import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, testDatabaseAdapter, testSqlClient } from "./helpers/database";
import { academicImportLimits, academicImportUsage, consumeAcademicImportQuota } from "../src/lib/ai-quota";
import type { AuthenticatedUser, Bindings } from "../src/types";
let db:PGlite;
vi.mock('../src/lib/database',()=>({database:()=>testDatabaseAdapter(db),sqlClient:()=>testSqlClient(db),firstRow:(result:{rows:unknown[]})=>result.rows[0]}));
const user={id:'20000000-0000-4000-8000-000000000001',email:'student@example.invalid',roles:['STUDENT'],operatorRoles:[],universityId:null} as AuthenticatedUser;
const other={...user,id:'20000000-0000-4000-8000-000000000002'};
const env={} as Bindings;
beforeAll(async()=>{db=await createTestDatabase();await db.exec(readFileSync(new URL('../../database/neon/migrations/20261003103000_academic_import_allowance.sql',import.meta.url),'utf8'));for(const actor of[user,other])await db.query("insert into public.users(id,email,password_hash,updated_at) values($1,$2,'test',now())",[actor.id,actor.id+'@example.invalid']);},60000);
beforeEach(async()=>{await db.exec('delete from app_private.academic_import_usage;delete from app_private.ai_requests');});
afterAll(async()=>{await db?.close();});
describe('shared weekly source imports',()=>{
 it('restores failed and abandoned credits while retaining completed and live reservations',async()=>{
  const states=['FAILED','PROCESSING','COMPLETED','PROCESSING'] as const,ids=states.map(()=>crypto.randomUUID());
  for(const [i,status] of states.entries()){
   await consumeAcademicImportQuota(env,user,'timetable',ids[i]!,false);
   await db.query("insert into app_private.ai_requests(user_id,idempotency_key,request_hash,mode,status,result,created_at) values($1,$2,repeat('a',64),'timetable',$3,'{}'::jsonb,$4)",[user.id,ids[i],status,new Date(Date.now()-(i===1?360000:0)).toISOString()]);
  }
  expect(await academicImportUsage(env,user,false)).toMatchObject({used:2,remaining:3});
  // User A cannot release user B's unsuccessful reservation.
  const foreign=crypto.randomUUID();await consumeAcademicImportQuota(env,other,'timetable',foreign,false);
  await db.query("insert into app_private.ai_requests(user_id,idempotency_key,request_hash,mode,status) values($1,$2,repeat('b',64),'timetable','FAILED')",[other.id,foreign]);
  await consumeAcademicImportQuota(env,user,'timetable',crypto.randomUUID(),false);
  const rows=await db.query('select request_id from app_private.academic_import_usage where user_id=$1',[user.id]);
  expect(rows.rows.map(row=>row.request_id)).toEqual(expect.arrayContaining([ids[2],ids[3]]));expect(rows.rows).toHaveLength(3);
  expect((await db.query('select request_id from app_private.academic_import_usage where user_id=$1',[other.id])).rows).toHaveLength(1);
  // The paid attempt audit remains intact even after the allowance is refunded.
  expect((await db.query('select status from app_private.ai_requests where user_id=$1',[user.id])).rows).toHaveLength(4);
 });
 it('shares Standard five across timetable, calendar, image and document',async()=>{
  for(const kind of ['calendar','timetable','image','document','timetable'] as const)await consumeAcademicImportQuota(env,user,kind,crypto.randomUUID(),false);
  expect(await academicImportUsage(env,user,false)).toMatchObject({limit:5,used:5,remaining:0,calendar:{used:1,remaining:2}});
  await expect(consumeAcademicImportQuota(env,user,'image',crypto.randomUUID(),false)).rejects.toMatchObject({status:429,details:{reason:'IMPORT_WEEK_LIMIT'}});
 });
 it('limits Standard calendars to three while preserving other remaining imports',async()=>{
  for(let i=0;i<3;i++)await consumeAcademicImportQuota(env,user,'calendar',crypto.randomUUID(),false);
  await expect(consumeAcademicImportQuota(env,user,'calendar',crypto.randomUUID(),false)).rejects.toMatchObject({status:429,details:{reason:'IMPORT_CALENDAR_LIMIT'}});
  await consumeAcademicImportQuota(env,user,'timetable',crypto.randomUUID(),false);
  expect(await academicImportUsage(env,user,false)).toMatchObject({used:4,remaining:1});
 });
 it('does not count the same parse or reviewed save twice',async()=>{
  const requestId=crypto.randomUUID();await consumeAcademicImportQuota(env,user,'calendar',requestId,false);await consumeAcademicImportQuota(env,user,'calendar',requestId,false);
  expect(await academicImportUsage(env,user,false)).toMatchObject({used:1});
 });
 it('grants Pro30 and enforces the31st reservation',async()=>{
  expect(academicImportLimits(true)).toEqual({limit:30,calendarLimit:30});
  for(let i=0;i<30;i++)await consumeAcademicImportQuota(env,user,'document',crypto.randomUUID(),true);
  await expect(consumeAcademicImportQuota(env,user,'image',crypto.randomUUID(),true)).rejects.toMatchObject({status:429});
  expect(await academicImportUsage(env,user,true)).toMatchObject({limit:30,used:30,remaining:0});
 });
 it('isolates users and excludes previous weeks',async()=>{
  await consumeAcademicImportQuota(env,user,'image',crypto.randomUUID(),false);
  await db.exec("update app_private.academic_import_usage set created_at=now()-interval '8 days'");
  expect(await academicImportUsage(env,user,false)).toMatchObject({used:0});
  await consumeAcademicImportQuota(env,other,'image',crypto.randomUUID(),false);
  expect(await academicImportUsage(env,user,false)).toMatchObject({used:0});expect(await academicImportUsage(env,other,false)).toMatchObject({used:1});
 });
});
