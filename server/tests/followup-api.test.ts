import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {Hono,type Context,type Next} from 'hono';
import type {PGlite} from '@electric-sql/pglite';
import {october6Database} from './helpers/oct6-database';
import {testDatabaseAdapter,testSqlClient} from './helpers/database';
import {calendarRoutes} from '../src/routes/calendar';
import {examRoutes} from '../src/routes/exams';
import {learningRoutes} from '../src/routes/learning';
import {mediaRoutes} from '../src/routes/media';
import {AppError} from '../src/lib/errors';
import type {Bindings} from '../src/types';
const provider=vi.hoisted(()=>({parts:vi.fn(),upload:vi.fn(),playback:vi.fn()}));
vi.mock('../src/lib/direct-storage',()=>({listUploadParts:provider.parts,signedUploadPart:provider.upload,signedPlayback:provider.playback}));
let db:PGlite;
const user=crypto.randomUUID(),other=crypto.randomUUID(),campus=crypto.randomUUID();
vi.mock('../src/lib/database',()=>({database:()=>testDatabaseAdapter(db),sqlClient:()=>testSqlClient(db),firstRow:(r:{rows:unknown[]})=>r.rows[0]}));
vi.mock('../src/middleware/auth',()=>({requireAuth:async(_c:Context,next:Next)=>next(),currentUser:(c:Context)=>({id:c.req.header('x-user'),universityId:campus,email:'fixture@example.invalid',roles:['STUDENT']})}));
const bucket={createMultipartUpload:vi.fn(async()=>({uploadId:crypto.randomUUID(),abort:vi.fn()})),resumeMultipartUpload:vi.fn(()=>({complete:vi.fn(async()=>({})),abort:vi.fn()})),head:vi.fn(),get:vi.fn(),delete:vi.fn()};
const env={ENVIRONMENT:'local',PRIVATE_BUCKET:bucket,R2_DIRECT_UPLOADS_ENABLED:'true',PUBLIC_API_ORIGIN:'https://api.example.invalid'} as unknown as Bindings;
const app=new Hono().route('/calendar',calendarRoutes).route('/exams',examRoutes).route('/learning',learningRoutes).route('/media',mediaRoutes);
app.onError((e,c)=>c.json({error:e.message},e instanceof AppError?e.status:500));
const request=(path:string,method='GET',body?:unknown,actor=user)=>app.request(path,{method,headers:{'x-user':actor,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},env);
async function json(response:Response,status=200){const body=await response.json();expect(response.status,JSON.stringify(body)).toBe(status);return body;}
let date:string;
beforeAll(async()=>{
 db=await october6Database();
 await db.query("insert into universities(id,name,slug,updated_at)values($1,'Followup API fixture',$1::uuid::text,now())",[campus]);
 for(const id of [user,other]){
  await db.query("insert into users(id,email,password_hash,updated_at)values($1,$1::uuid::text||'@example.invalid','fixture',now())",[id]);
  await db.query("insert into profiles(id,user_id,username,display_name,university_id,updated_at)values($1,$1,'fixture_'||right($1::uuid::text,12),'Fixture',$2,now())",[id,campus]);
 }
 date=(await db.query<{date_value:string}>("select ((now() at time zone 'Africa/Lagos')::date+20)::text date_value")).rows[0]!.date_value;
},90000);
beforeEach(async()=>{vi.clearAllMocks();await db.exec('begin;');});
afterEach(async()=>{await db.exec('rollback;');});
afterAll(async()=>db?.close());
describe('Followup HTTP boundaries',()=>{
 it('imports and clears multiple exam IDs through the real SQL adapter with owner isolation',async()=>{
  await json(await request('/exams/personal','POST',{requestId:crypto.randomUUID(),kind:'TEST',entry:{title:'Chemistry class test',courseCode:'CHE 201',date,startsAt:'14:00',endsAt:'15:00',venue:'LT 1'}}),201);
  const papers=(await json(await request('/exams'))).exams;
  const alarms=(await json(await request('/learning/alarms'))).alarms;
  expect(alarms).toHaveLength(4);expect(alarms[0].assessment_kind).toBe('TEST');
  expect(await json(await request('/learning/alarms/bulk-delete','POST',{ids:alarms.map((a:any)=>a.id)},other))).toEqual({deleted:0});
  expect(await json(await request('/learning/alarms/bulk-delete','POST',{ids:alarms.map((a:any)=>a.id)}))).toEqual({deleted:4});
  expect(await json(await request('/exams/import-alarms','POST',{entryIds:papers.map((p:any)=>p.id)},other))).toEqual({imported:0});
  await json(await request('/exams/import-alarms','POST',{entryIds:papers.map((p:any)=>p.id)}));
  expect((await json(await request('/learning/alarms'))).alarms).toHaveLength(4);
 });
 it('imports several calendar IDs without duplicate reminders or access to another student’s events',async()=>{
  const rid=crypto.randomUUID(),ids=[crypto.randomUUID(),crypto.randomUUID()];
  await db.query("insert into calendar_imports(user_id,request_id,request_hash)values($1,$2,'fixture')",[user,rid]);
  for(const [index,id] of ids.entries())await db.query("insert into student_calendar_events(id,user_id,institution_id,title,starts_on,ends_on,semester,import_id,row_number)values($1,$2,$3,'Calendar fixture',$4,$4,'First',$5,$6)",[id,user,campus,date,rid,index]);
  expect(await json(await request('/calendar/import-alarms','POST',{entryIds:ids,time:'08:00'},other))).toEqual({imported:0});
  for(let i=0;i<2;i++)expect(await json(await request('/calendar/import-alarms','POST',{entryIds:ids,time:'08:00'}))).toEqual({imported:2});
  expect((await json(await request('/learning/alarms'))).alarms).toHaveLength(2);
 });
 it('signs only an owned, reserved chunk and rejects a false or incomplete storage receipt',async()=>{
  const upload=crypto.randomUUID();
  await json(await request('/media/message-uploads','POST',{uploadId:upload,name:'clip.mp4',type:'video/mp4',size:512,kind:'post'}),201);
  provider.upload.mockResolvedValue({url:'https://fixture.r2.cloudflarestorage.com/reserved',headers:{},expiresIn:600});
  await json(await request('/media/message-uploads/'+upload+'/parts/1/url','POST',undefined,other),404);expect(provider.upload).not.toHaveBeenCalled();
  await json(await request('/media/message-uploads/'+upload+'/parts/2/url','POST'),409);
  await json(await request('/media/message-uploads/'+upload+'/parts/1/url','POST'));expect(provider.upload).toHaveBeenCalledWith(env,expect.any(String),expect.any(String),1,512);
  provider.parts.mockResolvedValue([{partNumber:1,size:511,etag:'a'.repeat(32)}]);
  await json(await request('/media/message-uploads/'+upload+'/parts/1/confirm','POST',{etag:'pretend-browser-receipt'}),409);
  expect((await db.query<{parts:object}>('select parts from app_private.media_upload_sessions where id=$1',[upload])).rows[0]!.parts).toEqual({});
 });
 it('publishes metadata once after verified direct storage completion and signs the actual post bucket',async()=>{
  const upload=crypto.randomUUID(),bytes=new Uint8Array(512);bytes.set(new TextEncoder().encode('ftypisom'),4);
  await json(await request('/media/message-uploads','POST',{uploadId:upload,name:'clip.mp4',type:'video/mp4',size:512,kind:'post'}),201);
  provider.parts.mockResolvedValue([{partNumber:1,size:512,etag:'a'.repeat(32)}]);bucket.get.mockResolvedValue({size:512,arrayBuffer:async()=>bytes.buffer});
  const finished=await json(await request('/media/message-uploads/'+upload+'/complete','POST'),201);expect(finished).toMatchObject({id:upload,kind:'post',private:false});
  expect(bucket.get).toHaveBeenCalledWith(expect.any(String),{range:{offset:0,length:512}});
  await json(await request('/media/message-uploads/'+upload+'/complete','POST'));expect(bucket.resumeMultipartUpload).toHaveBeenCalledTimes(1);
  expect((await db.query('select id from media_objects where id=$1',[upload])).rows).toHaveLength(1);
  provider.playback.mockResolvedValue({url:'https://fixture.r2.cloudflarestorage.com/signed',expiresIn:600});
  await json(await request('/media/'+upload+'/playback','POST',undefined,other));expect(provider.playback).toHaveBeenCalledWith(env,expect.objectContaining({private:true,object_key:expect.stringMatching(/^post-direct\/direct\//)}));
 });
 it('removes a forged video from storage without publishing media metadata',async()=>{
  const upload=crypto.randomUUID();
  await json(await request('/media/message-uploads','POST',{uploadId:upload,name:'clip.mp4',type:'video/mp4',size:512,kind:'post'}),201);
  provider.parts.mockResolvedValue([{partNumber:1,size:512,etag:'a'.repeat(32)}]);bucket.get.mockResolvedValue({size:512,arrayBuffer:async()=>new Uint8Array(512).buffer});
  await json(await request('/media/message-uploads/'+upload+'/complete','POST'),400);expect(bucket.delete).toHaveBeenCalledOnce();
  expect((await db.query('select id from media_objects where id=$1',[upload])).rows).toHaveLength(0);
  expect((await db.query<{status:string}>('select status from app_private.media_upload_sessions where id=$1',[upload])).rows[0]!.status).toBe('ABORTED');
 });
});
