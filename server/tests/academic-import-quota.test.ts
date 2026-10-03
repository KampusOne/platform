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
beforeEach(async()=>{await db.exec('delete from app_private.academic_import_usage');});
afterAll(async()=>{await db?.close();});
describe('shared weekly source imports',()=>{
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
