import {PGlite} from '@electric-sql/pglite';
import {Hono} from 'hono';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {testDatabaseAdapter} from './helpers/database';
import {messageRoutes} from '../src/routes/messages';
import {AppError} from '../src/lib/errors';
import type {Bindings,Variables} from '../src/types';
let db:PGlite;
vi.mock('../src/lib/database',()=>({database:()=>testDatabaseAdapter(db),firstRow:(r:{rows:unknown[]})=>r.rows[0]}));
vi.mock('../src/middleware/auth',()=>({requireAuth:async(_c:unknown,next:()=>Promise<void>)=>next(),currentUser:(c:{get:(k:string)=>unknown})=>c.get('user')}));
const reader=crypto.randomUUID(),sender=crypto.randomUUID(),outsider=crypto.randomUUID(),thread=crypto.randomUUID(),otherThread=crypto.randomUUID();
const seen=crypto.randomUUID(),unseen=crypto.randomUUID(),elsewhere=crypto.randomUUID();
const app=new Hono<{Bindings:Bindings;Variables:Variables}>();
app.use('*',async(c,next)=>{c.set('user',{id:c.req.header('X-Test-User')??reader,email:'test@example.invalid',roles:['STUDENT'],operatorRoles:[],universityId:null});await next();});
app.route('/messages',messageRoutes);
app.onError((e,c)=>e instanceof AppError?c.json({code:e.code},e.status):c.json({error:String(e)},500));
function read(lastReadMessageId:string,user=reader){return app.request('/messages/threads/'+thread+'/read',{method:'PUT',headers:{'Content-Type':'application/json','X-Test-User':user},body:JSON.stringify({lastReadMessageId})},{} as Bindings);}
beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`create table public.profiles(user_id uuid primary key,deleted_at timestamptz);create table public.user_blocks(blocker_id uuid,blocked_id uuid);create table public.direct_threads(id uuid primary key,institution_id uuid,initiator_id uuid,recipient_id uuid,status text);create table public.direct_messages(id uuid primary key,thread_id uuid,sender_id uuid,body text,media_id uuid,unsent_at timestamptz,read_at timestamptz,created_at timestamptz);`);
  for(const user of [reader,sender,outsider])await db.query('insert into public.profiles(user_id)values($1)',[user]);
  for(const id of [thread,otherThread])await db.query("insert into public.direct_threads values($1,null,$2,$3,'ACCEPTED')",[id,sender,reader]);
  for(const [id,target,time] of [[seen,thread,'2026-10-12T10:00:00Z'],[unseen,thread,'2026-10-12T10:01:00Z'],[elsewhere,otherThread,'2026-10-12T10:00:00Z']])await db.query("insert into public.direct_messages(id,thread_id,sender_id,body,created_at)values($1,$2,$3,'Hello',$4)",[id,target,sender,time]);
},15000);
afterAll(async()=>{await db?.close();});
describe('confirmed message reads',()=>{
  it('reduces 3 to 2 without marking an unseen later message; repeated reads are idempotent',async()=>{
    for(let i=0;i<2;i++){const response=await read(seen);expect(response.status).toBe(200);expect(await response.json()).toEqual({read:true,unreadCount:2});}
    expect((await db.query<{read_at:string|null}>('select read_at from public.direct_messages where id=$1',[unseen])).rows[0]?.read_at).toBeNull();
  });
  it('rejects another participant’s message boundary and another account',async()=>{
    expect((await read(elsewhere)).status).toBe(404);
    expect((await read(seen,outsider)).status).toBe(404);
    expect((await read('bad-id')).status).toBe(400);
  });
  it('keeps blocked conversations private and their messages unread',async()=>{
    await db.query('insert into public.user_blocks values($1,$2)',[reader,sender]);
    expect((await read(unseen)).status).toBe(404);
    expect((await db.query<{read_at:string|null}>('select read_at from public.direct_messages where id=$1',[unseen])).rows[0]?.read_at).toBeNull();
  });
});
