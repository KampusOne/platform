import { readFileSync } from "node:fs";
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Hono, type Context, type Next } from "hono";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, testDatabaseAdapter, testSqlClient } from "./helpers/database";
import { financeRefundRoutes } from "../src/routes/finance-refunds";
import { paymentRoutes } from "../src/routes/payments";
import { AppError } from "../src/lib/errors";
import type { Bindings } from "../src/types";
let pg: PGlite;
vi.mock("../src/lib/database", () => ({database: () => testDatabaseAdapter(pg),sqlClient: () => testSqlClient(pg),firstRow: (r: {rows: unknown[]}) => r.rows[0]}));
vi.mock("../src/middleware/auth", () => ({
  currentUser: (c: Context) => ({id: c.req.header("x-user"),universityId: c.req.header("x-campus"),email: "synthetic@example.invalid",roles: ["STUDENT"],operatorRoles: []}),
  requireAuth: async (c: Context, n: Next) => c.req.header("x-user") ? n() : c.json({error: "Unauthorized"}, 401),
}));
const uni = crypto.randomUUID(), otherUni = crypto.randomUUID(), buyer = crypto.randomUUID(), tutor = crypto.randomUUID(), reviewer = crypto.randomUUID(), requester = crypto.randomUUID(), outsider = crypto.randomUUID(), agent = crypto.randomUUID(), policy = crypto.randomUUID();
const env = {ENVIRONMENT: "local",PAYMENTS_ENABLED: "true",PAYSTACK_SECRET_KEY: "sk_live_synthetic",PHASE_2_SCHEMA_READY: "true",PHASE_3_SCHEMA_READY: "true"} as Bindings;
const app = new Hono().route("/finance", financeRefundRoutes).route("/payments", paymentRoutes);
app.onError((e, c) => c.json({error: e.message}, e instanceof AppError ? e.status : 500));
async function api(path: string, actor = reviewer, body?: unknown, campus = uni) {
  return app.request(path, {method: body ? "POST" : "GET",headers: {"x-user": actor,"x-campus": campus,"content-type": "application/json"},...(body ? {body: JSON.stringify(body)} : {})}, env);
}
async function fixture() {
  const booking = crypto.randomUUID(), listing = crypto.randomUUID(), window = crypto.randomUUID(), reference = "K1-T-" + crypto.randomUUID();
  await pg.query("insert into tutorial_listings(id,university_id,tutor_profile_id,course_code,title,description,format,price_kobo,capacity,status,review_status)values($1,$2,$3,'SYN101','Synthetic session','Local financial fixture only','ONLINE',600000,5,'PUBLISHED','APPROVED')", [listing,uni,agent]);
  await pg.query("insert into tutorial_availability_windows(id,listing_id,starts_at,ends_at,capacity)values($1,$2,now()+interval '1 day',now()+interval '25 hours',5)", [window,listing]);
  const price = {baseKobo: 600000,fareKobo: 0,payableKobo: 600000,listedItemsKobo: 600000,sellerNetKobo: 570000,estimatedProcessingKobo: 19000};
  await pg.query("select * from app_private.create_priced_tutorial_booking($1,$2,$3,$4,$5,$6,$7,600000,$8::jsonb)", [booking,uni,buyer,listing,window,crypto.randomUUID(),policy,JSON.stringify(price)]);
  await pg.query("insert into payment_attempts(id,user_id,university_id,resource_type,resource_id,provider_reference,amount_kobo,idempotency_key,status)values($1,$2,$3,'TUTORIAL_BOOKING',$4,$5,600000,$5,'INITIALIZED')", [crypto.randomUUID(),buyer,uni,booking,reference]);
  await pg.query("select app_private.record_priced_tutorial_receipt($1,600000,19000,now())", [reference]);
  return {booking,reference};
}
async function requestRefund(reference: string, amount = 600000, requestId = crypto.randomUUID()) {
  const response = await api("/finance/refunds", requester, {universityId: uni,reference,amountKobo: amount,requestId,reason: "Synthetic approved customer refund request"});
  expect(response.status).toBe(201);
  return (await response.json() as {refund: {id: string;status: string;review_reason: string|null}}).refund;
}
async function approve(refund: string, actor = reviewer) {
  return api(`/finance/refunds/${refund}/approve`, actor, {confirm: true,reviewNote: "Synthetic independent finance approval"});
}
async function bind(refund: string, providerId: string) {
  return api(`/finance/refunds/${refund}/provider`, reviewer, {providerRefundId: providerId,reviewNote: "Synthetic existing dashboard refund identifier"});
}
async function record(refund: string, reference: string, providerId: string, status: string, amount = 600000, currency = "NGN") {
  return (await pg.query<{status: string}>("select app_private.record_verified_refund($1,$2,$3,$4,$5,$6,$7,$8,$9) as status", [refund,uni,reviewer,providerId,reference,currency,amount,status,status === "processed" ? "2026-10-03T10:00:00Z" : null])).rows[0]!.status;
}
async function balance(code: string, owner: string|null = null) {
  return Number((await pg.query<{amount: number}>("select app_private.finance_balance($1,$2,$3) as amount", [uni,owner,code])).rows[0]!.amount);
}
async function storeFixture(fare = 0) {
  const vendorUser = crypto.randomUUID(), vendor = crypto.randomUUID(), application = crypto.randomUUID(), order = crypto.randomUUID(), storePolicy = crypto.randomUUID(), reference = "K1-O-"+crypto.randomUUID();
  await pg.query("insert into users(id,email,password_hash,updated_at)values($1,$1::uuid::text||'@example.invalid','synthetic',now())", [vendorUser]);
  await pg.query("insert into agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement)values($1,$2,$3,'VENDOR','Synthetic refund vendor','+2348012345678','Synthetic fixture only')", [application,vendorUser,uni]);
  await pg.query("insert into agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,verified_at)values($1,$2,$3,$4,'VENDOR','Synthetic refund vendor',now())", [vendor,vendorUser,uni,application]);
  await pg.query("insert into app_private.commerce_fee_policies(id,university_id,kind,version,buyer_basis_points,buyer_flat_per_item_kobo,seller_commission_basis_points,collection,checkout_savings,allow_processor_subsidy,source_url,approval_note,approved_by)values($1,$2,'STORE',$1::uuid::text,0,0,500,'{}',true,false,'https://paystack.com/pricing','Synthetic reviewed store policy',$3)", [storePolicy,uni,reviewer]);
  await pg.query("insert into orders(id,university_id,buyer_user_id,vendor_profile_id,subtotal_kobo,delivery_fee_kobo,fulfilment_mode,pricing_formula_version)values($1,$2,$3,$4,600000,$5,$6,'INCLUSIVE_V1')", [order,uni,buyer,vendor,fare,fare ? "RIDER" : "PICKUP"]);
  await pg.query("insert into app_private.store_checkout_quotes(id,university_id,buyer_user_id,vendor_profile_id,policy_id,request_id,request_payload,items,pricing)values($1,$2,$3,$4,$5,$6,'{}','[]',$7::jsonb)", [order,uni,buyer,vendor,storePolicy,crypto.randomUUID(),JSON.stringify({baseKobo: 600000,listedItemsKobo: 600000,payableKobo: 600000+fare,sellerNetKobo: 570000,fareKobo: fare,cashDueKobo: 0})]);
  await pg.query("insert into app_private.order_price_snapshots(order_id,university_id,quote_id,base_kobo,listed_items_kobo,discount_kobo,seller_net_kobo,payable_kobo,cash_due_kobo)values($1,$2,$1,600000,600000,0,570000,$3,0)", [order,uni,600000+fare]);
  await pg.query("select app_private.record_verified_paystack_receipt($1,$2,'STORE_ORDER',$3,$4,19000,now())", [uni,reference,order,600000+fare]);
  const lines = [{code: "PAYMENT_SUSPENSE",type: "LIABILITY",direction: "DEBIT",amount: 600000+fare},{code: "VENDOR_PENDING",type: "LIABILITY",owner: vendorUser,direction: "CREDIT",amount: 570000},{code: "PLATFORM_COMMISSION",type: "REVENUE",direction: "CREDIT",amount: 30000},...(fare ? [{code: "DELIVERY_LIABILITY",type: "LIABILITY",direction: "CREDIT",amount: fare}] : [])];
  const journal = (await pg.query<{id: string}>("select app_private.post_finance_journal($1,'STORE_ORDER',$2,$3,'Synthetic original store allocation',$4::jsonb) as id", [uni,order,"priced-payment:"+reference,JSON.stringify(lines)])).rows[0]!.id;
  await pg.query("insert into app_private.commerce_settlements(order_id,university_id,provider_reference,amount_kobo,seller_net_kobo,digital_fare_kobo,cash_fare_kobo,provider_fee_kobo,journal_id)values($1,$2,$3,$4,570000,$5,0,19000,$6)", [order,uni,reference,600000+fare,fare,journal]);
  await pg.query("update orders set status='PAID' where id=$1", [order]);
  return {order,reference,vendorUser};
}
beforeAll(async () => {
  pg = await createTestDatabase();
  for (const file of ["20260912200000_phase_3_commerce_foundation.sql","20260930220000_store_fulfilment_modes.sql","20260930240000_rider_commission_ledger.sql","20260930250000_inclusive_store_quotes.sql","20260930260000_inclusive_tutorial_bookings.sql","20260930270000_verified_kira_subscription.sql","20260930280000_verified_learning_materials.sql","20261001020000_admin_workspace_extensions.sql","20261001182000_discount_codes_and_newsletter_access.sql","20261001185000_scoped_commerce_discounts.sql","20261001185500_material_discounts.sql","20261003125000_verified_refund_accounting.sql"])
    await pg.exec(readFileSync(new URL("../../database/neon/migrations/" + file, import.meta.url), "utf8"));
  for (const campus of [uni,otherUni]) await pg.query("insert into universities(id,name,slug,updated_at)values($1,'Synthetic campus '||$1::uuid::text,$1::uuid::text,now())", [campus]);
  for (const user of [buyer,tutor,reviewer,requester,outsider]) {
    await pg.query("insert into users(id,email,password_hash,updated_at)values($1,$1::uuid::text||'@example.invalid','synthetic',now())", [user]);
    await pg.query("insert into profiles(id,user_id,university_id,username,display_name,updated_at)values($1,$1,$2,'syn_'||substring(replace($1::uuid::text,'-',''),1,20),'Synthetic person',now())", [user,uni]);
  }
  for (const actor of [requester,reviewer,buyer]) await pg.query("insert into operator_roles(user_id,university_id,role)values($1,$2,'FINANCE_REVIEWER')", [actor,uni]);
  await pg.query("insert into operator_roles(user_id,university_id,role)values($1,$2,'FINANCE_REVIEWER')", [outsider,otherUni]);
  const application = crypto.randomUUID();
  await pg.query("insert into agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement)values($1,$2,$3,'TUTOR','Synthetic tutor','+2348012345678','Synthetic local fixture')", [application,tutor,uni]);
  await pg.query("insert into agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,verified_at)values($1,$2,$3,$4,'TUTOR','Synthetic tutor',now())", [agent,tutor,uni,application]);
  await pg.query("insert into app_private.commerce_fee_policies(id,university_id,kind,version,buyer_basis_points,buyer_flat_per_item_kobo,seller_commission_basis_points,collection,checkout_savings,allow_processor_subsidy,source_url,approval_note,approved_by)values($1,$2,'TUTORIAL','SYNTHETIC_V1',0,0,500,'{}',true,false,'https://paystack.com/pricing','Synthetic approved policy',$3)", [policy,uni,reviewer]);
}, 30000);
afterAll(async () => pg?.close());
afterEach(() => vi.unstubAllGlobals());

