import{afterAll,afterEach,beforeAll,describe,expect,it,vi}from'vitest';
import type{PGlite}from'@electric-sql/pglite';
import{createTestDatabase,testDatabaseAdapter}from'./helpers/database';
import{createSession}from'../src/services/sessions';
import{deliverCommunityPush,checkCommunityPushReceipts,preferenceCategoryFor}from'../src/services/community-push';
import{deliverQueuedNotifications}from'../src/services/notification-outbox';
import type{Bindings}from'../src/types';
let db:PGlite;
vi.mock('../src/lib/database',()=>({database:()=>testDatabaseAdapter(db),firstRow:(r:{rows:unknown[]})=>r.rows[0]}));
const user='68000000-0000-4000-8000-000000000001',campus='68000000-0000-4000-8000-000000000002';
const env={ENVIRONMENT:'local',UNIFIED_SCHEMA_READY:'true',JWT_SECRET:'test-only-push-session-secret-12345678901234'}as Bindings;
let family:string;
beforeAll(async()=>{
 db=await createTestDatabase();
 await db.query("insert into universities(id,name,slug,updated_at)values($1,'Push test campus','push-test-campus',now())",[campus]);
 await db.query("insert into users(id,email,password_hash,email_verified_at,updated_at)values($1,'push@example.invalid','test-only',now(),now())",[user]);
 await db.query("insert into profiles(id,user_id,username,display_name,university_id,updated_at)values(gen_random_uuid(),$1,'push-test','Push test person',$2,now())",[user,campus]);
 await createSession(env,{id:user,email:'push@example.invalid',roles:['STUDENT'],operatorRoles:[],universityId:campus});
 family=(await db.query<{family_id:string}>('select family_id from refresh_tokens where user_id=$1 and revoked_at is null',[user])).rows[0]!.family_id;
},60000);
afterEach(()=>vi.unstubAllGlobals());
afterAll(async()=>db?.close());
async function queued(device=true){
 await db.exec('delete from app_private.community_push_deliveries;delete from app_private.notification_outbox;delete from public.in_app_notifications;delete from app_private.push_devices');
 const id=crypto.randomUUID(),key='announcement-push:'+id;
 await db.query("insert into public.in_app_notifications(user_id,institution_id,title,body,path,dedupe_key)values($1,$2,'Venue update','LT1 to LT2','/community?id=test',$3)",[user,campus,key.replace('announcement-push:','announcement:')]);
 await db.query("insert into app_private.notification_outbox(id,user_id,channel,subject,body,dedupe_key)values($1,$2,'PUSH','Venue update','LT1 to LT2',$3)",[id,user,key]);
 if(device)await db.query("insert into app_private.push_devices(user_id,token,session_family_id,platform,label,build_version)values($1,'ExpoPushToken[syntheticToken123456]',$2,'android','Test phone','test')",[user,family]);
 return id;
}
async function state(id:string){return(await db.query<{state:string;last_error_code:string}>('select state,last_error_code from app_private.notification_outbox where id=$1',[id])).rows[0]!;}
describe('durable push outbox',()=>{
 it('emails account restoration after a suspension expires only once',async()=>{
  await queued(false);
  const restriction=crypto.randomUUID();
  await db.query("insert into public.account_restrictions(id,user_id,institution_id,kind,reason,starts_at,ends_at,created_by)values($1,$2,$3,'SUSPENDED','Test restriction',now()-interval '2 hours',now()-interval '1 hour',$2)",[restriction,user,campus]);
  const fetcher=vi.fn().mockResolvedValue(Response.json({id:'restoration-email'}));vi.stubGlobal('fetch',fetcher);
  const mailEnv={...env,RESEND_API_KEY:'test-only',RESEND_FROM_EMAIL:'KampusOne <team@example.invalid>'};
  expect(await deliverQueuedNotifications(mailEnv)).toEqual({sent:1});expect(await deliverQueuedNotifications(mailEnv)).toEqual({sent:0});
  expect(fetcher).toHaveBeenCalledTimes(1);expect(JSON.parse(fetcher.mock.calls[0]![1].body).subject).toBe('Your KampusOne account has been restored');
  await db.query('delete from public.account_restrictions where id=$1',[restriction]);
 });
 it('waits for registration without claiming an unsent notification was sent',async()=>{
  const id=await queued(false),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  await deliverCommunityPush(env);expect(await state(id)).toEqual({state:'PENDING',last_error_code:'NO_ELIGIBLE_DEVICE'});expect(fetcher).not.toHaveBeenCalled();
 });
 it('retries an acknowledged rate rejection once due and keeps the same delivery identifier',async()=>{
  const id=await queued(),fetcher=vi.fn().mockResolvedValueOnce(new Response('',{status:429})).mockResolvedValueOnce(Response.json({data:{status:'ok',id:'synthetic-ticket'}}));vi.stubGlobal('fetch',fetcher);
  await deliverCommunityPush(env);expect((await state(id)).state).toBe('PENDING');
  await db.exec('update app_private.community_push_deliveries set next_attempt_at=now();update app_private.notification_outbox set next_attempt_at=now()');
  await deliverCommunityPush(env);expect((await state(id)).state).toBe('SENT');expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetcher.mock.calls[0]![1].body).data.deliveryId).toBe(JSON.parse(fetcher.mock.calls[1]![1].body).data.deliveryId);
  const deliveries=await db.query<{attempts:number;status:string}>('select attempts,status from app_private.community_push_deliveries where outbox_id=$1',[id]);expect(deliveries.rows).toEqual([{attempts:2,status:'ACCEPTED'}]);
  await deliverCommunityPush(env);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('preserves an uncertain acknowledgement without blindly sending twice',async()=>{
  const id=await queued(),fetcher=vi.fn().mockRejectedValue(new Error('timeout'));vi.stubGlobal('fetch',fetcher);
  await deliverCommunityPush(env);expect(await state(id)).toEqual({state:'FAILED',last_error_code:'DELIVERY_UNCONFIRMED'});
  await db.query("update app_private.notification_outbox set state='PENDING',next_attempt_at=now() where id=$1",[id]);await deliverCommunityPush(env);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('disables an unregistered device after a provider receipt and reports the failed delivery',async()=>{
  const id=await queued();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({data:{status:'ok',id:'gone-ticket'}})).mockResolvedValueOnce(Response.json({data:{'gone-ticket':{status:'error',details:{error:'DeviceNotRegistered'}}}})));
  await deliverCommunityPush(env);await db.exec("update app_private.community_push_deliveries set updated_at=now()-interval '16 minutes'");await checkCommunityPushReceipts(env);
  expect((await state(id)).last_error_code).toBe('DeviceNotRegistered');expect((await db.query('select active from app_private.push_devices')).rows).toEqual([{active:false}]);
 });
 it('rechecks mention visibility, edits and mutual blocks before delivering to the social channel',async()=>{
  const author=crypto.randomUUID(),source=crypto.randomUUID(),post=crypto.randomUUID(),otherCampus=crypto.randomUUID();
  await db.query("insert into universities(id,name,slug,updated_at)values($1,'Other mention campus',$1::uuid::text,now())",[otherCampus]);
  await db.query("insert into users(id,email,password_hash,updated_at)values($1,$1::uuid::text||'@example.invalid','test-only',now())",[author]);
  await db.query("insert into profiles(id,user_id,username,display_name,university_id,updated_at)values(gen_random_uuid(),$1,'mention_author','Mention author',$2,now());",[author,campus]);
  await db.query("update profiles set username='push_test' where user_id=$1",[user]);
  await db.query("insert into content_sources(id,university_id,name,owner_user_id)values($1,$2,'Mention author',$3)",[source,campus,author]);
  await db.query("insert into feed_posts(id,university_id,source_id,author_user_id,category,title,summary,body,audience,status,published_at)values($1,$2,$3,$4,'UPDATE','Post title','Post summary','Hello @push_test',jsonb_build_object('visibility','CAMPUS'),'PUBLISHED',now())",[post,campus,source,author]);
  const mentionQueue=async()=>{const id=await queued();const key='post-mention:'+post+':'+user;await db.query('update app_private.notification_outbox set dedupe_key=$2 where id=$1',[id,key]);await db.query('update in_app_notifications set dedupe_key=$1,path=$2',[key,'/post?id='+post]);return id;};
  const fetcher=vi.fn().mockResolvedValue(Response.json({data:{status:'ok',id:'mention-ticket'}}));vi.stubGlobal('fetch',fetcher);
  const first=await mentionQueue();expect(preferenceCategoryFor('post-mention:'+post)).toBe('mentions');await deliverCommunityPush(env);
  expect((await state(first)).state).toBe('SENT');expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({channelId:'kampusone-social-v1',data:{preferenceCategory:'mentions',path:'/post?id='+post}});
  const changed=await mentionQueue();await db.query("update feed_posts set body='Mention removed' where id=$1",[post]);await deliverCommunityPush(env);expect((await state(changed)).last_error_code).toBe('POST_OR_AUDIENCE_CHANGED');
  const blocked=await mentionQueue();await db.query("update feed_posts set body='Hello @push_test' where id=$1",[post]);await db.query('insert into user_blocks(blocker_id,blocked_id)values($1,$2)',[author,user]);await deliverCommunityPush(env);expect((await state(blocked)).last_error_code).toBe('POST_OR_AUDIENCE_CHANGED');
  await db.query('delete from user_blocks where blocker_id=$1 and blocked_id=$2',[author,user]);const transferred=await mentionQueue();await db.query('update feed_posts set university_id=$2 where id=$1',[post,otherCampus]);await deliverCommunityPush(env);expect((await state(transferred)).last_error_code).toBe('POST_OR_AUDIENCE_CHANGED');
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
});
