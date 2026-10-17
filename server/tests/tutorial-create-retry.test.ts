import { PGlite } from '@electric-sql/pglite';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import schema from './fixtures/database-schema.json';
import { testDatabaseAdapter } from './helpers/database';
import { agentRoutes } from '../src/routes/agents';
import { AppError } from '../src/lib/errors';
import type { Bindings, Variables } from '../src/types';

let db:PGlite;
vi.mock('../src/lib/database',()=>({database:()=>testDatabaseAdapter(db),firstRow:(result:{rows:unknown[]})=>result.rows[0]}));
vi.mock('../src/middleware/auth',()=>({requireAuth:async(_context:unknown,next:()=>Promise<void>)=>next(),currentUser:(context:{get:(key:string)=>unknown})=>context.get('user')}));
const owner=crypto.randomUUID(),otherOwner=crypto.randomUUID(),campus=crypto.randomUUID(),otherCampus=crypto.randomUUID();
const app=new Hono<{Bindings:Bindings;Variables:Variables}>();
app.use('*',async(context,next)=>{
  context.set('user',{id:context.req.header('X-Test-User')??owner,email:'test@example.invalid',roles:['STUDENT'],operatorRoles:[],universityId:context.req.header('X-Test-Campus')??campus});
  await next();
});
app.route('/agents',agentRoutes);
app.onError((error,context)=>error instanceof AppError?context.json({code:error.code},error.status):context.json({error:String(error)},500));
const env={TUTORIALS_ENABLED:'true',PHASE_2_SCHEMA_READY:'true',PAYMENTS_ENABLED:'false'} as Bindings;
const details={courseCode:'MTH 101',title:'Calculus revision',description:'An in-person revision session for first-year calculus.',format:'IN_PERSON',priceKobo:0,capacity:20,locationText:'Library'};
async function create(requestId:string,data:unknown=details,user=owner,institution=campus){return app.request('/agents/tutorials',{method:'POST',headers:{'Content-Type':'application/json','X-Test-User':user,'X-Test-Campus':institution},body:JSON.stringify({...data as object,requestId})},env);}
beforeAll(async()=>{
  db=new PGlite();
  for(const name of ['agent_profiles','tutorial_listings']){
    await db.exec(schema.tables.find(statement=>statement.startsWith('CREATE TABLE public.'+name+' '))!);
    await db.exec('alter table public.'+name+' add primary key(id)');
  }
  await db.exec('alter table agent_profiles add column suspension_ends_at timestamptz,add column suspension_reason text');
  for(const user of [owner,otherOwner])await db.query("insert into public.agent_profiles(university_id,user_id,application_id,agent_type,display_name,verified_at)values($1,$2,$3,'TUTOR','Test tutor',now())",[campus,user,crypto.randomUUID()]);
},15000);
afterAll(async()=>{await db?.close();});
describe('tutorial creation retry against PostgreSQL',()=>{
  it('returns the same listing after an interrupted create and after submission',async()=>{
    const key=crypto.randomUUID();
    const responses=await Promise.all([create(key),create(key)]);
    expect(responses.map(response=>response.status)).toEqual([201,201]);
    for(const response of responses)expect(await response.json()).toEqual({id:key,status:'DRAFT'});
    await db.query("update public.tutorial_listings set status='SUBMITTED' where id=$1",[key]);
    const retried=await create(key);expect(retried.status).toBe(201);expect(await retried.json()).toEqual({id:key,status:'SUBMITTED'});
    expect((await db.query('select id from public.tutorial_listings where id=$1',[key])).rows).toHaveLength(1);
  });
  it('rejects reused keys with different content, another owner or deleted content',async()=>{
    const key=crypto.randomUUID();expect((await create(key)).status).toBe(201);
    expect((await create(key,{...details,title:'A different class'})).status).toBe(409);
    expect((await create(key,details,otherOwner)).status).toBe(409);
    await db.query('update public.tutorial_listings set deleted_at=now() where id=$1',[key]);
    expect((await create(key)).status).toBe(409);
  });
  it('does not use an approved profile in a different current institution',async()=>{
    expect((await create(crypto.randomUUID(),details,owner,otherCampus)).status).toBe(403);
  });
});
