import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase,testDatabaseAdapter,testSqlClient} from './helpers/database';
import {createSession} from '../src/services/sessions';
import {app} from '../src/app';
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
