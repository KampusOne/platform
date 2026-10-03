import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {Hono,type Context,type Next} from 'hono';
import type {PGlite} from '@electric-sql/pglite';
import {studentGroupRoutes} from '../src/routes/student-groups';
import {calendarRoutes} from '../src/routes/calendar';
import {learningRoutes} from '../src/routes/learning';
import {studentRoutes} from '../src/routes/student';
import {AppError} from '../src/lib/errors';
import {createTestDatabase,testDatabaseAdapter,testSqlClient} from './helpers/database';
let db:PGlite;const owner=crypto.randomUUID(),member=crypto.randomUUID(),nonmember=crypto.randomUUID(),foreign=crypto.randomUUID(),campus=crypto.randomUUID(),otherCampus=crypto.randomUUID();
vi.mock('../src/lib/database',()=>({database:()=>testDatabaseAdapter(db),sqlClient:()=>testSqlClient(db),firstRow:(r:{rows:unknown[]})=>r.rows[0]}));
vi.mock('../src/middleware/auth',()=>({requireAuth:async(_c:Context,n:Next)=>n(),currentUser:(c:Context)=>({id:c.req.header('x-user'),universityId:c.req.header('x-user')===foreign?otherCampus:campus,roles:['STUDENT']})}));
vi.mock('../src/services/community-push',()=>({deliverCommunityPush:async()=>({})}));
const app=new Hono().route('/groups',studentGroupRoutes).route('/calendar',calendarRoutes).route('/learning',learningRoutes).route('/student',studentRoutes);
app.onError((e,c)=>c.json({error:e.message},e instanceof AppError?e.status:500));
const req=(path:string,method='GET',body?:unknown,user=owner)=>app.request(path,{method,headers:{'x-user':user,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
beforeAll(async()=>{db=await createTestDatabase();for(const [i,uni] of [campus,otherCampus].entries())await db.query("insert into public.universities(id,name,slug,updated_at) values($1,$2,$3,now())",[uni,'Group campus '+i,'group-campus-'+i]);for(const [i,user] of [owner,member,nonmember,foreign].entries()){await db.query("insert into public.users(id,email,password_hash,updated_at) values($1,$2,'test-only',now())",[user,'groups'+i+'@example.invalid']);await db.query("insert into public.profiles(id,user_id,university_id,username,display_name,updated_at) values(gen_random_uuid(),$1,$2,$3,$4,now())",[user,user===foreign?otherCampus:campus,'groupuser'+i,'Group person '+i]);}},60000);
afterAll(async()=>db?.close());
describe('student communities and private study groups',()=>{
 it('creates creator admin idempotently, enforces membership/tenant and permits study members to post',async()=>{
  const requestId=crypto.randomUUID(),draft={requestId,kind:'STUDY_GROUP',name:'CPE 250 study circle',description:'Computer education',keywords:['CPE250','2025 set']};
  const created=await req('/groups','POST',draft);expect(created.status).toBe(201);const group=(await created.json()).group;
  expect((await (await req('/groups','POST',draft)).json()).group.id).toBe(group.id);
  expect((await req('/groups','POST',{...draft,name:'Changed name'})).status).toBe(409);
  expect((await req('/groups/'+group.id+'/posts')).status).toBe(200);
  expect((await req('/groups/'+group.id+'/posts','GET',undefined,nonmember)).status).toBe(403);
  expect((await req('/groups/'+group.id,'GET',undefined,foreign)).status).toBe(404);
  expect((await req('/groups/'+group.id+'/join','POST',{},member)).status).toBe(200);
  const postDraft={requestId:crypto.randomUUID(),title:'Osmosis revision',body:'Let us revise cell membranes.',pollOptions:['Today','Tomorrow']};
  const posted=await req('/groups/'+group.id+'/posts','POST',postDraft,member);expect(posted.status).toBe(201);const post=(await posted.json()).post;
  expect((await req('/groups/'+group.id+'/posts','POST',{...postDraft,urgent:true},member)).status).toBe(403);
  expect((await req('/groups/'+group.id+'/posts','POST',{...postDraft,body:'Changed'},member)).status).toBe(409);
  expect((await req('/groups/'+group.id+'/posts/'+post.id+'/vote','POST',{optionIndex:0},owner)).status).toBe(200);
  expect((await req('/groups/'+group.id+'/posts/'+post.id+'/vote','POST',{optionIndex:3},owner)).status).toBe(404);
  const commented=await req('/groups/'+group.id+'/posts/'+post.id+'/comments','POST',{body:'I can join.'});expect(commented.status).toBe(201);const comment=(await commented.json()).comment;
  expect((await req('/groups/'+group.id+'/posts/'+post.id+'/comments/'+comment.id,'DELETE',{},member)).status).toBe(404);
  expect((await req('/groups/'+group.id+'/posts/'+post.id+'/comments/'+comment.id,'DELETE')).status).toBe(200);
  expect((await db.query("select id from app_private.notification_outbox where dedupe_key like 'community-post:%'")).rows).toHaveLength(0);
  expect((await db.query("select id from public.in_app_notifications where dedupe_key like 'community-post:%'")).rows).toHaveLength(1);
  const startKey=crypto.randomUUID();const started=await req('/groups/'+group.id+'/study/start','POST',{requestId:startKey},member);expect(started.status).toBe(201);const session=(await started.json()).active;
  expect((await (await req('/groups/'+group.id+'/study/start','POST',{requestId:startKey},member)).json()).active.id).toBe(session.id);
  await db.query("update public.student_group_study_sessions set started_at=now()-interval '35 minutes' where id=$1",[session.id]);
  expect((await req('/groups/'+group.id+'/study/stop','POST',{sessionId:session.id},owner)).status).toBe(404);
  expect((await req('/groups/'+group.id+'/study/stop','POST',{sessionId:session.id},member)).status).toBe(200);
  const insightResponse=await req('/groups/'+group.id+'/study', 'GET',undefined,member);const insights=await insightResponse.json();expect(insights,JSON.stringify(insights)).toHaveProperty('active',null);expect(insights.members.find((m:any)=>m.user_id===member).today_seconds).toBeGreaterThanOrEqual(2100);
  expect((await req('/groups/'+group.id+'/study','GET',undefined,nonmember)).status).toBe(403);
  expect((await req('/groups/'+group.id+'/join','DELETE',{},member)).status).toBe(200);
  expect((await req('/groups/'+group.id+'/posts','GET',undefined,member)).status).toBe(403);
 });
 it('limits community publishing to admins and queues immediate/urgent member notifications once',async()=>{
  const created=await req('/groups','POST',{requestId:crypto.randomUUID(),kind:'COMMUNITY',name:'Faculty notices'});const group=(await created.json()).group;
  await req('/groups/'+group.id+'/join','POST',{},member);
  expect((await req('/groups/'+group.id+'/posts','POST',{requestId:crypto.randomUUID(),title:'Hello',body:'Not an admin'},member)).status).toBe(403);
  const draft={requestId:crypto.randomUUID(),title:'Venue changed',body:'Meet at LT 2.',urgent:true,venue:'LT 2'};
  const posted=await req('/groups/'+group.id+'/posts','POST',draft);expect(posted.status).toBe(201);const post=(await posted.json()).post;
  await req('/groups/'+group.id+'/posts','POST',draft);
  expect((await db.query("select id from app_private.notification_outbox where dedupe_key like $1",['community-urgent:'+post.id+':%'])).rows).toHaveLength(1);
  expect((await req('/groups/'+group.id+'/members','POST',{username:'groupuser3'})).status).toBe(409);
 });

 it('keeps class alarms fifteen minutes early including midnight and scopes batch removal',async()=>{
  const draft={title:'Midnight lab',courseCode:'CPE100',dayOfWeek:1,startsAt:'00:10',endsAt:'01:10',reminderMinutes:0,reminderEnabled:true};
  const created=await req('/student/timetable','POST',draft);expect(created.status).toBe(201);const entry=(await created.json()).id;
  const ownAlarms=await(await req('/learning/alarms')).json();const alarm=ownAlarms.alarms.find((a:any)=>a.timetable_entry_id===entry);expect(alarm.time).toBe('23:55');expect(alarm.days).toEqual([0]);
  expect((await(await req('/learning/alarms/bulk-delete','POST',{ids:[alarm.id]},member)).json()).deleted).toBe(0);
  expect((await(await req('/learning/alarms/bulk-delete','POST',{ids:[alarm.id]})).json()).deleted).toBe(1);
  expect((await db.query('select reminder_enabled from public.timetable_entries where id=$1',[entry])).rows[0].reminder_enabled).toBe(false);
  expect((await(await req('/student/timetable/bulk-delete','POST',{ids:[entry]},member)).json()).deleted).toBe(0);
  expect((await(await req('/student/timetable/bulk-delete','POST',{ids:[entry]})).json()).deleted).toBe(1);
  expect((await db.query('select id from public.student_alarms where timetable_entry_id=$1',[entry])).rows).toHaveLength(0);
 });
 it('clears selected GPA history and draft grades only for their owner',async()=>{
  const mine=crypto.randomUUID(),theirs=crypto.randomUUID();
  for(const [term,user] of [[mine,owner],[theirs,member]]){await db.query("insert into public.gpa_terms(id,university_id,user_id,session_label,semester,level_code,gpa,earned_units,quality_points,updated_at) values($1,$2,$3,'2026/2027',1,'200',4,3,12,now())",[term,campus,user]);await db.query("insert into public.gpa_results(term_id,course_code,course_title,units,grade,grade_point) values($1,'CPE201','Computing',3,'B',4)",[term]);}
  expect((await(await req('/student/gpa/bulk-delete','POST',{ids:[mine]},member)).json()).deleted).toBe(0);
  expect((await(await req('/student/gpa/bulk-delete','POST',{ids:[mine,theirs],clearDrafts:true})).json()).deleted).toBe(1);
  expect((await db.query('select term_id from public.gpa_results')).rows).toEqual([{term_id:theirs}]);
  expect((await db.query('select course_code from public.course_drafts where user_id=$1',[owner])).rows).toHaveLength(0);
  expect((await req('/student/gpa/bulk-delete','POST',{ids:[]})).status).toBe(400);
  expect((await req('/student/gpa/bulk-delete','POST',{ids:[],clearDrafts:true})).status).toBe(200);
 });
 it('removes only selected owned calendar dates and keeps exam windows distinct',async()=>{
  const imported=await req('/calendar/import','POST',{requestId:crypto.randomUUID(),events:[{title:'Faculty examinations',startsOn:'2027-02-01',endsOn:'2027-02-05',semester:'First semester'},{title:'General examinations',startsOn:'2027-02-08',endsOn:'2027-02-20',semester:'First semester'},{title:'CED examinations',startsOn:'2027-02-25',endsOn:'2027-02-26',semester:'First semester'},{title:'Second semester examinations',startsOn:'2027-06-14',endsOn:'2027-07-06',semester:'Second semester'}]});expect(imported.status).toBe(201);
  const details=await (await req('/calendar')).json();expect(details.examPeriods.map((p:any)=>[p.startsOn,p.endsOn])).toEqual([['2027-02-01','2027-02-26'],['2027-06-14','2027-07-06']]);
  expect((await (await req('/calendar/bulk-delete','POST',{ids:[details.events[0].id]},member)).json()).deleted).toBe(0);
  expect((await (await req('/calendar/bulk-delete','POST',{ids:details.events.map((e:any)=>e.id)})).json()).deleted).toBe(4);
 });
});
