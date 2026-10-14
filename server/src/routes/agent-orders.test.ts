import { PGlite } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../lib/errors';
import type { Bindings, Variables } from '../types';

const stubs=vi.hoisted(()=>({execute:vi.fn(),user:{id:'11111111-1111-4111-8111-111111111111',universityId:'22222222-2222-4222-8222-222222222222'}}));
vi.mock('../middleware/auth',()=>({requireAuth:async(_c:unknown,next:()=>Promise<void>)=>next(),currentUser:()=>stubs.user}));
vi.mock('../lib/database',()=>({database:()=>({execute:stubs.execute}),firstRow:(r:{rows:unknown[]})=>r.rows[0],sqlClient:vi.fn()}));
vi.mock('../lib/fulfilment',async original=>({...await original<typeof import('../lib/fulfilment')>(),fulfilmentSchemaReady:async()=>false}));
vi.mock('../lib/commerce-pricing',async original=>({...await original<typeof import('../lib/commerce-pricing')>(),inclusiveStoreReady:async()=>false}));
vi.mock('../lib/tutorial-pricing',async original=>({...await original<typeof import('../lib/tutorial-pricing')>(),pricedTutorialReady:async()=>false}));
vi.mock('../lib/rider-finance',async original=>({...await original<typeof import('../lib/rider-finance')>(),riderFinanceSummary:async()=>null}));
import { agentRoutes } from './agents';

const db=new PGlite(),dialect=new PgDialect();
const uni=stubs.user.universityId,otherUni='99999999-9999-4999-8999-999999999999',vendor='33333333-3333-4333-8333-333333333333';
const states=['PAID','ACCEPTED','READY','IN_DELIVERY','DELIVERED','PENDING_PAYMENT','PAYMENT_FAILED','FAILED','CANCELLED','REFUNDED','DISPUTED'];
const orderId=(i:number)=>'44444444-4444-4444-8444-'+String(i).padStart(12,'0');
const app=new Hono<{Bindings:Bindings;Variables:Variables}>().route('/v1/agents',agentRoutes);
app.onError((error,c)=>c.json({error:{message:error.message}},error instanceof AppError?error.status:500));
const env={PHASE_3_SCHEMA_READY:'true'} as Bindings;
beforeAll(async()=>{
  await db.exec(`
    create table agent_profiles(id uuid primary key,user_id uuid,university_id uuid,agent_type text,status text,display_name text,biography text,verified_at timestamptz);
    create table orders(id uuid primary key,vendor_profile_id uuid,university_id uuid,status text,subtotal_kobo int,delivery_fee_kobo int,total_kobo int,delivery_zone_id uuid,delivery_note text,pricing_formula_version text,earnings_state text,created_at timestamptz default now(),updated_at timestamptz default now());
    create table delivery_zones(id uuid,name text);
    create table vendor_products(id uuid,name text,image_url text,vendor_profile_id uuid);
    create table order_items(id uuid,order_id uuid,product_id uuid,quantity int,unit_price_kobo int,created_at timestamptz);
    create table order_delivery_snapshots(order_id uuid,recipient_name text,recipient_phone_e164 text,delivery_location text,delivery_landmark text,latitude numeric,longitude numeric);
    create table order_status_events(id uuid,order_id uuid,previous_status text,status text,source text,note text,occurred_at timestamptz);
    create table delivery_jobs(id uuid,order_id uuid,university_id uuid,status text,rider_profile_id uuid,rider_earning_kobo int,earnings_state text);
    create table agent_applications(id uuid,user_id uuid,agent_type text,display_name text,phone_e164 text,legal_name text,kyc_status text,bank_status text,phone_verified_at timestamptz,status text,review_note text,submitted_at timestamptz,reviewed_at timestamptz,updated_at timestamptz);
    create table tutorial_listings(id uuid,tutor_profile_id uuid,title text);
    create table tutorial_bookings(id uuid,listing_id uuid,status text,amount_kobo int,earnings_state text,scheduled_for timestamptz,created_at timestamptz);
  `);
  await db.query('insert into agent_profiles(id,user_id,university_id,agent_type,status) values($1,$2,$3,\'VENDOR\',\'ACTIVE\')',[vendor,stubs.user.id,uni]);
  for(const [i,state] of states.entries())await db.query('insert into orders(id,vendor_profile_id,university_id,status,subtotal_kobo,delivery_fee_kobo,total_kobo,earnings_state) values($1,$2,$3,$4,10000,0,10000,\'PENDING\')',[orderId(i),vendor,uni,state]);
  await db.query('insert into orders(id,vendor_profile_id,university_id,status,subtotal_kobo,total_kobo) values($1,$2,$3,\'PAID\',10000,10000)',[orderId(99),vendor,otherUni]);
});
beforeEach(()=>{stubs.execute.mockReset().mockImplementation((statement:SQL)=>{const q=dialect.sqlToQuery(statement);return db.query(q.sql,q.params);});});
afterAll(async()=>{await db.close();});
describe('paid agent order visibility at the API boundary',()=>{
  it('lists only successfully paid orders from the agent campus',async()=>{
    const response=await app.request('/v1/agents/orders',{},env);expect(response.status).toBe(200);
    const data=await response.json() as {orders:{status:string}[]};
    expect(data.orders.map(order=>order.status).sort()).toEqual(['ACCEPTED','DELIVERED','IN_DELIVERY','PAID','READY']);
  });
  it.each(states.slice(5))('denies a direct detail request for %s before reading buyer details',async state=>{
    const response=await app.request('/v1/agents/orders/'+orderId(states.indexOf(state)),{},env);
    expect(response.status).toBe(404);expect(stubs.execute).toHaveBeenCalledOnce();
  });
  it('keeps a paid order accessible and blocks the other campus',async()=>{
    const response=await app.request('/v1/agents/orders/'+orderId(0),{},env);expect(response.status).toBe(200);expect((await response.json() as {order:{status:string}}).order.status).toBe('PAID');
    expect((await app.request('/v1/agents/orders/'+orderId(99),{},env)).status).toBe(404);
  });
  it('excludes unsuccessful orders from dashboard counts and recent activity',async()=>{
    const response=await app.request('/v1/agents/dashboard',{},env);expect(response.status).toBe(200);
    const data=await response.json() as {metrics:{store:{orders:number;delivered:number;pending_earnings_kobo:number}},activity:{orders:unknown[]}};
    expect(data.metrics.store.orders).toBe(5);expect(data.metrics.store.delivered).toBe(1);expect(Number(data.metrics.store.pending_earnings_kobo)).toBe(50000);expect(data.activity.orders).toHaveLength(5);
  });
});
