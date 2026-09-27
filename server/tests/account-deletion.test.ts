import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase} from './helpers/database';
let db:PGlite;
const owner=crypto.randomUUID(),other=crypto.randomUUID(),campus=crypto.randomUUID(),family=crypto.randomUUID();
async function challenge(){const id=crypto.randomUUID();await db.query("insert into app_private.account_deletion_codes(id,user_id,session_family_id,token_hash) values($1,$2,$3,'correct-hash')",[id,owner,family]);return id;}
async function remove(id:string,hash='correct-hash',actor=owner,session=family){return (await db.query<{outcome:string}>('select app_private.delete_own_account($1,$2,$3,$4,$5) as outcome',[actor,session,id,hash,crypto.randomUUID()])).rows[0]?.outcome;}
beforeAll(async()=>{db=await createTestDatabase();await db.query("insert into public.universities(id,name,slug,updated_at) values($1,'Deletion test','deletion-test',now())",[campus]);for(const uid of [owner,other]){await db.query("insert into public.users(id,email,password_hash,updated_at) values($1,$2,'private-hash',now())",[uid,uid+'@test.invalid']);await db.query("insert into public.profiles(id,user_id,username,display_name,university_id,updated_at) values(gen_random_uuid(),$1,$2,'Private person',$3,now())",[uid,'user_'+uid.slice(0,8),campus]);}},60000);
afterAll(async()=>{await db?.close();});
describe('account deletion transaction',()=>{
 it('rejects another account or session and persists a five-attempt limit',async()=>{
  const id=await challenge();expect(await remove(id,'correct-hash',other)).toBe('INVALID_CODE');expect(await remove(id,'correct-hash',owner,crypto.randomUUID())).toBe('INVALID_CODE');
  for(let i=0;i<5;i++)expect(await remove(id,'wrong')).toBe('INVALID_CODE');
  expect(await remove(id)).toBe('INVALID_CODE');expect((await db.query('select deleted_at from public.users where id=$1',[owner])).rows[0]).toEqual({deleted_at:null});
 });
 it('rejects expired confirmation without changing the account',async()=>{
  const id=await challenge();await db.query("update app_private.account_deletion_codes set expires_at=now()-interval '1 minute' where id=$1",[id]);expect(await remove(id)).toBe('INVALID_CODE');
 });
 it('atomically anonymizes identity, removes social content and schedules durable file erasure',async()=>{
  const post=crypto.randomUUID(),media=crypto.randomUUID(),source=crypto.randomUUID();
  await db.query("insert into content_sources(id,university_id,name) values($1,$2,'Source')",[source,campus]);
  await db.query("insert into public.feed_posts(id,university_id,author_user_id,source_id,category,summary,title,body,status,published_at) values($1,$2,$3,$4,'UPDATE','Summary','Private post','Private content','PUBLISHED',now())",[post,campus,owner,source]);
  await db.query("insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name) values($1,$2,$3,'avatar','private-avatar','image/png',100,'my-photo.png')",[media,owner,campus]);
  await db.query("insert into public.feed_comments(post_id,institution_id,author_user_id,body,client_request_id) values($1,$2,$3,'Private comment',gen_random_uuid())",[post,campus,owner]);
  const id=await challenge();expect(await remove(id)).toBe('DELETED');
  expect((await db.query('select email,password_hash,status::text from public.users where id=$1',[owner])).rows[0]).toEqual({email:'deleted+'+owner+'@account.invalid',password_hash:'deleted',status:'DEACTIVATED'});
  expect((await db.query('select display_name,university_id from public.profiles where user_id=$1',[owner])).rows[0]).toEqual({display_name:'Deleted account',university_id:null});
  expect((await db.query('select body,status from public.feed_posts where id=$1',[post])).rows[0]).toEqual({body:'',status:'ARCHIVED'});
  expect((await db.query('select body from public.feed_comments where author_user_id=$1',[owner])).rows[0]).toEqual({body:'[deleted]'});
  expect((await db.query('select media_id from app_private.account_media_erasure where media_id=$1',[media])).rows).toHaveLength(1);
  expect((await db.query('select deleted_at from public.users where id=$1',[other])).rows[0]).toEqual({deleted_at:null});
  expect(await remove(id)).toBe('INVALID_CODE');
 });
});
