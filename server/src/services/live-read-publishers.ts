import {sql} from 'drizzle-orm';
import {database} from '../lib/database';
import {publishUserReads} from '../lib/live-updates';
import type {Bindings} from '../types';
export const livePublishingEnabled=(env:Bindings)=>env.LIVE_UPDATES_ENABLED==='true'&&Boolean(env.LIVE_USERS);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Invalidation only. Resolve the recipient's current approved scope, never an old upload/device scope. */
export async function publishNotificationRead(env:Bindings,userId:string,eventId:string,institutionId?:string|null){
  if(!livePublishingEnabled(env)||!uuid.test(userId))return;
  const target=await database(env).execute<{user_id:string;university_id:string|null}>(sql`
    select p.user_id,p.university_id from public.profiles p join public.users u on u.id=p.user_id
    where p.user_id=${userId}::uuid and p.deleted_at is null and u.status::text='ACTIVE' and u.deleted_at is null
      and (${institutionId??null}::uuid is null or p.university_id=${institutionId??null}::uuid)
      and not exists(select 1 from public.account_restrictions r where r.user_id=u.id and r.revoked_at is null and r.starts_at<=now()and(r.ends_at is null or r.ends_at>now()))
  `);
  for(const row of target.rows)await publishUserReads(env,row.user_id,row.university_id,{id:eventId,prefixes:['/v1/notifications/inbox']});
}
/** Bounded first-party dispatch fanout; remaining readers reconcile through the existing HTTP fallback. */
export async function publishRiderQueueReads(env:Bindings,institutionId:string|null,eventId:string,actorId:string){
  if(!livePublishingEnabled(env)||!institutionId||!uuid.test(institutionId)||!uuid.test(actorId))return;
  const targets=await database(env).execute<{user_id:string;university_id:string}>(sql`
    with eligible as(
      select distinct p.user_id,p.university_id,(p.user_id=${actorId}::uuid) as actor
      from public.profiles p join public.users u on u.id=p.user_id
      where p.university_id=${institutionId}::uuid and p.deleted_at is null and u.status::text='ACTIVE' and u.deleted_at is null
        and not exists(select 1 from public.account_restrictions r where r.user_id=u.id and r.revoked_at is null and r.starts_at<=now()and(r.ends_at is null or r.ends_at>now()))
        and (p.user_id=${actorId}::uuid or exists(
          select 1 from public.agent_profiles a join public.rider_presence presence on presence.rider_profile_id=a.id
          where a.user_id=p.user_id and a.university_id=p.university_id and a.agent_type='RIDER' and a.status='ACTIVE' and presence.online
        ))
    ) select user_id,university_id from eligible order by actor desc,user_id limit 16
  `);
  await Promise.all(targets.rows.map(row=>publishUserReads(env,row.user_id,row.university_id,{id:eventId+':'+row.user_id,prefixes:['/v1/agents']})));
}
