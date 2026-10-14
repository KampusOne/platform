import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono, type Context, type Next } from 'hono';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, testDatabaseAdapter, testSqlClient } from './helpers/database';
import { quoteKira, initializeKira, reconcileKira } from '../src/lib/kira-billing';
import { paymentRoutes } from '../src/routes/payments';
import { AppError } from '../src/lib/errors';
import { financeReport } from '../src/lib/admin-reporting';
import { reconcilePricedStore } from '../src/lib/commerce-pricing';
import { collectionReference } from '../src/lib/collection-provider';
import type { AuthenticatedUser, Bindings } from '../src/types';
let pg:PGlite;
vi.mock('../src/lib/database',()=>({database:()=>testDatabaseAdapter(pg),sqlClient:()=>testSqlClient(pg),firstRow:(r:{rows:unknown[]})=>r.rows[0]}));
vi.mock('../src/middleware/auth',()=>({currentUser:(c:Context)=>({id:c.req.header('x-user'),universityId:c.req.header('x-campus'),email:'synthetic@example.invalid',roles:['STUDENT']}),requireAuth:async(c:Context,n:Next)=>c.req.header('x-user')?n():c.json({error:'Unauthorized'},401)}));
const campus=crypto.randomUUID(),other=crypto.randomUUID(),admin=crypto.randomUUID(),buyer=crypto.randomUUID();
const legacyReference='K1-RC-HISTORICAL-'+crypto.randomUUID();
const env={ENVIRONMENT:'local',PHASE_3_SCHEMA_READY:'true',UNIFIED_SCHEMA_READY:'true',KIRA_SUBSCRIPTIONS_ENABLED:'true',PAYMENTS_ENABLED:'true',AI_ASSISTANT_ENABLED:'true',AI:{run:vi.fn()},BACHS_PRICED_CHECKOUT_ENABLED:'true',BACHS_API_KEY:'sk_sandbox_synthetic',BACHS_WEBHOOK_SECRET:'synthetic-webhook-secret',PAYSTACK_SECRET_KEY:'sk_test_synthetic'} as Bindings;
const user={id:buyer,universityId:campus,email:'synthetic@example.invalid',roles:['STUDENT']} as AuthenticatedUser;
const app=new Hono().route('/payments',paymentRoutes);app.onError((e,c)=>c.json({error:e.message},e instanceof AppError?e.status:500));
const sql=(f:string)=>readFileSync(new URL('../../database/neon/migrations/'+f,import.meta.url),'utf8');
beforeAll(async()=>{
 pg=await createTestDatabase();
 for(const f of ['20260912200000_phase_3_commerce_foundation.sql','20260930220000_store_fulfilment_modes.sql','20260930240000_rider_commission_ledger.sql','20260930250000_inclusive_store_quotes.sql','20260930260000_inclusive_tutorial_bookings.sql','20260930270000_verified_kira_subscription.sql','20260930280000_verified_learning_materials.sql','20260930290000_verified_agent_payouts.sql','20261001020000_admin_workspace_extensions.sql','20261001182000_discount_codes_and_newsletter_access.sql','20261003120000_configurable_kira_pricing.sql'])await pg.exec(sql(f));
 for(const id of [campus,other])await pg.query("insert into universities(id,name,slug,updated_at)values($1,'Synthetic '||$1::uuid::text,$1::uuid::text,now())",[id]);
 for(const id of [admin,buyer])await pg.query("insert into users(id,email,password_hash,updated_at)values($1,$1::uuid::text||'@example.invalid','synthetic',now())",[id]);
 for(const id of [admin,buyer])await pg.query("insert into profiles(id,user_id,university_id,username,display_name,updated_at)values($1,$1,$2,'fixture_'||substring(replace($1::uuid::text,'-',''),1,20),'Synthetic',now())",[id,campus]);
 await pg.query("insert into app_private.kira_price_plans(id,university_id,version,amount_kobo,listed_amount_kobo,discount_percent,collection,estimated_processing_kobo,approved_by,approval_note,source_url)values($1,$2,'LEGACY_PRO',600000,600000,0,$3,19000,$4,'Synthetic historical approval','https://paystack.com/pricing')",[crypto.randomUUID(),campus,JSON.stringify({basisPoints:150,flatKobo:10000,flatWaivedBelowKobo:250000,capKobo:200000}),admin]);
 await pg.exec('insert into app_private.active_kira_price_plans(university_id,plan_id)select university_id,id from app_private.kira_price_plans');
 for(const f of ['20261003122000_kira_plan_catalogue.sql','20261003123000_payment_pricing_profiles.sql','20261003124000_payout_fee_components.sql','20261003125000_verified_refund_accounting.sql','20261006110000_customer_paid_provider_fees.sql','20261009100000_bachs_pricing_psychology.sql','20261009100000_payment_idempotency_inbox.sql','20261013190000_agent_withdrawal_commission.sql','20261013200000_delivery_checkout_recovery.sql','20261013205000_bachs_bank_details.sql','20261013210000_bachs_agent_banks_and_payouts.sql'])await pg.exec(sql(f));
 await pg.query("insert into app_private.payment_fee_profiles(university_id,version,transaction_class,collection,effective_from,status,source_url,approval_note,approved_by) values($1,'TEST_LOCAL','LOCAL_COLLECTION',$2,now(),'APPROVED','https://paystack.com/pricing','Synthetic approval for provider coexistence test',$3)",[campus,JSON.stringify({basisPoints:150,flatKobo:10000,flatWaivedBelowKobo:250000,capKobo:200000}),admin]);
 await pg.query("select app_private.record_verified_paystack_receipt($1,$2,'RIDER_COMMISSION',$3,10000,0,now())",[other,legacyReference,crypto.randomUUID()]);
 await pg.query("insert into app_private.kira_price_plans(id,university_id,tier,plan_name,version,amount_kobo,listed_amount_kobo,discount_percent,collection,estimated_processing_kobo,approved_by,approval_note,source_url,model_access,available,active_status) select gen_random_uuid(),university_id,'pro','Kira Pro','ACTIVE_TEST',600000,600000,0,collection,19000,approved_by,'Synthetic active provider test','https://paystack.com/pricing','pro',true,true from app_private.kira_price_plans where version='LEGACY_PRO'");
 await pg.exec("update app_private.active_kira_price_plans set plan_id=(select id from app_private.kira_price_plans where version='ACTIVE_TEST') where tier='pro'");
 await pg.exec(sql('20261010140000_bachs_collection_cutover.sql'));
 await pg.exec(sql('20261014160000_verified_store_payment_recovery.sql'));

},60000);
afterAll(async()=>{await pg?.close();});afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
let reference='',checkoutId='chk_synthetic_cutover',checkout:{amount:string;currency:string;reference:string;status:string;charge?:{payment_id:string}};
const provider=()=>vi.fn(async(url:string,options?:RequestInit)=>{
 if(url.endsWith('/accounts/checkout/settings'))return Response.json({fee_preference:'org_pays',enabled_payment_methods:{NGN_BANK_TRANSFER:{enabled:true}}});
 if(url.endsWith('/checkout-sessions')&&options?.method==='POST'){
  const body=JSON.parse(String(options.body));reference=body.reference;
  expect(body.pricing).toEqual({currency:'NGN',amount:'6000.00'});expect(body.payment_method_types).toEqual(['NGN_BANK_TRANSFER']);
  expect(new Headers(options.headers).get('Idempotency-Key')).toBe(reference);
  checkout={reference,status:'open',amount:'6000.00',currency:'NGN'};
  return Response.json({checkout_id:checkoutId,checkout_url:'https://sandbox-checkout.bachs.io/c/synthetic',reference,status:'open',expires_at:new Date(Date.now()+(body.expires_in_minutes-1)*60000).toISOString()});
 }
 if(url.endsWith('/checkout-sessions/'+checkoutId))return Response.json({checkout_id:checkoutId,...checkout});
 if(url.endsWith('/payments/ch_synthetic_payment'))return Response.json({payment_id:'ch_synthetic_payment',checkout_id:checkoutId,reference,status:'succeeded',amount:'6000.00',amount_paid:'6000.00',currency:'NGN',merchant_bears_cost:true,payment_method:'NGN_BANK_TRANSFER',fees:{amount:'90.00',currency:'NGN'},completed_at:new Date().toISOString()});
 throw Error('Unexpected provider URL '+url);
});

