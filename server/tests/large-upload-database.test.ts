import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase} from './helpers/database';
let db:PGlite;
const user=crypto.randomUUID(),other=crypto.randomUUID(),uni=crypto.randomUUID();
const migration=(name:string)=>readFileSync(new URL('../../database/neon/migrations/'+name,import.meta.url),'utf8');
beforeAll(async()=>{
 db=await createTestDatabase();
 // Upload DDL does not need PostGIS; GIS acceptance runs separately on Neon.
 const foundation=migration('20261001180000_map_v2_and_message_uploads.sql');
 const table=foundation.match(/create table if not exists app_private\.media_upload_sessions\([\s\S]*?\n\);/);
 if(!table)throw new Error('Upload session DDL is missing');await db.exec(table[0]);
 const limits=migration('20261001187000_media_limits_map_capture_controls.sql').split('create table if not exists app_private.campus_map_controls')[0];
 await db.exec(limits+'commit;');
 await db.exec(migration('20261001190000_atomic_large_upload_allowance.sql'));
 await db.query("insert into universities(id,name,slug,updated_at)values($1,'Upload fixture',$1::uuid::text,now())",[uni]);
 for(const id of [user,other])await db.query("insert into users(id,email,password_hash,updated_at)values($1,$1::uuid::text||'@example.test','fixture',now())",[id]);
});
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('begin;');});afterEach(async()=>{await db.exec('rollback;');});
async function reserve(id=crypto.randomUUID(),owner=user,size=524288000){return db.query<{id:string,multipart_id:string}>('select id,multipart_id from app_private.reserve_message_upload($1,$2,$3,$4,$5,$6,$7,$8)',[id,owner,uni,'message/'+owner+'/'+id,'multipart-'+id,'notes.pdf','application/pdf',size]);}
it('persists a 500 MiB DM object while retaining the smaller identity limit',async()=>{
 await db.query("insert into media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name)values($1,$2,$3,'message','fixture-large','application/pdf',524288000,'notes.pdf')",[crypto.randomUUID(),user,uni]);
 await expect(db.query("insert into media_objects(id,owner_user_id,kind,object_key,content_type,size_bytes,original_name)values($1,$2,'kyc','fixture-identity','image/jpeg',10485761,'identity.jpg')",[crypto.randomUUID(),user])).rejects.toThrow('media_objects_size_bytes_check');
});
it('rejects a DM larger than 500 MiB at the database boundary',async()=>{
 await expect(db.query("insert into media_objects(id,owner_user_id,kind,object_key,content_type,size_bytes,original_name)values($1,$2,'message','fixture-too-large','application/pdf',524288001,'notes.pdf')",[crypto.randomUUID(),user])).rejects.toThrow('media_objects_size_bytes_check');
});
it('includes the requested bytes in the daily quota and keeps an existing reservation retryable',async()=>{
 const first=crypto.randomUUID();await reserve(first);for(let n=0;n<3;n++)await reserve();
 expect((await reserve(first)).rows[0]?.id).toBe(first);
 await expect(reserve()).rejects.toThrow('UPLOAD_ALLOWANCE_EXHAUSTED');
});
it('does not let another account reuse a private upload reservation',async()=>{
 const id=crypto.randomUUID();await reserve(id);await expect(reserve(id,other)).rejects.toThrow('UPLOAD_SESSION_CONFLICT');
});
it('does not let a retry change the reserved file size',async()=>{
 const id=crypto.randomUUID();await reserve(id);await expect(reserve(id,user,100)).rejects.toThrow('UPLOAD_SESSION_CONFLICT');
});
