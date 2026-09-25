import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase,testDatabaseAdapter,testSqlClient} from './helpers/database';
import {app} from '../src/app';
import {createSession} from '../src/services/sessions';
import {detectedMime} from '../src/routes/media';
import type {Bindings} from '../src/types';
let db:PGlite;
vi.mock('../src/lib/database',()=>({database:()=>testDatabaseAdapter(db),sqlClient:()=>testSqlClient(db),firstRow:(r:{rows:unknown[]})=>r.rows[0]}));
const school='71000000-0000-4000-8000-000000000001',otherSchool='71000000-0000-4000-8000-000000000002';
const admin='72000000-0000-4000-8000-000000000001',finance='72000000-0000-4000-8000-000000000002',student='72000000-0000-4000-8000-000000000003';
const env:Bindings={ENVIRONMENT:'local',ALLOWED_ORIGINS:'https://app.example.invalid',MINIMUM_APP_VERSION:'1',MAINTENANCE_MODE:'false',ACADEMIC_CORE_ENABLED:'true',SOCIAL_FEED_ENABLED:'true',MARKETPLACE_ENABLED:'false',PAYMENTS_ENABLED:'false',AI_ASSISTANT_ENABLED:'false',UNIFIED_SCHEMA_READY:'true',PHASE_2_SCHEMA_READY:'true',JWT_SECRET:'test-only-operations-secret-key-1234567890'};
const tokens=new Map<string,string>();
async function request(path:string,actor=admin,method='GET',body?:unknown){return app.request('https://api.example.invalid/v1'+path,{method,headers:{Authorization:'Bearer '+tokens.get(actor),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})},env);}
async function response(r:Response,status=200){const result=await r.json();expect({status:r.status,...(r.status===status?{}:{result})}).toEqual({status});return result;}
beforeAll(async()=>{
 db=await createTestDatabase();
 for(const [i,id] of [school,otherSchool].entries())await db.query('insert into public.universities(id,name,slug,updated_at) values($1,$2,$3,now())',[id,'University '+i,'operations-school-'+i]);
 for(const [i,id] of [admin,finance,student].entries()){
  await db.query("insert into public.users(id,email,password_hash,email_verified_at,updated_at) values($1,$2,'test-only',now(),now())",[id,'operations'+i+'@example.invalid']);
  await db.query("insert into public.profiles(id,user_id,username,display_name,university_id,updated_at) values(gen_random_uuid(),$1,$2,$3,$4,now())",[id,'operations'+i,'Person '+i,school]);
  tokens.set(id,(await createSession(env,{id,email:'operations'+i+'@example.invalid',roles:['STUDENT'],operatorRoles:[],universityId:school})).accessToken);
 }
 await db.query("insert into public.operator_roles(user_id,role) values($1,'PLATFORM_ADMIN')",[admin]);
 await db.query("insert into app_private.staff_access(user_id,permissions,university_ids,updated_by) values($1,array['finance.view','analytics.view'],array[$2::uuid],$3)",[finance,school,admin]);
},60000);
afterAll(async()=>{await db?.close();});
describe('requirements 15–20: server permissions and university scope',()=>{
 it('finance-only staff can load only authorized modules and their university list',async()=>{
  const access=await response(await request('/admin/access',finance));expect(access.permissions).toEqual(['finance.view','analytics.view']);expect(access.universities.map((s:{id:string})=>s.id)).toEqual([school]);
  await response(await request('/admin/workspaces/finance',finance));await response(await request('/admin/workspaces/analytics',finance));
  for(const path of ['/admin/users','/admin/applications','/admin/dashboard','/admin/operations','/admin/audit','/admin/staff','/manage/users/'+student])await response(await request(path,finance),403);
  await response(await request('/admin/workspaces/finance?universityId='+otherSchool,finance),403);
  await response(await request('/admin/workspaces/analytics?universityId='+otherSchool,finance),403);
 });
 it('staff cannot grant themselves access; suspended custom access overrides legacy roles',async()=>{
  await response(await request('/admin/staff/'+finance,finance,'PUT',{permissions:['users.view'],universityIds:[school],allUniversities:false,status:'ACTIVE',reason:'Trying to elevate access'}),403);
  await db.query("insert into public.operator_roles(user_id,role,university_id) values($1,'FINANCE_REVIEWER',$2)",[finance,school]);
  await db.query("update app_private.staff_access set status='SUSPENDED' where user_id=$1",[finance]);
  await response(await request('/admin/access',finance),403);await response(await request('/admin/workspaces/finance',finance),403);
  await db.query("update app_private.staff_access set status='ACTIVE' where user_id=$1",[finance]);
 });
 it('badge changes are audited without creating staff or agent powers',async()=>{
  await response(await request('/admin/users/'+student+'/verification',admin,'POST',{verified:true,reason:'Manual evidence checked for this badge'}));
  expect((await db.query('select verification_status,public_badge_verified from public.profiles where user_id=$1',[student])).rows[0]).toEqual({verification_status:'UNVERIFIED',public_badge_verified:true});
  expect((await db.query('select * from public.operator_roles where user_id=$1',[student])).rows).toHaveLength(0);
  expect((await db.query("select action from app_private.audit_events where target_id=$1 and action='user.badge.granted'",[student])).rows).toHaveLength(1);
  await response(await request('/admin/access',student),403);
 });
 it('every implemented workspace queries real schema columns and honors pagination',async()=>{
  for(const module of ['universities','users','agents','academic-submissions','content','analytics','finance','audit','ai','support']){
   const data=await response(await request('/admin/workspaces/'+module+'?pageSize=1&sort=name&direction=asc'));expect(data.rows.length).toBeLessThanOrEqual(1);expect(data.pageSize).toBe(1);
  }
 });
 it('preserves current badge controls while applying scoped staff permissions and conflict checks',async()=>{
  await response(await request('/admin/public-badges/'+student,finance),403);
  await response(await request('/admin/public-badges/'+student,student),403);
  expect((await response(await request('/admin/public-badges/'+student))).badge.verified).toBe(true);
  await response(await request('/admin/public-badges/'+student,admin,'PUT',{verified:false,expected:true,reason:'Reviewed the public recognition badge'}));
  await response(await request('/admin/public-badges/'+student,admin,'PUT',{verified:true,expected:true,reason:'A stale browser must not overwrite it'}),409);
  expect((await db.query('select verification_status,public_badge_verified from public.profiles where user_id=$1',[student])).rows[0]).toEqual({verification_status:'UNVERIFIED',public_badge_verified:false});
  await db.query("insert into app_private.staff_access(user_id,permissions,all_universities,status,updated_by) values($1,array['users.verify'],true,'SUSPENDED',$1)",[admin]);
  await response(await request('/admin/public-badges/'+student,admin),403);
  await db.query('delete from app_private.staff_access where user_id=$1',[admin]);
 });
});
describe('requirements 70–74, 121, 144–156 and 10',()=>{
 it('permits ordinary one-character posts and stable retries, rejects key reuse and cross-owner deletion',async()=>{
  const requestId=crypto.randomUUID();const created=await response(await request('/student/feed',student,'POST',{body:'A',requestId}),201);
  expect(await response(await request('/student/feed',student,'POST',{body:'A',requestId}))).toEqual(created);
  await response(await request('/student/feed',student,'POST',{body:'Changed',requestId}),409);
  await response(await request('/student/feed/'+created.id,finance,'DELETE'),404);
  await response(await request('/student/feed/'+created.id,student,'DELETE'));
 });
 it('supports owned media-only MP4 posts and keeps the feed media type',async()=>{
  const media=crypto.randomUUID();await db.query("insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name) values($1,$2,$3,'post',$4,'video/mp4',100,'video.mp4')",[media,student,school,'post/'+media]);
  const created=await response(await request('/student/feed',student,'POST',{body:'',mediaId:media,requestId:crypto.randomUUID()}),201);
  const feed=await response(await request('/student/feed',student));expect(feed.posts.find((p:{id:string})=>p.id===created.id)).toMatchObject({media_type:'video/mp4'});
  await response(await request('/student/feed',finance,'POST',{body:'Unauthorized',mediaId:media,requestId:crypto.randomUUID()}),400);
  const bytes=new Uint8Array([0,0,0,20,...new TextEncoder().encode('ftypisom00000000')]);expect(detectedMime(bytes)).toBe('video/mp4');bytes.set(new TextEncoder().encode('heic'),8);expect(detectedMime(bytes)).toBeNull();
 });
 it('dashboard reads do not earn a streak day',async()=>{
  await response(await request('/student/home',student));await response(await request('/student/home',student));expect((await db.query('select * from public.user_streaks where user_id=$1',[student])).rows).toHaveLength(0);
 });
 it('streams bounded and suffix video ranges and rejects unsatisfiable ranges before storage',async()=>{
  const media=crypto.randomUUID(),get=vi.fn().mockImplementation(async()=>({body:new Uint8Array([7,8,9]).buffer,size:10,httpEtag:'"sample"'}));
  env.MEDIA_BUCKET={get} as unknown as R2Bucket;
  await db.query("insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name) values($1,$2,$3,'post',$4,'video/mp4',10,'video.mp4')",[media,student,school,'post/'+media]);
  for(const range of ['bytes=7-9','bytes=-3','bytes=7-']) {
   const r=await app.request('https://api.example.invalid/v1/media/'+media,{headers:{Range:range}},env);
   expect(r.status).toBe(206);expect(r.headers.get('Content-Range')).toBe('bytes 7-9/10');expect(r.headers.get('Content-Length')).toBe('3');expect(Array.from(new Uint8Array(await r.arrayBuffer()))).toEqual([7,8,9]);
   expect(get.mock.calls.at(-1)?.[1]).toEqual({range:{offset:7,length:3}});
  }
  for(const range of ['bytes=10-','bytes=8-7','bytes=-0','bytes=0-1,4-5']) {
   const r=await app.request('https://api.example.invalid/v1/media/'+media,{headers:{Range:range}},env);expect(r.status).toBe(416);expect(r.headers.get('Content-Range')).toBe('bytes */10');
  }
  expect(get).toHaveBeenCalledTimes(3);
  delete env.MEDIA_BUCKET;
 });
 it('allows provisional academics at a documented second university without inventing global departments',async()=>{
  await response(await request('/student/me/onboarding',student,'PATCH',{firstName:'Ada',lastName:'Student',username:'ada_student',universityId:otherSchool,currentLevel:'100',matriculationNumber:'TEST/123',admissionYear:2026,graduationYear:2030,missingAcademic:{facultyName:'Reported faculty',departmentName:'Reported department',programmeName:'Reported programme',sourceNote:'Needs university verification'}}));
  const me=await response(await request('/student/me',student));expect(me.profile).toMatchObject({university_id:otherSchool,faculty_id:null,department_id:null,department_name:'Reported department',admission_year:2026});
  expect(me.profile.provisional_academic_submission_id).toBeTruthy();expect((await db.query("select * from public.departments where name='Reported department'")).rows).toHaveLength(0);
  const submissions=await response(await request('/admin/workspaces/academic-submissions?universityId='+otherSchool));expect(submissions.rows).toHaveLength(1);
 });
 it('product events reject private payloads and deduplicate retries',async()=>{
  await response(await request('/student/events',student,'POST',{requestId:crypto.randomUUID(),event:'screen_view',screen:'today',prompt:'private study question'}),400);
  const event={requestId:crypto.randomUUID(),event:'screen_view',screen:'today'};await response(await request('/student/events',student,'POST',event),202);await response(await request('/student/events',student,'POST',event),202);
  expect((await db.query('select * from public.product_events where user_id=$1',[student])).rows).toHaveLength(1);
 });
 it('application drafts remain private and cannot set approval or permissions',async()=>{
  await response(await request('/applications/draft',student,'PUT',{step:2,values:{displayName:'Real applicant',status:'APPROVED',permissions:['staff.manage']}}));
  const own=await response(await request('/applications/draft',student));expect(own.draft.values).toEqual({displayName:'Real applicant'});
  expect((await response(await request('/applications/draft',finance))).draft).toBeNull();
 });
});
describe('requirements 146–159 and238: reviewed sources and scoped guidelines',()=>{
 const sourceKey='test-university-document',batch=crypto.randomUUID(),claim=crypto.randomUUID(),faculty=crypto.randomUUID();
 beforeAll(async()=>{
  await db.query("insert into public.academic_source_documents(source_key,filename,sha256,metadata_json) values($1,'Test-source.pdf',$2,$3::jsonb)",[sourceKey,'a'.repeat(64),JSON.stringify({pages:10,source_kind:'secondary_research_compilation',independently_verified_current:false})]);
  await db.query("insert into public.academic_import_batches(id,source_key,hash)values($1,$2,$3)",[batch,sourceKey,'b'.repeat(64)]);
  await db.query("insert into public.academic_source_claims(id,batch_id,source_key,report_ref,page,claim_kind,payload) values($1,$2,$3,'institution:TEST',2,'institution',$4::jsonb)",[claim,batch,sourceKey,JSON.stringify({name_as_reported:'Review test university',original_primary_source_verified:false})]);
  await db.query("insert into public.faculties(id,university_id,name,slug,updated_at) values($1,$2,'Test faculty','academic-test',now())",[faculty,otherSchool]);
 });
 it('does not publish staged institution claims until an authorized recorded review',async()=>{
  expect((await db.query("select * from public.universities where slug='review-test-university'")).rows).toHaveLength(0);
  await response(await request('/admin/academic/claims',finance),403);
  const claims=await response(await request('/admin/academic/claims?kind=institution'));expect(claims.rows.some((r:{id:string})=>r.id===claim)).toBe(true);
  const body={name:'Review test university',slug:'review-test-university',primarySourceUrl:'https://university.example.invalid/official-register',sourceVerified:true,reason:'Reviewed the current primary institutional source independently.'};
  await response(await request('/admin/academic/claims/'+claim+'/publish-institution',finance,'POST',body),403);
  const responses=await Promise.all([request('/admin/academic/claims/'+claim+'/publish-institution',admin,'POST',body),request('/admin/academic/claims/'+claim+'/publish-institution',admin,'POST',body)]);
  expect(responses.map(r=>r.status).sort()).toEqual([201,409]);
  const institutions=(await db.query("select * from public.universities where slug='review-test-university'")).rows;expect(institutions).toHaveLength(1);
  const config=(await db.query('select status,grading_scale,grading_source_status from public.institution_config where institution_id=$1',[institutions[0]!.id])).rows[0];expect(config).toEqual({status:'CATALOGUED',grading_scale:{},grading_source_status:'UNVERIFIED'});
  expect((await db.query('select payload from public.academic_source_claims where id=$1',[claim])).rows[0]!.payload).toMatchObject({original_primary_source_verified:false});
  expect((await db.query("select * from app_private.audit_events where action='academic.institution.published' and target_id=$1",[claim])).rows).toHaveLength(1);
 });
 it('publishes source-backed versions and enforces university/faculty/session applicability',async()=>{
  const body={universityId:otherSchool,title:'Verified guideline',body:'This is a test guideline paraphrase for the declared university only.',sourceUrl:'https://university.example.invalid/handbook',sourceKey,sourcePage:3,sourceExcerpt:'Test excerpt supplied solely for integration verification.',issuingInstitution:'Test university',sourceVerified:true,reason:'Current source and institutional scope reviewed for this publication.'};
  const first=await response(await request('/admin/academic/guidelines',admin,'POST',body),201);
  await response(await request('/admin/academic/guidelines',finance,'POST',body),403);
  await response(await request('/admin/academic/guidelines',admin,'POST',{...body,sourcePage:11}),400);
  const facultyRule=await response(await request('/admin/academic/guidelines',admin,'POST',{...body,title:'Faculty guideline',facultyId:faculty}),201);
  await response(await request('/admin/academic/guidelines',admin,'POST',{...body,title:'Session-specific guideline',sessionLabel:'2099/2100'}),201);
  const second=await response(await request('/admin/academic/guidelines',admin,'POST',{...body,title:'Revised guideline',replacesId:first.id}),201);expect(second.version).toBe(2);
  const applicable=await response(await request('/account/guidelines',student));expect(applicable.guidelines.map((g:{id:string})=>g.id)).toEqual([second.id]);expect(applicable.guidelines[0]).toMatchObject({source_page:3,version:2,issuing_institution:'Test university'});
  expect((await response(await request('/account/guidelines',finance))).guidelines).toEqual([]);
  await db.query('update public.profiles set faculty_id=$1 where user_id=$2',[faculty,student]);
  const own=await response(await request('/account/guidelines',student));expect(own.guidelines.map((g:{id:string})=>g.id).sort()).toEqual([second.id,facultyRule.id].sort());
  expect((await db.query('select status from public.institution_guidelines where id=$1',[first.id])).rows[0]).toEqual({status:'ARCHIVED'});
 });
});
describe('requirements 201–208 and140–141: honest checks and safe timetable retries',()=>{
 it('records real completeness flags and limits them to authorized reviewers',async()=>{
  const application=crypto.randomUUID();
  await db.query("insert into public.agent_applications(id,university_id,user_id,agent_type,display_name,legal_name,phone_e164,statement,terms_accepted_at) values($1,$2,$3,'VENDOR','Test shop','Test Person','+2348000000001','Test application requires evidence review.',now())",[application,school,finance]);
  await response(await request('/admin/applications/'+application+'/checks',finance,'POST'),403);
  await response(await request('/admin/applications/'+application+'/checks',student),403);
  const checked=await response(await request('/admin/applications/'+application+'/checks',admin,'POST'),201);
  expect(checked.reviewGroup).toBe('NEEDS_REVIEW');expect(checked.flags.some((f:{code:string})=>f.code==='MISSING_DETAILS')).toBe(true);expect(checked.humanDecisionRequired).toBe(true);
  const report=await response(await request('/admin/applications/'+application+'/checks'));expect(report.checks[0].coverage.notPerformed).toContain('document_authenticity');expect(report.checks[0].current).toBe(true);
  expect((await response(await request('/admin/applications/'+application+'/checks',admin,'POST'))).reused).toBe(true);
  const identity=crypto.randomUUID(),portrait=crypto.randomUUID();
  for(const mediaId of [identity,portrait])await db.query("insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name)values($1,$2,$3,'kyc',$4,'image/png',100,'test-image.png')",[mediaId,finance,school,'check/'+mediaId]);
  await db.query("insert into public.agent_application_details(application_id,birth_date,is_student,business_name,business_address,identity_document_id,portrait_document_id,terms_version,role_details) values($1,'2000-01-01',false,'Test shop','Test address',$2,$3,'test-v1',$4::jsonb)",[application,identity,portrait,JSON.stringify({campusPermission:'NOT_REQUIRED'})]);
  const completed=await response(await request('/admin/applications/'+application+'/checks',admin,'POST'),201);expect(completed.reviewGroup).toBe('COMPLETE');expect(completed.flags).toEqual([]);expect(completed.humanDecisionRequired).toBe(true);
  expect((await db.query('select status,kyc_status from public.agent_applications where id=$1',[application])).rows[0]).toEqual({status:'SUBMITTED',kyc_status:'NOT_STARTED'});
  await db.query('update public.media_objects set deleted_at=now() where id=$1',[identity]);
  const old=await response(await request('/admin/applications/'+application+'/checks'));expect(old.checks[0].current).toBe(false);
  const rechecked=await response(await request('/admin/applications/'+application+'/checks',admin,'POST'),201);expect(rechecked.reviewGroup).toBe('NEEDS_REVIEW');expect(rechecked.flags.some((f:{code:string})=>f.code==='EVIDENCE_UNAVAILABLE')).toBe(true);
 });
 it('stores timetable batches once under concurrent retries and rejects changed payload',async()=>{
  const requestId=crypto.randomUUID(),entries=[{title:'Real timetable class',courseCode:'TEST201',dayOfWeek:2,startsAt:'10:00',endsAt:'11:00',reminderMinutes:15,reminderEnabled:true}];
  const responses=await Promise.all([request('/learning/timetable/import',student,'POST',{requestId,entries}),request('/learning/timetable/import',student,'POST',{requestId,entries})]);expect(responses.map(r=>r.status).sort()).toEqual([200,201]);
  const rows=(await db.query('select id from public.timetable_entries where user_id=$1 and course_code=$2',[student,'TEST201'])).rows;expect(rows).toHaveLength(1);
  expect((await db.query('select id from public.student_alarms where user_id=$1 and timetable_entry_id=$2',[student,rows[0]!.id])).rows).toHaveLength(1);
  await response(await request('/learning/timetable/import',student,'POST',{requestId,entries:[{...entries[0],title:'Changed import'}]}),409);
  await response(await request('/learning/timetable/import',student,'POST',{requestId:crypto.randomUUID(),entries}),201);
  expect((await db.query('select id from public.timetable_entries where user_id=$1 and course_code=$2',[student,'TEST201'])).rows).toHaveLength(1);
 });
 it('never presents a universal grading scale as a reviewed university rule',async()=>{
  const data=await response(await request('/learning/courses',student));expect(data.gradingScale).toBeNull();expect(data.gradingScaleStatus).toBe('UNVERIFIED');
  await response(await request('/learning/courses',student,'PUT',{courses:[{courseCode:'TEST301',title:'Explicit grade label',units:3,grade:'B+'}]}));
  expect((await response(await request('/learning/courses',student))).courses[0].grade).toBe('B+');
 });
});