async function delivery(id:string,type='checkout.completed'){
 const raw=JSON.stringify({id,type,data:{checkout_id:checkoutId,reference}}),timestamp=String(Math.floor(Date.now()/1000));
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.BACHS_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+raw));
 const signature=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
 return app.request('/payments/bachs/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Bachs-Signature-V2':`t=${timestamp},v1=${'0'.repeat(64)},v1=${signature}`},body:raw},env);
}
describe('BACHS checkout and verified entitlement cutover',()=>{
 it('opens an owned fixed-price checkout and refuses to infer payment from its return link',async()=>{
  const fetcher=provider();vi.stubGlobal('fetch',fetcher);
  const quote=await quoteKira(env,user,'pro');expect(quote.amountKobo).toBe(600000);
  const initialized=await initializeKira(env,user,crypto.randomUUID(),undefined,'',quote.amountKobo,quote.quoteId,'pro');
  expect(initialized.reference).toMatch(/^K1-B-AI-/);expect(initialized.authorizationUrl).toContain('sandbox-checkout.bachs.io');
  await reconcileKira(env,reference,buyer);
  expect((await pg.query('select * from app_private.kira_billing_periods')).rows).toHaveLength(0);
  expect((await pg.query('select * from public.ledger_transactions where university_id=$1',[campus])).rows).toHaveLength(0);
  expect(await reconcileKira(env,reference,admin)).toBe(false);
 });
 it('re-fetches provider evidence, rejects a changed amount, and credits a signed success exactly once across both event types',async()=>{
  vi.stubGlobal('fetch',provider());checkout={...checkout,status:'completed',charge:{payment_id:'ch_synthetic_payment'},amount:'5999.99'};
  expect((await delivery('evt_synthetic_bad_amount')).status).toBe(503);
  expect((await pg.query('select * from app_private.kira_billing_periods')).rows).toHaveLength(0);
  checkout.amount='6000.00';
  const accepted=await delivery('evt_synthetic_checkout');expect({status:accepted.status,body:await accepted.json()}).toEqual({status:200,body:{status:'reconciled'}});
  expect((await delivery('evt_synthetic_checkout')).status).toBe(200);
  expect((await delivery('evt_synthetic_collection','collection.succeeded')).status).toBe(200);
  expect((await pg.query('select * from app_private.kira_billing_periods')).rows).toHaveLength(1);
  expect((await pg.query('select * from app_private.verified_bachs_receipts')).rows).toHaveLength(1);
  expect((await pg.query('select * from app_private.verified_paystack_receipts where university_id=$1',[campus])).rows).toHaveLength(0);
  expect((await pg.query('select provider from app_private.verified_collection_receipts where provider_reference=$1',[reference])).rows).toEqual([{provider:'BACHS'}]);
  const balance=(code:string)=>pg.query<{balance:number}>('select app_private.finance_balance($1,null,$2) as balance',[campus,code]).then(r=>Number(r.rows[0]!.balance));
  expect(await balance('BACHS_CLEARING')).toBe(591000);expect(await balance('PAYSTACK_CLEARING')).toBe(0);
  expect(await balance('PAYMENT_SUSPENSE')).toBe(0);expect(await balance('KIRA_SUBSCRIPTION_REVENUE')).toBe(600000);
  expect((await pg.query('select * from public.ledger_transactions where university_id=$1',[campus])).rows).toHaveLength(3);
 });
 it('rejects unsigned deliveries before touching receipt state and prevents provider identity forgery',async()=>{
  expect((await app.request('/payments/bachs/webhook',{method:'POST',body:'{}'},env)).status).toBe(401);
  await expect(pg.query('select app_private.record_verified_bachs_receipt($1,$2,$3,$4,$5,$6,now())',[other,reference,'KIRA_SUBSCRIPTION',crypto.randomUUID(),600000,9000])).rejects.toThrow('BACHS_VERIFIED_RECEIPT_REQUIRED');
  await expect(pg.query("update app_private.verified_collection_receipts set provider='PAYSTACK' where provider_reference=$1",[reference])).rejects.toThrow('append-only');
 });
 it('backfills historical Paystack evidence and registers subsequent legacy payments without changing their provider',async()=>{
  expect((await pg.query('select provider,paystack_reference,bachs_reference from app_private.verified_collection_receipts where provider_reference=$1',[legacyReference])).rows).toEqual([{provider:'PAYSTACK',paystack_reference:legacyReference,bachs_reference:null}]);
  const ref='K1-RC-NEW-LEGACY-'+crypto.randomUUID();
  await pg.query("select app_private.record_verified_paystack_receipt($1,$2,'RIDER_COMMISSION',$3,10000,0,now())",[other,ref,crypto.randomUUID()]);
  expect((await pg.query('select provider from app_private.verified_collection_receipts where provider_reference=$1',[ref])).rows).toEqual([{provider:'PAYSTACK'}]);
  expect((await pg.query('select amount_kobo from app_private.verified_paystack_receipts where provider_reference=$1',[legacyReference])).rows).toEqual([{amount_kobo:10000}]);
  const fake='K1-B-AI-FORGED-'+crypto.randomUUID();
  await expect(pg.query("insert into app_private.verified_collection_receipts(provider_reference,provider,bachs_reference) values($1,'BACHS',$1)",[fake])).rejects.toThrow('foreign key');
 });
});

