import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createHmac} from 'node:crypto';
import {createTestDatabase,testDatabaseAdapter,testSqlClient} from './helpers/database';
import {app} from '../src/app';
import {createSession} from '../src/services/sessions';
import {composeBroadcastPayload,deliverQueuedBroadcasts,verifyResendSignature,type EmailBindings} from '../src/services/broadcast-delivery';
let db:PGlite;
vi.mock('../src/lib/database',()=>({database:()=>testDatabaseAdapter(db),sqlClient:()=>testSqlClient(db),firstRow:(r:{rows:unknown[]})=>r.rows[0]}));
const school='81000000-0000-4000-8000-000000000001',other='81000000-0000-4000-8000-000000000002';
const admin='82000000-0000-4000-8000-000000000001',finance='82000000-0000-4000-8000-000000000002',staff='82000000-0000-4000-8000-000000000003',alice='82000000-0000-4000-8000-000000000004',bob='82000000-0000-4000-8000-000000000005',outside='82000000-0000-4000-8000-000000000006';
const users=[admin,finance,staff,alice,bob,outside],persona='00000000-0000-4000-8000-000000000052';
const faculty='83000000-0000-4000-8000-000000000001',department='83000000-0000-4000-8000-000000000002';
const email=(id:string)=>`broadcast${users.indexOf(id)}@example.invalid`;
const secret=Buffer.from('broadcast-test-signing-secret');
const env:EmailBindings={ENVIRONMENT:'local',ALLOWED_ORIGINS:'https://app.example.invalid',MINIMUM_APP_VERSION:'1',MAINTENANCE_MODE:'false',ACADEMIC_CORE_ENABLED:'true',SOCIAL_FEED_ENABLED:'true',MARKETPLACE_ENABLED:'false',PAYMENTS_ENABLED:'false',AI_ASSISTANT_ENABLED:'false',UNIFIED_SCHEMA_READY:'true',PHASE_2_SCHEMA_READY:'true',JWT_SECRET:'test-only-broadcast-secret-key-1234567890',RESEND_API_KEY:'re_test_only_never_live',RESEND_FROM_EMAIL:'KampusOne <team@example.invalid>',RESEND_WEBHOOK_SECRET:'whsec_'+secret.toString('base64'),PUBLIC_API_ORIGIN:'https://api.example.invalid'};
const tokens=new Map<string,string>(),fetchMock=vi.fn();
async function request(path:string,actor=admin,method='GET',body?:unknown){return app.request('https://api.example.invalid/v1'+path,{method,headers:{Authorization:'Bearer '+tokens.get(actor),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},env);}
async function response(r:Response,status=200):Promise<any>{const result=await r.json();expect({status:r.status,...(r.status===status?{}:{result})}).toEqual({status});return result;}
function payload(ids=[alice,bob],kind='OPERATIONAL'){return {personaId:persona,kind,subject:'Verified campus service update',body:'The library service changes tomorrow. Please read the campus notice.',segment:{role:'ALL',userIds:ids}};}
async function draft(ids=[alice,bob],kind='OPERATIONAL',actor=admin,university=school){return response(await request('/admin/broadcasts?universityId='+university,actor,'POST',payload(ids,kind)),201);}
async function preview(c:string,actor=admin){return response(await request('/admin/broadcasts/'+c+'/preview?universityId='+school,actor,'POST',{revision:1}));}
function sendBody(p:any){return {snapshotId:p.snapshotId,revision:p.revision,recipientCount:p.eligibleCount,confirm:'SEND_REVIEWED_CAMPAIGN'};}
async function queue(ids=[alice,bob],kind='OPERATIONAL',actor=admin){const c=await draft(ids,kind,actor),p=await preview(c.id,actor);await response(await request('/admin/broadcasts/'+c.id+'/send?universityId='+school,actor,'POST',sendBody(p)));return {c,p};}
async function webhook(type:string,providerId:string,to=[email(alice)],eventId=crypto.randomUUID(),override?:string){const raw=override??JSON.stringify({type,created_at:new Date().toISOString(),data:{email_id:providerId,to}}),timestamp=String(Math.floor(Date.now()/1000)),signature=createHmac('sha256',secret).update(`${eventId}.${timestamp}.${raw}`).digest('base64');return app.request('https://api.example.invalid/v1/email/webhooks/resend',{method:'POST',headers:{'Content-Type':'application/json','svix-id':eventId,'svix-timestamp':timestamp,'svix-signature':'v1,'+signature},body:raw},env);}
beforeAll(async()=>{
 db=await createTestDatabase();
 for(const [i,id] of [school,other].entries())await db.query('insert into public.universities(id,name,slug,updated_at)values($1,$2,$3,now())',[id,'Broadcast university '+i,'broadcast-school-'+i]);
 for(const [i,id] of users.entries()){
  await db.query("insert into public.users(id,email,password_hash,email_verified_at,updated_at)values($1,$2,'test-only',now(),now())",[id,email(id)]);
  await db.query('insert into public.profiles(id,user_id,username,display_name,university_id,updated_at)values(gen_random_uuid(),$1,$2,$3,$4,now())',[id,'broadcast'+i,'Broadcast person '+i,id===outside?other:school]);
  tokens.set(id,(await createSession(env,{id,email:email(id),roles:['STUDENT'],operatorRoles:[],universityId:id===outside?other:school})).accessToken);
 }
 await db.query("insert into public.faculties(id,university_id,name,slug,updated_at)values($1,$2,'Science','broadcast-science',now())",[faculty,school]);
 await db.query("insert into public.departments(id,faculty_id,name,slug,updated_at)values($1,$2,'Mathematics','broadcast-maths',now())",[department,faculty]);
 await db.query('update public.profiles set faculty_id=$1,department_id=$2 where user_id=$3',[faculty,department,bob]);
 for(const [id,type,status] of [[alice,'VENDOR','PAUSED'],[bob,'TUTOR','ACTIVE']]){
  const application=crypto.randomUUID(),profile=crypto.randomUUID();
  await db.query("insert into public.agent_applications(id,university_id,user_id,agent_type,display_name,phone_e164,statement)values($1,$2,$3,$4,'Test agent','+2348000000000','Test-only application')",[application,school,id,type]);
  await db.query("insert into public.agent_profiles(id,university_id,user_id,application_id,agent_type,display_name,verified_at,status)values($1,$2,$3,$4,$5,'Test agent',now(),$6)",[profile,school,id,application,type,status]);
  if(type==='VENDOR')await db.query('insert into public.orders(university_id,buyer_user_id,vendor_profile_id,subtotal_kobo)values($1,$2,$3,100)',[school,bob,profile]);
 }
 await db.query("insert into public.operator_roles(user_id,role)values($1,'PLATFORM_ADMIN')",[admin]);
 await db.query("insert into app_private.staff_access(user_id,permissions,university_ids,updated_by)values($1,array['finance.view'],array[$2::uuid],$3),($4,array['broadcasts.view','broadcasts.manage','broadcasts.send'],array[$2::uuid],$3)",[finance,school,admin,staff]);
},60000);
beforeEach(async()=>{
 fetchMock.mockReset();fetchMock.mockImplementation(async()=>new Response(JSON.stringify({id:crypto.randomUUID()}),{status:200,headers:{'Content-Type':'application/json'}}));vi.stubGlobal('fetch',fetchMock);
 await db.exec('delete from app_private.email_delivery_events;delete from app_private.email_recipients;delete from app_private.email_audience_snapshots;delete from app_private.email_campaigns;delete from app_private.email_preferences;delete from app_private.email_preference_events;delete from app_private.email_suppressions;delete from app_private.email_rate_windows');
 await db.exec("update app_private.email_delivery_controls set enabled=true,max_per_day=1000,max_per_minute=30,postal_address='Test organisation, 1 Campus Road, Lagos';update app_private.staff_access set status='ACTIVE'");
 await db.query('update public.profiles set university_id=$1 where user_id=$2',[school,alice]);await db.query('update public.agent_profiles set university_id=$1 where user_id=$2',[school,alice]);
});
afterAll(async()=>{vi.unstubAllGlobals();await db?.close();});
describe('broadcast permissions and immutable review',()=>{
 it('uses real role/status, buyer and academic segments without exporting unrestricted data',async()=>{
  const segments=await response(await request('/admin/broadcasts/segments?universityId='+school,staff));expect(segments.faculties).toEqual([{id:faculty,name:'Science'}]);expect(segments.departments).toEqual([{id:department,name:'Mathematics',faculty_id:faculty}]);
  for(const [segment,expected] of [[{role:'VENDOR',agentStatus:'ACTIVE'},[]],[{role:'VENDOR',agentStatus:'PAUSED'},[alice]],[{role:'TUTOR'},[bob]],[{role:'BUYER'},[bob]],[{role:'STAFF'},[admin,finance,staff]],[{role:'ALL',facultyId:faculty,departmentId:department},[bob]]] as [Record<string,string>,string[]][]){
   const c=await response(await request('/admin/broadcasts?universityId='+school,admin,'POST',{...payload(),segment:{...segment,userIds:[]}}),201),p=await preview(c.id);expect(p.sample.map((u:any)=>u.userId).sort()).toEqual([...expected].sort());
  }
  expect(fetchMock).not.toHaveBeenCalled();
 });
 it('hides campaigns and email lists from finance and rejects cross-university staff access',async()=>{
  for(const path of ['/admin/broadcasts','/admin/broadcasts/settings','/admin/broadcasts/recipients?q=broadcast'])await response(await request(path,finance),403);
  await response(await request('/admin/broadcasts',finance,'POST',payload()),403);await response(await request('/admin/broadcasts?universityId='+other,staff),403);
  const c=await draft([outside],'OPERATIONAL',admin,other);await response(await request('/admin/broadcasts/'+c.id+'?universityId='+school,staff),404);expect(fetchMock).not.toHaveBeenCalled();
 });
 it('freezes the selected university audience and sends it once only after explicit review',async()=>{
  const c=await draft([alice,bob,outside]),p=await preview(c.id);expect(p.eligibleCount).toBe(2);const persisted=(await response(await request('/admin/broadcasts/'+c.id))).review;expect(persisted).toMatchObject({snapshotId:p.snapshotId,eligibleCount:2,subject:p.subject,body:p.body});expect(p.sample.map((x:any)=>x.email).sort()).toEqual([email(alice),email(bob)].sort());expect(fetchMock).not.toHaveBeenCalled();
  await response(await request('/admin/broadcasts/'+c.id+'/send',admin,'POST',{...sendBody(p),confirm:'SEND_TEST'}),400);await response(await request('/admin/broadcasts/'+c.id+'/send',admin,'POST',{...sendBody(p),recipientCount:3}),409);
  await response(await request('/admin/broadcasts/'+c.id+'/send',admin,'POST',sendBody(p)));expect((await response(await request('/admin/broadcasts/'+c.id+'/send',admin,'POST',sendBody(p)))).alreadyQueued).toBe(true);
  expect((await db.query("select * from app_private.email_recipients where status='PENDING'")).rows).toHaveLength(2);expect(fetchMock).not.toHaveBeenCalled();expect(await deliverQueuedBroadcasts(env)).toEqual({accepted:2,skipped:0});
  expect(fetchMock.mock.calls.map(x=>JSON.parse(x[1].body).to[0]).sort()).toEqual([email(alice),email(bob)].sort());await deliverQueuedBroadcasts(env);expect(fetchMock).toHaveBeenCalledTimes(2);
 });
 it('rejects stale content and expired previews',async()=>{
  const c=await draft(),p=await preview(c.id);await response(await request('/admin/broadcasts/'+c.id,admin,'PUT',{...payload(),subject:'Changed message requires review',revision:1}));await response(await request('/admin/broadcasts/'+c.id+'/send',admin,'POST',sendBody(p)),409);
  const p2=await response(await request('/admin/broadcasts/'+c.id+'/preview',admin,'POST',{revision:2}));await db.query("update app_private.email_audience_snapshots set expires_at=now()-interval '1 second'where id=$1",[p2.snapshotId]);await response(await request('/admin/broadcasts/'+c.id+'/send',admin,'POST',sendBody(p2)),409);
 });
 it('queues a test to one selected account and prevents request-key reuse for another account',async()=>{
  const c=await draft(),body={userId:alice,revision:1,requestId:crypto.randomUUID(),confirm:'SEND_TEST'},first=await response(await request('/admin/broadcasts/'+c.id+'/test',admin,'POST',body));
  expect(await response(await request('/admin/broadcasts/'+c.id+'/test',admin,'POST',body))).toEqual(first);await response(await request('/admin/broadcasts/'+c.id+'/test',admin,'POST',{...body,userId:bob}),409);await response(await request('/admin/broadcasts/'+c.id+'/test',admin,'POST',{...body,userId:outside,requestId:crypto.randomUUID()}),400);
  await deliverQueuedBroadcasts(env);expect(fetchMock).toHaveBeenCalledTimes(1);expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({to:[email(alice)],subject:'[Test] Verified campus service update'});
 });
 it('honors scheduling, global pause and cancellation',async()=>{
  const c=await draft(),p=await preview(c.id);await response(await request('/admin/broadcasts/'+c.id+'/send',admin,'POST',{...sendBody(p),scheduledAt:new Date(Date.now()+3600000).toISOString()}));await deliverQueuedBroadcasts(env);expect(fetchMock).not.toHaveBeenCalled();
  await db.query('update app_private.email_campaigns set scheduled_at=now()where id=$1',[c.id]);await db.exec('update app_private.email_delivery_controls set enabled=false');await deliverQueuedBroadcasts(env);expect(fetchMock).not.toHaveBeenCalled();
  await response(await request('/admin/broadcasts/'+c.id+'/cancel',admin,'POST',{}));await db.exec('update app_private.email_delivery_controls set enabled=true');await deliverQueuedBroadcasts(env);expect(fetchMock).not.toHaveBeenCalled();
 });
 it('rechecks sender revocation and recipient campus membership before delivery',async()=>{
  await queue([alice],'OPERATIONAL',staff);await db.query("update app_private.staff_access set status='SUSPENDED'where user_id=$1",[staff]);expect(await deliverQueuedBroadcasts(env)).toEqual({accepted:0,skipped:1});
  await queue([alice]);await db.query('update public.profiles set university_id=$1 where user_id=$2',[other,alice]);await db.query('update public.agent_profiles set university_id=$1 where user_id=$2',[other,alice]);expect(await deliverQueuedBroadcasts(env)).toEqual({accepted:0,skipped:1});expect(fetchMock).not.toHaveBeenCalled();
 });
});
describe('consent, suppression and provider reliability',()=>{
 it('requires opt-in and honors unsubscribe after review; GET leaves consent unchanged',async()=>{
  expect((await response(await request('/email/preferences',alice))).marketing_opt_in).toBe(false);const c=await draft([alice,bob],'MARKETING');expect((await preview(c.id)).eligibleCount).toBe(0);
  await response(await request('/email/preferences',alice,'PUT',{marketingOptIn:true,consentVersion:'marketing-email-v1'}));const p=await preview(c.id);expect(p.eligibleCount).toBe(1);expect(p.notOptedInCount).toBe(1);
  const row=(await db.query<any>('select unsubscribe_token,payload from app_private.email_recipients where snapshot_id=$1',[p.snapshotId])).rows[0]!;expect(row.payload.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');expect(row.payload.html).toContain('1 Campus Road');
  expect((await app.request('https://api.example.invalid/v1/email/unsubscribe/'+row.unsubscribe_token,{},env)).status).toBe(200);expect((await response(await request('/email/preferences',alice))).marketing_opt_in).toBe(true);
  await response(await request('/admin/broadcasts/'+c.id+'/send',admin,'POST',sendBody(p)));expect((await app.request('https://api.example.invalid/v1/email/unsubscribe/'+row.unsubscribe_token,{method:'POST',body:'List-Unsubscribe=One-Click'},env)).status).toBe(200);expect(await deliverQueuedBroadcasts(env)).toEqual({accepted:0,skipped:1});expect(fetchMock).not.toHaveBeenCalled();
 });
 it('requires a real mailing address and discloses managed personas with escaped content',async()=>{
  await db.exec('update app_private.email_delivery_controls set postal_address=null');const c=await draft([alice],'MARKETING');await response(await request('/admin/broadcasts/'+c.id+'/preview',admin,'POST',{revision:1}),409);
  await response(await request('/admin/broadcasts/personas',staff,'POST',{displayName:'Jeffrey'}),403);const p=await response(await request('/admin/broadcasts/personas',admin,'POST',{displayName:'Jeffrey'}),201);expect(p.display_name).toBe('Jeffrey');
  const message=composeBroadcastPayload({from:'Jeffrey <team@example.invalid>',senderName:'Jeffrey',subject:'Update',body:'<script>alert(1)</script> & goodbye',kind:'OPERATIONAL',postalAddress:'',apiOrigin:'https://api.example.invalid'},email(alice),crypto.randomUUID());expect(message.html).not.toContain('<script>');expect(message.html).toContain('&lt;script&gt;');expect(message.text).toContain('This sender identity is managed by KampusOne.');
 });
 it('retries uncertain delivery with unchanged payload and idempotency key; acceptance is not delivery',async()=>{
  const {c}=await queue([alice]);fetchMock.mockRejectedValueOnce(new Error('timeout'));await deliverQueuedBroadcasts(env);await db.exec('update app_private.email_recipients set next_attempt_at=now()');await deliverQueuedBroadcasts(env);expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0]![1].body).toBe(fetchMock.mock.calls[1]![1].body);expect(fetchMock.mock.calls[0]![1].headers['Idempotency-Key']).toBe(fetchMock.mock.calls[1]![1].headers['Idempotency-Key']);expect((await response(await request('/admin/broadcasts/'+c.id))).delivery).toEqual([{is_test:false,status:'ACCEPTED',count:1}]);
 });
 it('enforces rate budgets across workers and stops beyond the provider deduplication window',async()=>{
  await queue();await db.exec('update app_private.email_delivery_controls set max_per_day=1');await Promise.all([deliverQueuedBroadcasts(env),deliverQueuedBroadcasts(env)]);expect(fetchMock).toHaveBeenCalledTimes(1);
  await db.exec("update app_private.email_recipients set first_attempt_at=now()-interval '24 hours'where status='PENDING';update app_private.email_delivery_controls set max_per_day=1000");await deliverQueuedBroadcasts(env);expect(fetchMock).toHaveBeenCalledTimes(1);expect((await db.query("select * from app_private.email_recipients where status='UNKNOWN'")).rows).toHaveLength(1);
 });
 it('matches the official Svix signature fixture and rejects tampering, staleness and malformed events',async()=>{
  const body='{"event_type":"ping","data":{"success":true}}',h=new Headers({'svix-id':'msg_loFOjxBNrRLzqYUf','svix-timestamp':'1731705121','svix-signature':'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0='}),s='whsec_plJ3nmyCDGBKInavdOK15jsl';expect(await verifyResendSignature(body,h,s,1731705121000)).toBe(true);expect(await verifyResendSignature(body+' ',h,s,1731705121000)).toBe(false);expect(await verifyResendSignature(body,h,s,1731705432000)).toBe(false);
  await response(await app.request('https://api.example.invalid/v1/email/webhooks/resend',{method:'POST',body:'{}'},env),400);await response(await webhook('email.sent','provider',[],crypto.randomUUID(),'{invalid'),400);
 });
 it('deduplicates signed events, reconciles out-of-order delivery and suppresses after bounce',async()=>{
  const provider='test-provider-email';await response(await webhook('email.delivered',provider));await queue([alice]);fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({id:provider}),{status:200}));await deliverQueuedBroadcasts(env);expect((await db.query('select status from app_private.email_recipients')).rows[0]).toEqual({status:'DELIVERED'});
  const eid=crypto.randomUUID();await response(await webhook('email.bounced',provider,[email(alice)],eid));await response(await webhook('email.bounced',provider,[email(alice)],eid));await response(await webhook('email.delivered',provider));expect((await db.query('select status from app_private.email_recipients')).rows[0]).toEqual({status:'BOUNCED'});expect((await db.query('select * from app_private.email_delivery_events where event_id=$1',[eid])).rows).toHaveLength(1);
  const c=await draft([alice]),p=await preview(c.id);expect(p.eligibleCount).toBe(0);expect(p.suppressedCount).toBe(1);expect(fetchMock).toHaveBeenCalledTimes(1);
 });
});
