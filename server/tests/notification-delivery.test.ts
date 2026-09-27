import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase,testDatabaseAdapter,testSqlClient} from './helpers/database';
import {createSession} from '../src/services/sessions';
import {app} from '../src/app';
import {notifyFeedInteraction,notifyPublishedPost} from '../src/services/feed-notifications';
import { readFileSync } from 'node:fs';
import {deliverCommunityPush,checkCommunityPushReceipts} from '../src/services/community-push';
import type {Bindings} from '../src/types';
let db:PGlite;
vi.mock('../src/lib/database',()=>({database:()=>testDatabaseAdapter(db),sqlClient:()=>testSqlClient(db),firstRow:(r:{rows:unknown[]})=>r.rows[0]}));
const staff='24000000-0000-4000-8000-000000000001',student='24000000-0000-4000-8000-000000000002',outsider='24000000-0000-4000-8000-000000000003';
const school='24000000-0000-4000-8000-000000000010',school2='24000000-0000-4000-8000-000000000011';
const env:Bindings={ENVIRONMENT:'local',ALLOWED_ORIGINS:'https://app.example.invalid',MINIMUM_APP_VERSION:'0.2.0',MAINTENANCE_MODE:'false',ACADEMIC_CORE_ENABLED:'true',SOCIAL_FEED_ENABLED:'true',MARKETPLACE_ENABLED:'false',PAYMENTS_ENABLED:'false',AI_ASSISTANT_ENABLED:'false',UNIFIED_SCHEMA_READY:'true',JWT_SECRET:'test-only-long-signing-secret-do-not-deploy-123456789'};
const tokens=new Map<string,string>();
async function request(path:string,method='GET',body?:unknown,actor=staff){return app.request('https://api.example.invalid/v1/notifications'+path,{method,headers:{Authorization:`Bearer ${tokens.get(actor)}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},env)}
async function data(res:Response,status=200){const body=await res.json();expect({status:res.status,...(res.status===status?{}:{body})}).toEqual({status});return body as any;}
beforeAll(async()=>{
 db=await createTestDatabase();
 for(const [idx,id] of [school,school2].entries())await db.query('insert into public.universities(id,name,slug,updated_at) values($1,$2,$3,now())',[id,`Push School ${idx}`,`push-school-${idx}`]);
 for(const [idx,user] of [staff,student,outsider].entries()){
  await db.query("insert into public.users(id,email,password_hash,updated_at) values($1,$2,'test-only',now())",[user,`push${idx}@example.invalid`]);
  await db.query('insert into public.profiles(id,user_id,username,display_name,university_id,updated_at) values(gen_random_uuid(),$1,$2,$3,$4,now())',[user,`push${idx}`,`Test ${idx}`,idx===2?school2:school]);
  tokens.set(user,(await createSession(env,{id:user,email:`push${idx}@example.invalid`,roles:['STUDENT'],operatorRoles:[],universityId:idx===2?school2:school})).accessToken);
 }
 await db.query("insert into app_private.staff_access(user_id,permissions,university_ids,updated_by) values($1,ARRAY['notifications.test'],$2::uuid[],$1)",[staff,[school]]);
},60000);
afterAll(async()=>{await db?.close()});
afterEach(()=>vi.unstubAllGlobals());
const register=(token:string,actor=student)=>request('/devices','POST',{expoPushToken:token,platform:'android',label:'Test phone',buildVersion:'0.2.0-test'},actor).then(r=>data(r));
describe('selected-device notification delivery',()=>{
 let deviceId:string,otherDeviceId:string;
 it('registers an authenticated native device without returning its token',async()=>{
  const r=await register('ExpoPushToken[test_native_device_123]');deviceId=r.device.id;expect(JSON.stringify(r)).not.toContain('ExpoPushToken');
  otherDeviceId=(await register('ExpoPushToken[other_native_device_123]',outsider)).device.id;
  const rows=await data(await request('/devices','GET',undefined,student));expect(rows.devices).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain('ExpoPushToken');
 });
 it('does not expose other-university devices or allow student staff endpoints',async()=>{
  const r=await data(await request('/admin/devices'));expect(r.devices.map((d:any)=>d.id)).toEqual([deviceId]);
  await data(await request(`/admin/devices?universityId=${school2}`),403);
  await data(await request('/admin/devices','GET',undefined,student),403);
  const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
  await data(await request('/admin/test','POST',{deviceId:otherDeviceId,requestId:crypto.randomUUID()}),403);expect(fetchMock).not.toHaveBeenCalled();
 });
 it('targets exactly one device and retries never resend the same attempt',async()=>{
  const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{status:'ok',id:'ticket-001'}}),{status:200}));vi.stubGlobal('fetch',fetchMock);
  const requestId=crypto.randomUUID();
  const r=await data(await request('/admin/test','POST',{deviceId,requestId}),202);expect(r).toMatchObject({status:'ACCEPTED',deviceDelivery:'not_observed'});
  const repeated=await data(await request('/admin/test','POST',{deviceId,requestId}));expect(repeated.status).toBe('ACCEPTED');expect(fetchMock).toHaveBeenCalledTimes(1);
  const payload=JSON.parse(fetchMock.mock.calls[0][1].body);expect(payload.to).toBe('ExpoPushToken[test_native_device_123]');expect(payload.data.attemptId).toBe(requestId);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({data:{'ticket-001':{status:'ok'}}}),{status:200}));
  const receipt=await data(await request(`/admin/attempts/${requestId}/receipt`,'POST',{}));expect(receipt).toEqual({status:'RECEIPT_OK',deviceDelivery:'not_observed'});
  await data(await request(`/attempts/${requestId}/observed`,'POST',{},outsider),404);
  const observed=await data(await request(`/attempts/${requestId}/observed`,'POST',{},student));expect(observed.observation.observed_at).toBeTruthy();
 });
 it('preserves uncertain delivery and does not automatically duplicate a timed-out send',async()=>{
  const fetchMock=vi.fn().mockRejectedValue(new Error('timeout'));vi.stubGlobal('fetch',fetchMock);
  const requestId=crypto.randomUUID();const r=await data(await request('/admin/test','POST',{deviceId,requestId}),202);expect(r.status).toBe('UNKNOWN');
  expect((await data(await request('/admin/test','POST',{deviceId,requestId}))).status).toBe('UNKNOWN');expect(fetchMock).toHaveBeenCalledTimes(1);
 });
 it('retires unregistered tokens and hides them from subsequent test selection',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{status:'error',details:{error:'DeviceNotRegistered'}}}),{status:200})));
  const r=await data(await request('/admin/test','POST',{deviceId,requestId:crypto.randomUUID()}),202);expect(r).toMatchObject({status:'FAILED',errorCode:'DeviceNotRegistered'});
  expect((await data(await request('/admin/devices'))).devices).toEqual([]);
 });
 it('does not let another user disable a device or accept browser tokens',async()=>{
  await register('ExpoPushToken[test_native_device_123]');
  await data(await request(`/devices/${deviceId}`,'DELETE',undefined,outsider));
  expect((await data(await request('/devices','GET',undefined,student))).devices[0].active).toBe(true);
  await data(await request('/devices','POST',{expoPushToken:'plain-browser-token',platform:'web',label:'Browser',buildVersion:'0.2.0'},student),400);
 });
 it('blocks targeting a device after its linked session is revoked',async()=>{
  const r=await register('ExpoPushToken[test_native_device_123]');
  await db.query('update public.refresh_tokens set revoked_at=now() where user_id=$1',[student]);
  const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
  await data(await request('/admin/test','POST',{deviceId:r.device.id,requestId:crypto.randomUUID()}),404);
  expect(fetchMock).not.toHaveBeenCalled();
 });

});

describe('community announcement delivery',()=>{
 async function queue(actor=student,institution=school){
  const announcement=crypto.randomUUID(),key=announcement+':'+actor;
  await db.query("insert into public.in_app_notifications(user_id,institution_id,title,body,path,dedupe_key) values($1,$2,'Class update','Bring your lab notes','/community?id=test',$3)",[actor,institution,'announcement:'+key]);
  return (await db.query<{id:string}>("insert into app_private.notification_outbox(user_id,channel,subject,body,dedupe_key) values($1,'PUSH','Class update','Bring your lab notes',$2) returning id",[actor,'announcement-push:'+key])).rows[0]!.id;
 }
 beforeAll(async()=>{
  tokens.set(student,(await createSession(env,{id:student,email:'push1@example.invalid',roles:['STUDENT'],operatorRoles:[],universityId:school})).accessToken);
  await register('ExpoPushToken[test_native_device_123]');
 });
 it('sends an announcement once per active device and records its receipt',async()=>{
  const outbox=await queue(),fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:{status:'ok',id:'community-ticket'}})));vi.stubGlobal('fetch',fetchMock);
  await deliverCommunityPush(env);await deliverCommunityPush(env);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({to:'ExpoPushToken[test_native_device_123]',title:'Class update',data:{kind:'campus-update',path:'/community?id=test'}});
  expect((await db.query('select status from app_private.community_push_deliveries where outbox_id=$1',[outbox])).rows).toEqual([{status:'ACCEPTED'}]);
  await db.query("update app_private.community_push_deliveries set created_at=now()-interval '16 minutes' where outbox_id=$1",[outbox]);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({data:{'community-ticket':{status:'ok'}}})));
  await checkCommunityPushReceipts(env);
  expect((await db.query('select status from app_private.community_push_deliveries where outbox_id=$1',[outbox])).rows).toEqual([{status:'RECEIPT_OK'}]);
 });
 it('respects notification opt-out and never sends an old-campus announcement after a transfer',async()=>{
  const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
  await db.query(`update profiles set settings='{"notifications":false}'::jsonb where user_id=$1`,[student]);
  await queue();await deliverCommunityPush(env);
  await db.query(`update profiles set settings='{}'::jsonb where user_id=$1`,[student]);
  await queue(student,school2);await deliverCommunityPush(env);
  expect(fetchMock).not.toHaveBeenCalled();
  expect((await db.query('select id from public.in_app_notifications where user_id=$1',[student])).rows.length).toBeGreaterThan(0);
 });
 it('retains uncertain send state without duplicating a provider request',async()=>{
  const outbox=await queue(),fetchMock=vi.fn().mockRejectedValue(new Error('network acknowledgement lost'));vi.stubGlobal('fetch',fetchMock);
  await deliverCommunityPush(env);
  await db.query("update app_private.notification_outbox set state='PENDING',next_attempt_at=now() where id=$1",[outbox]);
  await deliverCommunityPush(env);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect((await db.query('select status,error_code from app_private.community_push_deliveries where outbox_id=$1',[outbox])).rows).toEqual([{status:'UNKNOWN',error_code:'PUSH_NETWORK_UNCERTAIN'}]);
 });
});


describe('notification inbox and preferences',()=>{
 it('filters opted-out categories and gives an exact unread count for the inbox',async()=>{
  const preference=await data(await request('/preferences','GET',undefined,student));
  const preferences={...preference.preferences,likes:false,pushAnnouncements:false};
  await data(await request('/preferences','PUT',preferences,student));
  const id=crypto.randomUUID();
  await db.query("insert into public.in_app_notifications(user_id,institution_id,title,body,dedupe_key) values($1,$2,'Hidden like','social',$3),($1,$2,'Visible comment','reply',$4)",[student,school,'feed-like:'+id,'feed-comment:'+id]);
  const result=await data(await request('/inbox','GET',undefined,student));
  expect(result.notifications.some((item:any)=>item.title==='Hidden like')).toBe(false);
  expect(result.notifications.some((item:any)=>item.title==='Visible comment')).toBe(true);
  expect(result.unreadCount).toBe(result.notifications.filter((item:any)=>!item.read_at).length);
  await data(await request('/read-all','POST',{},student));
  expect((await data(await request('/inbox','GET',undefined,student))).unreadCount).toBe(0);
  await data(await request('/preferences','PUT',preference.preferences,student));
 });
 it('does not enqueue push notifications for social activity',async()=>{
  const post=crypto.randomUUID(),source=crypto.randomUUID();
  await db.query("insert into public.content_sources(id,university_id,name,verified) values($1,$2,'Social test',true)",[source,school]);
  await db.query("insert into public.feed_posts(id,source_id,university_id,author_user_id,category,title,summary,body,status) values($1,$2,$3,$4,'UPDATE','Post','Summary','Body','PUBLISHED')",[post,source,school,student]);
  await notifyFeedInteraction(env,post,staff,'like');
  const key='feed-like:'+post+':'+staff;
  expect((await db.query('select id from public.in_app_notifications where dedupe_key=$1',[key])).rows).toHaveLength(1);
  expect((await db.query("select id from app_private.notification_outbox where channel='PUSH' and dedupe_key=$1",[key])).rows).toHaveLength(0);
 });
 it('syncs owned alarm events once and ignores another user alarm',async()=>{
  const alarm=crypto.randomUUID(),firedAt=new Date().toISOString();
  await db.query("insert into public.student_alarms(id,user_id,institution_id,label,time,days,enabled) values($1,$2,$3,'MTH 201','08:00',ARRAY[1]::smallint[],true)",[alarm,student,school]);
  const events=[{id:crypto.randomUUID(),alarmId:alarm,kind:'ringing',firedAt},{id:crypto.randomUUID(),alarmId:alarm,kind:'missed',firedAt}];
  await data(await request('/alarm-events','POST',{events},outsider));
  expect((await db.query("select id from public.in_app_notifications where user_id=$1 and dedupe_key like 'alarm:%'",[outsider])).rows).toHaveLength(0);
  await data(await request('/alarm-events','POST',{events},student));await data(await request('/alarm-events','POST',{events},student));
  expect((await db.query("select id from public.in_app_notifications where user_id=$1 and dedupe_key like $2",[student,'alarm:'+alarm+':%'])).rows).toHaveLength(2);
 });
 it('dispatches subscribed posts in-app and only designated official posts by push',async()=>{
  await db.exec(readFileSync(new URL('../../database/neon/migrations/20260926120000_profile_safety_and_messages.sql',import.meta.url),'utf8'));
  const source=crypto.randomUUID();await db.query("insert into public.content_sources(id,university_id,name,verified) values($1,$2,'Official test',true)",[source,school]);
  await db.query('insert into public.profile_post_subscriptions(follower_id,target_id) values($1,$2)',[student,staff]);
  const publish=async()=>{const post=crypto.randomUUID();await db.query("insert into public.feed_posts(id,source_id,university_id,author_user_id,category,title,summary,body,status) values($1,$2,$3,$4,'UPDATE','New post','Summary','Full post','PUBLISHED')",[post,source,school,staff]);await notifyPublishedPost(env,post);return post;};
  const ordinary=await publish();
  expect((await db.query('select id from public.in_app_notifications where dedupe_key=$1',['profile-post:'+ordinary+':'+student])).rows).toHaveLength(1);
  expect((await db.query('select id from app_private.notification_outbox where dedupe_key like $1',['%'+ordinary+'%'])).rows).toHaveLength(0);
  await db.query('insert into public.profile_social_policies(user_id,institution_id,notify_all_in_app,notify_all_push) values($1,$2,true,true)',[staff,school]);
  const official=await publish();await notifyPublishedPost(env,official);
  expect((await db.query("select o.user_id from app_private.notification_outbox o join public.in_app_notifications n on o.dedupe_key='activity:'||n.id::text where n.dedupe_key like $1",['official-post:'+official+':%'])).rows).toEqual([{user_id:student}]);
 });
});
