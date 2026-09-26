import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {Hono} from 'hono';
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase,testDatabaseAdapter,testSqlClient} from './helpers/database';
import {peopleRoutes} from '../src/routes/people';
import {mediaRoutes} from '../src/routes/media';
import {messageRoutes} from '../src/routes/messages';
import {accountRoutes} from '../src/routes/account';
import {AppError} from '../src/lib/errors';
import type {Bindings,Variables} from '../src/types';
let db:PGlite;
vi.mock('../src/lib/database',()=>({database:()=>testDatabaseAdapter(db),sqlClient:()=>testSqlClient(db),firstRow:(r:{rows:unknown[]})=>r.rows[0]}));
vi.mock('../src/middleware/auth',()=>({requireAuth:async(c:any,next:()=>Promise<void>)=>{c.set('user',{id:c.req.header('X-Test-User'),universityId:campus,roles:['STUDENT']});await next();},currentUser:(c:any)=>c.get('user')}));
const campus='11000000-0000-4000-8000-000000000099',a='11000000-0000-4000-8000-000000000001',b='11000000-0000-4000-8000-000000000002',outsider='11000000-0000-4000-8000-000000000003';
const env={UNIFIED_SCHEMA_READY:'true',JWT_SECRET:'private-test-key-only-000000000000000000000'} as Bindings;
const app=new Hono<{Bindings:Bindings;Variables:Variables}>();app.route('/media',mediaRoutes);app.route('/people',peopleRoutes);app.route('/messages',messageRoutes);app.route('/account',accountRoutes);app.onError((e,c)=>c.json({error:e.message},e instanceof AppError?e.status:500));
function request(path:string,method='GET',body?:unknown,user=a){return app.request('https://test.invalid'+path,{method,headers:{'X-Test-User':user,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},{...env});}
async function json(r:Response,status=200){const data:any=await r.json();expect({status:r.status,...(r.status===status?{}:{data})}).toEqual({status});return data;}
beforeAll(async()=>{db=await createTestDatabase();await db.exec(readFileSync(new URL('../../database/neon/migrations/20260926120000_profile_safety_and_messages.sql',import.meta.url),'utf8'));await db.query("insert into public.universities(id,name,slug,updated_at) values($1,'Test Campus','test-campus',now())",[campus]);for(const uid of [a,b,outsider]){await db.query("insert into public.users(id,email,password_hash,updated_at) values($1,$2,'test',now())",[uid,uid+'@test.invalid']);await db.query("insert into public.profiles(id,user_id,university_id,display_name,username,updated_at) values(gen_random_uuid(),$1,$2,'Student',$3,now())",[uid,campus,'user_'+uid.slice(-1)]);}},60000);
beforeEach(async()=>{await db.exec('truncate public.direct_messages,public.direct_threads,public.user_blocks,public.profile_social_policies,public.profile_reports,public.profile_post_subscriptions,public.profile_follows,app_private.request_rate_limits');});
afterAll(async()=>{await db?.close();});
describe('Profile safety and direct-message boundaries',()=>{
 it('creates an optional-reason block, hides profile and prevents messages; unblock is owner-scoped',async()=>{
  await json(await request('/people/'+b+'/block','PUT',{}));
  const blocked=await json(await request('/account/blocked'));expect(blocked.profiles[0].user_id).toBe(b);
  await json(await request('/people/'+b),404);
  await json(await request('/messages/threads','POST',{userId:b}),404);
  await json(await request('/people/'+b+'/block','DELETE',undefined,outsider));
  expect((await json(await request('/account/blocked'))).profiles).toHaveLength(1);
  await json(await request('/people/'+b+'/block','DELETE'));expect((await json(await request('/account/blocked'))).profiles).toHaveLength(0);
 });
 it('enforces protected profiles on the server and persists private report reason',async()=>{
  await db.query('insert into public.profile_social_policies(user_id,block_protected) values($1,true)',[b]);
  await json(await request('/people/'+b+'/block','PUT',{reason:'Other'}),403);
  await json(await request('/people/'+b+'/report','POST',{reason:'Harassment',details:'Test report'}),201);
  expect((await db.query('select reason from public.profile_reports')).rows).toEqual([{reason:'Harassment'}]);
 });
 it('requires recipient acceptance, denies outsiders and retries a sent message idempotently',async()=>{
  const created=await json(await request('/messages/threads','POST',{userId:b}),201),tid=created.thread.id;expect(created.thread.status).toBe('REQUESTED');
  const mid=crypto.randomUUID();await json(await request('/messages/threads/'+tid+'/messages','POST',{id:mid,body:'Hello'}),201);
  await json(await request('/messages/threads/'+tid+'/messages','POST',{id:mid,body:'Hello'}));
  await json(await request('/messages/threads/'+tid, 'GET',undefined,outsider),404);
  await json(await request('/messages/threads/'+tid+'/messages','POST',{id:crypto.randomUUID(),body:'Another'}),403);
  await json(await request('/messages/threads/'+tid+'/accept','PUT',{accept:true}),403);
  await json(await request('/messages/threads/'+tid+'/accept','PUT',{accept:true},b));
  await json(await request('/messages/threads/'+tid+'/messages','POST',{id:crypto.randomUUID(),body:'Hi'},b),201);
  expect((await json(await request('/messages/inbox'))).unreadCount).toBe(1);
  await json(await request('/messages/threads/'+tid+'/read','PUT'));expect((await json(await request('/messages/inbox'))).unreadCount).toBe(0);
 });
 it('opens accepted conversations when recipient follows sender and closes access on block',async()=>{
  await db.query('insert into public.profile_follows(follower_id,followed_id) values($1,$2)',[b,a]);
  const created=await json(await request('/messages/threads','POST',{userId:b}),201);expect(created.thread.status).toBe('ACCEPTED');
  await json(await request('/people/'+a+'/block','PUT',{},b));
  await json(await request('/messages/threads/'+created.thread.id),404);
  expect((await json(await request('/messages/inbox'))).threads).toHaveLength(0);
 });
});

it('keeps message files private, requires acceptance and ownership, and revokes access on block',async()=>{
 const file=crypto.randomUUID();await db.query("insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name) values($1::uuid,$2,$3,'message',($1::uuid)::text,'image/png',100,'photo.png')",[file,a,campus]);
 const t=(await json(await request('/messages/threads','POST',{userId:b}),201)).thread.id;
 await json(await request('/messages/threads/'+t+'/messages','POST',{id:crypto.randomUUID(),mediaId:file}),403);
 await json(await request('/messages/threads/'+t+'/accept','PUT',{accept:true},b));
 await json(await request('/messages/threads/'+t+'/messages','POST',{id:crypto.randomUUID(),mediaId:file},b),404);
 const mid=crypto.randomUUID();await json(await request('/messages/threads/'+t+'/messages','POST',{id:mid,mediaId:file}),201);
 await json(await request('/messages/threads/'+t+'/messages','POST',{id:mid,mediaId:file}));
 await json(await request('/media/'+file+'/access','POST',{},outsider),403);
 const access=await json(await request('/media/'+file+'/access','POST',{},b));expect(access.expiresIn).toBe(90);expect(access.url).toContain('?access=');
 await json(await request('/people/'+a+'/block','PUT',{},b));await json(await request('/media/'+file+'/access','POST',{},b),403);
});
it('paginates messages in stable chronological order without overlapping pages',async()=>{
 await db.query('insert into public.profile_follows(follower_id,followed_id) values($1,$2)',[b,a]);
 const tid=(await json(await request('/messages/threads','POST',{userId:b}),201)).thread.id;
 await db.query("insert into public.direct_messages(id,thread_id,sender_id,body,created_at) select gen_random_uuid(),$1,$2,'Message '||n,now()+(n||' seconds')::interval from generate_series(1,65) n",[tid,a]);
 const first=await json(await request('/messages/threads/'+tid));expect(first.messages).toHaveLength(50);expect(first.messages[0].body).toBe('Message 16');expect(first.nextCursor).toBeTruthy();
 const second=await json(await request('/messages/threads/'+tid+'?before='+first.nextCursor));expect(second.messages).toHaveLength(15);expect(second.messages[0].body).toBe('Message 1');expect(second.nextCursor).toBeNull();
});

it('paginates more than 100 inbox conversations and counts all unread messages, with server filters and private cursors',async()=>{
 await db.exec("insert into public.users(id,email,password_hash,updated_at) select gen_random_uuid(),'pagination-'||n||'@test.invalid','test',now() from generate_series(1,105) n");
 await db.query("insert into public.profiles(id,user_id,university_id,display_name,username,updated_at) select gen_random_uuid(),id,$1,'Student',left(replace(id::text,'-',''),28),now() from public.users where email like 'pagination-%'",[campus]);
 await db.query("insert into public.direct_threads(institution_id,initiator_id,recipient_id,status) select $1,$2,id,'ACCEPTED' from public.users where email like 'pagination-%'",[campus,a]);
 await db.query("insert into public.direct_messages(id,thread_id,sender_id,body) select gen_random_uuid(),id,recipient_id,'Hello' from public.direct_threads where initiator_id=$1",[a]);
 const seen=new Set<string>();let cursor:string|null=null;const sizes:number[]=[];
 do {const page=await json(await request('/messages/inbox'+(cursor?'?before='+encodeURIComponent(cursor):'')));sizes.push(page.threads.length);expect(page.unreadCount).toBe(105);for(const t of page.threads){expect(seen.has(t.id)).toBe(false);seen.add(t.id);}cursor=page.nextCursor;}while(cursor);
 expect(sizes).toEqual([50,50,5]);expect(seen.size).toBe(105);
 expect((await json(await request('/messages/inbox?filter=Requests'))).threads).toEqual([]);
 expect((await json(await request('/messages/inbox?filter=Unread'))).threads).toHaveLength(50);
 expect((await json(await request('/messages/inbox','GET',undefined,outsider))).unreadCount).toBe(0);
 await json(await request('/messages/inbox?before=not-a-cursor'),400);
});