describe('campus and programme administration',()=>{
 it('keeps campus buildings and offices in their selected institution and campus',async()=>{
  const one=await response(await request('/campus-admin',admin,'POST',{universityId:school,name:'North Campus',slug:'north'}),201);
  const two=await response(await request('/campus-admin',admin,'POST',{universityId:otherSchool,name:'South Campus',slug:'south'}),201);
  const building=await response(await request('/campus-admin/'+one.id+'/places',admin,'POST',{name:'Engineering Block'}),201);
  const office=await response(await request('/campus-admin/'+one.id+'/places',admin,'POST',{name:'Head of Department',parentId:building.id,floor:'First',room:'102',aliases:['HOD']}),201);
  await response(await request('/campus-admin/'+two.id+'/places',admin,'POST',{name:'Invalid office',parentId:building.id}),400);
  await response(await request('/campus-admin/'+two.id+'/places',admin,'POST',{id:office.id,name:'Moved office'}),403);
  await response(await request('/campus-admin/'+one.id+'/places',finance),403);
  await response(await request('/campus-admin/'+one.id+'/places',student),403);
  const places=await response(await request('/campus-admin/'+one.id+'/places'));
  expect(places.places.find((p:{id:string})=>p.id===office.id)).toMatchObject({parent_place_id:building.id,floor_label:'First',room_label:'102',search_aliases:['HOD']});
 });
 it('creates and edits verified programme awards and duration without crossing faculty scope',async()=>{
  const faculty=crypto.randomUUID(),department=crypto.randomUUID(),programme=crypto.randomUUID();
  const common={universityId:school,sourceUrl:'https://school.example.invalid/prospectus',sourceVerified:true,reason:'Reviewed the current university prospectus'};
  await response(await request('/admin/academic/catalogue',admin,'POST',{...common,id:faculty,kind:'faculty',name:'Engineering'}));
  await response(await request('/admin/academic/catalogue',admin,'POST',{...common,id:department,kind:'department',name:'Mechatronics Engineering',parentId:faculty}));
  await response(await request('/admin/academic/catalogue',admin,'POST',{...common,id:programme,kind:'programme',name:'B.Eng Mechatronics Engineering',parentId:department,code:'MTE',award:'B.Eng',durationYears:5}));
  await response(await request('/admin/academic/catalogue',finance,'POST',{...common,id:programme,kind:'programme',name:'Unauthorized change',parentId:department}),403);
  await response(await request('/admin/academic/catalogue',admin,'POST',{...common,universityId:otherSchool,id:crypto.randomUUID(),kind:'department',name:'Invalid department',parentId:faculty}),400);
  const catalogue=await response(await request('/admin/academic/catalogue?universityId='+school));
  expect(catalogue.programmes.find((p:{id:string})=>p.id===programme)).toMatchObject({award:'B.Eng',normal_duration_years:'5.0',primary_source_url:common.sourceUrl});
  expect((await response(await request('/admin/academic/catalogue?universityId='+otherSchool))).programmes.some((p:{id:string})=>p.id===programme)).toBe(false);
 });
 it('restricts notification sound management and resolves an institution default',async()=>{
  const media=crypto.randomUUID();
  await db.query("insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name) values($1,$2,$3,'notification-sound',$4,'audio/mpeg',100,'ping.mp3')",[media,admin,school,'sound/'+media]);
  await response(await request('/notifications/admin/sounds',finance),403);
  await response(await request('/notifications/admin/sounds',student,'POST',{name:'Campus ping',mediaId:media,universityId:school}),403);
  const sound=await response(await request('/notifications/admin/sounds',admin,'POST',{name:'Campus ping',mediaId:media,universityId:school}),201);
  await response(await request('/notifications/admin/sounds/'+sound.id+'/default',admin,'PUT',{}));
  const current=await response(await request('/notifications/sounds/default',finance));
  expect(current.sound).toMatchObject({id:sound.id,name:'Campus ping',availability:'web',nativeSound:'default'});
  expect((await response(await request('/notifications/sounds/default',student))).sound).toBeNull();
 });
});

