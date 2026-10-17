import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, testDatabaseAdapter } from './helpers/database';
import { messageRoutes } from '../src/routes/messages';
import { AppError } from '../src/lib/errors';
import type { Bindings, Variables } from '../src/types';

let db:PGlite;
vi.mock('../src/lib/database',()=>({database:()=>testDatabaseAdapter(db),firstRow:(value:{rows:unknown[]})=>value.rows[0]}));
vi.mock('../src/middleware/auth',()=>({requireAuth:async(_c:unknown,next:()=>Promise<void>)=>next(),currentUser:(c:{get:(key:string)=>unknown})=>c.get('user')}));
const campus=crypto.randomUUID(),sender=crypto.randomUUID(),recipient=crypto.randomUUID(),outsider=crypto.randomUUID(),thread=crypto.randomUUID();
const app=new Hono<{Bindings:Bindings;Variables:Variables}>();
app.use('*',async(c,next)=>{c.set('user',{id:c.req.header('X-Test-User')??sender,email:'fixture@example.invalid',roles:['STUDENT'],operatorRoles:[],universityId:campus});await next();});
app.route('/messages',messageRoutes);
app.onError((error,c)=>c.json({error:error.message},error instanceof AppError?error.status:500));
function send(id:string,body='A synthetic confirmation fixture',user=sender){return app.request('/messages/threads/'+thread+'/messages',{method:'POST',headers:{'Content-Type':'application/json','X-Test-User':user},body:JSON.stringify({id,body})},{} as Bindings);}
beforeAll(async()=>{
  db=await createTestDatabase();
  await db.query("insert into public.universities(id,name,slug,updated_at)values($1,'Synthetic confirmation campus',$1::uuid::text,now())",[campus]);
  for(const user of [sender,recipient,outsider]){
    await db.query("insert into public.users(id,email,password_hash,updated_at)values($1,$1::uuid::text||'@example.invalid','synthetic',now())",[user]);
    await db.query("insert into public.profiles(id,user_id,university_id,username,display_name,updated_at)values($1,$1,$2,'fixture_'||substring(replace($1::uuid::text,'-',''),1,20),'Synthetic',now())",[user,campus]);
  }
  await db.query("insert into public.direct_threads(id,institution_id,initiator_id,recipient_id,status)values($1,$2,$3,$4,'ACCEPTED')",[thread,campus,sender,recipient]);
},60000);
afterAll(async()=>{await db?.close();});
describe('durable message confirmations',()=>{
  it('commits message, notice and push together; a lost-response replay returns the same receipt',async()=>{
    const id=crypto.randomUUID();const first=await send(id);expect(first.status).toBe(201);expect((await first.json() as any).message.id).toBe(id);
    const replay=await send(id);expect(replay.status).toBe(200);expect((await replay.json() as any).message.id).toBe(id);
    for(const table of ['public.direct_messages','public.in_app_notifications','app_private.notification_outbox']){
      const field=table==='public.direct_messages'?'id':'dedupe_key',value=field==='id'?id:'message:'+id;
      expect(Number((await db.query<{count:string}>('select count(*) from '+table+' where '+field+'=$1',[value])).rows[0]!.count)).toBe(1);
    }
  });
  it('notification failure leaves no secretly committed message and the same id succeeds when the queue recovers',async()=>{
    await db.exec("create function app_private.fail_fixture_push() returns trigger language plpgsql as $$begin raise exception 'Synthetic outbox failure';end$$;create trigger fail_fixture_push before insert on app_private.notification_outbox for each row execute function app_private.fail_fixture_push()");
    const id=crypto.randomUUID();expect((await send(id)).status).toBe(500);
    expect((await db.query('select id from public.direct_messages where id=$1',[id])).rows).toHaveLength(0);
    expect((await db.query('select id from public.in_app_notifications where dedupe_key=$1',['message:'+id])).rows).toHaveLength(0);
    await db.exec('drop trigger fail_fixture_push on app_private.notification_outbox');
    expect((await send(id)).status).toBe(201);
  });
  it('concurrent retries confirm one intent and neither different text nor another account can reuse its receipt',async()=>{
    const id=crypto.randomUUID();const responses=await Promise.all([send(id),send(id)]);
    expect(responses.every(response=>response.ok)).toBe(true);
    for(const response of responses)expect((await response.json() as any).message.id).toBe(id);
    expect((await db.query('select id from public.direct_messages where id=$1',[id])).rows).toHaveLength(1);
    expect((await send(id,'Different text')).status).toBe(409);
    expect((await send(id,undefined,outsider)).status).toBe(404);
  });
});

describe('agent DM contact rules',()=>{
 it('removes a violating number, pauses the conversation for three days and permits tutor contacts',async()=>{
  const application=crypto.randomUUID(),profile=crypto.randomUUID();
  await db.query("insert into agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement)values($1,$2,$3,'VENDOR','Fixture vendor','+2348012345678','Synthetic contact-rule fixture')",[application,recipient,campus]);
  await db.query("insert into agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,verified_at)values($1,$2,$3,$4,'VENDOR','Fixture vendor',now())",[profile,recipient,campus,application]);
  const id=crypto.randomUUID();expect((await send(id,'Pay into 0123456789')).status).toBe(403);
  expect((await db.query('select id from direct_messages where id=$1',[id])).rows).toHaveLength(0);
  const pause=(await db.query<{paused:boolean}>("select suspended_until>now()+interval '2 days 23 hours' paused from direct_threads where id=$1",[thread])).rows[0]!;expect(pause.paused).toBe(true);
  expect((await send(crypto.randomUUID(),'Is this still available?')).status).toBe(403);
  await db.query("update agent_profiles set agent_type='TUTOR'where id=$1",[profile]);
  expect((await send(crypto.randomUUID(),'Call me on 08012345678')).status).toBe(201);
 });
});
