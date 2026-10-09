import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import type {PGlite} from "@electric-sql/pglite";
import {october6Database} from "./helpers/oct6-database";

describe("Class reminder mute is class-only and expires after one Lagos day",()=>{
 let db:PGlite;
 const me=randomUUID(),other=randomUUID(),university=randomUUID();
 const myClass=randomUUID(),theirClass=randomUUID();
 let today:string;
 beforeAll(async()=>{
  db=await october6Database();
  today=(await db.query<{day:string}>("select (now() at time zone 'Africa/Lagos')::date::text as day")).rows[0]!.day;
  const dow=(await db.query<{day:number}>("select extract(dow from now() at time zone 'Africa/Lagos')::int as day")).rows[0]!.day;
  await db.query("insert into public.universities(id,name,slug,updated_at) values ($1::uuid,'Class-alarm fixture',$1::text,now())",[university]);
  for(const student of [me,other]){
   await db.query("insert into public.users(id,email,password_hash,updated_at) values($1::uuid,$1::text||'@example.test','fixture',now())",[student]);
   await db.query("insert into public.profiles(id,user_id,username,display_name,university_id,updated_at) values($1::uuid,$1::uuid,'student_'||right($1::text,12),'Fixture',$2,now())",[student,university]);
  }
  for(const [student,entry] of [[me,myClass],[other,theirClass]]){
   await db.query("insert into public.timetable_entries(id,user_id,university_id,title,course_code,day_of_week,starts_at,ends_at,reminder_minutes,reminder_enabled) values($1,$2,$3,'Computer Architecture','CPE 201',$4,'14:00','15:00',15,true)",[entry,student,university,dow]);
  }
  await db.query("insert into public.student_alarms(user_id,institution_id,label,time,days,enabled) values($1,$2,'Personal wake up','07:00',array[$3]::smallint[],true)",[me,university,dow]);
 },90000);
 afterAll(async()=>{await db?.close();});
 it("only mutes the owner's class alarms and leaves personal alarms and other users alone",async()=>{
  const mute=(await db.query<{n:number}>("select app_private.set_class_alarms_muted_today($1,true) n",[me])).rows[0]!.n;
  expect(mute).toBe(1);
  const mine=(await db.query<{timetable_entry_id:string|null;muted_on:string|null;enabled:boolean}>("select timetable_entry_id,muted_on::text,enabled from public.student_alarms where user_id=$1 order by timetable_entry_id nulls last",[me])).rows;
  expect(mine).toHaveLength(2);
  expect(mine.find(a=>a.timetable_entry_id===myClass)).toMatchObject({muted_on:today,enabled:true});
  expect(mine.find(a=>a.timetable_entry_id===null)).toMatchObject({muted_on:null,enabled:true});
  const theirs=(await db.query<{muted_on:string|null}>("select muted_on::text from public.student_alarms where user_id=$1",[other])).rows;
  expect(theirs[0]?.muted_on).toBeNull();
 });
 it("allows resuming today without disabling the recurring alarm",async()=>{
  expect((await db.query<{n:number}>("select app_private.set_class_alarms_muted_today($1,false) n",[me])).rows[0]!.n).toBe(1);
  const row=(await db.query<{muted_on:string|null;enabled:boolean}>("select muted_on::text,enabled from public.student_alarms where timetable_entry_id=$1",[myClass])).rows[0];
  expect(row).toMatchObject({muted_on:null,enabled:true});
 });
});