describe('measured reports',()=>{
 it('scopes event counts and observed return rates, and exposes no account or source payload',async()=>{
  for(const [actor,institution,age,screen] of [[finance,school,20,'today'],[finance,school,18,'timetable'],[student,otherSchool,20,'foreign-screen']])await db.query("insert into product_events(user_id,institution_id,event_name,screen,client_request_id,created_at)values($1,$2,'screen_view',$3,gen_random_uuid(),now()-($4::int*interval '1 day'))",[actor,institution,screen,age]);
  const report=await response(await request('/admin/reports/engagement?days=30',finance));
  expect(report.totals).toMatchObject({events:2,active_users:1});expect(report.retention).toEqual({eligible_users:1,returned_users:1});
  expect(report.universities.map((row:{id:string})=>row.id)).toEqual([school]);
  expect(JSON.stringify(report)).not.toContain('foreign-screen');expect(JSON.stringify(report)).not.toContain(finance);expect(JSON.stringify(report)).not.toContain('@example.invalid');
  await response(await request('/admin/reports/engagement?universityId='+otherSchool,finance),403);
  await response(await request('/admin/reports/engagement',student),403);
  await response(await request('/admin/reports/engagement?days=500',finance),400);
 });
 it('requires separate AI access and reports stored job states without prompts, answers or secrets',async()=>{
  await db.query("insert into app_private.ai_requests(user_id,idempotency_key,request_hash,mode,status,result)values($1,gen_random_uuid(),repeat('c',64),'study','COMPLETED',$2::jsonb)",[admin,JSON.stringify({prompt:'PRIVATE QUESTION',text:'PRIVATE ANSWER'})]);
  await response(await request('/admin/reports/ai',finance),403);
  const report=await response(await request('/admin/reports/ai'));
  expect(report.usage).toContainEqual(expect.objectContaining({mode:'study',status:'COMPLETED',requests:1}));
  for(const privateText of ['PRIVATE QUESTION','PRIVATE ANSWER','HF_TOKEN','JWT_SECRET'])expect(JSON.stringify(report)).not.toContain(privateText);
  expect(report.measuredCost).toBeNull();
 });
});

// Reproduce the production schema before the pending academic migration.
describe('profile rollout compatibility',()=>{
 it('reads an existing profile when optional academic tables and columns are absent',async()=>{
  await db.exec('begin');
  try {
   await db.exec('alter table public.profiles drop column provisional_academic_submission_id; alter table public.profiles drop column admission_year; drop table public.academic_missing_submissions cascade;');
   const me=await response(await request('/student/me',student));
   expect(me.profile.id).toBe(student);
   expect(me.profile.admission_year).toBeNull();
   expect(me.profile.provisional_academic_submission_id).toBeNull();
  } finally { await db.exec('rollback'); }
 });
});
