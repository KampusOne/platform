import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
let db:PGlite;
const campus=crypto.randomUUID(),buyer=crypto.randomUUID(),seller=crypto.randomUUID(),agent=crypto.randomUUID();
beforeEach(async()=>{
  db=new PGlite();
  await db.exec(`create schema app_private;
    create table users(id uuid primary key,status text default 'ACTIVE',deleted_at timestamptz);
    create table profiles(user_id uuid primary key,university_id uuid,deleted_at timestamptz);
    create table agent_profiles(id uuid primary key,user_id uuid,university_id uuid);
    create table orders(id uuid primary key,buyer_user_id uuid,vendor_profile_id uuid,university_id uuid,status text,earnings_state text default 'PENDING');
    create table tutorial_listings(id uuid primary key,tutor_profile_id uuid,university_id uuid,title text);
    create table tutorial_bookings(id uuid primary key,listing_id uuid,student_user_id uuid,university_id uuid,status text,earnings_state text default 'PENDING');
    create table app_private.tutorial_material_purchases(id uuid primary key,student_user_id uuid,tutor_user_id uuid,university_id uuid,status text,title text,earnings_state text default 'PENDING');
    create table payment_attempts(id uuid primary key,user_id uuid,university_id uuid,resource_type text,resource_id uuid,provider_reference text,status text);
    create table app_private.verified_collection_receipts(provider_reference text primary key);
    create table in_app_notifications(id uuid primary key default gen_random_uuid(),user_id uuid,institution_id uuid,actor_user_id uuid,title text,body text,path text,dedupe_key text unique);
    create table app_private.notification_outbox(id uuid primary key default gen_random_uuid(),user_id uuid,channel text,subject text,body text,dedupe_key text unique);`);
  await db.exec(readFileSync(new URL('../../database/neon/migrations/20261014200000_commerce_notifications.sql',import.meta.url),'utf8'));
  for(const id of [buyer,seller]){
    await db.query('insert into users(id)values($1)',[id]);
    await db.query('insert into profiles(user_id,university_id)values($1,$2)',[id,campus]);
  }
  await db.query('insert into agent_profiles values($1,$2,$3)',[agent,seller,campus]);
});
afterEach(async()=>db?.close());
async function purchase(kind='STORE_ORDER',verified=true){
  const id=crypto.randomUUID(),ref='K1-B-O-'+id;
  if(kind==='STORE_ORDER')await db.query("insert into orders(id,buyer_user_id,vendor_profile_id,university_id,status)values($1,$2,$3,$4,'PAID')",[id,buyer,agent,campus]);
  else if(kind==='TUTORIAL_BOOKING'){
    await db.query("insert into tutorial_listings values($1,$2,$3,'MTH201 course')",[id,agent,campus]);
    await db.query("insert into tutorial_bookings(id,listing_id,student_user_id,university_id,status)values($1,$1,$2,$3,'CONFIRMED')",[id,buyer,campus]);
  }else await db.query("insert into app_private.tutorial_material_purchases(id,student_user_id,tutor_user_id,university_id,status,title)values($1,$2,$3,$4,'PAID','MTH201 course')",[id,buyer,seller,campus]);
  if(verified)await db.query('insert into app_private.verified_collection_receipts values($1)',[ref]);
  await db.query("insert into payment_attempts values($1,$2,$3,$4,$1,$5,'INITIALIZED')",[id,buyer,campus,kind,ref]);
  return id;
}
async function paid(id:string){await db.query("update payment_attempts set status='SUCCEEDED' where id=$1",[id]);}
async function notices(){return(await db.query<{user_id:string;title:string;path:string;dedupe_key:string;body:string}>('select * from in_app_notifications order by dedupe_key')).rows;}
describe('transactional commerce notifications',()=>{
  it('queues payment, acceptance, delivery and clearing once with matching durable push notices',async()=>{
    const id=await purchase();await paid(id);await paid(id);
    expect((await notices()).map(n=>n.title).sort()).toEqual(['New paid order','Payment received']);
    expect((await notices()).find(n=>n.user_id===buyer)?.path).toBe('/order-detail?id='+id);
    expect((await notices()).find(n=>n.user_id===seller)?.path).toBe('/vendor-orders');
    for(const status of ['ACCEPTED','ACCEPTED','DELIVERED','DELIVERED'])await db.query('update orders set status=$2 where id=$1',[id,status]);
    await db.query("update orders set earnings_state='AVAILABLE' where id=$1",[id]);
    await db.query("update orders set earnings_state='AVAILABLE' where id=$1",[id]);
    const rows=await notices();
    expect(rows.map(n=>n.title).sort()).toEqual(['Earnings available','New paid order','Order accepted','Order delivered','Payment received','Purchase completed']);
    expect(rows.find(n=>n.title==='Purchase completed')?.body).toContain('Thank you');
    const pushes=(await db.query<{dedupe_key:string;channel:string}>('select * from app_private.notification_outbox order by dedupe_key')).rows;
    expect(pushes.map(n=>n.dedupe_key)).toEqual(rows.map(n=>n.dedupe_key));expect(pushes.every(n=>n.channel==='PUSH')).toBe(true);
  });
  it.each(['TUTORIAL_BOOKING','TUTORIAL_PURCHASE'])('notifies both sides of a paid %s and cleared earnings',async kind=>{
    const id=await purchase(kind);await paid(id);await paid(id);
    expect(await notices()).toHaveLength(2);expect((await notices()).every(n=>n.body.includes('MTH201 course'))).toBe(true);
    const table=kind==='TUTORIAL_BOOKING'?'tutorial_bookings':'app_private.tutorial_material_purchases';
    await db.query(`update ${table} set earnings_state='AVAILABLE' where id=$1`,[id]);
    expect((await notices()).filter(n=>n.title==='Earnings available')).toHaveLength(1);
    expect((await notices()).filter(n=>n.title==='Purchase completed')).toHaveLength(1);
  });
  it('does not emit paid notices for unverified, failed or cancelled purchases',async()=>{
    const unverified=await purchase('STORE_ORDER',false);await paid(unverified);
    const failed=await purchase();await db.query("update payment_attempts set status='FAILED' where id=$1",[failed]);
    const cancelled=await purchase();await db.query("update orders set status='CANCELLED' where id=$1",[cancelled]);await paid(cancelled);
    expect(await notices()).toHaveLength(0);expect((await db.query('select * from app_private.notification_outbox')).rows).toHaveLength(0);
  });
  it('rolls notices back with a failed settlement transaction',async()=>{
    const id=await purchase();await db.exec(`begin;update payment_attempts set status='SUCCEEDED' where id='${id}';rollback;`);
    expect(await notices()).toHaveLength(0);expect((await db.query('select * from app_private.notification_outbox')).rows).toHaveLength(0);
  });
  it('does not send another university’s seller notice or use another buyer’s receipt',async()=>{
    const id=await purchase();await db.query('update profiles set university_id=$2 where user_id=$1',[seller,crypto.randomUUID()]);await paid(id);
    expect((await notices()).map(n=>n.user_id)).toEqual([buyer]);
    const wrong=await purchase();await db.query('update payment_attempts set user_id=$2 where id=$1',[wrong,seller]);await paid(wrong);
    expect(await notices()).toHaveLength(1);
  });
});
