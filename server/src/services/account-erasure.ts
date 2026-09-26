import { sql } from 'drizzle-orm';
import { database, firstRow } from '../lib/database';
import type { Bindings } from '../types';

/** Small retryable batches; deletion never relies on an in-memory background job. */
export async function eraseDeletedAccountMedia(env:Bindings) {
  if(env.UNIFIED_SCHEMA_READY!=='true') return;
  const db=database(env);
  if(!firstRow(await db.execute<{ready:boolean}>(sql`select to_regclass('app_private.account_media_erasure') is not null as ready`))?.ready) return;
  const jobs=await db.execute<{media_id:string;object_key:string;kind:string}>(sql`
    with due as(select media_id from app_private.account_media_erasure where erased_at is null and next_attempt_at<=now() order by next_attempt_at limit 30 for update skip locked)
    update app_private.account_media_erasure job set attempts=attempts+1,next_attempt_at=now()+interval '5 minutes'
    from due where due.media_id=job.media_id returning job.media_id,job.object_key,job.kind`);
  for(const job of jobs.rows) {
    try {
      // Historical objects may have moved buckets. Both deletes are idempotent.
      if(!env.MEDIA_BUCKET||!env.PRIVATE_BUCKET) throw new Error('STORAGE_UNAVAILABLE');
      await Promise.all([env.MEDIA_BUCKET.delete(job.object_key),env.PRIVATE_BUCKET.delete(job.object_key)]);
      await db.execute(sql`update app_private.account_media_erasure set erased_at=now() where media_id=${job.media_id}::uuid`);
    } catch {
      console.error(JSON.stringify({event:'account.media_erasure.retry',mediaId:job.media_id}));
      await db.execute(sql`update app_private.account_media_erasure set next_attempt_at=now()+interval '1 hour' where media_id=${job.media_id}::uuid`);
    }
  }
}