describe('store BACHS checkout and delayed verified receipt recovery',()=>{
 const storeCampus=other;
 const vendorProfile=crypto.randomUUID(),product=crypto.randomUUID(),policy=crypto.randomUUID(),category=crypto.randomUUID();
 const paidAt=new Date(Date.now()-120000).toISOString();
 let storeCheckoutId='chk_synthetic_store_'+crypto.randomUUID(),storePaymentId='ch_synthetic_store_'+crypto.randomUUID();
 let checkoutReference='';
 beforeAll(async()=>{
  const application=crypto.randomUUID();
  await pg.query("insert into app_private.bachs_fee_profiles(university_id,version,context,collection,status,effective_from,source_url,variance_tolerance_kobo,approval_note,eligibility_evidence,approved_by)values($1,'SYNTHETIC_STORE_BACKDATED','CHECKOUT_BANK_TRANSFER','{\"basisPoints\":150,\"flatKobo\":0,\"flatWaivedBelowKobo\":0,\"capKobo\":200000}','APPROVED',now()-interval '1 day','https://docs.bachs.io/for-you/fees',100,'Synthetic prior approved fee context','Synthetic bank transfer merchant-bears-fee capability',$2)",[storeCampus,admin]);
  await pg.query("insert into public.agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement,status)values($1,$2,$3,'VENDOR','Synthetic store','+2348000000001','Synthetic verified store','APPROVED')",[application,admin,storeCampus]);
  await pg.query("insert into public.agent_profiles(id,application_id,user_id,university_id,agent_type,display_name,status,verified_at)values($1,$2,$3,$4,'VENDOR','Synthetic store','ACTIVE',now())",[vendorProfile,application,admin,storeCampus]);
  await pg.query("insert into public.vendor_storefronts(vendor_profile_id,university_id,display_name,status,submitted_at,reviewed_by_user_id,reviewed_at,moderated_revision,contact_phone_e164,pickup_location,description,opening_hours)values($1,$2,'Synthetic store','APPROVED',now(),$3,now(),1,'+2348000000001','Synthetic campus','Synthetic verified shop','{\"Monday\":\"08:00-17:00\"}')",[vendorProfile,storeCampus,admin]);
  await pg.query("insert into product_categories(id,university_id,name,status)values($1,$2,'Synthetic books','APPROVED')",[category,storeCampus]);
  await pg.query("insert into public.vendor_products(id,vendor_profile_id,university_id,name,description,category,category_id,price_kobo,stock_quantity,status,reviewed_by_user_id,reviewed_at,moderated_revision,package_weight_grams,package_length_cm,package_width_cm,package_height_cm,bicycle_delivery_eligible)values($1,$2,$3,'Synthetic book','Synthetic test product description','Synthetic books',$5,30000,3,'PUBLISHED',$4,now(),1,200,20,15,3,true)",[product,vendorProfile,storeCampus,admin,category]);
  await pg.query("insert into app_private.commerce_fee_policies(id,university_id,kind,version,buyer_basis_points,buyer_flat_per_item_kobo,seller_commission_basis_points,collection,source_url,approval_note,approved_by)values($1,$2,'STORE','SYNTHETIC_STORE',250,0,0,'{}','https://docs.bachs.io/for-you/fees','Synthetic store settlement approval',$3)",[policy,storeCampus,admin]);
 },60000);
 async function order(){
  const id=crypto.randomUUID(),quote=crypto.randomUUID();
  await pg.query("insert into app_private.store_checkout_quotes(id,university_id,buyer_user_id,vendor_profile_id,policy_id,request_id,request_payload,items,pricing)values($1,$2,$3,$4,$5,gen_random_uuid(),'{}','[]','{}')",[quote,storeCampus,buyer,vendorProfile,policy]);
  await pg.query("insert into public.orders(id,university_id,buyer_user_id,vendor_profile_id,status,subtotal_kobo,delivery_fee_kobo,pricing_formula_version,fulfilment_mode)values($1,$2,$3,$4,'PENDING_PAYMENT',31300,0,'INCLUSIVE_V1','PICKUP')",[id,storeCampus,buyer,vendorProfile]);
  await pg.query("insert into public.order_items(order_id,product_id,quantity,unit_price_kobo)values($1,$2,1,31300)",[id,product]);
  await pg.query("insert into app_private.order_price_snapshots(order_id,university_id,quote_id,base_kobo,listed_items_kobo,discount_kobo,seller_net_kobo,payable_kobo,cash_due_kobo)values($1,$2,$3,30000,31300,0,30000,31300,0)",[id,storeCampus,quote]);
  await pg.query("insert into public.inventory_reservations(order_id,product_id,quantity,expires_at)values($1,$2,1,now()+interval '20 minutes')",[id,product]);
  await pg.query('update public.vendor_products set stock_quantity=stock_quantity-1 where id=$1',[product]);
  return id;
 }
 const fetcher=()=>vi.fn(async(url:string,options?:RequestInit)=>{
  if(url.includes('paystack.co'))throw Error('New store checkout must never contact Paystack');
  if(url.endsWith('/accounts/checkout/settings'))return Response.json({fee_preference:'org_pays',enabled_payment_methods:{NGN_BANK_TRANSFER:{enabled:true}}});
  if(url.endsWith('/checkout-sessions')&&options?.method==='POST'){
   const body=JSON.parse(String(options.body));checkoutReference=body.reference;
   storeCheckoutId='chk_synthetic_store_'+crypto.randomUUID();storePaymentId='ch_synthetic_store_'+crypto.randomUUID();
   expect(body.pricing).toEqual({currency:'NGN',amount:'313.00'});
   expect(body.success_url).toBe('https://links.kampusone.app/payment/return?reference='+encodeURIComponent(checkoutReference));
   return Response.json({checkout_id:storeCheckoutId,checkout_url:'https://sandbox-checkout.bachs.io/c/store-synthetic',reference:checkoutReference,status:'open',expires_at:new Date(Date.now()+(body.expires_in_minutes-1)*60000).toISOString()});
  }
  if(url.endsWith('/checkout-sessions/'+storeCheckoutId))return Response.json({checkout_id:storeCheckoutId,reference:checkoutReference,status:'completed',amount:'313.00',currency:'NGN',charge:{payment_id:storePaymentId}});
  if(url.endsWith('/payments/'+storePaymentId))return Response.json({payment_id:storePaymentId,checkout_id:storeCheckoutId,reference:checkoutReference,status:'succeeded',amount:'313.00',amount_paid:'313.00',currency:'NGN',merchant_bears_cost:true,payment_method:'NGN_BANK_TRANSFER',fees:{amount:'4.69',currency:'NGN'},completed_at:paidAt});
  throw Error('Unexpected provider request');
 });
 async function initializeOrder(id:string){
  vi.stubGlobal('fetch',fetcher());vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.parse(paidAt)-60000);
  const initialized=await app.request('/payments/initialize',{method:'POST',headers:{'x-user':buyer,'x-campus':storeCampus,'Content-Type':'application/json'},body:JSON.stringify({resourceType:'STORE_ORDER',resourceId:id,idempotencyKey:crypto.randomUUID()})},env);
  vi.useRealTimers();expect(initialized.status).toBe(200);
  await pg.query("update public.payment_attempts set created_at=now()-interval '10 minutes' where provider_reference=$1",[checkoutReference]);
 }
 it('routes every new collection kind to BACHS while retaining historical reference identity',()=>{
  for(const kind of ['AI','O','T','M','RC'] as const)expect(collectionReference(env,kind)).toMatch(new RegExp('^K1-B-'+kind+'-'));
  expect(collectionReference({...env,BACHS_PRICED_CHECKOUT_ENABLED:'false'},'O')).toMatch(/^K1-O-/);
 });
 it('settles an on-time payment after automatic expiry, posts earnings and replays exactly once',async()=>{
  const id=await order();vi.stubGlobal('fetch',fetcher());
  const previousTransactions=(await financeReport(env,storeCampus)).transactions_processed;
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(Date.now()-180000);
  const initialized=await app.request('/payments/initialize',{method:'POST',headers:{'x-user':buyer,'x-campus':storeCampus,'Content-Type':'application/json'},body:JSON.stringify({resourceType:'STORE_ORDER',resourceId:id,idempotencyKey:crypto.randomUUID()})},env);
  vi.useRealTimers();
  expect({status:initialized.status,body:initialized.status===200?null:await initialized.json()}).toEqual({status:200,body:null});
  const response=await initialized.json();expect(response.reference).toMatch(/^K1-B-O-/);expect(response.authorizationUrl).toContain('bachs.io');
  await pg.query("update public.payment_attempts set created_at=now()-interval '10 minutes' where provider_reference=$1",[checkoutReference]);
  await pg.query("update public.inventory_reservations set expires_at=now()-interval '1 minute' where order_id=$1",[id]);
  await pg.query('select * from app_private.expire_stale_commerce()');
  expect((await pg.query('select status from public.orders where id=$1',[id])).rows).toEqual([{status:'CANCELLED'}]);
  expect(await reconcilePricedStore(env,checkoutReference,buyer)).toBe(true);
  expect((await pg.query('select status from public.orders where id=$1',[id])).rows).toEqual([{status:'PAID'}]);
  const before=(await pg.query('select count(*)::int count from public.ledger_transactions where reference_id=$1',[id])).rows;
  expect(Number((await pg.query("select app_private.finance_balance($1,$2,'VENDOR_PENDING') as balance",[storeCampus,admin])).rows[0]!.balance)).toBe(30000);
  expect((await pg.query('select stock_quantity from public.vendor_products where id=$1',[product])).rows).toEqual([{stock_quantity:2}]);
  const report=await financeReport(env,storeCampus);expect(report.transactions_processed).toBe(previousTransactions+1);expect(report.vendor_proceeds_kobo).toBe(30000);
  const status=await app.request('/payments/status/'+checkoutReference,{headers:{'x-user':buyer,'x-campus':storeCampus}},env);
  expect(status.status).toBe(200);expect((await status.json()).payment).toMatchObject({status:'SUCCEEDED',resource_type:'STORE_ORDER',resource_id:id,order_status:'PAID'});
  await reconcilePricedStore(env,checkoutReference,buyer);
  expect((await pg.query('select count(*)::int count from public.ledger_transactions where reference_id=$1',[id])).rows).toEqual(before);
  expect((await pg.query('select stock_quantity from public.vendor_products where id=$1',[product])).rows).toEqual([{stock_quantity:2}]);
  expect(await reconcilePricedStore(env,checkoutReference,admin)).toBe(false);
 });
 it('holds a paid receipt for review when expired stock was sold instead of overselling or inventing earnings',async()=>{
  const id=await order();await initializeOrder(id);
  await pg.query("update public.inventory_reservations set expires_at=now()-interval '1 minute' where order_id=$1",[id]);
  await pg.query('select * from app_private.expire_stale_commerce()');await pg.query('update public.vendor_products set stock_quantity=0 where id=$1',[product]);
  await reconcilePricedStore(env,checkoutReference,buyer);
  expect((await pg.query('select status,failure_code from public.payment_attempts where provider_reference=$1',[checkoutReference])).rows).toEqual([{status:'REQUIRES_REVIEW',failure_code:'PAID_ORDER_STOCK_UNAVAILABLE'}]);
  expect((await pg.query('select * from app_private.commerce_settlements where order_id=$1',[id])).rows).toHaveLength(0);
  expect(Number((await pg.query("select app_private.finance_balance($1,$2,'VENDOR_PENDING') as balance",[storeCampus,admin])).rows[0]!.balance)).toBe(30000);
  expect((await pg.query('select stock_quantity from public.vendor_products where id=$1',[product])).rows).toEqual([{stock_quantity:0}]);
 });
 it('keeps a vendor cancellation final even when receipt confirmation arrives before its audit write',async()=>{
  await pg.query('update public.vendor_products set stock_quantity=2 where id=$1',[product]);
  const id=await order();await initializeOrder(id);await pg.query('select * from app_private.cancel_vendor_order($1,$2)',[id,admin]);
  await reconcilePricedStore(env,checkoutReference,buyer);
  expect((await pg.query('select status,cancelled_by_user_id from public.orders where id=$1',[id])).rows).toEqual([{status:'CANCELLED',cancelled_by_user_id:admin}]);
  expect((await pg.query('select status from public.payment_attempts where provider_reference=$1',[checkoutReference])).rows).toEqual([{status:'REQUIRES_REVIEW'}]);
  expect((await pg.query('select * from app_private.commerce_settlements where order_id=$1',[id])).rows).toHaveLength(0);
 });
});
