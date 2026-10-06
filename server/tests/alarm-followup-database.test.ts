import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {october6Database} from './helpers/oct6-database';
describe('Categorized alarms and private class tests',()=>{
 let db:PGlite;
 const user=randomUUID(),other=randomUUID(),uni=randomUUID();
 let date:string;
 beforeAll(async()=>{
  db=await october6Database();
  await db.query("insert into public.universities(id,name,slug,updated_at)values($1::uuid,'Fixture campus',$1::text,now())",[uni]);
  for(const id of [user,other]){
   await db.query("insert into public.users(id,email,password_hash,updated_at)values($1::uuid,$1::text||'@example.test','fixture',now())",[id]);
   await db.query("insert into public.profiles(id,user_id,username,display_name,university_id,updated_at)values($1::uuid,$1::uuid,'fixture_'||right($1::text,12),'Fixture student',$2::uuid,now())",[id,uni]);
  }
  date=(await db.query<{date_value:string}>("select ((now() at time zone 'Africa/Lagos')::date+20)::text date_value")).rows[0]!.date_value;
 },90000);
 afterAll(async()=>{await db?.close();});
 it('saves a class test once, generates four reminders and preserves it across timetable replacement',async()=>{
  const request=randomUUID(),entry={title:'Private class test',courseCode:'',date,startsAt:'14:00',endsAt:'15:00',venue:''};
  const add=()=>db.query('select * from app_private.add_personal_assessment($1,$2,$3,$4,$5,$6::jsonb)',[user,uni,request,'personal-hash','TEST',JSON.stringify(entry)]);
  expect((await add()).rows).toEqual([{imported:1,replayed:false}]);
  expect((await add()).rows).toEqual([{imported:1,replayed:true}]);
  const exams=[{...entry,title:'Timetable exam',courseCode:'CSC 201',startsAt:'09:00',endsAt:'11:00'}];
  await db.query('select * from app_private.import_exam_schedule($1,$2,$3,$4,$5::jsonb)',[user,uni,randomUUID(),'schedule-hash',JSON.stringify(exams)]);
  const rows=(await db.query<{assessment_kind:string;is_personal:boolean;count:number}>('select e.assessment_kind,e.is_personal,count(l.alarm_id)::int from public.student_exams e left join app_private.exam_alarm_links l on l.exam_id=e.id where e.user_id=$1 group by e.assessment_kind,e.is_personal',[user])).rows;
  expect(rows).toHaveLength(2);expect(rows.find(r=>r.is_personal)).toEqual({assessment_kind:'TEST',is_personal:true,count:4});
 });
 it('clears exam reminders without deleting papers and reimports without duplicates',async()=>{
  const ids=(await db.query<{id:string}>('select id from public.student_alarms where user_id=$1',[user])).rows.map(r=>r.id);
  expect((await db.query<{n:number}>('select app_private.clear_student_alarms($1,$2::uuid[]) n',[other,ids])).rows[0]!.n).toBe(0);
  expect((await db.query<{n:number}>('select app_private.clear_student_alarms($1,$2::uuid[]) n',[user,ids])).rows[0]!.n).toBe(8);
  const papers=(await db.query<{id:string;reminders_enabled:boolean}>('select id,reminders_enabled from public.student_exams where user_id=$1',[user])).rows;
  expect(papers).toHaveLength(2);expect(papers.every(e=>!e.reminders_enabled)).toBe(true);
  for(let i=0;i<2;i++)await db.query('select app_private.import_exam_alarms($1,$2::uuid[])',[user,papers.map(e=>e.id)]);
  expect((await db.query<{n:number}>('select count(*)::int n from public.student_alarms where user_id=$1',[user])).rows[0]!.n).toBe(8);
 });
 it('imports calendar alarms idempotently, enforces ownership and cleans up deleted events',async()=>{
  const event=randomUUID(),request=randomUUID();
  await db.query("insert into public.calendar_imports(user_id,request_id,request_hash)values($1,$2,'calendar-fixture')",[user,request]);
  await db.query("insert into public.student_calendar_events(id,user_id,institution_id,title,starts_on,ends_on,semester,import_id,row_number)values($1,$2,$3,'Registration closes',$4,$4,'First',$5,0)",[event,user,uni,date,request]);
  expect((await db.query<{n:number}>("select app_private.import_calendar_alarms($1,$2::uuid[],'08:00') n",[other,[event]])).rows[0]!.n).toBe(0);
  for(let i=0;i<2;i++)await db.query("select app_private.import_calendar_alarms($1,$2::uuid[],'08:00')",[user,[event]]);
  const rows=(await db.query<{id:string;fires_at:Date}>('select id,fires_at from public.student_alarms where calendar_event_id=$1',[event])).rows;
  expect(rows).toHaveLength(1);expect(new Date(rows[0]!.fires_at).toISOString()).toBe(date+'T07:00:00.000Z');
  await db.query('select app_private.clear_student_alarms($1,$2::uuid[])',[user,[rows[0]!.id]]);
  expect((await db.query('select id from public.student_calendar_events where id=$1',[event])).rows).toHaveLength(1);
  await db.query("select app_private.import_calendar_alarms($1,$2::uuid[],'08:00')",[user,[event]]);
  await db.query('delete from public.student_calendar_events where id=$1',[event]);
  expect((await db.query('select id from public.student_alarms where calendar_event_id=$1',[event])).rows).toHaveLength(0);
 });
 it('rehearses the operator fixtures, including direct-post upload reservations, without retaining synthetic data',async()=>{
  const before=(await db.query('select count(*)::int n from public.users')).rows;
  await db.exec('begin;');
  try{await db.exec(readFileSync(new URL('../../database/verification/2026-10-06-followup-acceptance.sql',import.meta.url),'utf8'));}
  finally{await db.exec('rollback;');}
  expect((await db.query('select count(*)::int n from public.users')).rows).toEqual(before);
 });
});