describe("snapshot-bound finance refunds", () => {
  it("requires scoped finance permission, original receipt and independent approval", async () => {
    const f = await fixture(), r = await requestRefund(f.reference);
    expect((await api("/finance/refunds", tutor)).status).toBe(403);
    expect((await approve(r.id, outsider)).status).toBe(403);
    expect((await approve(r.id, buyer)).status).toBe(403);
    expect((await approve(r.id, requester)).status).toBe(403);
    expect((await api("/finance/refunds", requester, {universityId: uni,reference: "missing-snapshot",amountKobo: 600000,requestId: crypto.randomUUID(),reason: "Original receipt has not been supplied"})).status).toBe(409);
    expect((await approve(r.id)).status).toBe(200);
  });
  it("seals idempotent requests and refuses snapshot changes and partial invented accounting", async () => {
    const f = await fixture(), requestId = crypto.randomUUID(), r = await requestRefund(f.reference,600000,requestId);
    expect((await requestRefund(f.reference,600000,requestId)).id).toBe(r.id);
    await expect(pg.query("update app_private.verified_refund_requests set original_snapshot='{}' where id=$1", [r.id])).rejects.toThrow("REFUND_SNAPSHOT_IMMUTABLE");
    await expect(pg.query("update app_private.tutorial_booking_prices set payable_kobo=payable_kobo-1 where booking_id=$1", [f.booking])).rejects.toThrow();
    const partialFixture = await fixture(), partial = await requestRefund(partialFixture.reference,100000);
    expect(partial).toMatchObject({status: "REQUIRES_REVIEW",review_reason: "PARTIAL_REFUND_POLICY_REQUIRED"});
    expect((await approve(partial.id)).status).toBe(409);
  });
  it("keeps pending and failed refunds reserved without ledger debit or fulfilment changes", async () => {
    const f = await fixture(), r = await requestRefund(f.reference);
    await approve(r.id);await bind(r.id,"821");
    const before = await balance("TUTOR_PENDING",tutor), count = (await pg.query<{n: number}>("select count(*)::int as n from ledger_transactions")).rows[0]!.n;
    expect(await record(r.id,f.reference,"821","pending")).toBe("PROVIDER_PENDING");
    expect(await record(r.id,f.reference,"821","pending")).toBe("PROVIDER_PENDING");
    expect(await record(r.id,f.reference,"821","failed")).toBe("FAILED");
    expect(await balance("TUTOR_PENDING",tutor)).toBe(before);
    expect((await pg.query<{n: number}>("select count(*)::int as n from ledger_transactions")).rows[0]!.n).toBe(count);
    await expect(pg.query("update tutorial_bookings set status='COMPLETED',earnings_state='PENDING',completed_at=now() where id=$1", [f.booking])).rejects.toThrow("PURCHASE_RESERVED_FOR_REFUND_REVIEW");
    expect((await pg.query<{status: string}>("select status from tutorial_bookings where id=$1", [f.booking])).rows[0]!.status).toBe("CONFIRMED");
  });
  it("rejects wrong amount/currency then reverses principal, seller and commission exactly once while retaining collection fees", async () => {
    const f = await fixture(), r = await requestRefund(f.reference);
    await approve(r.id);await bind(r.id,"822");
    await expect(record(r.id,f.reference,"822","processed",600001)).rejects.toThrow("REFUND_PROVIDER_SNAPSHOT_MISMATCH");
    await expect(record(r.id,f.reference,"822","processed",600000,"USD")).rejects.toThrow("REFUND_PROVIDER_SNAPSHOT_MISMATCH");
    const seller = await balance("TUTOR_PENDING",tutor), commission = await balance("PLATFORM_COMMISSION"), clearing = await balance("PAYSTACK_CLEARING"), expense = await balance("PROCESSING_EXPENSE");
    expect(await record(r.id,f.reference,"822","processed")).toBe("SUCCEEDED");
    expect(await record(r.id,f.reference,"822","processed")).toBe("ALREADY_SUCCEEDED");
    expect(await balance("TUTOR_PENDING",tutor)).toBe(seller-570000);
    expect(await balance("PLATFORM_COMMISSION")).toBe(commission-30000);
    expect(await balance("PAYSTACK_CLEARING")).toBe(clearing-600000);
    expect(await balance("PROCESSING_EXPENSE")).toBe(expense);
    expect((await pg.query<{n: number}>("select count(*)::int as n from ledger_transactions where idempotency_key='verified-refund:822'")).rows[0]!.n).toBe(1);
    const saved = (await pg.query("select seller_reversal_kobo,commission_reversal_kobo,collection_fee_returned_kobo,refund_processing_fee_kobo,delivery_refund_kobo,journal_id from app_private.verified_refund_requests where id=$1", [r.id])).rows[0];
    expect(saved).toMatchObject({seller_reversal_kobo: 570000,commission_reversal_kobo: 30000,collection_fee_returned_kobo: 0,refund_processing_fee_kobo: null,delivery_refund_kobo: 0});
    await expect(record(r.id,f.reference,"822","failed")).rejects.toThrow("REFUND_PROVIDER_STATE_CONFLICT");
  });
  it("verifies the provider on the check route and never trusts the caller's refund status", async () => {
    const f = await fixture(), r = await requestRefund(f.reference);
    await approve(r.id);await bind(r.id,"823");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json({status: true,data: url.includes("/refund/")
      ? {id: 823,transaction: 123,currency: "NGN",amount: 600000,status: "processing",domain: "live"}
      : {id: 123,reference: f.reference,currency: "NGN",amount: 600000,fees: 19000,status: "reversed",domain: "live"}})));
    const response = await api(`/finance/refunds/${r.id}/check`, reviewer, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({status: "PROVIDER_PENDING",providerStatus: "processing"});
    expect((await pg.query<{journal_id: string|null}>("select journal_id from app_private.verified_refund_requests where id=$1", [r.id])).rows[0]!.journal_id).toBeNull();
    expect((await api(`/finance/refunds/${r.id}/check`, buyer, {})).status).toBe(403);
  });
  it("retains Kira's original plan and receipt for policy review without guessing an entitlement reversal", async () => {
    const plan = crypto.randomUUID(), checkout = crypto.randomUUID(), reference = "K1-AI-"+crypto.randomUUID();
    await pg.query("insert into app_private.kira_price_plans(id,university_id,version,collection,estimated_processing_kobo,approved_by,approval_note,source_url)values($1,$2,'SYNTHETIC_REFUND_V1','{}',19000,$3,'Synthetic reviewed subscription plan','https://paystack.com/pricing')", [plan,uni,reviewer]);
    await pg.query("insert into app_private.active_kira_price_plans(university_id,plan_id)values($1,$2)", [uni,plan]);
    await pg.query("select * from app_private.create_kira_checkout($1,$2,$3,$4,$5)", [checkout,buyer,uni,crypto.randomUUID(),reference]);
    await pg.query("select app_private.record_kira_receipt($1,600000,19000,now())", [reference]);
    const before = await balance("PAYSTACK_CLEARING"), r = await requestRefund(reference);
    expect(r).toMatchObject({status: "REQUIRES_REVIEW",review_reason: "KIRA_ENTITLEMENT_REFUND_POLICY_REQUIRED"});
    expect((await approve(r.id)).status).toBe(409);
    expect(await balance("PAYSTACK_CLEARING")).toBe(before);
    const snapshot = (await pg.query<{original_snapshot: {pricing: {plan: {id: string}}}}>("select original_snapshot from app_private.verified_refund_requests where id=$1", [r.id])).rows[0]!.original_snapshot;
    expect(snapshot.pricing.plan.id).toBe(plan);
  });
  it("uses the learning material's sealed original quote and reverses unearned principal once", async () => {
    const resource = crypto.randomUUID(), media = crypto.randomUUID(), quote = crypto.randomUUID(), reference = "K1-M-"+crypto.randomUUID();
    await pg.query("insert into media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name)values($1,$2,$3,'resource',$1::uuid::text,'application/pdf',100,'Synthetic material.pdf')", [media,tutor,uni]);
    await pg.query("insert into tutorial_resources(id,university_id,tutor_profile_id,course_code,title,description,resource_type,access_model,price_kobo,publisher_name,media_object_id,status)values($1,$2,$3,'SYN101','Synthetic notes','Synthetic paid notes only','PDF','PAID',600000,'Synthetic tutor',$4,'PUBLISHED')", [resource,uni,agent,media]);
    await pg.query("insert into app_private.material_checkout_quotes(id,university_id,student_user_id,resource_id,tutor_user_id,media_object_id,policy_id,request_id,title,base_kobo,pricing)values($1,$2,$3,$4,$5,$6,$7,$8,'Synthetic notes',600000,$9::jsonb)", [quote,uni,buyer,resource,tutor,media,policy,crypto.randomUUID(),JSON.stringify({listedItemsKobo: 600000,payableKobo: 600000,sellerNetKobo: 570000})]);
    await pg.query("select * from app_private.create_material_purchase($1,$2,$3)", [quote,buyer,uni]);
    await pg.query("select * from app_private.prepare_material_payment($1,$2,$3,$4,$5,$6)", [crypto.randomUUID(),quote,buyer,uni,crypto.randomUUID(),reference]);
    await pg.query("select app_private.record_material_receipt($1,600000,19000,now())", [reference]);
    const r = await requestRefund(reference);expect(r.status).toBe("REQUESTED");
    await approve(r.id);await bind(r.id,"824");
    expect(await record(r.id,reference,"824","processed")).toBe("SUCCEEDED");
    expect(await record(r.id,reference,"824","processed")).toBe("ALREADY_SUCCEEDED");
    expect((await pg.query("select status,earnings_state from app_private.tutorial_material_purchases where id=$1", [quote])).rows[0]).toMatchObject({status: "REFUNDED",earnings_state: "REVERSED"});
  });
  it("reverses an unfulfilled pickup's original vendor allocation and sends delivery refunds to policy review", async () => {
    const pickup = await storeFixture(), r = await requestRefund(pickup.reference);
    expect(r.status).toBe("REQUESTED");
    await approve(r.id);await bind(r.id,"826");
    expect(await record(r.id,pickup.reference,"826","processed")).toBe("SUCCEEDED");
    expect(await balance("VENDOR_PENDING",pickup.vendorUser)).toBe(0);
    const delivery = await storeFixture(30000), manual = await requestRefund(delivery.reference,630000);
    expect(manual).toMatchObject({status: "REQUIRES_REVIEW",review_reason: "DELIVERY_REFUND_POLICY_REQUIRED"});
    expect((await approve(manual.id)).status).toBe(409);
    expect((await pg.query("select delivery_refund_kobo,delivery_treatment,journal_id from app_private.verified_refund_requests where id=$1", [manual.id])).rows[0]).toMatchObject({delivery_refund_kobo: 0,delivery_treatment: "REQUIRES_REVIEW",journal_id: null});
  });
  it("releases only requests cancelled before provider binding and preserves historical snapshot evidence", async () => {
    const f = await fixture(), r = await requestRefund(f.reference);
    const response = await api(`/finance/refunds/${r.id}/cancel`, reviewer, {reviewNote: "Synthetic request cancelled before provider initiation"});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({status: "CANCELLED"});
    await expect(pg.query("delete from app_private.verified_refund_requests where id=$1", [r.id])).rejects.toThrow("REFUND_APPEND_ONLY");
    const replacement = await requestRefund(f.reference);expect(replacement.id).not.toBe(r.id);
    await approve(replacement.id);await bind(replacement.id,"825");
    expect((await api(`/finance/refunds/${replacement.id}/cancel`, reviewer, {reviewNote: "Synthetic unsafe cancellation after provider binding"})).status).toBe(409);
  });
  it("quarantines signed legacy tutorial events without confirming a booking or adding ledger lines", async () => {
    const f = await fixture();
    // A separate legacy booking contains no immutable price or verified receipt.
    const booking = crypto.randomUUID(), listing = (await pg.query<{listing_id: string}>("select listing_id from tutorial_bookings where id=$1", [f.booking])).rows[0]!.listing_id;
    const reference = "K1-T-legacy-" + crypto.randomUUID();
    await pg.query("insert into tutorial_bookings(id,university_id,listing_id,student_user_id,amount_kobo,status,payment_expires_at)values($1,$2,$3,$4,600000,'PENDING_PAYMENT',now()+interval '1 hour')", [booking,uni,listing,buyer]);
    await pg.query("insert into payment_attempts(id,user_id,university_id,resource_type,resource_id,provider_reference,amount_kobo,idempotency_key,status)values($1,$2,$3,'TUTORIAL_BOOKING',$4,$5,600000,$5,'INITIALIZED')", [crypto.randomUUID(),buyer,uni,booking,reference]);
    const raw = JSON.stringify({event: "charge.success",data: {reference,amount: 600000,status: "success"}});
    const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(env.PAYSTACK_SECRET_KEY!),{name: "HMAC",hash: "SHA-512"},false,["sign"]);
    const signature = [...new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(raw)))].map(n => n.toString(16).padStart(2,"0")).join("");
    const fetcher = vi.fn();vi.stubGlobal("fetch",fetcher);
    const initialize = await api("/payments/initialize",buyer,{resourceType: "TUTORIAL_BOOKING",resourceId: booking,idempotencyKey: crypto.randomUUID()});
    expect(initialize.status).toBe(503);
    expect(await initialize.json()).toMatchObject({error: expect.stringContaining("price review")});
    const response = await app.request("/payments/paystack/webhook",{method: "POST",headers: {"X-Paystack-Signature": signature},body: raw},env);
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({status: "requires_review"});
    expect(fetcher).not.toHaveBeenCalled();
    expect((await pg.query("select status,failure_code from payment_attempts where provider_reference=$1", [reference])).rows[0]).toMatchObject({status: "REQUIRES_REVIEW",failure_code: "LEGACY_VERIFIED_SNAPSHOT_REQUIRED"});
    expect((await pg.query<{status: string}>("select status from tutorial_bookings where id=$1", [booking])).rows[0]!.status).toBe("PENDING_PAYMENT");
    expect((await pg.query<{n: number}>("select count(*)::int as n from ledger_transactions where reference_id=$1", [booking])).rows[0]!.n).toBe(0);
  });
  it("runs the synthetic SQL acceptance fixture with a full rollback", async () => {
    const before = (await pg.query<{n: number}>("select count(*)::int as n from ledger_transactions")).rows[0]!.n;
    await pg.exec(readFileSync(new URL("../../database/verification/refund-functional-acceptance.sql",import.meta.url),"utf8"));
    expect((await pg.query<{n: number}>("select count(*)::int as n from ledger_transactions")).rows[0]!.n).toBe(before);
  });
});
