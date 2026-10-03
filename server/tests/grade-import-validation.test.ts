import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {Hono,type Context,type Next} from 'hono';
import type {PGlite} from '@electric-sql/pglite';
import {studentRoutes} from '../src/routes/student';
import {learningRoutes} from '../src/routes/learning';
import {AppError} from '../src/lib/errors';
import {isSingleCourseCode,courseCodeIdentity} from '../src/lib/course-code';
import {prepareGradePlannerImport,isSingleCourseCode as mobileSingleCode} from '../../mobile/src/lib/grade-import';
import {createTestDatabase,testDatabaseAdapter,testSqlClient} from './helpers/database';
let db:PGlite;const student=crypto.randomUUID(),campus=crypto.randomUUID();
vi.mock('../src/lib/database',()=>({database:()=>testDatabaseAdapter(db),sqlClient:()=>testSqlClient(db),firstRow:(r:{rows:unknown[]})=>r.rows[0]}));
vi.mock('../src/middleware/auth',()=>({requireAuth:async(_c:Context,n:Next)=>n(),currentUser:()=>({id:student,universityId:campus,roles:['STUDENT']})}));
const app=new Hono().route('/student',studentRoutes).route('/learning',learningRoutes);app.onError((error,c)=>c.json({error:error.message},error instanceof AppError?error.status:500));
const req=(path:string,body:unknown,method='POST')=>app.request(path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)},{UNIFIED_SCHEMA_READY:'true'});
beforeAll(async()=>{db=await createTestDatabase();await db.query("insert into public.universities(id,name,slug,updated_at) values($1,'Grade campus','grade-campus',now())",[campus]);await db.query("insert into public.users(id,email,password_hash,updated_at) values($1,'grade-test@example.invalid','test-only',now())",[student]);},60000);
afterAll(async()=>db?.close());
describe('single course results with unambiguous units',()=>{
 it('accepts normal departmental code presentations and rejects combined rows consistently on server/mobile',()=>{
  for(const code of['BIO192','PHY291','MTH 201','CED-213','CPE_250']){expect(isSingleCourseCode(code),code).toBe(true);expect(mobileSingleCode(code),code).toBe(true);}
  for(const code of['BIO192, PHY291','BIO192/PHY291','BIO192\nPHY291','BIO192;PHY291','BIO192 PHY291','BIO192 & PHY291']){expect(isSingleCourseCode(code),code).toBe(false);expect(mobileSingleCode(code),code).toBe(false);}
  expect(courseCodeIdentity(' BIO 192 ')).toBe(courseCodeIdentity('bio192'));
 });
 it('leaves ambiguous shared-unit rows out of the preview and requires review rather than inventing a split',()=>{
  const result=prepareGradePlannerImport([{course_code:'BIO192',title:'Biology',units:3,grade:'A'},{course_code:'BIO192, PHY291',title:'BIO192, PHY291',units:2,grade:'A'}],{A:5,B:4});
  expect(result.rows).toEqual([{courseCode:'BIO192',courseTitle:'Biology',units:3,grade:'A',gradePoint:5}]);expect(result.warnings).toHaveLength(1);expect(result.warnings[0]).toContain('confirm each course’s units');
  expect(result.rows.reduce((sum,row)=>sum+row.units,0)).toBe(3);
 });
 it('excludes all duplicate aliases and identifies invalid units/grades before computing totals',()=>{
  const result=prepareGradePlannerImport([{course_code:'BIO192',title:'Biology',units:3,grade:'A'},{course_code:'bio 192',title:'Duplicate Biology',units:2,grade:'B'},{course_code:'PHY291',title:'Physics',units:0,grade:'A'},{course_code:'MTH201',title:'Mathematics',units:3,grade:'Z'},{course_code:'CED213',title:'Computer education',units:2,grade:'B'}],{A:5,B:4});
  expect(result.rows).toEqual([{courseCode:'CED213',courseTitle:'Computer education',units:2,grade:'B',gradePoint:4}]);expect(result.warnings.some(w=>w.includes('appears more than once'))).toBe(true);expect(result.warnings.some(w=>w.includes('valid course units'))).toBe(true);expect(result.warnings.some(w=>w.includes('grading scale'))).toBe(true);
 });
 it('rejects combined GPA/planner records and duplicate code variants at their actual save endpoints',async()=>{
  const grade=(code:string)=>({courseCode:code,courseTitle:'Biology',units:3,grade:'A',gradePoint:5});
  for(const code of['BIO192, PHY291','BIO192/PHY291','BIO192\nPHY291']){const saved=await req('/student/gpa',{sessionLabel:'2026/2027',semester:1,levelCode:'200',results:[grade(code)]});expect(saved.status,JSON.stringify(await saved.json())).toBe(400);const planned=await req('/learning/courses',{courses:[{courseCode:code,title:'Biology',units:3,grade:'A'}]},'PUT');expect(planned.status,JSON.stringify(await planned.json())).toBe(400);}
  expect((await req('/student/gpa',{sessionLabel:'2026/2027',semester:1,levelCode:'200',results:[grade('BIO192'),grade('BIO 192')]})).status).toBe(400);
  expect((await req('/learning/courses',{courses:[{courseCode:'BIO192',title:'Biology',units:3,grade:'A'},{courseCode:'bio 192',title:'Duplicate Biology',units:2,grade:'B'}]},'PUT')).status).toBe(400);
  expect((await db.query('select id from public.gpa_terms')).rows).toHaveLength(0);expect((await db.query('select course_code from public.course_drafts')).rows).toHaveLength(0);
  const valid=await req('/student/gpa',{sessionLabel:'2026/2027',semester:1,levelCode:'200',results:[grade('BIO192'),{...grade('PHY291'),units:2,grade:'B',gradePoint:4}]});expect(valid.status).toBe(200);expect(await valid.json()).toEqual({gpa:4.6,earnedUnits:5});
  expect((await req('/learning/courses',{courses:[{courseCode:'BIO192',title:'Biology',units:3,grade:'A'}]},'PUT')).status).toBe(200);
 });
});
