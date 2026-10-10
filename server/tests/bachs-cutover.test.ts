import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono, type Context, type Next } from 'hono';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, testDatabaseAdapter, testSqlClient } from './helpers/database';
import { quoteKira, initializeKira, reconcileKira } from '../src/lib/kira-billing';
import { paymentRoutes } from '../src/routes/payments';
import { AppError } from '../src/lib/errors';
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
 for(const f of ['20261003122000_kira_plan_catalogue.sql','20261003123000_payment_pricing_profiles.sql','20261003124000_payout_fee_components.sql','20261003125000_verified_refund_accounting.sql','20261006110000_customer_paid_provider_fees.sql','20261009100000_bachs_pricing_psychology.sql','20261009100000_payment_idempotency_inbox.sql'])await pg.exec(sql(f));
 await pg.query("insert into app_private.payment_fee_profiles(university_id,version,transaction_class,collection,effective_from,status,source_url,approval_note,approved_by) values($1,'TEST_LOCAL','LOCAL_COLLECTION',$2,now(),'APPROVED','https://paystack.com/pricing','Synthetic approval for provider coexistence test',$3)",[campus,JSON.stringify({basisPoints:150,flatKobo:10000,flatWaivedBelowKobo:250000,capKobo:200000}),admin]);
 await pg.query("select app_private.record_verified_paystack_receipt($1,$2,'RIDER_COMMISSION',$3,10000,0,now())",[other,legacyReference,crypto.randomUUID()]);
 await pg.query("insert into app_private.kira_price_plans(id,university_id,tier,plan_name,version,amount_kobo,listed_amount_kobo,discount_percent,collection,estimated_processing_kobo,approved_by,approval_note,source_url,model_access,available,active_status) select gen_random_uuid(),university_id,'pro','Kira Pro','ACTIVE_TEST',600000,600000,0,collection,19000,approved_by,'Synthetic active provider test','https://paystack.com/pricing','pro',true,true from app_private.kira_price_plans where version='LEGACY_PRO'");
 await pg.exec("update app_private.active_kira_price_plans set plan_id=(select id from app_private.kira_price_plans where version='ACTIVE_TEST') where tier='pro'");
 await pg.exec(sql('20261010140000_bachs_collection_cutover.sql'));

},60000);
afterAll(async()=>{await pg?.close();});afterEach(()=>vi.unstubAllGlobals());
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
