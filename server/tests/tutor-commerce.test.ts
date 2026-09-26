import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {Hono} from 'hono';
import type {PGlite} from '@electric-sql/pglite';
import {createTestDatabase,testDatabaseAdapter,testSqlClient} from './helpers/database';
import {learningCommerceRoutes} from '../src/routes/learning-commerce';
import {messageRoutes} from '../src/routes/messages';
import {mediaRoutes} from '../src/routes/media';
import {paymentRoutes} from '../src/routes/payments';
import {AppError} from '../src/lib/errors';
import type {Bindings,Variables} from '../src/types';
let db:PGlite;
vi.mock('../src/lib/database',()=>({database:()=>testDatabaseAdapter(db),sqlClient:()=>testSqlClient(db),firstRow:(r:{rows:unknown[]})=>r.rows[0]}));
vi.mock('../src/middleware/auth',()=>({requireAuth:async(c:any,next:()=>Promise<void>)=>{c.set('user',{id:c.req.header('X-Test-User'),email:'test@test.invalid',universityId:campus,roles:['STUDENT']});await next();},currentUser:(c:any)=>c.get('user')}));
vi.mock('../src/lib/paystack',()=>({initializePaystack:vi.fn(async()=>({authorization_url:'https://checkout.paystack.com/synthetic',access_code:'synthetic'})),validPaystackSignature:vi.fn(async()=>true)}));
const campus=crypto.randomUUID(),student=crypto.randomUUID(),tutor=crypto.randomUUID(),stranger=crypto.randomUUID(),profile=crypto.randomUUID(),listing=crypto.randomUUID(),resource=crypto.randomUUID(),media=crypto.randomUUID();
const env={TUTORIALS_ENABLED:'true',PAYMENTS_ENABLED:'true',UNIFIED_SCHEMA_READY:'true',PHASE_2_SCHEMA_READY:'true',JWT_SECRET:'synthetic-test-key-with-at-least-32-characters'} as Bindings;
const app=new Hono<{Bindings:Bindings;Variables:Variables}>();app.route('/learning',learningCommerceRoutes);app.route('/messages',messageRoutes);app.route('/media',mediaRoutes);app.route('/payments',paymentRoutes);app.onError((e,c)=>c.json({error:e.message},e instanceof AppError?e.status:500));
async function request(path:string,method='GET',body?:unknown,user=student){await db.exec('savepoint api_request');const response=await app.request('https://test.invalid'+path,{method,headers:{'X-Test-User':user,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},env);if(response.status>=400)await db.exec('rollback to savepoint api_request');await db.exec('release savepoint api_request');return response;}
async function json(r:Response,status=200){const data:any=await r.json();expect({status:r.status,...(r.status===status?{}:{data})}).toEqual({status});return data;}
async function buy(target:{resourceId?:string;listingId?:string},key=crypto.randomUUID()){
  const {quote}=await json(await request('/learning/quote','POST',target));
  return (await json(await request('/learning/purchases','POST',{id:key,target,quote}),201)).purchase;
}
async function pay(p:any,currency='NGN',amount=p.amount_kobo){
  const checkout=await json(await request('/payments/initialize','POST',{resourceType:'TUTORIAL_PURCHASE',resourceId:p.id,idempotencyKey:'test-'+p.id}));
  const event={event:'charge.success',data:{status:'success',reference:checkout.reference,amount,currency}};
  return {result:await json(await request('/payments/paystack/webhook','POST',event)),event,checkout};
}
beforeAll(async()=>{
  db=await createTestDatabase();
  await db.query("insert into public.universities(id,name,slug,updated_at) values($1,'Synthetic campus','tutor-test',now())",[campus]);
  for(const uid of [student,tutor,stranger]){
    await db.query("insert into public.users(id,email,password_hash,updated_at) values($1,$2,'test',now())",[uid,uid+'@test.invalid']);
    await db.query("insert into public.profiles(id,user_id,university_id,display_name,username,updated_at) values(gen_random_uuid(),$1,$2,'Test person',$3,now())",[uid,campus,uid.replaceAll('-','').slice(0,28)]);
  }
  const application=crypto.randomUUID();
  await db.query("insert into public.agent_applications(id,university_id,user_id,agent_type,display_name,phone_e164,statement,status) values($1,$2,$3,'TUTOR','Test tutor','+2348000000000','Synthetic tutor application','APPROVED')",[application,campus,tutor]);
  await db.query("insert into public.agent_profiles(id,university_id,user_id,application_id,agent_type,display_name,verified_at) values($1,$2,$3,$4,'TUTOR','Test tutor',now())",[profile,campus,tutor,application]);
  await db.query("insert into public.tutorial_listings(id,university_id,tutor_profile_id,course_code,title,description,format,price_kobo,capacity,status,review_status,package_days) values($1,$2,$3,'MTH101','Monthly mathematics','A full month of mathematics help.','ONLINE',30000,20,'PUBLISHED','APPROVED',30)",[listing,campus,profile]);
  await db.query("insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name) values($1,$2,$3,'resource','synthetic.pdf','application/pdf',100,'notes.pdf')",[media,tutor,campus]);
  await db.query("insert into public.tutorial_resources(id,university_id,tutor_profile_id,course_code,title,description,resource_type,access_model,price_kobo,publisher_name,status,media_object_id) values($1,$2,$3,'MTH101','Mathematics notes','A useful set of mathematics notes.','PDF','PAID',30000,'Test tutor','PUBLISHED',$4)",[resource,campus,profile,media]);
  for(const [kind,bps,flat] of [['TUTOR_COMMISSION',1000,0],['BUYER_SERVICE',0,2000]] as const)
    await db.query("insert into public.fee_rules(institution_id,fee_type,version,effective_at,flat_kobo,basis_points,created_by,reason) values($1,$2,'test-v1',now()-interval '1 hour',$3,$4,$5,'Synthetic testing only')",[campus,kind,flat,bps,tutor]);
},60000);
beforeEach(async()=>{await db.exec('begin');});
afterEach(async()=>{await db.exec('rollback');});
afterAll(async()=>{await db?.close();});
import {afterEach} from 'vitest';
describe('paid tutor materials, packages and session access',()=>{
  it('uses the same fee snapshot for scheduled bookings and their ledger settlement',async()=>{
    const window=crypto.randomUUID(),booking=crypto.randomUUID();
    await db.query("insert into public.tutorial_availability_windows(id,listing_id,starts_at,ends_at,capacity) values($1,$2,now()+interval '1 hour',now()+interval '2 hours',20)",[window,listing]);
    const created=await db.query<{amount_kobo:number}>('select * from app_private.create_tutorial_booking($1,$2,$3,$4,$5)',[booking,campus,listing,window,student]);
    expect(created.rows[0]!.amount_kobo).toBe(32000);
    const summary=await json(await request('/payments/summary/TUTORIAL_BOOKING/'+booking));expect(summary.purchase.buyer_fee_kobo).toBe(2000);
    const checkout=await json(await request('/payments/initialize','POST',{resourceType:'TUTORIAL_BOOKING',resourceId:booking,idempotencyKey:'scheduled-test'}));
    expect((await json(await request('/payments/paystack/webhook','POST',{event:'charge.success',data:{reference:checkout.reference,status:'success',amount:32000,currency:'NGN'}}))).status).toBe('processed');
    expect((await db.query("select amount_kobo from public.ledger_lines l join public.ledger_accounts a on a.id=l.account_id where a.account_code='TUTOR_PAYABLE'")).rows).toEqual([{amount_kobo:27000}]);
  });
  it('prices an actual store order, balances checkout and records rider net only on delivery',async()=>{
    const vendor=crypto.randomUUID(),rider=crypto.randomUUID(),zone=crypto.randomUUID(),product=crypto.randomUUID(),category=crypto.randomUUID(),order=crypto.randomUUID();
    for(const [type,pid,uid] of [['VENDOR',vendor,stranger],['RIDER',rider,tutor]]){
      const application=crypto.randomUUID();
      await db.query("insert into public.agent_applications(id,university_id,user_id,agent_type,display_name,phone_e164,statement,status) values($1,$2,$3,$4,'Synthetic agent','+2348000000000','Synthetic finance test','APPROVED')",[application,campus,uid,type]);
      await db.query("insert into public.agent_profiles(id,university_id,user_id,application_id,agent_type,display_name,verified_at) values($1,$2,$3,$4,$5,'Synthetic agent',now())",[pid,campus,uid,application,type]);
    }
    await db.query("insert into public.vendor_storefronts(vendor_profile_id,university_id,display_name,description,contact_phone_e164,pickup_location,status,listing_revision,moderated_revision,reviewed_by_user_id,reviewed_at,submitted_at,opening_hours) values($1,$2,'Test shop','Synthetic store for finance testing','+2348000000000','Test campus main gate','APPROVED',1,1,$3,now(),now(),'{}'::jsonb||jsonb_build_object('summary','Weekdays'))",[vendor,campus,tutor]);
    await db.query("insert into public.product_categories(id,university_id,name,status) values($1,$2,'Test books','APPROVED')",[category,campus]);
    await db.query("insert into public.vendor_products(id,university_id,vendor_profile_id,name,description,category,category_id,price_kobo,stock_quantity,status,moderated_revision,reviewed_by_user_id,reviewed_at,submitted_at,package_weight_grams,package_length_cm,package_width_cm,package_height_cm,bicycle_delivery_eligible) values($1,$2,$3,'Test textbook','A synthetic finance test textbook','Test books',$4,150000,4,'PUBLISHED',1,$5,now(),now(),350,24,18,3,true)",[product,campus,vendor,category,tutor]);
    await db.query("insert into public.delivery_zones(id,university_id,name,base_fee_kobo) values($1,$2,'Test zone',99999)",[zone,campus]);
    for(const [kind,flat,bps] of [['DELIVERY',5000,0],['RIDER_COMMISSION',0,1000]])await db.query("insert into public.fee_rules(institution_id,fee_type,version,effective_at,flat_kobo,basis_points,created_by,reason) values($1,$2,'store-test',now(),$3,$4,$5,'Synthetic store fee test')",[campus,kind,flat,bps,tutor]);
    const created=await db.query<{total_kobo:number}>("select * from app_private.create_store_order_v3($1,$2,$3,$4,$5,'Test recipient','+2348000000000','Test hostel',null,null,null,null,$6::jsonb,'pickup-hash','delivery-hash')",[order,campus,student,vendor,zone,JSON.stringify([{product_id:product,quantity:1}])]);
    expect(created.rows[0]!.total_kobo).toBe(157000);
    const job=(await db.query<{id:string;rider_earning_kobo:number;commission_kobo:number}>('select id,rider_earning_kobo,commission_kobo from public.delivery_jobs where order_id=$1',[order])).rows[0]!;
    expect(job.rider_earning_kobo).toBe(4500);expect(job.commission_kobo).toBe(500);
    const reference='store-'+crypto.randomUUID();await db.query("insert into public.payment_attempts(user_id,university_id,resource_type,resource_id,provider_reference,amount_kobo,idempotency_key,status) values($1,$2,'STORE_ORDER',$3,$4,157000,$4,'INITIALIZED')",[student,campus,order,reference]);
    await db.query("select app_private.settle_commerce_payment($1,157000,'NGN')",[reference]);
    await db.query("update public.delivery_jobs set rider_profile_id=$2,status='DELIVERED',delivered_at=now() where id=$1",[job.id,rider]);
    await db.query("update public.delivery_jobs set status='DELIVERED' where id=$1",[job.id]);
    expect((await db.query("select * from public.ledger_transactions where reference_type='DELIVERY_EARNING'")).rows).toHaveLength(1);
    expect((await db.query("select transaction_id from public.ledger_lines group by transaction_id having sum(case when direction='DEBIT' then amount_kobo else -amount_kobo end)<>0")).rows).toHaveLength(0);
    const pickup=crypto.randomUUID();await db.query("insert into public.campus_places(id,university_id,name,category,latitude,longitude,status) values($1,$2,'Campus gate','TRANSPORT',6.4,5.6,'PUBLISHED')",[pickup,campus]);
    await db.query('update public.vendor_storefronts set pickup_place_id=$2 where vendor_profile_id=$1',[vendor,pickup]);
    await db.query("update public.vendor_storefronts set status='APPROVED',moderated_revision=listing_revision,reviewed_at=now(),reviewed_by_user_id=$2 where vendor_profile_id=$1",[vendor,tutor]);
    await db.query("insert into public.fee_rules(institution_id,fee_type,version,effective_at,flat_kobo,basis_points,created_by,reason,bands) values($1,'DELIVERY','map-test',now()+interval '1 millisecond',8000,0,$2,'Synthetic map distance','[]')",[campus,tutor]);
    // The future policy is not active yet. The current version still prices the map estimate.
    const mappedOrder=crypto.randomUUID();await db.query("select * from app_private.create_store_order_v3($1,$2,$3,$4,$5,'Test recipient','+2348000000000','Test hostel',null,6.401,5.6,null,$6::jsonb,'pickup-hash','delivery-hash')",[mappedOrder,campus,student,vendor,zone,JSON.stringify([{product_id:product,quantity:1}])]);
    const mapped=(await db.query<{fee_snapshot:{delivery:{distanceMetres:number;distanceBasis:string}}}>('select fee_snapshot from public.orders where id=$1',[mappedOrder])).rows[0]!.fee_snapshot.delivery;
    expect(mapped.distanceMetres).toBeGreaterThan(100);expect(mapped.distanceMetres).toBeLessThan(120);expect(mapped.distanceBasis).toBe('CAMPUS_MAP_ESTIMATE');
  });
  it('enforces package capacity and expires unpaid reservations during maintenance',async()=>{
    await db.query('update public.tutorial_listings set capacity=1 where id=$1',[listing]);
    const p=await buy({listingId:listing});
    const target={listingId:listing};const {quote}=await json(await request('/learning/quote','POST',target,stranger));
    await json(await request('/learning/purchases','POST',{id:crypto.randomUUID(),target,quote},stranger),409);
    await db.query("update public.tutorial_purchases set payment_expires_at=now()-interval '1 minute' where id=$1",[p.id]);
    await db.query('select app_private.maintain_tutor_commerce()');
    expect((await db.query('select status from public.tutorial_purchases where id=$1',[p.id])).rows[0]).toEqual({status:'EXPIRED'});
    await json(await request('/learning/purchases','POST',{id:crypto.randomUUID(),target,quote},stranger),201);
  });
  it('quotes integer fees and requires confirmed payment before private access',async()=>{
    const p=await buy({resourceId:resource});expect(p.amount_kobo).toBe(32000);expect(p.commission_kobo).toBe(3000);expect(p.tutor_net_kobo).toBe(27000);
    await json(await request('/media/'+media+'/access','POST'),403);
    expect((await pay(p)).result.status).toBe('processed');
    expect((await json(await request('/media/'+media+'/access','POST'))).expiresIn).toBe(90);
    await json(await request('/media/'+media+'/access','POST',undefined,stranger),403);
    const totals=await db.query<{debit:number;credit:number}>('select sum(amount_kobo) filter(where direction=\'DEBIT\')::integer debit,sum(amount_kobo) filter(where direction=\'CREDIT\')::integer credit from public.ledger_lines');
    expect(totals.rows[0]).toEqual({debit:32000,credit:32000});
  });
  it('deduplicates checkout and webhook retries without duplicate entitlement or money',async()=>{
    const p=await buy({resourceId:resource});expect((await buy({resourceId:resource})).id).toBe(p.id);
    const {event,checkout}=await pay(p);
    expect((await json(await request('/payments/paystack/webhook','POST',event))).status).toBe('already_processed');
    expect((await db.query('select * from public.ledger_transactions where idempotency_key=$1',['paystack:'+checkout.reference])).rows).toHaveLength(1);
    expect((await buy({resourceId:resource})).id).toBe(p.id);
  });
  it('rejects changed quotes and owner/tenant bypasses',async()=>{
    const {quote}=await json(await request('/learning/quote','POST',{resourceId:resource}));
    await json(await request('/learning/purchases','POST',{id:crypto.randomUUID(),target:{resourceId:resource},quote:{...quote,amountKobo:1}}),409);
    const p=await buy({resourceId:resource});
    await json(await request('/payments/initialize','POST',{resourceType:'TUTORIAL_PURCHASE',resourceId:p.id,idempotencyKey:'unauthorized'},stranger),404);
    await json(await request('/learning/quote','POST',{resourceId:resource},tutor),404);
  });
  it.each([['USD',32000],['NGN',1]])('holds mismatched %s payment for review',async(currency,amount)=>{
    const p=await buy({resourceId:resource});expect((await pay(p,currency,amount)).result.status).toBe('requires_review');
    await json(await request('/media/'+media+'/access','POST'),403);expect((await db.query('select * from public.ledger_transactions')).rows).toHaveLength(0);
  });
  it('holds late payments without granting access',async()=>{
    const p=await buy({resourceId:resource});const init=await json(await request('/payments/initialize','POST',{resourceType:'TUTORIAL_PURCHASE',resourceId:p.id,idempotencyKey:'late-payment'}));
    await db.query("update public.tutorial_purchases set payment_expires_at=now()-interval '1 second' where id=$1",[p.id]);
    expect((await json(await request('/payments/paystack/webhook','POST',{event:'charge.success',data:{reference:init.reference,status:'success',amount:32000,currency:'NGN'}}))).status).toBe('requires_review');
    await json(await request('/media/'+media+'/access','POST'),403);
  });
  it('activates a package, allows two-way chat and media, then denies expired access',async()=>{
    const p=await buy({listingId:listing});await pay(p);
    const t=(await json(await request('/learning/threads','POST',{studentId:student,tutorId:tutor}))).thread.id;
    await json(await request('/messages/threads/'+t+'/messages','POST',{id:crypto.randomUUID(),body:'Hello tutor'}),201);
    const attachment=crypto.randomUUID();await db.query("insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name) values($1,$2,$3,'message','voice.m4a','audio/mp4',100,'voice.m4a')",[attachment,tutor,campus]);
    await json(await request('/messages/threads/'+t+'/messages','POST',{id:crypto.randomUUID(),body:'Welcome',mediaId:attachment},tutor),201);
    await json(await request('/media/'+attachment+'/access','POST'));
    await json(await request('/messages/threads/'+t,'GET',undefined,stranger),404);
    await db.query("update public.tutorial_purchases set access_starts_at=now()-interval '31 days',access_ends_at=now()-interval '1 day' where id=$1",[p.id]);
    await json(await request('/messages/threads/'+t+'/messages','POST',{id:crypto.randomUUID(),body:'Expired'}),403);
    await json(await request('/media/'+attachment+'/access','POST'),403);
    expect((await json(await request('/messages/threads/'+t))).messages).toHaveLength(2);
    await expect(db.query("insert into public.direct_messages(id,thread_id,sender_id,body) values(gen_random_uuid(),$1,$2,'Bypass')",[t,student])).rejects.toThrow('TUTOR_ACCESS_EXPIRED');
  });
  it('stacks renewals after the current paid period',async()=>{
    const p=await buy({listingId:listing});await pay(p);
    const first=(await json(await request('/learning/purchases'))).purchases[0];
    const renewal=await buy({listingId:listing});await pay(renewal);
    const next=(await json(await request('/learning/purchases'))).purchases.find((x:any)=>x.id===renewal.id);
    expect(next.access_starts_at).toBe(first.access_ends_at);expect(next.access_status).toBe('UPCOMING');
  });
  it('revokes disputed digital access and reserves the earning',async()=>{
    const p=await buy({resourceId:resource});await pay(p);
    await json(await request('/learning/purchases/'+p.id+'/dispute','POST',{reason:'The file does not contain the advertised notes.'}));
    await json(await request('/media/'+media+'/access','POST'),403);
    expect((await db.query('select earnings_state from public.tutorial_purchases where id=$1',[p.id])).rows[0]).toEqual({earnings_state:'RESERVED'});
  });
  it('preserves fee versions, exact percentage rounding and configured distance fallback',async()=>{
    await db.query("insert into public.fee_rules(institution_id,fee_type,version,effective_at,flat_kobo,basis_points,created_by,reason,bands) values($1,'DELIVERY','delivery-v1',now(),2000,0,$2,'Synthetic distance test','[{\"fromMetres\":0,\"toMetres\":1000,\"feeKobo\":1000},{\"fromMetres\":1000,\"toMetres\":null,\"feeKobo\":3000}]')",[campus,tutor]);
    const quote=async(kind:string,basis:number,distance:number|null)=>((await db.query<{q:any}>('select app_private.quote_fee($1,$2,$3,null,$4) q',[campus,kind,basis,distance])).rows[0]!.q);
    expect((await quote('TUTOR_COMMISSION',30000,null)).feeKobo).toBe(3000);
    expect((await quote('DELIVERY',0,null)).feeKobo).toBe(2000);expect((await quote('DELIVERY',0,999)).feeKobo).toBe(1000);expect((await quote('DELIVERY',0,1000)).feeKobo).toBe(3000);
    await expect(db.query("update public.fee_rules set flat_kobo=5 where fee_type='DELIVERY'")).rejects.toThrow('FEE_RULE_IMMUTABLE');
  });
  it('reserves withdrawal gross atomically, quotes bank net, deduplicates and reverses rejection',async()=>{
    await db.query("update public.tutorial_listings set price_kobo=1000000 where id=$1",[listing]);
    const p=await buy({listingId:listing});await pay(p);
    await db.query("update public.tutorial_purchases set earnings_state='AVAILABLE' where id=$1",[p.id]);
    await db.query("update public.agent_applications set bank_status='VERIFIED' where user_id=$1",[tutor]);
    const rule=crypto.randomUUID(),requestId=crypto.randomUUID();
    await db.query("insert into public.fee_rules(id,institution_id,fee_type,version,effective_at,flat_kobo,basis_points,created_by,reason) values($1,$2,'WITHDRAWAL','withdraw-test',now(),2000,0,$3,'Synthetic withdrawal fee')",[rule,campus,tutor]);
    await db.query('select * from app_private.request_agent_payout_v2($1,$2,$3,500000,$4)',[requestId,profile,tutor,rule]);
    await db.query('select * from app_private.request_agent_payout_v2($1,$2,$3,500000,$4)',[requestId,profile,tutor,rule]);
    const payout=(await db.query('select amount_kobo,fee_kobo,net_kobo from public.payout_requests where id=$1',[requestId])).rows[0];
    expect(payout).toEqual({amount_kobo:500000,fee_kobo:2000,net_kobo:498000});
    expect((await db.query("select * from public.ledger_transactions where reference_type='PAYOUT_RESERVE'")).rows).toHaveLength(1);
    await db.query("update public.payout_requests set status='REJECTED' where id=$1",[requestId]);
    const balance=await db.query<{net:number}>("select sum(case when direction='CREDIT' then amount_kobo else -amount_kobo end)::integer net from public.ledger_lines l join public.ledger_accounts a on a.id=l.account_id where a.account_code='PAYOUT_RESERVED'");expect(balance.rows[0]!.net).toBe(0);
    await db.query('select * from app_private.request_agent_payout_v2($1,$2,$3,500000,$4)',[crypto.randomUUID(),profile,tutor,rule]);
    await expect(db.query('select * from app_private.request_agent_payout_v2($1,$2,$3,500000,$4)',[crypto.randomUUID(),profile,tutor,rule])).rejects.toThrow('PAYOUT_BALANCE_INSUFFICIENT');
  });
  it('keeps accepted fees after later policy versions and forbids price rewrites',async()=>{
    const p=await buy({resourceId:resource});
    await db.query("insert into public.fee_rules(institution_id,fee_type,version,effective_at,flat_kobo,basis_points,created_by,reason) values($1,'BUYER_SERVICE','test-v2',now(),9000,0,$2,'Synthetic new price version')",[campus,tutor]);
    await pay(p);
    const accepted=(await db.query<{buyer_fee_kobo:number}>('select buyer_fee_kobo from public.tutorial_purchases where id=$1',[p.id])).rows[0];expect(accepted!.buyer_fee_kobo).toBe(2000);
    await expect(db.query('update public.tutorial_purchases set buyer_fee_kobo=1 where id=$1',[p.id])).rejects.toThrow('PURCHASE_PRICE_IMMUTABLE');
  });
});
