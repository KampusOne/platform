import { readFileSync } from "node:fs";
import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { Hono, type Context, type Next } from "hono";
import type { PGlite } from "@electric-sql/pglite";
import {
  createTestDatabase,
  testDatabaseAdapter,
  testSqlClient,
} from "./helpers/database";
import { agentRoutes } from "../src/routes/agents";
import { paymentRoutes } from "../src/routes/payments";
import { studentRoutes } from "../src/routes/student";
import { financePolicyRoutes } from "../src/routes/finance-policies";
import { aiRoutes } from "../src/routes/ai";
import { tutorCommerceRoutes } from "../src/routes/tutor-commerce";
import { mediaRoutes } from "../src/routes/media";
import {encryptBankDetails} from "../src/lib/bank-envelope";
import {payoutAdminRoutes} from "../src/routes/payouts-admin";
import {withdrawalCommissionTiers} from "../src/lib/payout-commission";
import { adminRoutes } from "../src/routes/admin";
import { AppError } from "../src/lib/errors";
import { riderFinanceSummary } from "../src/lib/rider-finance";
import { prepareStoreQuote, storeQuoteSchema } from "../src/lib/commerce-pricing";
import { deriveHandoffCode } from "../src/lib/security";
import type { AuthenticatedUser, Bindings } from "../src/types";
let pg: PGlite;
vi.mock("../src/lib/database", () => ({
  database: () => testDatabaseAdapter(pg),
  sqlClient: () => testSqlClient(pg),
  firstRow: (r: { rows: unknown[] }) => r.rows[0],
}));
vi.mock('../src/lib/delivery-routing',()=>({riderPickupAvailability:async()=>new Map(),mappedDeliveryPoint:async()=>({campus_id:campus,name:'Synthetic mapped pickup',latitude:6.3,longitude:5.6}),currentAgentPosition:async()=>({latitude:6.3,longitude:5.6,captured_at:new Date().toISOString(),accuracy_metres:10}),campusDeliveryRoute:async()=>({distanceMetres:700,geometry:{type:'LineString',coordinates:[[5.6,6.3],[5.601,6.3]]},source:'ISOLATED_FINANCE_FIXTURE'})}));
vi.mock("../src/middleware/auth", () => ({
  currentUser: (c: Context) =>
    c.get("user") ?? {
      id: c.req.header("x-user"),
      universityId: c.req.header("x-campus"),
      email: "synthetic@example.invalid",
      roles: ["STUDENT"],
    },
  requireAuth: async (c: Context, n: Next) =>
    c.req.header("x-user") ? n() : c.json({ error: "Unauthorized" }, 401),
}));
const campus = crypto.randomUUID(),
  otherCampus = crypto.randomUUID(),
  vendorUser = crypto.randomUUID(),
  vendor = crypto.randomUUID(),
  buyer = crypto.randomUUID(),
  zone = crypto.randomUUID(),
  product = crypto.randomUUID(),
  category = crypto.randomUUID();
const env = {
  ENVIRONMENT: "local",
  STORE_ENABLED: "true",
  OTP_PEPPER: "synthetic-local-handoff-pepper",
  PHASE_3_SCHEMA_READY: "true",
  PHASE_2_SCHEMA_READY: "true",
  PAYMENTS_ENABLED: "true",
  TUTORIALS_ENABLED: "true",
  KIRA_SUBSCRIPTIONS_ENABLED: "true",
  PAYOUTS_ENABLED: "true",
  UNIFIED_SCHEMA_READY: "true",
  AI_ASSISTANT_ENABLED: "true",
  HF_TOKEN: "synthetic-local-ai-provider-token",
  HF_CHAT_MODEL: "synthetic/standard",
  HF_PRO_MODEL: "synthetic/pro",
  JWT_SECRET: "synthetic-private-file-test-key-at-least-32-characters",
  LOGISTICS_ENABLED: "true",
  PAYSTACK_SECRET_KEY: "sk_live_synthetic-not-a-real-key",
} as Bindings;
const app = new Hono()
  .route("/agents", agentRoutes)
  .route("/payments", paymentRoutes)
  .route("/student", studentRoutes)
  .route("/ai", aiRoutes)
  .route("/materials", tutorCommerceRoutes)
  .route("/media", mediaRoutes)
  .route("/v1/admin/operations/payouts",payoutAdminRoutes)
  .route("/v1/admin", adminRoutes)
  .route("/finance", financePolicyRoutes);
app.onError((e, c) =>
  c.json({ error: e.message }, e instanceof AppError ? e.status : 500),
);
async function request(
  path: string,
  user: string,
  method = "GET",
  body?: unknown,
  uni = campus,
) {
  return app.request(
    path,
    {
      method,
      headers: {
        "x-user": user,
        "x-campus": uni,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    env,
  );
}
async function person(
  user = crypto.randomUUID(),
  uni = campus,
  type = "RIDER",
) {
  await pg.query(
    "insert into users(id,email,password_hash,updated_at)values($1,$1::uuid::text||'@example.invalid','synthetic',now()) on conflict do nothing",
    [user],
  );
  await pg.query(
    "insert into profiles(id,user_id,university_id,username,display_name,updated_at)values($1,$1,$2,'synthetic_'||substring(replace($1::uuid::text,'-',''),1,20),'Synthetic student',now()) on conflict do nothing",
    [user, uni],
  );
  const profile = crypto.randomUUID(),
    application = crypto.randomUUID();
  await pg.query(
    "insert into agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement)values($1,$2,$3,$4,'Synthetic agent','+2348012345678','Synthetic fixture only')",
    [application, user, uni, type],
  );
  await pg.query(
    "insert into agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,verified_at)values($1,$2,$3,$4,$5,'Synthetic agent',now())",
    [profile, user, uni, application, type],
  );
  if (type === "RIDER")
    await pg.query(
      "insert into rider_presence(rider_profile_id,online,capacity_status,last_seen_at,updated_at)values($1,true,'AVAILABLE',now(),now())",
      [profile],
    );
  return { user, profile, uni };
}
type Rider = Awaited<ReturnType<typeof person>>;
async function journal(
  user: string,
  amount: number,
  key = crypto.randomUUID(),
  code = "RIDER_AVAILABLE",
) {
  const lines = [
    { code: "PAYSTACK_CLEARING", type: "ASSET", direction: "DEBIT", amount },
    { code, type: "LIABILITY", owner: user, direction: "CREDIT", amount },
  ];
  const r = await pg.query<{ id: string }>(
    "select app_private.post_finance_journal($1,'SYNTHETIC_FIXTURE',$2,$2,'Synthetic ledger fixture',$3::jsonb) as id",
    [campus, key, JSON.stringify(lines)],
  );
  return { id: r.rows[0]!.id, lines, key };
}
async function balance(r: Rider, code = "RIDER_AVAILABLE") {
  return Number(
    (
      await pg.query<{ amount: number }>(
        "select app_private.finance_balance($1,$2,$3) as amount",
        [r.uni, r.user, code],
      )
    ).rows[0]!.amount,
  );
}
async function job(r: Rider, method = "CASH", fare = 30000, verified = true) {
  const orderId = crypto.randomUUID(),
    jobId = crypto.randomUUID();
  await pg.query(
    "insert into orders(id,university_id,buyer_user_id,vendor_profile_id,delivery_zone_id,subtotal_kobo,delivery_fee_kobo,status,pricing_formula_version)values($1,$2,$3,$4,$5,100000,$6,'IN_DELIVERY','SYNTHETIC_V1')",
    [orderId, r.uni, buyer, vendor, zone, fare],
  );
  await pg.query(
    "insert into delivery_jobs(id,university_id,order_id,zone_id,rider_profile_id,status,pickup_code_hash,delivery_code_hash,code_expires_at,fare_kobo,rider_earning_kobo,earning_formula_version,fare_payment_method,fare_basis,financial_version,request_posted_at,route_distance_metres)values($1,$2,$3,$4,$5,'PICKED_UP','synthetic-pickup','synthetic-handoff',now()+interval '1 day',$6,$7,'CAMPUS_FARE_V1',$8,'CAMPUS_ZONE','CAMPUS_FARE_V1',now(),$9)",
    [
      jobId,
      r.uni,
      orderId,
      zone,
      r.profile,
      fare,
      (fare * 9) / 10,
      method,
      fare === 30000 ? 700 : ((fare - 30000) / 5000) * 1000 + 1,
    ],
  );
  if (verified) {
    const amount = 100000 + (method === "IN_APP" ? fare : 0),
      reference = "synthetic-" + orderId;
    const lines = [
      { code: "PAYSTACK_CLEARING", type: "ASSET", direction: "DEBIT", amount },
      {
        code: "VENDOR_PENDING",
        type: "LIABILITY",
        owner: vendorUser,
        direction: "CREDIT",
        amount: 100000,
      },
      ...(method === "IN_APP"
        ? [
            {
              code: "DELIVERY_LIABILITY",
              type: "LIABILITY",
              direction: "CREDIT",
              amount: fare,
            },
          ]
        : []),
    ];
    const tx = (
      await pg.query<{ id: string }>(
        "select app_private.post_finance_journal($1,'STORE_ORDER',$2,$3,'Synthetic verified order receipt',$4::jsonb) as id",
        [r.uni, orderId, reference, JSON.stringify(lines)],
      )
    ).rows[0]!.id;
    await pg.query(
      "insert into app_private.commerce_settlements(order_id,university_id,provider_reference,amount_kobo,seller_net_kobo,digital_fare_kobo,cash_fare_kobo,provider_fee_kobo,journal_id)values($1,$2,$3,$4,100000,$5,$6,0,$7)",
      [
        orderId,
        r.uni,
        reference,
        amount,
        method === "IN_APP" ? fare : 0,
        method === "CASH" ? fare : 0,
        tx,
      ],
    );
  }
  return { orderId, jobId };
}
async function complete(r: Rider, j: Awaited<ReturnType<typeof job>>) {
  return (
    await pg.query<{ result: string }>(
      "select app_private.confirm_delivery_completion($1,$2,$3,$4) as result",
      [j.jobId, r.profile, r.user, "synthetic-handoff"],
    )
  ).rows[0]!.result;
}
async function checkout(r: Rider) {
  return (
    await pg.query<{
      id: string;
      amount_kobo: number;
      provider_reference: string;
    }>(
      "select * from app_private.create_rider_commission_checkout($1,$2,$3,$4,$5)",
      [
        crypto.randomUUID(),
        r.profile,
        r.user,
        crypto.randomUUID(),
        "K1-RC-" + crypto.randomUUID(),
      ],
    )
  ).rows[0]!;
}
async function receipt(reference: string, amount: number, fee = 0) {
  return (
    await pg.query<{ result: string }>(
      "select app_private.record_rider_commission_receipt($1,$2,$3,now()) as result",
      [reference, amount, fee],
    )
  ).rows[0]!.result;
}
beforeAll(async () => {
  pg = await createTestDatabase();
  for (const file of [
    "20260912200000_phase_3_commerce_foundation.sql",
    "20260930220000_store_fulfilment_modes.sql",
    "20260930240000_rider_commission_ledger.sql",
    "20260930250000_inclusive_store_quotes.sql",
    "20260930260000_inclusive_tutorial_bookings.sql",
    "20260930270000_verified_kira_subscription.sql",
    "20260930280000_verified_learning_materials.sql",
    "20260930290000_verified_agent_payouts.sql",
    "20261001020000_admin_workspace_extensions.sql",
    "20261001182000_discount_codes_and_newsletter_access.sql",
    "20261001185000_scoped_commerce_discounts.sql",
    "20261001185500_material_discounts.sql",
    "20261001195000_delivery_route_positions.sql",
    "20261003081000_verified_failed_payout_release.sql",
    "20261003120000_configurable_kira_pricing.sql",
    "20261003122000_kira_plan_catalogue.sql",
    "20261003123000_payment_pricing_profiles.sql",
    "20261003124000_payout_fee_components.sql",
    "20261003125000_verified_refund_accounting.sql",
    "20261003126000_tutorial_pricing_context.sql",
    "20261009100000_payment_idempotency_inbox.sql",
    "20261013190000_agent_withdrawal_commission.sql",
    "20261013200000_delivery_checkout_recovery.sql",
    "20261013205000_bachs_bank_details.sql",
    "20261013210000_bachs_agent_banks_and_payouts.sql",
    "20261013213000_payout_reconciliation_schedule.sql",
  ])
    await pg.exec(
      readFileSync(
        new URL("../../database/neon/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  // Reuse the production durable Bachs inbox DDL without replacing the
  // independently tested collection accounting in this finance fixture.
  const bachsCutover=readFileSync(new URL("../../database/neon/migrations/20261010140000_bachs_collection_cutover.sql",import.meta.url),"utf8");
  await pg.exec(bachsCutover.slice(bachsCutover.indexOf("create table if not exists app_private.bachs_webhook_inbox"),bachsCutover.indexOf("create function app_private.bachs_collection_ready")));
  // This fixture intentionally retains pre-customer-surcharge Paystack collection accounting.
  await pg.exec(`create function app_private.collection_paid_price_matches(p_ref text,p_gross bigint,p_fee bigint,p_quote bigint)returns boolean language sql as $$select p_gross=p_quote and p_fee>=0$$;create function app_private.recover_customer_processing_fee(p_ref text,p_gross bigint,p_fee bigint)returns bigint language sql as $$select p_gross$$;`);
  await pg.exec('create view app_private.verified_collection_receipts as select provider_reference from app_private.verified_paystack_receipts');
  for(const file of ['20261014160000_verified_store_payment_recovery.sql','20261014200000_commerce_notifications.sql','20261017120000_campus_release.sql','20261017121000_multi_vendor_checkout.sql'])await pg.exec(readFileSync(new URL('../../database/neon/migrations/'+file,import.meta.url),'utf8'));
  for (const uni of [campus, otherCampus])
    await pg.query(
      "insert into universities(id,name,slug,updated_at)values($1,'Synthetic campus '||$1::uuid::text,$1::uuid::text,now())",
      [uni],
    );
  await person(buyer, campus, "TUTOR");
  const appId = crypto.randomUUID();
  await pg.query(
    "insert into users(id,email,password_hash,updated_at)values($1,'synthetic-vendor@example.invalid','synthetic',now())",
    [vendorUser],
  );
  await pg.query(
    "insert into agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement)values($1,$2,$3,'VENDOR','Synthetic vendor','+2348012345678','Synthetic fixture only')",
    [appId, vendorUser, campus],
  );
  await pg.query(
    "insert into agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,verified_at)values($1,$2,$3,$4,'VENDOR','Synthetic vendor',now())",
    [vendor, vendorUser, campus, appId],
  );
  await pg.query(
    "insert into delivery_zones(id,university_id,name,base_fee_kobo,active)values($1,$2,'Synthetic campus route',30000,true)",
    [zone, campus],
  );
  await pg.query(
    "update delivery_zones set route_distance_metres=700 where id=$1",
    [zone],
  );
  await pg.query("insert into campus_places(id,university_id,name,category,status)values($1,$2,'Synthetic mapped pickup','SERVICE','PUBLISHED')",[vendor,campus]);
  await pg.query(
    "insert into vendor_storefronts(vendor_profile_id,university_id,display_name,description,status,submitted_at,reviewed_by_user_id,reviewed_at,moderated_revision,contact_phone_e164,pickup_location,pickup_place_id,opening_hours)values($1,$2,'Synthetic shop','A synthetic store description','APPROVED',now(),$3,now(),1,'+2348012345678','Approved campus pickup gate',$1,'{\"mon\":\"08:00-17:00\"}'::jsonb)",
    [vendor, campus, buyer],
  );
  await pg.query(
    "insert into product_categories(id,university_id,name,status)values($1,$2,'Synthetic books','APPROVED')",
    [category, campus],
  );
  await pg.query(
    "insert into vendor_products(id,university_id,vendor_profile_id,name,description,category,category_id,price_kobo,stock_quantity,status,reviewed_by_user_id,reviewed_at,moderated_revision,package_weight_grams,package_length_cm,package_width_cm,package_height_cm,bicycle_delivery_eligible)values($1,$2,$3,'Synthetic book','A synthetic product description','Synthetic books',$4,350000,40,'PUBLISHED',$5,now(),1,200,20,15,3,true)",
    [product, campus, vendor, category, buyer],
  );
  await pg.query(
    "insert into operator_roles(user_id,university_id,role)values($1,$2,'FINANCE_REVIEWER')",
    [buyer, campus],
  );
}, 60000);
afterAll(async () => pg?.close());
afterEach(() => vi.unstubAllGlobals());
describe("rider cash commission ledger", () => {
  it("posts balanced immutable journals and rejects changed idempotency payloads", async () => {
    const r = await person(),
      posted = await journal(r.user, 27000);
    const again = await pg.query<{ id: string }>(
      "select app_private.post_finance_journal($1,'SYNTHETIC_FIXTURE',$2,$2,'Synthetic ledger fixture',$3::jsonb) as id",
      [campus, posted.key, JSON.stringify(posted.lines)],
    );
    expect(again.rows[0]!.id).toBe(posted.id);
    expect(await balance(r)).toBe(27000);
    await expect(
      pg.query(
        "select app_private.post_finance_journal($1,'SYNTHETIC_FIXTURE',$2,$2,'Synthetic ledger fixture',$3::jsonb)",
        [
          campus,
          posted.key,
          JSON.stringify(posted.lines.map((l) => ({ ...l, amount: 28000 }))),
        ],
      ),
    ).rejects.toThrow("IDEMPOTENCY");
    await expect(
      pg.query(
        "update ledger_lines set amount_kobo=1 where transaction_id=$1",
        [posted.id],
      ),
    ).rejects.toThrow("append-only");
    await expect(
      pg.query("delete from ledger_transactions where id=$1", [posted.id]),
    ).rejects.toThrow("append-only");
    await expect(
      pg.query(
        "insert into ledger_lines(transaction_id,account_id,direction,amount_kobo) select transaction_id,account_id,direction,amount_kobo from ledger_lines where transaction_id=$1",
        [posted.id],
      ),
    ).rejects.toThrow("UNBALANCED");
    await expect(
      pg.query(
        "select app_private.post_finance_journal($1,'SYNTHETIC_FIXTURE','x',$2,'Bad balance',$3::jsonb)",
        [
          campus,
          crypto.randomUUID(),
          JSON.stringify([{ ...posted.lines[0], amount: 1 }, posted.lines[1]]),
        ],
      ),
    ).rejects.toThrow("INVALID_JOURNAL");
  });
  it("keeps cash out of withdrawable earnings and charges exactly ten percent once", async () => {
    const r = await person(),
      j = await job(r);
    expect(await complete(r, j)).toBe("DELIVERED");
    expect(await complete(r, j)).toBe("INVALID_STATE");
    expect(await balance(r)).toBe(0);
    expect(await balance(r, "RIDER_COMMISSION_RECEIVABLE")).toBe(3000);
    expect(await riderFinanceSummary(env, r.user, campus)).toMatchObject({
      available_kobo: -3000,
      commission_due_kobo: 3000,
      unpaid_commissions: 1,
      cash_collected_kobo: 30000,
      rides_suspended: false,
    });
    expect(
      (
        await pg.query<{ earnings_state: string }>(
          "select earnings_state from delivery_jobs where id=$1",
          [j.jobId],
        )
      ).rows[0]!.earnings_state,
    ).toBe("NOT_EARNED");
    await expect(
      pg.query("update delivery_jobs set financial_version=null where id=$1", [
        j.jobId,
      ]),
    ).rejects.toThrow("IMMUTABLE");
  });
  it("requires verified order funds before settling either a cash or digital fare", async () => {
    const r = await person();
    for (const method of ["CASH", "IN_APP"])
      await expect(
        complete(r, await job(r, method, 30000, false)),
      ).rejects.toThrow("PAYMENT_UNVERIFIED");
    expect(await balance(r)).toBe(0);
    expect(await balance(r, "RIDER_COMMISSION_RECEIVABLE")).toBe(0);
  });
  it("credits digital rider net after handoff and releases it only after the dispute window", async () => {
    const r = await person(),
      j = await job(r, "IN_APP", 45000);
    expect(await complete(r, j)).toBe("DELIVERED");
    expect(await balance(r)).toBe(0);
    expect(await balance(r, "RIDER_PENDING")).toBe(40500);
    await expect(
      pg.query(
        "update delivery_jobs set earnings_state='AVAILABLE' where id=$1",
        [j.jobId],
      ),
    ).rejects.toThrow("NOT_ELIGIBLE");
    await pg.query(
      "update delivery_jobs set delivered_at=now()-interval '49 hours' where id=$1",
      [j.jobId],
    );
    await pg.query(
      "update delivery_jobs set earnings_state='AVAILABLE' where id=$1",
      [j.jobId],
    );
    expect(await balance(r)).toBe(40500);
    expect(await balance(r, "RIDER_PENDING")).toBe(0);
  });
  it("offsets cash commissions from available digital earnings without crediting cash", async () => {
    const r = await person();
    await journal(r.user, 27000);
    await complete(r, await job(r, "CASH", 45000));
    expect(await balance(r)).toBe(22500);
    expect(await balance(r, "RIDER_COMMISSION_RECEIVABLE")).toBe(0);
    expect(await riderFinanceSummary(env, r.user, campus)).toMatchObject({
      unpaid_commissions: 0,
      commission_due_kobo: 0,
      cash_collected_kobo: 45000,
    });
  });
  it("blocks the next ride at four variable unpaid commissions and restores claims after exact repayment", async () => {
    const r = await person();
    for (const fare of [30000, 35000, 40000, 45000])
      await complete(r, await job(r, "CASH", fare));
    expect(await riderFinanceSummary(env, r.user, campus)).toMatchObject({
      available_kobo: -15000,
      unpaid_commissions: 4,
      rides_suspended: true,
    });
    const next = await job(r);
    await pg.query(
      "update delivery_jobs set status='AVAILABLE',rider_profile_id=null where id=$1",
      [next.jobId],
    );
    await pg.query("update orders set status='READY' where id=$1", [
      next.orderId,
    ]);
    await expect(
      pg.query("select * from app_private.reserve_delivery_job($1,$2)", [
        next.jobId,
        r.profile,
      ]),
    ).rejects.toThrow("COMMISSION_LIMIT");
    const blocked = await request(
      "/agents/deliveries/" + next.jobId + "/reserve",
      r.user,
      "POST",
      {},
    );
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({
      error: expect.stringContaining("Four ride commissions"),
    });
    const intent = await checkout(r);
    expect(Number(intent.amount_kobo)).toBe(15000);
    expect(await receipt(intent.provider_reference, 15000, 225)).toBe("PAID");
    expect(await receipt(intent.provider_reference, 15000, 225)).toBe(
      "ALREADY_PAID",
    );
    expect(await balance(r)).toBe(0);
    expect(await balance(r, "RIDER_COMMISSION_RECEIVABLE")).toBe(0);
    expect(await riderFinanceSummary(env, r.user, campus)).toMatchObject({
      unpaid_commissions: 0,
      rides_suspended: false,
    });
    const claimed = await pg.query<{ id: string }>(
      "select * from app_private.reserve_delivery_job($1,$2)",
      [next.jobId, r.profile],
    );
    expect(claimed.rows[0]!.id).toBe(next.jobId);
    await expect(
      pg.query("select * from app_private.reserve_delivery_job($1,$2)", [
        next.jobId,
        r.profile,
      ]),
    ).rejects.toThrow("RIDER_AT_CAPACITY");
  });
  it("holds mismatched verified repayment funds without clearing debt or duplicating received money", async () => {
    const r = await person();
    await complete(r, await job(r));
    const intent = await checkout(r);
    const before = Number(
      (
        await pg.query<{ amount: number }>(
          "select app_private.finance_balance($1,null,'PAYMENT_SUSPENSE') as amount",
          [campus],
        )
      ).rows[0]!.amount,
    );
    expect(await receipt(intent.provider_reference, 2999, 44)).toBe(
      "REQUIRES_REVIEW",
    );
    expect(await receipt(intent.provider_reference, 2999, 44)).toBe(
      "REQUIRES_REVIEW",
    );
    expect(await balance(r, "RIDER_COMMISSION_RECEIVABLE")).toBe(3000);
    expect(
      Number(
        (
          await pg.query<{ amount: number }>(
            "select app_private.finance_balance($1,null,'PAYMENT_SUSPENSE') as amount",
            [campus],
          )
        ).rows[0]!.amount,
      ),
    ).toBe(before + 2999);
    expect(
      (
        await pg.query<{ status: string }>(
          "select status from app_private.rider_commission_checkouts where id=$1",
          [intent.id],
        )
      ).rows[0]!.status,
    ).toBe("REQUIRES_REVIEW");
  });
  it("credits a late repayment safely when earnings have already cleared its snapshot debt", async () => {
    const r = await person();
    await complete(r, await job(r));
    const intent = await checkout(r);
    await journal(r.user, 10000);
    await pg.query("select app_private.offset_rider_commissions($1,$2)", [
      r.user,
      campus,
    ]);
    expect(await balance(r)).toBe(7000);
    await receipt(intent.provider_reference, 3000, 45);
    expect(await balance(r)).toBe(10000);
    await receipt(intent.provider_reference, 3000, 45);
    expect(await balance(r)).toBe(10000);
  });
  it("checks receipt ownership and transaction success instead of API request success", async () => {
    const r = await person();
    await complete(r, await job(r));
    const intent = await checkout(r),
      other = await person();
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            reference: intent.provider_reference,
            currency: "NGN",
            amount: 3000,
            status: "pending",
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(
      (
        await request(
          "/agents/rider-commission-checkout/" + intent.provider_reference,
          other.user,
        )
      ).status,
    ).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      (
        await request(
          "/agents/rider-commission-checkout/" + intent.provider_reference,
          r.user,
        )
      ).status,
    ).toBe(200);
    expect(await balance(r, "RIDER_COMMISSION_RECEIVABLE")).toBe(3000);
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            reference: intent.provider_reference,
            currency: "NGN",
            amount: 3000,
            fees: 45,
            status: "success",
            paid_at: new Date().toISOString(),
          },
        }),
        { status: 200 },
      ),
    );
    expect(
      (
        await request(
          "/agents/rider-commission-checkout/" + intent.provider_reference,
          r.user,
        )
      ).status,
    ).toBe(200);
    expect(await balance(r, "RIDER_COMMISSION_RECEIVABLE")).toBe(0);
  });
  it("initializes exact debt without a customer surcharge and reuses an initialized session", async () => {
    const r = await person();
    await complete(r, await job(r));
    const requestId = crypto.randomUUID();
    const fetcher = vi.fn().mockImplementation(async (_url, options) => {
      const data = JSON.parse(options.body);
      expect(data.amount).toBe(3000);
      expect(data.currency).toBe("NGN");
      return new Response(
        JSON.stringify({
          status: true,
          data: {
            authorization_url: "https://checkout.paystack.com/synthetic",
            access_code: "synthetic-access",
            reference: data.reference,
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const first = await request(
      "/agents/rider-commission-checkout",
      r.user,
      "POST",
      { agentProfileId: r.profile, requestId },
    );
    expect(first.status).toBe(200);
    const again = await request(
      "/agents/rider-commission-checkout",
      r.user,
      "POST",
      { agentProfileId: r.profile, requestId },
    );
    expect(again.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await again.json()).toMatchObject({
      amountKobo: 3000,
      authorizationUrl: "https://checkout.paystack.com/synthetic",
    });
  });
});

const syntheticPolicy = {
  universityId: campus,
  kind: "STORE",
  version: "SYNTHETIC_V1",
  buyerBasisPoints: 0,
  buyerFlatPerItemKobo: 0,
  sellerCommissionBasisPoints: 500,
  collection: {
    basisPoints: 150,
    flatKobo: 10000,
    flatWaivedBelowKobo: 250000,
    capKobo: 200000,
    displayRoundKobo: 100,
  },
  checkoutSavings: true,
  allowProcessorSubsidy: false,
  sourceUrl: "https://paystack.com/pricing",
  approvalNote: "Synthetic approved policy used only for local tests.",
};

async function tutorialFixture() {
  const tutor = await person(undefined, campus, "TUTOR"),
    student = await person();
  const listing = crypto.randomUUID(),
    window = crypto.randomUUID();
  await pg.query(
    "insert into tutorial_listings(id,university_id,tutor_profile_id,course_code,title,description,format,price_kobo,capacity,status,review_status)values($1,$2,$3,'SYN101','Synthetic session','Local financial fixture only','IN_PERSON',350000,5,'PUBLISHED','APPROVED')",
    [listing, campus, tutor.profile],
  );
  await pg.query(
    "insert into tutorial_availability_windows(id,listing_id,starts_at,ends_at,capacity)values($1,$2,now()+interval '1 day',now()+interval '25 hours',5)",
    [window, listing],
  );
  return {
    tutor,
    student,
    listing,
    window,
    input: {
      listingId: listing,
      availabilityWindowId: window,
      requestId: crypto.randomUUID(),
      expectedPriceKobo: 365500,
    },
  };
}
describe("inclusive tutorial booking settlement", () => {
  it("requires an approved policy, keeps the displayed budget and reuses a request without reserving another seat", async () => {
    const f = await tutorialFixture();
    expect(
      (
        await request(
          "/student/tutorial-bookings",
          f.student.user,
          "POST",
          f.input,
        )
      ).status,
    ).toBe(409);
    await json(
      await request("/finance/fee-policies", buyer, "POST", {
        ...syntheticPolicy,
        kind: "TUTORIAL",
      }),
      201,
    );
    expect(
      (
        await request("/student/tutorial-bookings", f.student.user, "POST", {
          ...f.input,
          expectedPriceKobo: 350000,
        })
      ).status,
    ).toBe(409);
    const first = await json(
      await request(
        "/student/tutorial-bookings",
        f.student.user,
        "POST",
        f.input,
      ),
      201,
    );
    const again = await json(
      await request(
        "/student/tutorial-bookings",
        f.student.user,
        "POST",
        f.input,
      ),
      201,
    );
    expect(first).toEqual(again);
    expect(first.amountKobo).toBe(365500);
    expect(
      Number(
        (
          await pg.query<{ n: number }>(
            "select count(*) as n from tutorial_bookings where availability_window_id=$1",
            [f.window],
          )
        ).rows[0]!.n,
      ),
    ).toBe(1);
    expect(
      (
        await request("/student/tutorial-bookings", f.student.user, "POST", {
          ...f.input,
          availabilityWindowId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(
          "/payments/summary?resourceType=TUTORIAL_BOOKING&resourceId=" +
            first.id,
          buyer,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          "/payments/summary?resourceType=TUTORIAL_BOOKING&resourceId=" +
            first.id,
          f.student.user,
          "GET",
          undefined,
          otherCampus,
        )
      ).status,
    ).toBe(404);
    await expect(
      pg.query(
        "update tutorial_bookings set amount_kobo=amount_kobo+1 where id=$1",
        [first.id],
      ),
    ).rejects.toThrow("BOOKING_PRICE_IMMUTABLE");
  });
  it("uses the sealed exact total and verified receipt, credits approved tutor net once and releases after completion plus 48 hours", async () => {
    const f = await tutorialFixture(),
      booking = await json(
        await request(
          "/student/tutorial-bookings",
          f.student.user,
          "POST",
          f.input,
        ),
        201,
      );
    let providerReference = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options?: RequestInit) => {
        if (options?.method === "POST") {
          const body = JSON.parse(String(options.body));
          expect(body.amount).toBe(365500);
          providerReference = body.reference;
          return Response.json({
            status: true,
            data: {
              authorization_url: "https://checkout.paystack.com/synthetic",
              access_code: "synthetic",
              reference: providerReference,
            },
          });
        }
        return Response.json({
          status: true,
          data: {
            reference: providerReference,
            status: "success",
            amount: 365500,
            fees: 15483,
            currency: "NGN",
            domain: "live",
            paid_at: new Date().toISOString(),
          },
        });
      }),
    );
    const initialized = await json(
      await request("/payments/initialize", f.student.user, "POST", {
        resourceType: "TUTORIAL_BOOKING",
        resourceId: booking.id,
        idempotencyKey: "synthetic-" + booking.id,
      }),
    );
    await json(
      await request(
        "/payments/status/" + initialized.reference,
        f.student.user,
      ),
    );
    await json(
      await request(
        "/payments/status/" + initialized.reference,
        f.student.user,
      ),
    );
    expect(await balance(f.tutor, "TUTOR_PENDING")).toBe(332500);
    expect(await balance(f.tutor, "TUTOR_AVAILABLE")).toBe(0);
    expect(
      (
        await pg.query<{ status: string }>(
          "select status from tutorial_bookings where id=$1",
          [booking.id],
        )
      ).rows[0]!.status,
    ).toBe("CONFIRMED");
    await pg.query(
      "update tutorial_bookings set status='COMPLETED',completed_at=now(),dispute_deadline=now()+interval '48 hours',earnings_state='PENDING' where id=$1",
      [booking.id],
    );
    await expect(
      pg.query(
        "update tutorial_bookings set earnings_state='AVAILABLE' where id=$1",
        [booking.id],
      ),
    ).rejects.toThrow("EARNINGS_NOT_ELIGIBLE");
    await pg.query(
      "update tutorial_bookings set completed_at=now()-interval '49 hours',dispute_deadline=now()-interval '1 hour' where id=$1",
      [booking.id],
    );
    await pg.query(
      "update tutorial_bookings set earnings_state='AVAILABLE' where id=$1",
      [booking.id],
    );
    expect(await balance(f.tutor, "TUTOR_PENDING")).toBe(0);
    expect(await balance(f.tutor, "TUTOR_AVAILABLE")).toBe(332500);
    expect(
      (await json(await request("/agents/earnings", f.tutor.user))).tutorials
        .available_kobo,
    ).toBe(332500);
  });
  it("holds a successful payment after booking expiry without activating the tutorial or crediting a tutor", async () => {
    const f = await tutorialFixture(),
      booking = await json(
        await request(
          "/student/tutorial-bookings",
          f.student.user,
          "POST",
          f.input,
        ),
        201,
      ),
      reference = "synthetic-late-tutorial-" + booking.id;
    await pg.query(
      "insert into payment_attempts(user_id,university_id,resource_type,resource_id,provider_reference,amount_kobo,idempotency_key,status)values($1,$2,'TUTORIAL_BOOKING',$3,$4,365500,$4,'INITIALIZED')",
      [f.student.user, campus, booking.id, reference],
    );
    await pg.query(
      "update tutorial_bookings set payment_expires_at=now()-interval '1 hour',status='CANCELLED' where id=$1",
      [booking.id],
    );
    const result = (
      await pg.query<{ result: string }>(
        "select app_private.record_priced_tutorial_receipt($1,365500,15483,now()) as result",
        [reference],
      )
    ).rows[0]!.result;
    expect(result).toBe("REQUIRES_REVIEW");
    expect(await balance(f.tutor, "TUTOR_PENDING")).toBe(0);
    expect(
      (
        await pg.query<{ purpose: string }>(
          "select purpose from app_private.verified_paystack_receipts where provider_reference=$1",
          [reference],
        )
      ).rows[0]!.purpose,
    ).toBe("TUTORIAL_BOOKING");
  });
});
function quoteInput(mode = "RIDER", paymentMethod = "IN_APP") {
  return {
    vendorProfileId: vendor,
    fulfilmentMode: mode,
    deliveryZoneId: mode === "RIDER" ? zone : null,
    deliveryPlaceId:mode==="RIDER"?vendor:null,
    recipientName: "Synthetic buyer",
    recipientPhoneE164: "+2348012345678",
    deliveryLocation: mode === "PICKUP" ? null : "Synthetic hostel gate",
    deliveryPaymentMethod: paymentMethod,
    items: [{ productId: product, quantity: 1, expectedUnitPriceKobo: 365500 }],
    requestId: crypto.randomUUID(),
  };
}
async function json(response: Response, expected = 200) {
  const data = await response.json();
  expect(response.status, JSON.stringify(data)).toBe(expected);
  return data;
}
async function pricedOrder(mode = "RIDER", method = "IN_APP") {
  const data = quoteInput(mode, method),
    q = await json(
      await request("/student/order-quotes", buyer, "POST", data),
      201,
    );
  const o = await json(
    await request("/student/orders", buyer, "POST", {
      ...data,
      quoteId: q.quote.id,
    }),
    201,
  );
  return { input: data, quote: q.quote, order: o };
}
// Historical cash orders must remain payable and settle correctly after new
// cash checkout is disabled. Seed the old database state without the HTTP entry points.
async function legacyCashOrder() {
  const data = storeQuoteSchema.parse(quoteInput('RIDER', 'CASH'));
  const quote = await prepareStoreQuote(env, { id: buyer, universityId: campus, roles: ['STUDENT'], operatorRoles: [] } as unknown as AuthenticatedUser, data);
  const [pickup, delivery] = await Promise.all([deriveHandoffCode(env, quote.id, 'pickup'), deriveHandoffCode(env, quote.id, 'delivery')]);
  await pg.query('select * from app_private.create_priced_store_order($1,$2,$3,$4,$5)', [quote.id, buyer, campus, pickup.hash, delivery.hash]);
  return { input: data, quote, order: { id: quote.id } };
}
describe("approved inclusive store checkout", () => {
  it("keeps checkout gated without an approved policy and restricts approval to the reviewer campus", async () => {
    const catalog = await json(await request("/student/store", buyer));
    expect(catalog.checkoutEnabled).toBe(false);
    expect(
      (await request("/student/order-quotes", buyer, "POST", quoteInput()))
        .status,
    ).toBe(503);
    const preview = await json(
      await request("/finance/fee-policy-preview", buyer, "POST", {
        ...syntheticPolicy,
        samples: [{ baseKobo: 350000, quantity: 1 }],
      }),
    );
    expect(preview.approved).toBe(false);
    expect(preview.listings[0].customerPriceKobo).toBe(365500);
    expect(
      (
        await request("/finance/fee-policies", buyer, "POST", {
          ...syntheticPolicy,
          universityId: otherCampus,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/finance/fee-policies", buyer, "POST", {
          ...syntheticPolicy,
          sellerCommissionBasisPoints: 0,
        })
      ).status,
    ).toBe(400);
    await json(
      await request("/finance/fee-policies", buyer, "POST", syntheticPolicy),
      201,
    );
    const live = await json(await request("/student/store", buyer));
    expect(live.checkoutEnabled).toBe(true);
    expect(
      Number(
        live.products.find((p: { id: string }) => p.id === product).price_kobo,
      ),
    ).toBe(365500);
    expect(Number(live.deliveryZones[0].base_fee_kobo)).toBe(0);
    expect(live.deliveryZones[0].distance_basis).toBe("QUOTE_REQUIRED");
  });
  it("rejects new cash quotes and orders before reserving stock or creating a quote", async () => {
    const before = (await pg.query('select (select count(*) from app_private.store_checkout_quotes) as quotes,(select count(*) from public.orders) as orders,(select stock_quantity from vendor_products where id=$1) as stock', [product])).rows[0];
    for (const path of ['/student/order-quotes', '/student/orders']) {
      const response = await request(path, buyer, 'POST', quoteInput('RIDER', 'CASH'));
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).toContain('Pay for items and delivery in the app.');
    }
    expect((await pg.query('select (select count(*) from app_private.store_checkout_quotes) as quotes,(select count(*) from public.orders) as orders,(select stock_quantity from vendor_products where id=$1) as stock', [product])).rows[0]).toEqual(before);
  });
  it("includes the rider fare in the in-app total and reserves stock once across retries", async () => {
    const data = quoteInput("RIDER", "IN_APP");
    const before = (
      await pg.query<{ stock_quantity: number }>(
        "select stock_quantity from vendor_products where id=$1",
        [product],
      )
    ).rows[0]!.stock_quantity;
    const first = await json(
        await request("/student/order-quotes", buyer, "POST", data),
        201,
      ),
      again = await json(
        await request("/student/order-quotes", buyer, "POST", data),
        201,
      );
    expect(first.quote.id).toBe(again.quote.id);
    expect(first.quote.pricing).toMatchObject({
      listedItemsKobo: 365500,
      discountKobo: 0,
      fareKobo: 50000,
      payableKobo: 415500,
      cashDueKobo: 0,
      totalKobo: 415500,
    });
    for (const hidden of [
      "sellerNetKobo",
      "estimatedProcessingKobo",
      "sellerCommissionKobo",
      "buyerComponentKobo",
    ])
      expect(JSON.stringify(first)).not.toContain(hidden);
    expect(
      (
        await request("/student/order-quotes", buyer, "POST", {
          ...data,
          recipientName: "Changed name",
        })
      ).status,
    ).toBe(409);
    const created = await json(
      await request("/student/orders", buyer, "POST", {
        ...data,
        quoteId: first.quote.id,
      }),
      201,
    );
    const retried = await json(
      await request("/student/orders", buyer, "POST", {
        ...data,
        quoteId: first.quote.id,
      }),
      201,
    );
    expect(created.id).toBe(retried.id);
    expect(
      (
        await request("/student/orders", buyer, "POST", {
          ...data,
          quoteId: first.quote.id,
          recipientName: "Changed after quote",
        })
      ).status,
    ).toBe(409);
    expect(created).toMatchObject({
      totalKobo: 415500,
      payableKobo: 415500,
      cashDueKobo: 0,
    });
    expect(
      (
        await pg.query<{ stock_quantity: number }>(
          "select stock_quantity from vendor_products where id=$1",
          [product],
        )
      ).rows[0]!.stock_quantity,
    ).toBe(before - 1);
    const foreign = await person();
    expect(
      (
        await request("/student/orders", foreign.user, "POST", {
          ...data,
          quoteId: first.quote.id,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await pg.query<{ fare_payment_method: string }>(
          "select fare_payment_method from delivery_jobs where order_id=$1",
          [created.id],
        )
      ).rows[0]!.fare_payment_method,
    ).toBe("IN_APP");
  });
  it("refuses stale catalogue prices and price changes between quote and reservation", async () => {
    expect(
      (
        await request("/student/order-quotes", buyer, "POST", {
          ...quoteInput(),
          items: [
            { productId: product, quantity: 1, expectedUnitPriceKobo: 350000 },
          ],
        })
      ).status,
    ).toBe(409);
    const input = quoteInput("PICKUP"),
      q = await json(
        await request("/student/order-quotes", buyer, "POST", input),
        201,
      );
    await pg.query("update vendor_products set price_kobo=400000 where id=$1", [
      product,
    ]);
    expect(
      (
        await request("/student/orders", buyer, "POST", {
          ...input,
          quoteId: q.quote.id,
        })
      ).status,
    ).toBe(409);
    expect(
      (await pg.query("select id from orders where id=$1", [q.quote.id])).rows,
    ).toHaveLength(0);
    await pg.query("update vendor_products set price_kobo=350000 where id=$1", [
      product,
    ]);
    await pg.query(
      "update vendor_products set status='PUBLISHED',reviewed_at=now(),reviewed_by_user_id=$2,moderated_revision=listing_revision where id=$1",
      [product, buyer],
    );
  });
  it("retains the quoted digital amount and idempotent settlement for pre-existing cash orders", async () => {
    const prepared = await legacyCashOrder();
    const fetcher = vi.fn().mockImplementation(async (url, options) => {
      expect(url).toContain("/transaction/initialize");
      const data = JSON.parse(options.body);
      expect(data.amount).toBe(365500);
      return Response.json({
        status: true,
        data: {
          reference: data.reference,
          authorization_url: "https://checkout.paystack.com/synthetic",
          access_code: "synthetic",
        },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const initialized = await json(
      await request("/payments/initialize", buyer, "POST", {
        resourceType: "STORE_ORDER",
        resourceId: prepared.order.id,
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    const summary = await json(
      await request(
        "/payments/summary?resourceType=STORE_ORDER&resourceId=" +
          prepared.order.id,
        buyer,
      ),
    );
    expect(Number(summary.payment.amount_kobo)).toBe(365500);
    expect(Number(summary.payment.cash_due_kobo)).toBe(50000);
    fetcher.mockImplementation(async () =>
      Response.json({
        status: true,
        data: {
          reference: initialized.reference,
          currency: "NGN",
          amount: 365500,
          fees: 15483,
          paid_at: new Date().toISOString(),
          status: "success",
        },
      }),
    );
    expect(
      (
        await json(
          await request("/payments/status/" + initialized.reference, buyer),
        )
      ).payment.status,
    ).toBe("SUCCEEDED");
    const counts = (
      await pg.query<{ count: number }>(
        "select count(*)::int as count from ledger_transactions",
      )
    ).rows[0]!.count;
    expect(
      (
        await json(
          await request("/payments/status/" + initialized.reference, buyer),
        )
      ).payment.status,
    ).toBe("SUCCEEDED");
    expect(
      (
        await pg.query<{ count: number }>(
          "select count(*)::int as count from ledger_transactions",
        )
      ).rows[0]!.count,
    ).toBe(counts);
    expect(
      (
        await pg.query<{ status: string }>(
          "select status from orders where id=$1",
          [prepared.order.id],
        )
      ).rows[0]!.status,
    ).toBe("PAID");
    expect(
      (
        await pg.query<{ request_posted_at: unknown }>(
          "select request_posted_at from delivery_jobs where order_id=$1",
          [prepared.order.id],
        )
      ).rows[0]!.request_posted_at,
    ).toBeNull();
    const settled = (
      await pg.query<{
        seller_net_kobo: number;
        cash_fare_kobo: number;
        digital_fare_kobo: number;
        provider_fee_kobo: number;
      }>("select * from app_private.commerce_settlements where order_id=$1", [
        prepared.order.id,
      ])
    ).rows[0]!;
    expect(settled).toMatchObject({
      seller_net_kobo: 332500,
      cash_fare_kobo: 50000,
      digital_fare_kobo: 0,
      provider_fee_kobo: 15483,
    });
    const r = await person();
    for (const status of ["ACCEPTED", "READY"])
      await json(
        await request(
          `/agents/orders/${prepared.order.id}/status`,
          vendorUser,
          "PATCH",
          { status },
        ),
      );
    await json(
      await request(
        `/agents/orders/${prepared.order.id}/rider-request`,
        vendorUser,
        "POST",
        {},
      ),
    );
    const delivery = (
      await pg.query<{ id: string }>(
        "select id from delivery_jobs where order_id=$1",
        [prepared.order.id],
      )
    ).rows[0]!;
    await json(
      await request(
        `/agents/deliveries/${delivery.id}/reserve`,
        r.user,
        "POST",
        {},
      ),
    );
    await json(
      await request(
        `/agents/deliveries/${delivery.id}/pickup`,
        r.user,
        "POST",
        {
          code: (await deriveHandoffCode(env, prepared.order.id, "pickup"))
            .code,
        },
      ),
    );
    await json(
      await request(
        `/agents/deliveries/${delivery.id}/complete`,
        r.user,
        "POST",
        {
          code: (await deriveHandoffCode(env, prepared.order.id, "delivery"))
            .code,
        },
      ),
    );
    expect(await balance(r, "RIDER_COMMISSION_RECEIVABLE")).toBe(0);
    expect(await balance(r)).toBe(0);
  });
  it("holds funds for expired orders and successful second payments for review without funding the seller twice", async () => {
    const expired = await pricedOrder("PICKUP");
    const reference = "K1-O-" + crypto.randomUUID();
    await pg.query(
      "insert into payment_attempts(id,user_id,university_id,resource_type,resource_id,provider_reference,amount_kobo,idempotency_key,status)values($1,$2,$3,'STORE_ORDER',$4,$5,$6,$1::uuid::text,'INITIALIZED')",
      [
        crypto.randomUUID(),
        buyer,
        campus,
        expired.order.id,
        reference,
        expired.order.payableKobo,
      ],
    );
    await pg.query(
      "update inventory_reservations set expires_at=now()-interval '1 minute' where order_id=$1",
      [expired.order.id],
    );
    const before = Number(
      (
        await pg.query<{ amount: number }>(
          "select app_private.finance_balance($1,null,'PAYMENT_SUSPENSE') as amount",
          [campus],
        )
      ).rows[0]!.amount,
    );
    expect(
      (
        await pg.query<{ result: string }>(
          "select app_private.record_priced_store_receipt($1,$2,15483,now()) as result",
          [reference, 365500],
        )
      ).rows[0]!.result,
    ).toBe("REQUIRES_REVIEW");
    expect(
      Number(
        (
          await pg.query<{ amount: number }>(
            "select app_private.finance_balance($1,null,'PAYMENT_SUSPENSE') as amount",
            [campus],
          )
        ).rows[0]!.amount,
      ),
    ).toBe(before + 365500);
    expect(
      (
        await pg.query(
          "select * from app_private.commerce_settlements where order_id=$1",
          [expired.order.id],
        )
      ).rows,
    ).toHaveLength(0);
    const paid = await pricedOrder("PICKUP");
    const refs = ["K1-O-" + crypto.randomUUID(), "K1-O-" + crypto.randomUUID()];
    await pg.query(
      "insert into payment_attempts(id,user_id,university_id,resource_type,resource_id,provider_reference,amount_kobo,idempotency_key,status)values($1,$2,$3,'STORE_ORDER',$4,$5,365500,$1::uuid::text,'INITIALIZED')",
      [crypto.randomUUID(), buyer, campus, paid.order.id, refs[0]],
    );
    expect(
      (
        await pg.query<{ result: string }>(
          "select app_private.record_priced_store_receipt($1,365500,15483,now()) as result",
          [refs[0]],
        )
      ).rows[0]!.result,
    ).toBe("PAID");
    await pg.query(
      "insert into payment_attempts(id,user_id,university_id,resource_type,resource_id,provider_reference,amount_kobo,idempotency_key,status)values($1,$2,$3,'STORE_ORDER',$4,$5,365500,$1::uuid::text,'INITIALIZED')",
      [crypto.randomUUID(), buyer, campus, paid.order.id, refs[1]],
    );
    expect(
      (
        await pg.query<{ result: string }>(
          "select app_private.record_priced_store_receipt($1,365500,15483,now()) as result",
          [refs[1]],
        )
      ).rows[0]!.result,
    ).toBe("REQUIRES_REVIEW");
    expect(
      (
        await pg.query(
          "select * from app_private.commerce_settlements where order_id=$1",
          [paid.order.id],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      Number(
        (
          await pg.query<{ amount: number }>(
            "select app_private.finance_balance($1,null,'PAYMENT_SUSPENSE') as amount",
            [campus],
          )
        ).rows[0]!.amount,
      ),
    ).toBe(before + 731000);
  });
  it("stages an official fee check without silently changing approved prices", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            "<p>1.5% + NGN 100; under NGN 2,500; capped at NGN 2,000</p>",
          ),
        ),
    );
    const check = await json(
      await request("/finance/check-published-fees", buyer, "POST", {
        universityId: campus,
      }),
    );
    expect(check).toMatchObject({
      status: "BASELINE_FOUND",
      approvalRequired: true,
    });
    const policies = await json(
      await request("/finance/fee-policies?universityId=" + campus, buyer),
    );
    expect(
      policies.policies.filter((p: { kind: string }) => p.kind === "STORE"),
    ).toHaveLength(1);
  });
});

async function kiraCheckout(user: string, body: {requestId: string;consent: boolean;expectedAmountKobo?: number;discountCode?: string}) {
  if (!body.consent) return request('/ai/subscription-checkout',user,'POST',{...body,expectedAmountKobo:body.expectedAmountKobo??600000});
  const quoted=await request('/ai/subscription-quote',user,'POST',{tier:'pro',requestId:body.requestId,discountCode:body.discountCode??''});
  if(!quoted.ok)return quoted;
  const {quote}=await quoted.json() as {quote:{quoteId:string;amountKobo:number}};
  return request('/ai/subscription-checkout',user,'POST',{...body,tier:'pro',quoteId:quote.quoteId,expectedAmountKobo:body.expectedAmountKobo??quote.amountKobo});
}

describe("fixed-price verified Kira monthly access", () => {
  it("requires approval, a subscription switch, explicit checkout consent and an owned campus", async () => {
    const student = await person();
    const before = await json(await request("/ai/subscription", student.user));
    expect(before.subscription).toMatchObject({
      checkoutEnabled: false,
      amountKobo: 600000,
      autoRenew: false,
    });
    expect(
      (
        await kiraCheckout(student.user, {
          requestId: crypto.randomUUID(),
          consent: true,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await kiraCheckout(student.user, {
          requestId: crypto.randomUUID(),
          consent: false,
        })
      ).status,
    ).toBe(400);
    const approved = await json(
      await request("/finance/kira-plans", buyer, "POST", {
        universityId: campus,
        version: "SYNTHETIC_V1",
        collection: {...syntheticPolicy.collection,displayRoundKobo:undefined},
        sourceUrl: syntheticPolicy.sourceUrl,
        approvalNote: "Synthetic fixture only; no merchant approval.",
      }),
      201,
    );
    expect(approved.price).toMatchObject({
      customerPriceKobo: 600000,
      estimatedProcessingKobo: 19000,
      estimatedNetKobo: 581000,
    });
    expect(
      (
        await request(
          "/ai/subscription",
          student.user,
          "GET",
          undefined,
          otherCampus,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await json(
          await request(
            "/ai/subscription",
            student.user,
            "GET",
            undefined,
            otherCampus,
          ),
        )
      ).subscription.checkoutEnabled,
    ).toBe(false);
  });
  it("charges exactly ₦6,000, reuses checkout and activates one calendar month only after a successful server receipt", async () => {
    const student = await person(),
      requestId = crypto.randomUUID();
    let reference = "",
      paid = false;
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        const body = JSON.parse(String(options.body));
        expect(body.amount).toBe(600000);
        expect(body.currency).toBe("NGN");
        reference = body.reference;
        return Response.json({
          status: true,
          data: {
            authorization_url: "https://checkout.paystack.com/synthetic",
            access_code: "synthetic",
            reference,
          },
        });
      }
      return Response.json({
        status: true,
        data: {
          reference,
          amount: 600000,
          currency: "NGN",
          status: paid ? "success" : "pending",
          fees: paid ? 19000 : null,
          paid_at: paid ? new Date().toISOString() : null,
          domain: "live",
        },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const initialized = await json(
      await kiraCheckout(student.user, {
        requestId,
        consent: true,
      }),
    );
    expect(
      (
        await json(
          await kiraCheckout(student.user, {
            requestId,
            consent: true,
          }),
        )
      ).reference,
    ).toBe(initialized.reference);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await json(await request("/ai/status", student.user))).tier).toBe(
      "standard",
    );
    expect((await request("/payments/status/" + reference, buyer)).status).toBe(
      404,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    await json(await request("/payments/status/" + reference, student.user));
    expect((await json(await request("/ai/status", student.user))).tier).toBe(
      "standard",
    );
    paid = true;
    await json(await request("/payments/status/" + reference, student.user));
    expect((await json(await request("/ai/status", student.user))).tier).toBe(
      "pro",
    );
    const period = (
      await pg.query<{ starts_at: string; ends_at: string }>(
        "select starts_at,ends_at from app_private.kira_billing_periods where user_id=$1",
        [student.user],
      )
    ).rows[0]!;
    expect(
      Date.parse(period.ends_at) - Date.parse(period.starts_at),
    ).toBeGreaterThanOrEqual(28 * 86400000);
    await json(await request("/payments/status/" + reference, student.user));
    expect(
      Number(
        (
          await pg.query<{ n: number }>(
            "select count(*) as n from app_private.kira_billing_periods where user_id=$1",
            [student.user],
          )
        ).rows[0]!.n,
      ),
    ).toBe(1);
    expect(
      (
        await kiraCheckout(student.user, {
          requestId: crypto.randomUUID(),
          consent: true,
        })
      ).status,
    ).toBe(409);
    await expect(
      pg.query(
        "update app_private.kira_billing_periods set ends_at=ends_at+interval '1 month' where user_id=$1",
        [student.user],
      ),
    ).rejects.toThrow();
  });
  it("extends the existing paid period on an eligible manual renewal without consuming a free-use counter", async () => {
    const student = await person(),
      firstReference = "K1-AI-" + crypto.randomUUID();
    const first = (
      await pg.query<{ id: string }>(
        "select * from app_private.create_kira_checkout($1,$2,$3,$4,$5)",
        [
          crypto.randomUUID(),
          student.user,
          campus,
          crypto.randomUUID(),
          firstReference,
        ],
      )
    ).rows[0]!;
    await pg.query(
      "select app_private.record_kira_receipt($1,600000,19000,now())",
      [firstReference],
    );
    await pg.query(
      "update app_private.ai_subscriptions set current_period_end=now()+interval '3 days' where user_id=$1",
      [student.user],
    );
    const old = (
      await pg.query<{ current_period_end: string }>(
        "select current_period_end from app_private.ai_subscriptions where user_id=$1",
        [student.user],
      )
    ).rows[0]!.current_period_end;
    const reference = "K1-AI-" + crypto.randomUUID();
    await pg.query(
      "select * from app_private.create_kira_checkout($1,$2,$3,$4,$5)",
      [
        crypto.randomUUID(),
        student.user,
        campus,
        crypto.randomUUID(),
        reference,
      ],
    );
    await pg.query(
      "select app_private.record_kira_receipt($1,600000,19000,now())",
      [reference],
    );
    const next = (
      await pg.query<{ starts_at: string }>(
        "select starts_at from app_private.kira_billing_periods where provider_reference=$1",
        [reference],
      )
    ).rows[0]!.starts_at;
    expect(Date.parse(next)).toBe(Date.parse(old));
    expect(
      Number(
        (
          await pg.query<{ n: number }>(
            "select count(*) as n from app_private.ai_requests where user_id=$1",
            [student.user],
          )
        ).rows[0]!.n,
      ),
    ).toBe(0);
    await expect(
      pg.query(
        "update app_private.kira_checkouts set amount_kobo=599900 where id=$1",
        [first.id],
      ),
    ).rejects.toThrow();
  });
  it("holds wrong-total and expired successful payments without granting access, and exposes actual-fee reconciliation", async () => {
    for (const late of [false, true]) {
      const student = await person(),
        reference = "K1-AI-" + crypto.randomUUID();
      await pg.query(
        "select * from app_private.create_kira_checkout($1,$2,$3,$4,$5)",
        [
          crypto.randomUUID(),
          student.user,
          campus,
          crypto.randomUUID(),
          reference,
        ],
      );
      if (late)
        await pg.query(
          "update app_private.kira_checkouts set expires_at=now()-interval '1 hour' where provider_reference=$1",
          [reference],
        );
      expect(
        (
          await pg.query<{ result: string }>(
            "select app_private.record_kira_receipt($1,$2,19000,now()) as result",
            [reference, late ? 600000 : 600001],
          )
        ).rows[0]!.result,
      ).toBe("REQUIRES_REVIEW");
      expect((await json(await request("/ai/status", student.user))).tier).toBe(
        "standard",
      );
    }
    const receipts = await json(await request("/finance/receipts", buyer));
    expect(
      receipts.receipts.some(
        (r: {
          purpose: string;
          allocated: boolean;
          estimated_processing_kobo: string;
        }) =>
          r.purpose === "KIRA_SUBSCRIPTION" &&
          r.allocated &&
          Number(r.estimated_processing_kobo) === 19000,
      ),
    ).toBe(true);
  });
});

describe('versioned Kira prices and percentage offers', () => {
  const approve = async (amountKobo: number, discountPercent: number) => json(await request('/finance/kira-plans', buyer, 'POST', {
    universityId: campus, version: 'SYNTHETIC_OFFER_' + crypto.randomUUID(), amountKobo, discountPercent,
    collection: syntheticPolicy.collection, sourceUrl: syntheticPolicy.sourceUrl, approvalNote: 'Isolated configurable price fixture; no production price change.',
  }), 201);
  it('shows the offer, preserves an older checkout, and prevents a changed total from opening Paystack', async () => {
    const older = await person(), current = await person();
    await approve(600000, 0);
    const oldRequest = crypto.randomUUID();
    const oldIntent = (await pg.query<{amount_kobo: number}>('select * from app_private.create_kira_checkout($1,$2,$3,$4,$5)', [crypto.randomUUID(),older.user,campus,oldRequest,'SYNTHETIC_OLD_' + crypto.randomUUID()])).rows[0]!;
    expect(oldIntent.amount_kobo).toBe(600000);
    const approval = await approve(800000, 25);
    expect(approval.price).toMatchObject({listedAmountKobo:800000,discountPercent:25,customerPriceKobo:600000,discountKobo:200000});
    const visible = await json(await request('/ai/subscription', current.user));
    expect(visible.subscription).toMatchObject({listedAmountKobo:800000,discountPercent:25,amountKobo:600000,checkoutEnabled:true});
    const previous = await json(await request('/ai/subscription', older.user));
    expect(previous.subscription.checkout).toMatchObject({listed_amount_kobo:600000,offer_discount_percent:0,amount_kobo:600000});
    const fetcher = vi.fn(); vi.stubGlobal('fetch',fetcher);
    const blocked = await kiraCheckout(current.user, {requestId:crypto.randomUUID(),consent:true,expectedAmountKobo:800000});
    expect(blocked.status).toBe(409);
    expect(fetcher).not.toHaveBeenCalled();
    const refreshed = await json(await request('/ai/subscription', current.user));
    expect(refreshed.subscription.checkout).toBeNull();
    await expect(pg.query('update app_private.kira_price_plans set discount_percent=10 where id=$1',[approval.id])).rejects.toThrow(/append-only/);
    await expect(pg.query('update app_private.kira_checkouts set offer_discount_percent=10 where user_id=$1',[older.user])).rejects.toThrow(/SNAPSHOT_IMMUTABLE/);
  });
  it('charges the configured discounted total once and activates the verified paid month', async () => {
    await approve(1000000, 30);
    const student = await person(), requestId = crypto.randomUUID();
    let reference = '';
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body));
      expect(body.amount).toBe(700000); expect(body.bearer).toBe('account');
      reference = body.reference;
      return Response.json({status:true,data:{authorization_url:'https://checkout.paystack.com/synthetic-offer',access_code:'synthetic-offer',reference}});
    });
    vi.stubGlobal('fetch',fetcher);
    const body = {requestId,consent:true,expectedAmountKobo:700000};
    const initialized = await json(await kiraCheckout(student.user,body));
    expect(initialized.amountKobo).toBe(700000);
    expect((await json(await kiraCheckout(student.user,body))).reference).toBe(reference);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await pg.query<{result: string}>('select app_private.record_kira_receipt($1,$2,$3,now()) as result',[reference,700000,20500])).rows[0]!.result).toBe('PAID');
    expect((await pg.query<{result: string}>('select app_private.record_kira_receipt($1,$2,$3,now()) as result',[reference,700000,20500])).rows[0]!.result).toBe('ALREADY_PAID');
    expect((await json(await request('/ai/status',student.user))).tier).toBe('pro');
  });
  it('rejects stacked codes and unauthorized approvals, and discounts a custom price in integer kobo', async () => {
    const student = await person();
    expect((await request('/finance/kira-plans',student.user,'POST',{universityId:campus,version:'UNAUTHORIZED',amountKobo:1000000,discountPercent:25,collection:syntheticPolicy.collection,sourceUrl:syntheticPolicy.sourceUrl,approvalNote:'No privileged role assigned.'})).status).toBe(403);
    expect((await kiraCheckout(student.user,{requestId:crypto.randomUUID(),consent:true,discountCode:'EXTRA20',expectedAmountKobo:560000})).status).toBe(409);
    const custom = await approve(100001, 33);
    expect(custom.price.customerPriceKobo).toBe(67001);
    const row = (await pg.query<{amount_kobo:number;listed_amount_kobo:number}>('select * from app_private.create_kira_checkout($1,$2,$3,$4,$5)',[crypto.randomUUID(),student.user,campus,crypto.randomUUID(),'SYNTHETIC_CUSTOM_' + crypto.randomUUID()])).rows[0]!;
    expect(row).toMatchObject({amount_kobo:67001,listed_amount_kobo:100001});
    await approve(600000, 0);
  });
});

async function materialFixture() {
  const tutor = await person(undefined, campus, "TUTOR"),
    student = await person(),
    resource = crypto.randomUUID(),
    media = crypto.randomUUID();
  await pg.query(
    "insert into media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name)values($1,$2,$3,'resource',$1::uuid::text,'application/pdf',123,'synthetic-learning.pdf')",
    [media, tutor.user, campus],
  );
  await pg.query(
    "insert into tutorial_resources(id,university_id,tutor_profile_id,course_code,title,description,resource_type,access_model,price_kobo,publisher_name,status,media_object_id)values($1,$2,$3,'SYN101','Synthetic material','Local financial fixture only','PDF','PAID',50000,'Synthetic tutor','PUBLISHED',$4)",
    [resource, campus, tutor.profile, media],
  );
  return {
    tutor,
    student,
    resource,
    media,
    input: {
      resourceId: resource,
      requestId: crypto.randomUUID(),
      expectedPriceKobo: 50800,
    },
  };
}
async function materialPurchase(
  f: Awaited<ReturnType<typeof materialFixture>>,
) {
  const quote = await json(
    await request("/materials/quote", f.student.user, "POST", f.input),
  );
  const purchase = await json(
    await request("/materials/purchases", f.student.user, "POST", {
      quoteId: quote.quote.id,
    }),
    201,
  );
  return { quote: quote.quote, purchase: purchase.purchase };
}
describe("verified learning-material purchases and private access", () => {
  it("publishes an inclusive price, hides internal fees, isolates quote ownership and reuses a purchase", async () => {
    const f = await materialFixture(),
      catalog = await json(await request("/student/tutorials", f.student.user));
    expect(
      catalog.resources.find((r: { id: string }) => r.id === f.resource),
    ).toMatchObject({ price_kobo: 50800, pricing_ready: true, file_url: null });
    expect(
      (
        await request("/materials/quote", f.student.user, "POST", {
          ...f.input,
          expectedPriceKobo: 50000,
        })
      ).status,
    ).toBe(409);
    const saved = await materialPurchase(f);
    expect(saved.quote).toMatchObject({ priceKobo: 50800, amountKobo: 50800 });
    for (const field of [
      "baseKobo",
      "sellerNetKobo",
      "estimatedProcessingKobo",
      "policyId",
    ])
      expect(JSON.stringify(saved.quote)).not.toContain(field);
    expect(
      (
        await json(
          await request("/materials/purchases", f.student.user, "POST", {
            quoteId: saved.quote.id,
          }),
          201,
        )
      ).purchase.id,
    ).toBe(saved.purchase.id);
    expect(
      (
        await request("/materials/purchases", buyer, "POST", {
          quoteId: saved.quote.id,
        })
      ).status,
    ).toBe(409);
    expect(
      (await json(await request("/materials/purchases", buyer))).purchases.some(
        (p: { id: string }) => p.id === saved.purchase.id,
      ),
    ).toBe(false);
    expect(
      (
        await json(
          await request(
            "/materials/purchases",
            f.student.user,
            "GET",
            undefined,
            otherCampus,
          ),
        )
      ).purchases,
    ).toHaveLength(0);
    expect(
      (
        await request(
          "/media/" + f.media + "/access",
          f.student.user,
          "POST",
          {},
        )
      ).status,
    ).toBe(403);
    await expect(
      pg.query(
        "update app_private.tutorial_material_purchases set amount_kobo=amount_kobo+1 where id=$1",
        [saved.purchase.id],
      ),
    ).rejects.toThrow("PURCHASE_SNAPSHOT_IMMUTABLE");
  });
  it("unlocks only the purchased private file after exact verified payment and pauses access/earnings for an owned report", async () => {
    const f = await materialFixture(),
      saved = await materialPurchase(f);
    let reference = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options?: RequestInit) => {
        if (options?.method === "POST") {
          const body = JSON.parse(String(options.body));
          expect(body.amount).toBe(50800);
          reference = body.reference;
          return Response.json({
            status: true,
            data: {
              reference,
              authorization_url: "https://checkout.paystack.com/synthetic",
              access_code: "synthetic",
            },
          });
        }
        return Response.json({
          status: true,
          data: {
            reference,
            status: "success",
            amount: 50800,
            currency: "NGN",
            fees: 762,
            domain: "live",
            paid_at: new Date().toISOString(),
          },
        });
      }),
    );
    await json(
      await request(
        "/materials/purchases/" + saved.purchase.id + "/payment",
        f.student.user,
        "POST",
        { requestId: crypto.randomUUID() },
      ),
    );
    await json(await request("/payments/status/" + reference, f.student.user));
    await json(await request("/payments/status/" + reference, f.student.user));
    expect(await balance(f.tutor, "TUTOR_PENDING")).toBe(47500);
    const access = await json(
      await request(
        "/media/" + f.media + "/access",
        f.student.user,
        "POST",
        {},
      ),
    );
    expect(access.expiresIn).toBe(90);
    expect(
      (await request("/media/" + f.media + "/access", buyer, "POST", {}))
        .status,
    ).toBe(403);
    expect(
      (
        await json(
          await request(
            "/student/tutorial-resources/" + f.resource,
            f.student.user,
          ),
        )
      ).resource,
    ).toMatchObject({ can_access: true, media_object_id: f.media });
    const reported = await json(
      await request(
        "/materials/purchases/" + saved.purchase.id + "/dispute",
        f.student.user,
        "POST",
        { reason: "Synthetic report for the purchased resource." },
      ),
      201,
    );
    expect(
      (
        await json(
          await request(
            "/materials/purchases/" + saved.purchase.id + "/dispute",
            f.student.user,
            "POST",
            { reason: "Retry the same report safely." },
          ),
          201,
        )
      ).id,
    ).toBe(reported.id);
    expect(
      (
        await request(
          "/media/" + f.media + "/access",
          f.student.user,
          "POST",
          {},
        )
      ).status,
    ).toBe(403);
    await expect(
      pg.query(
        "update app_private.tutorial_material_purchases set earnings_state='AVAILABLE' where id=$1",
        [saved.purchase.id],
      ),
    ).rejects.toThrow("EARNINGS_NOT_ELIGIBLE");
    await json(
      await request(
        "/v1/admin/operations/disputes/" + reported.id + "/review",
        buyer,
        "POST",
        {
          status: "RESOLVED",
          resolutionCode: "NO_ACTION",
          note: "Synthetic review restores the paid resource; earnings retain the seven-day hold.",
        },
      ),
    );
    expect(
      (
        await request(
          "/media/" + f.media + "/access",
          f.student.user,
          "POST",
          {},
        )
      ).status,
    ).toBe(200);
    expect(await balance(f.tutor, "TUTOR_AVAILABLE")).toBe(0);
    await pg.query(
      "update app_private.tutorial_material_purchases set release_at=now()-interval '1 hour' where id=$1",
      [saved.purchase.id],
    );
    await pg.query("select app_private.release_due_material_earnings($1)", [
      campus,
    ]);
    await pg.query("select app_private.release_due_material_earnings($1)", [
      campus,
    ]);
    expect(await balance(f.tutor, "TUTOR_PENDING")).toBe(0);
    expect(await balance(f.tutor, "TUTOR_AVAILABLE")).toBe(47500);
  });
  it("rejects a changed file or base price before purchase and holds late successful funds without access", async () => {
    const f = await materialFixture(),
      quote = await json(
        await request("/materials/quote", f.student.user, "POST", f.input),
      );
    await pg.query(
      "update tutorial_resources set price_kobo=60000 where id=$1",
      [f.resource],
    );
    expect(
      (
        await request("/materials/purchases", f.student.user, "POST", {
          quoteId: quote.quote.id,
        })
      ).status,
    ).toBe(409);
    const fileChanged = await materialFixture(),
      fileQuote = await json(
        await request(
          "/materials/quote",
          fileChanged.student.user,
          "POST",
          fileChanged.input,
        ),
      ),
      replacementMedia = crypto.randomUUID();
    await pg.query(
      "insert into media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name)values($1,$2,$3,'resource',$1::uuid::text,'application/pdf',123,'synthetic-replacement.pdf')",
      [replacementMedia, fileChanged.tutor.user, campus],
    );
    await pg.query(
      "update tutorial_resources set media_object_id=$1 where id=$2",
      [replacementMedia, fileChanged.resource],
    );
    expect(
      (
        await request(
          "/materials/purchases",
          fileChanged.student.user,
          "POST",
          { quoteId: fileQuote.quote.id },
        )
      ).status,
    ).toBe(409);
    const late = await materialFixture(),
      saved = await materialPurchase(late),
      reference = "K1-L-" + crypto.randomUUID();
    await pg.query(
      "select * from app_private.prepare_material_payment($1,$2,$3,$4,$5,$6)",
      [
        crypto.randomUUID(),
        saved.purchase.id,
        late.student.user,
        campus,
        crypto.randomUUID(),
        reference,
      ],
    );
    await pg.query(
      "update app_private.tutorial_material_purchases set payment_expires_at=now()-interval '1 hour' where id=$1",
      [saved.purchase.id],
    );
    expect(
      (
        await pg.query<{ result: string }>(
          "select app_private.record_material_receipt($1,50800,762,now()) as result",
          [reference],
        )
      ).rows[0]!.result,
    ).toBe("REQUIRES_REVIEW");
    expect(
      (
        await request(
          "/media/" + late.media + "/access",
          late.student.user,
          "POST",
          {},
        )
      ).status,
    ).toBe(403);
    expect(await balance(late.tutor, "TUTOR_PENDING")).toBe(0);
  });
});

async function payoutFixture(type = "VENDOR", bearer = "PLATFORM") {
  const owner = await person(undefined, campus, type),
    setup = crypto.randomUUID(),
    policy = crypto.randomUUID(),
    recipient = "RCP_" + crypto.randomUUID().replaceAll("-", "");
  const application = (
    await pg.query<{ application_id: string }>(
      "select application_id from agent_profiles where id=$1",
      [owner.profile],
    )
  ).rows[0]!.application_id;
  await pg.query(
    "update agent_applications set status='APPROVED',legal_name='Synthetic verified owner',kyc_status='MANUALLY_VERIFIED',phone_verified_at=now(),terms_accepted_at=now(),bank_status='VERIFIED',bank_provider='PAYSTACK',bank_recipient_code=$2 where id=$1",
    [application, recipient],
  );
  const identity = crypto.randomUUID(),
    portrait = crypto.randomUUID();
  for (const media of [identity, portrait])
    await pg.query(
      "insert into media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name)values($1,$2,$3,'kyc',$1::uuid::text,'image/jpeg',10,'Synthetic verification fixture')",
      [media, owner.user, campus],
    );
  await pg.query(
    "insert into agent_application_details(application_id,birth_date,is_student,identity_document_id,portrait_document_id,terms_version)values($1,'2000-01-01',false,$2,$3,'Synthetic-policy')",
    [application, identity, portrait],
  );
  await pg.query(
    "insert into app_private.verified_people(user_id,identity_fingerprint,verified_by)values($1,$1::uuid::text,$2)",
    [owner.user, buyer],
  );
  await pg.query(
    "insert into app_private.payout_account_setups(id,user_id,agent_profile_id,application_id,institution_id,request_hash,status,bank_code,bank_name,account_name,account_last4,recipient_code,provider_mode,reviewed_by,reviewed_at)values($1,$2,$3,$4,$5,'synthetic','APPROVED','058','Synthetic Bank','Synthetic verified owner','1234',$6,'live',$7,now())",
    [setup, owner.user, owner.profile, application, campus, recipient, buyer],
  );
  await pg.query(
    "insert into app_private.payout_cost_policies(id,university_id,agent_type,version,fee_bearer,low_fee_kobo,middle_fee_kobo,high_fee_kobo,duty_threshold_kobo,duty_kobo,source_url,approval_note,approved_by)values($1,$2,$3,$1::uuid::text,$4,1000,2500,5000,1000000,5000,'https://paystack.com/pricing','Synthetic reviewed merchant fees',$5)",
    [policy, campus, type, bearer, buyer],
  );
  await pg.query(
    "insert into app_private.active_payout_cost_policies(university_id,agent_type,policy_id)values($1,$2,$3)on conflict(university_id,agent_type)do update set policy_id=excluded.policy_id",
    [campus, type, policy],
  );
  await journal(owner.user, 1000000, crypto.randomUUID(), type + "_AVAILABLE");
  return { owner, setup, policy, application, recipient };
}
async function payoutQuote(
  f: Awaited<ReturnType<typeof payoutFixture>>,
  amount = 700000,
) {
  return (
    await json(
      await request("/agents/payout-quote", f.owner.user, "POST", {
        agentProfileId: f.owner.profile,
        amountKobo: amount,
      }),
    )
  ).quote;
}
async function payoutRequest(
  f: Awaited<ReturnType<typeof payoutFixture>>,
  quote: { id: string; amountKobo: number;payoutCommissionKobo?:number;bankNetKobo?:number },
  requestId = crypto.randomUUID(),
) {
  const input = {
    agentProfileId: f.owner.profile,
    quoteId: quote.id,
    requestId,
    amountKobo: quote.amountKobo,
    expectedCommissionKobo:quote.payoutCommissionKobo,expectedBankNetKobo:quote.bankNetKobo,
  };
  const saved = await json(
    await request("/agents/payouts", f.owner.user, "POST", input),
    201,
  );
  return { saved, input };
}
async function preparePayout(f: Awaited<ReturnType<typeof payoutFixture>>) {
  const q = await payoutQuote(f),
    p = await payoutRequest(f, q);
  await json(
    await request(
      "/v1/admin/operations/payouts/" + p.saved.id + "/review",
      buyer,
      "POST",
      { status: "APPROVED", note: "Reviewed synthetic withdrawal" },
    ),
  );
  await pg.query("select app_private.prepare_ledger_transfer($1,$2)", [
    p.saved.id,
    campus,
  ]);
  return p.saved;
}
async function transferProof(
  p: { provider_reference: string },
  f: Awaited<ReturnType<typeof payoutFixture>>,
  status = "success",
  fee = 2500,
  recipient = f.recipient,
) {
  return (
    await pg.query<{ state: string }>(
      "select app_private.record_ledger_transfer($1,700000,$2,$3,'live',$4,'TRF_synthetic',now()) as state",
      [p.provider_reference, fee, recipient, status],
    )
  ).rows[0]!.state;
}
describe("verified agent withdrawals", () => {
  it("executes the self-rolling-back payout acceptance SQL on the migrated schema", async () => {
    await pg.exec(readFileSync(new URL("../../database/verification/payout-functional-acceptance.sql", import.meta.url), "utf8"));
  });
  it("versions the seller minimum independently of transfer fees and enforces the server snapshot", async () => {
    const f = await payoutFixture("VENDOR");
    const approved = await json(await request("/finance/transfer-policies", buyer, "POST", {
      universityId: campus, agentType: "VENDOR", version: crypto.randomUUID(), feeBearer: "PLATFORM",
      lowFeeKobo:1000,middleFeeKobo:2500,highFeeKobo:5000,dutyThresholdKobo:1_000_000,dutyKobo:5000,
      minimumWithdrawalKobo:500_000,statutoryDutyPolicy:"PLATFORM_ABSORBS_PENDING_STATEMENT",
      sourceUrl:"https://support.paystack.com/en/articles/2130370",approvalNote:"Synthetic reviewed independent seller minimum",
    }),201);
    expect(approved.id).toBeTruthy();
    expect((await request("/agents/payout-quote",f.owner.user,"POST",{agentProfileId:f.owner.profile,amountKobo:499_999})).status).toBe(409);
    const q=await payoutQuote(f,500_000);
    expect(q.minimumWithdrawalKobo).toBe(500_000);
    expect(q.expectedTransferFeeKobo).toBe(1000);
    const minimums=(await json(await request("/agents/earnings",f.owner.user))).withdrawalMinimums;
    expect(Number(minimums.find((p:{agent_type:string})=>p.agent_type==="VENDOR").minimum_withdrawal_kobo)).toBe(500_000);
    expect((await payoutRequest(f,q)).saved.id).toBeTruthy();
  });
  it("separates transfer GET fees from statement duty, absorbs duty, and reconciles each journal once", async () => {
    const f = await payoutFixture("VENDOR", "PAYEE");
    const q = await payoutQuote(f, 1_000_000);
    expect(q.walletDebitKobo).toBe(1_000_000);
    expect(q.bankNetKobo).toBe(997_500);
    expect(q.transferFeeAllowanceKobo).toBe(2500);
    expect(q.expectedStatutoryDutyKobo).toBe(0); // Actual transfer is below ₦10,000.
    const p = await payoutRequest(f, q);
    await pg.query("select app_private.review_ledger_payout($1,$2,$3,'APPROVED','Synthetic reviewed withdrawal')", [p.saved.id, campus, buyer]);
    await pg.query("select app_private.prepare_ledger_transfer($1,$2)", [p.saved.id, campus]);
    const record = () => pg.query("select app_private.record_ledger_transfer($1,997500,2500,$2,'live','success','TRF_synthetic',now())", [p.saved.provider_reference, f.recipient]);
    await record(); await record();
    const before = (await pg.query<{actual_statutory_duty_kobo:number|null}>("select actual_statutory_duty_kobo from app_private.agent_payout_settlements where payout_id=$1", [p.saved.id])).rows[0]!;
    expect(before.actual_statutory_duty_kobo).toBeNull();
    const reconcile = () => pg.query("select app_private.reconcile_payout_duty($1,$2,5000,'SYNTHETIC-BALANCE-DUTY-1',$3,'Synthetic reviewed statement duty evidence')", [p.saved.id, campus, buyer]);
    await reconcile(); await reconcile(); await record();
    expect(await balance(f.owner, "VENDOR_AVAILABLE")).toBe(0); // Excess duty is platform cost, never a new wallet debit.
    const actual = (await pg.query<{actual_statutory_duty_kobo:number;statutory_duty_source:string}>("select actual_statutory_duty_kobo,statutory_duty_source from app_private.agent_payout_settlements where payout_id=$1", [p.saved.id])).rows[0]!;
    expect(Number(actual.actual_statutory_duty_kobo)).toBe(5000);
    expect(actual.statutory_duty_source).toBe("PAYSTACK_BALANCE_STATEMENT");
    expect((await pg.query("select id from ledger_transactions where idempotency_key=$1", ["payout-duty-statement:"+p.saved.provider_reference])).rows).toHaveLength(1);
    await expect(pg.query("select app_private.reconcile_payout_duty($1,$2,0,'OTHER-STATEMENT',$3,'Synthetic changed duty evidence')", [p.saved.id, campus, buyer])).rejects.toThrow("PAYOUT_DUTY_ALREADY_RECONCILED");
  });
  it("accrues expected statutory duty separately and replaces the estimate from statement evidence", async () => {
    const f = await payoutFixture("TUTOR");
    const q = await payoutQuote(f, 1_000_000);
    expect(q.expectedTransferFeeKobo).toBe(2500);
    expect(q.expectedStatutoryDutyKobo).toBe(5000);
    expect(q.feeKobo).toBe(0);
    const p = await payoutRequest(f, q);
    await pg.query("select app_private.review_ledger_payout($1,$2,$3,'APPROVED','Synthetic reviewed withdrawal')", [p.saved.id, campus, buyer]);
    await pg.query("select app_private.prepare_ledger_transfer($1,$2)", [p.saved.id, campus]);
    await pg.query("select app_private.record_ledger_transfer($1,1000000,2500,$2,'live','success','TRF_synthetic',now())", [p.saved.provider_reference, f.recipient]);
    const pending = (await pg.query<{expected_duty_accrued_kobo:number;actual_statutory_duty_kobo:number|null}>("select expected_duty_accrued_kobo,actual_statutory_duty_kobo from app_private.agent_payout_settlements where payout_id=$1", [p.saved.id])).rows[0]!;
    expect(Number(pending.expected_duty_accrued_kobo)).toBe(5000);
    expect(pending.actual_statutory_duty_kobo).toBeNull();
    await pg.query("select app_private.reconcile_payout_duty($1,$2,5000,'SYNTHETIC-BALANCE-DUTY-2',$3,'Synthetic reviewed statement duty evidence')", [p.saved.id, campus, buyer]);
    expect((await pg.query("select id from ledger_transactions where idempotency_key=$1", ["payout-duty-accrual:"+p.saved.provider_reference])).rows).toHaveLength(1);
    expect(await balance(f.owner, "TUTOR_AVAILABLE")).toBe(0);
  });
  it("keeps a historical reserved duty until statement evidence, including on paid reversal", async () => {
    const f = await payoutFixture("TUTOR", "PAYEE"), quoteId = crypto.randomUUID();
    await pg.query("insert into app_private.agent_payout_quotes(id,user_id,university_id,agent_profile_id,agent_type,policy_id,account_setup_id,recipient_code,provider_mode,amount_kobo,estimated_fee_kobo,fee_allowance_kobo,bank_net_kobo) values($1,$2,$3,$4,'TUTOR',$5,$6,$7,'live',1000000,7500,7500,992500)", [quoteId,f.owner.user,campus,f.owner.profile,f.policy,f.setup,f.recipient]);
    const p = await payoutRequest(f, { id: quoteId, amountKobo: 1_000_000 });
    await pg.query("select app_private.review_ledger_payout($1,$2,$3,'APPROVED','Synthetic reviewed legacy quote')", [p.saved.id,campus,buyer]);
    await pg.query("select app_private.prepare_ledger_transfer($1,$2)", [p.saved.id,campus]);
    const record = (status:string, fee:number) => pg.query("select app_private.record_ledger_transfer($1,992500,$2,$3,'live',$4,'TRF_synthetic',now())", [p.saved.provider_reference,fee,f.recipient,status]);
    await record("success",2500); await record("success",2500);
    expect(await balance(f.owner,"TUTOR_AVAILABLE")).toBe(0);
    expect(await balance(f.owner,"PAYOUT_DUTY_RESERVED")).toBe(5000);
    await record("reversed",0); await record("reversed",0);
    expect(await balance(f.owner,"TUTOR_AVAILABLE")).toBe(995000);
    expect(await balance(f.owner,"PAYOUT_DUTY_RESERVED")).toBe(5000);
    const reconcile = () => pg.query("select app_private.reconcile_payout_duty($1,$2,0,'SYNTHETIC-STATEMENT-NO-DUTY',$3,'Statement confirms no qualifying duty charge')", [p.saved.id,campus,buyer]);
    await reconcile(); await reconcile();
    expect(await balance(f.owner,"TUTOR_AVAILABLE")).toBe(1_000_000);
    expect(await balance(f.owner,"PAYOUT_DUTY_RESERVED")).toBe(0);
  });
  it("requires owned active identity, a reviewed destination and campus policy, and enforces the withdrawal switch", async () => {
    const f = await payoutFixture();
    const q = await payoutQuote(f);
    expect(q.netKobo).toBe(700000);
    expect(q.feeKobo).toBe(0);
    expect(q.accountLast4).toBe("1234");
    expect(JSON.stringify(q)).not.toContain(f.recipient);
    expect(
      (
        await request("/agents/payout-quote", buyer, "POST", {
          agentProfileId: f.owner.profile,
          amountKobo: 700000,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(
          "/agents/payout-quote",
          f.owner.user,
          "POST",
          { agentProfileId: f.owner.profile, amountKobo: 700000 },
          otherCampus,
        )
      ).status,
    ).toBe(409);
    await pg.query(
      "update agent_applications set kyc_status='PENDING' where id=$1",
      [f.application],
    );
    expect(
      (
        await request("/agents/payouts", f.owner.user, "POST", {
          agentProfileId: f.owner.profile,
          amountKobo: 700000,
          quoteId: q.id,
          requestId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(409);
    env.PAYOUTS_ENABLED = "false";
    try {
      expect(
        (
          await request("/agents/payout-quote", f.owner.user, "POST", {
            agentProfileId: f.owner.profile,
            amountKobo: 700000,
          })
        ).status,
      ).toBe(503);
    } finally {
      env.PAYOUTS_ENABLED = "true";
    }
    expect(await balance(f.owner, "VENDOR_AVAILABLE")).toBe(1000000);
    const foreign = await person(undefined, otherCampus, "TUTOR");
    await pg.query(
      "insert into operator_roles(user_id,university_id,role)values($1,$2,'FINANCE_REVIEWER')",
      [foreign.user, otherCampus],
    );
    expect(
      (
        await request(
          "/finance/transfer-policies",
          foreign.user,
          "POST",
          {
            universityId: campus,
            agentType: "VENDOR",
            version: crypto.randomUUID(),
            feeBearer: "PLATFORM",
            lowFeeKobo: 1000,
            middleFeeKobo: 2500,
            highFeeKobo: 5000,
            dutyThresholdKobo: 1000000,
            dutyKobo: 5000,
            sourceUrl: "https://paystack.com/pricing",
            approvalNote: "Synthetic fee review evidence",
          },
          otherCampus,
        )
      ).status,
    ).toBe(403);
  });
  it("serializes competing reservations, reuses an exact request and seals balances and destinations", async () => {
    const f = await payoutFixture("TUTOR"),
      a = await payoutQuote(f),
      b = await payoutQuote(f),
      requestId = crypto.randomUUID();
    const input = {
      agentProfileId: f.owner.profile,
      amountKobo: 700000,
      quoteId: a.id,
      requestId,
    };
    const results = await Promise.all([
      request("/agents/payouts", f.owner.user, "POST", input),
      request("/agents/payouts", f.owner.user, "POST", {
        ...input,
        quoteId: b.id,
        requestId: crypto.randomUUID(),
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner = (await results.find((r) => r.status === 201)!.json()) as {
      id: string;
    };
    expect(await balance(f.owner, "TUTOR_AVAILABLE")).toBe(300000);
    expect(await balance(f.owner, "TUTOR_PAYOUT_RESERVED")).toBe(700000);
    const stored = (
      await pg.query<{ quote_id: string; request_id: string }>(
        "select quote_id,request_id from app_private.agent_payout_settlements where payout_id=$1",
        [winner.id],
      )
    ).rows[0]!;
    const replay = await json(
      await request("/agents/payouts", f.owner.user, "POST", {
        ...input,
        quoteId: stored.quote_id,
        requestId: stored.request_id,
      }),
      201,
    );
    expect(replay.id).toBe(winner.id);
    expect(
      (
        await request("/agents/payouts", f.owner.user, "POST", {
          ...input,
          amountKobo: 800000,
        })
      ).status,
    ).toBe(409);
    await expect(
      pg.query("update payout_requests set amount_kobo=1 where id=$1", [
        winner.id,
      ]),
    ).rejects.toThrow("SEALED_PAYOUT_IMMUTABLE");
    await expect(
      pg.query("update payout_requests set status='PAID' where id=$1", [
        winner.id,
      ]),
    ).rejects.toThrow("PAYOUT_VERIFIED_TRANSFER_REQUIRED");
    expect((await request("/agents/payouts/" + winner.id, buyer)).status).toBe(
      404,
    );
  });
  it("treats initiation as pending, requires exact provider proof and reports real reserved and withdrawn balances", async () => {
    const f = await payoutFixture(),
      q = await payoutQuote(f),
      p = await payoutRequest(f, q);
    await json(
      await request(
        "/v1/admin/operations/payouts/" + p.saved.id + "/review",
        buyer,
        "POST",
        { status: "APPROVED", note: "Reviewed synthetic bank destination" },
      ),
    );
    let wrong = true;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const data = {
        reference: p.saved.provider_reference,
        amount: 700000,
        currency: "NGN",
        domain: "live",
        status: "success",
        transfer_code: "TRF_synthetic",
        updatedAt: new Date().toISOString(),
        fee_charged: 3200,
        recipient: {
          recipient_code: wrong ? "RCP_wrong" : f.recipient,
          currency: "NGN",
          domain: "live",
          details: { account_number: "not-stored" },
        },
      };
      if (init?.method === "POST") {
        expect(JSON.parse(init.body as string).reference).toBe(
          p.saved.provider_reference,
        );
        return Response.json({ status: true, data });
      }
      expect(url).toContain("/transfer/verify/");
      return Response.json({ status: true, data });
    });
    vi.stubGlobal("fetch", fetch);
    await json(
      await request(
        "/v1/admin/operations/payouts/" + p.saved.id + "/transfer",
        buyer,
        "POST",
        { confirm: true },
      ),
    );
    expect(
      (
        await pg.query<{ status: string }>(
          "select status from payout_requests where id=$1",
          [p.saved.id],
        )
      ).rows[0]!.status,
    ).toBe("PROCESSING");
    expect(await balance(f.owner, "VENDOR_PAYOUT_RESERVED")).toBe(700000);
    await json(
      await request(
        "/v1/admin/operations/payouts/" + p.saved.id + "/check",
        buyer,
        "POST",
        {},
      ),
    );
    expect(
      (
        await pg.query<{ status: string }>(
          "select status from payout_requests where id=$1",
          [p.saved.id],
        )
      ).rows[0]!.status,
    ).toBe("REQUIRES_REVIEW");
    wrong = false;
    env.PAYOUTS_ENABLED = "false";
    env.PAYMENTS_ENABLED = "false";
    try {
      await json(await request("/agents/payouts/" + p.saved.id, f.owner.user));
      await json(await request("/agents/payouts/" + p.saved.id, f.owner.user));
    } finally {
      env.PAYOUTS_ENABLED = "true";
      env.PAYMENTS_ENABLED = "true";
    }
    expect(await balance(f.owner, "VENDOR_PAYOUT_RESERVED")).toBe(0);
    expect(await balance(f.owner, "VENDOR_AVAILABLE")).toBe(300000);
    const earnings = await json(
      await request("/agents/earnings", f.owner.user),
    );
    expect(Number(earnings.store.withdrawn_kobo)).toBe(700000);
    expect(Number(earnings.store.reserved_kobo)).toBe(0);
    expect(
      (
        await pg.query<{ count: number }>(
          "select count(*)::int count from ledger_transactions where idempotency_key=$1",
          ["payout-paid:" + p.saved.provider_reference],
        )
      ).rows[0]!.count,
    ).toBe(1);
    const proof = await pg.query(
      "select * from app_private.verified_payout_observations where payout_id=$1",
      [p.saved.id],
    );
    expect(JSON.stringify(proof.rows)).not.toContain("not-stored");
  });
  it("keeps an uncertain transfer reserved and returns a verified conclusive failure to the wallet once", async () => {
    const f = await payoutFixture("RIDER"),
      p = await preparePayout(f);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Synthetic connection failure");
      }),
    );
    expect(
      (
        await request(
          "/v1/admin/operations/payouts/" + p.id + "/transfer",
          buyer,
          "POST",
          { confirm: true },
        )
      ).status,
    ).toBe(503);
    expect(await balance(f.owner, "RIDER_PAYOUT_RESERVED")).toBe(700000);
    expect(await transferProof(p, f, "failed")).toBe("FAILED");
    expect(await transferProof(p, f, "failed")).toBe("FAILED");
    expect(await balance(f.owner, "RIDER_AVAILABLE")).toBe(1000000);
    expect(await balance(f.owner, "RIDER_PAYOUT_RESERVED")).toBe(0);
    expect(
      (
        await request(
          "/v1/admin/operations/payouts/" + p.id + "/review",
          buyer,
          "POST",
          { status: "REJECTED", note: "Cannot reject an initiated transfer" },
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await request(
          "/v1/admin/operations/payouts/" + p.id + "/review",
          buyer,
          "POST",
          {
            status: "PAID",
            providerReference: "fabricated",
            note: "Cannot fabricate payment proof",
          },
        )
      ).status,
    ).toBe(409);
    await expect(pg.query("select app_private.prepare_ledger_transfer($1,$2)",[p.id,campus])).rejects.toThrow('PAYOUT_FAILURE_ALREADY_RELEASED');
    expect(await transferProof(p, f, "reversed", 0)).toBe("FAILED");
    expect(await transferProof(p, f, "reversed", 0)).toBe("FAILED");
    expect(await balance(f.owner, "RIDER_AVAILABLE")).toBe(1000000);
    expect(await balance(f.owner, "RIDER_PAYOUT_RESERVED")).toBe(0);
    expect(await transferProof(p, f, "success")).toBe("REQUIRES_REVIEW");
    expect(await balance(f.owner, "RIDER_AVAILABLE")).toBe(1000000);
    const releases=await pg.query<{count:number}>('select count(*)::int count from ledger_transactions where idempotency_key=$1',['payout-failure-release:'+p.provider_reference]);
    expect(releases.rows[0]!.count).toBe(1);
    const nextQuote=await payoutQuote(f);
    const next=await payoutRequest(f,nextQuote);
    expect(next.saved.id).not.toBe(p.id);
  });
  it("returns unused fee allowance and compensates a paid reversal without changing journals", async () => {
    const f = await payoutFixture("TUTOR", "PAYEE"),
      q = await payoutQuote(f);
    expect(q.netKobo).toBe(697500);
    const p = await payoutRequest(f, q);
    await pg.query(
      "select app_private.review_ledger_payout($1,$2,$3,'APPROVED','Synthetic approved payout')",
      [p.saved.id, campus, buyer],
    );
    await pg.query("select app_private.prepare_ledger_transfer($1,$2)", [
      p.saved.id,
      campus,
    ]);
    const record = async (status: string, fee: number) =>
      (
        await pg.query<{ state: string }>(
          "select app_private.record_ledger_transfer($1,697500,$2,$3,'live',$4,'TRF_synthetic',now()) state",
          [p.saved.provider_reference, fee, f.recipient, status],
        )
      ).rows[0]!.state;
    expect(await record("success", 1000)).toBe("PAID");
    expect(await record("success", 1000)).toBe("PAID");
    expect(await balance(f.owner, "TUTOR_AVAILABLE")).toBe(301500);
    expect(await record("reversed", 0)).toBe("REVERSED");
    expect(await record("reversed", 0)).toBe("REVERSED");
    expect(await balance(f.owner, "TUTOR_AVAILABLE")).toBe(1000000);
    expect(await balance(f.owner, "TUTOR_PAYOUT_RESERVED")).toBe(0);
    await expect(
      pg.query(
        "delete from app_private.verified_payout_observations where payout_id=$1",
        [p.saved.id],
      ),
    ).rejects.toThrow("append-only");
  });
  it("blocks withdrawal with outstanding cash commissions and releases a rejection before transfer once", async () => {
    const f = await payoutFixture("RIDER");
    const cash = await job(f.owner, "CASH");
    await complete(f.owner, cash);
    const q = await payoutQuote(f);
    const p = await payoutRequest(f, q); // Eligible digital earnings offset the cash commission under the same financial lock.
    expect(
      (await riderFinanceSummary(env, f.owner.user, campus))
        ?.commission_due_kobo,
    ).toBe(0);
    expect(await balance(f.owner, "RIDER_AVAILABLE")).toBe(297000);
    await json(
      await request(
        "/v1/admin/operations/payouts/" + p.saved.id + "/review",
        buyer,
        "POST",
        { status: "REJECTED", note: "Synthetic pre-transfer rejection" },
      ),
    );
    expect(await balance(f.owner, "RIDER_AVAILABLE")).toBe(997000);
    expect(
      (
        await request(
          "/v1/admin/operations/payouts/" + p.saved.id + "/review",
          buyer,
          "POST",
          { status: "REJECTED", note: "Duplicate rejection attempt" },
        )
      ).status,
    ).toBe(409);
    const debtOwner = await person(f.owner.user, otherCampus, "RIDER"),
      otherVendor = await person(undefined, otherCampus, "VENDOR");
    const crossOrder = crypto.randomUUID(),
      crossJob = crypto.randomUUID(),
      crossZone = crypto.randomUUID(),
      crossJournal = crypto.randomUUID();
    await pg.query(
      "insert into delivery_zones(id,university_id,name,base_fee_kobo,active)values($1,$2,'Synthetic foreign-campus route',30000,true)",
      [crossZone, otherCampus],
    );
    await pg.query(
      "insert into orders(id,university_id,buyer_user_id,vendor_profile_id,subtotal_kobo,delivery_fee_kobo,status)values($1,$2,$3,$4,100000,30000,'IN_DELIVERY')",
      [crossOrder, otherCampus, buyer, otherVendor.profile],
    );
    await pg.query(
      "insert into delivery_jobs(id,university_id,order_id,rider_profile_id,zone_id,pickup_code_hash,delivery_code_hash,status,financial_version,fare_kobo,rider_earning_kobo,fare_basis,route_distance_metres)values($1,$2,$3,$4,$5,'synthetic-pickup','synthetic-delivery','AVAILABLE','CAMPUS_FARE_V1',30000,27000,'CAMPUS_ZONE',700)",
      [crossJob, otherCampus, crossOrder, debtOwner.profile, crossZone],
    );
    const lines = [
      {
        code: "RIDER_COMMISSION_RECEIVABLE",
        type: "ASSET",
        owner: f.owner.user,
        direction: "DEBIT",
        amount: 3000,
      },
      {
        code: "PLATFORM_COMMISSION",
        type: "REVENUE",
        direction: "CREDIT",
        amount: 3000,
      },
    ];
    await pg.query<{ id: string }>(
      "select app_private.post_finance_journal($1,'DELIVERY_JOB',$2,$3,'Synthetic other-campus cash commission',$4::jsonb)as id",
      [otherCampus, crossJob, crossJournal, JSON.stringify(lines)],
    );
    await pg.query(
      "insert into app_private.rider_cash_commissions(job_id,university_id,rider_profile_id,rider_user_id,fare_kobo,commission_kobo)values($1,$2,$3,$4,30000,3000)",
      [crossJob, otherCampus, debtOwner.profile, f.owner.user],
    );
    const next = await payoutQuote(f);
    expect(
      (
        await request("/agents/payouts", f.owner.user, "POST", {
          agentProfileId: f.owner.profile,
          amountKobo: 700000,
          quoteId: next.id,
          requestId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect(await balance(f.owner, "RIDER_AVAILABLE")).toBe(997000);
  });
  it("supports merchant OTP without storing the code or treating its acknowledgement as payment proof", async () => {
    const f = await payoutFixture(),
      q = await payoutQuote(f),
      p = await payoutRequest(f, q),
      otp = "123456";
    await json(
      await request(
        "/v1/admin/operations/payouts/" + p.saved.id + "/review",
        buyer,
        "POST",
        { status: "APPROVED", note: "Synthetic OTP transfer review" },
      ),
    );
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string);
      if (url.endsWith("/finalize_transfer"))
        expect(sent).toEqual({ transfer_code: "TRF_synthetic", otp });
      return Response.json({
        status: true,
        data: {
          reference: p.saved.provider_reference,
          amount: 700000,
          currency: "NGN",
          domain: "live",
          status: url.endsWith("/finalize_transfer") ? "pending" : "otp",
          transfer_code: "TRF_synthetic",
        },
      });
    });
    vi.stubGlobal("fetch", fetch);
    const start = await json(
      await request(
        "/v1/admin/operations/payouts/" + p.saved.id + "/transfer",
        buyer,
        "POST",
        { confirm: true },
      ),
    );
    expect(start.status).toBe("OTP_REQUIRED");
    await json(
      await request(
        "/v1/admin/operations/payouts/" + p.saved.id + "/finalize",
        buyer,
        "POST",
        { otp },
      ),
    );
    expect(
      (
        await pg.query<{ status: string }>(
          "select status from payout_requests where id=$1",
          [p.saved.id],
        )
      ).rows[0]!.status,
    ).toBe("PROCESSING");
    expect(await balance(f.owner, "VENDOR_PAYOUT_RESERVED")).toBe(700000);
    expect(
      JSON.stringify(
        (
          await pg.query(
            "select metadata from app_private.audit_events where target_id=$1",
            [p.saved.id],
          )
        ).rows,
      ),
    ).not.toContain(otp);
  });
});

describe("graduated withdrawal commission and one-action approval",()=>{
  async function commissionFixture(type="VENDOR"){
    const f=await payoutFixture(type);
    const policy=crypto.randomUUID();
    await pg.query("insert into app_private.payout_cost_policies(id,university_id,agent_type,version,fee_bearer,low_fee_kobo,middle_fee_kobo,high_fee_kobo,duty_threshold_kobo,duty_kobo,minimum_withdrawal_kobo,commission_tiers,source_url,approval_note,approved_by)values($1,$2,$3,$1::uuid::text,'PLATFORM',1000,2500,5000,1000000,5000,200000,$4::jsonb,'https://paystack.com/pricing','Reviewed graduated commission policy',$5)",[policy,campus,type,JSON.stringify(withdrawalCommissionTiers),buyer]);
    await pg.query("update app_private.active_payout_cost_policies set policy_id=$1 where university_id=$2 and agent_type=$3",[policy,campus,type]);
    return {...f,policy};
  }
  it.each(["VENDOR","TUTOR","RIDER"])("enforces the role minimum and explicit commission consent for %s",async type=>{
    const f=await commissionFixture(type),minimum=type==='RIDER'?200000:500000;
    expect((await request('/agents/payout-quote',f.owner.user,'POST',{agentProfileId:f.owner.profile,amountKobo:minimum-1})).status).toBe(409);
    const q=await payoutQuote(f,minimum);expect(q.payoutCommissionKobo).toBe(minimum*0.08);expect(q.bankNetKobo).toBe(minimum*0.92);expect(q.expectedTransferFeeKobo).toBe(1000);
    const input={agentProfileId:f.owner.profile,quoteId:q.id,requestId:crypto.randomUUID(),amountKobo:q.amountKobo};
    expect((await request('/agents/payouts',f.owner.user,'POST',input)).status).toBe(409);
    expect((await request('/agents/payouts',f.owner.user,'POST',{...input,expectedCommissionKobo:1,expectedBankNetKobo:199999})).status).toBe(409);
    const p=await payoutRequest(f,q);
    expect((await pg.query("select title from in_app_notifications where dedupe_key=$1",['payout:'+p.saved.id+':REQUESTED'])).rows[0]?.title).toBe('Payout pending');
    await request('/agents/payouts',f.owner.user,'POST',p.input);
    expect((await pg.query("select id from in_app_notifications where dedupe_key=$1",['payout:'+p.saved.id+':REQUESTED'])).rows).toHaveLength(1);
  });
  it("books commission once after exact verified success and restores it on reversal",async()=>{
    const f=await commissionFixture(),q=await payoutQuote(f,700000),p=await payoutRequest(f,q);
    expect(q.payoutCommissionKobo).toBe(56000);expect(q.bankNetKobo).toBe(644000);
    await pg.query("select app_private.review_ledger_payout($1,$2,$3,'APPROVED','Confirmed exact withdrawal')",[p.saved.id,campus,buyer]);
    await pg.query("select app_private.prepare_ledger_transfer($1,$2)",[p.saved.id,campus]);
    const proof=(status:string,amount=q.bankNetKobo)=>pg.query<{state:string}>("select app_private.record_ledger_transfer($1,$2,2500,$3,'live',$4,'TRF_commission',now()) as state",[p.saved.provider_reference,amount,f.recipient,status]);
    expect((await proof('success',700000)).rows[0]?.state).toBe('REQUIRES_REVIEW');
    expect((await pg.query("select id from ledger_transactions where idempotency_key=$1",['payout-paid:'+p.saved.provider_reference])).rows).toHaveLength(0);
    expect((await proof('success')).rows[0]?.state).toBe('PAID');await proof('success');
    expect((await pg.query("select sum(l.amount_kobo)::bigint as total from ledger_lines l join ledger_accounts a on a.id=l.account_id join ledger_transactions t on t.id=l.transaction_id where t.idempotency_key=$1 and a.account_code='PLATFORM_COMMISSION'",['payout-paid:'+p.saved.provider_reference])).rows[0]?.total).toBe(56000);
    expect(await balance(f.owner,'VENDOR_AVAILABLE')).toBe(300000);
    await proof('reversed');await proof('reversed');
    expect(await balance(f.owner,'VENDOR_AVAILABLE')).toBe(1000000);
    expect(await balance(f.owner,'VENDOR_PAYOUT_RESERVED')).toBe(0);
  });
  it("returns the full reserve on proven failure and permits a new request",async()=>{
    const f=await commissionFixture(),q=await payoutQuote(f),p=await payoutRequest(f,q);
    await pg.query("select app_private.review_ledger_payout($1,$2,$3,'APPROVED','Confirmed exact withdrawal')",[p.saved.id,campus,buyer]);
    await pg.query("select app_private.prepare_ledger_transfer($1,$2)",[p.saved.id,campus]);
    await pg.query("select app_private.record_ledger_transfer($1,$2,0,$3,'live','failed','TRF_failed',now())",[p.saved.provider_reference,q.bankNetKobo,f.recipient]);
    expect(await balance(f.owner,'VENDOR_AVAILABLE')).toBe(1000000);
    expect((await payoutRequest(f,await payoutQuote(f,500000))).saved.id).toBeTruthy();
  });
  it("approves and sends only the sealed bank amount once, with no mandatory note",async()=>{
    const f=await commissionFixture(),q=await payoutQuote(f),p=await payoutRequest(f,q);
    const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
      if(url.endsWith('/transfer')){const d=JSON.parse(String(init?.body));expect(d.amount).toBe(q.bankNetKobo);expect(d.recipient).toBe(f.recipient);return Response.json({status:true,data:{reference:d.reference,amount:d.amount,currency:'NGN',domain:'live',status:'pending',transfer_code:'TRF_approve'}});}
      return Response.json({status:true,data:{reference:p.saved.provider_reference,amount:q.bankNetKobo,currency:'NGN',domain:'live',status:'pending',transfer_code:'TRF_approve',fee_charged:0,recipient:{recipient_code:f.recipient},updatedAt:new Date().toISOString()}});
    });vi.stubGlobal('fetch',fetcher);
    const path='/v1/admin/operations/payouts/'+p.saved.id+'/approve';
    expect((await request(path,buyer,'POST',{})).status).toBe(400);
    expect((await request(path,f.owner.user,'POST',{confirm:true})).status).toBe(403);
    expect((await json(await request(path,buyer,'POST',{confirm:true}))).status).toBe('PROCESSING');
    expect((await json(await request(path,buyer,'POST',{confirm:true}))).status).toBe('PROCESSING');
    expect(fetcher.mock.calls.filter(([url])=>url.endsWith('/transfer'))).toHaveLength(1);
    const details=await json(await request('/v1/admin/operations/payouts/'+p.saved.id+'/details',buyer));expect(details.profile.user_id).toBe(f.owner.user);expect(Number(details.balances.available_kobo)).toBe(300000);
    expect((await request('/v1/admin/operations/payouts/'+p.saved.id+'/details',f.owner.user)).status).toBe(403);
  });
});

describe('Bachs bank payout approval and verified recovery',()=>{
 const platformId='acct_platformfixture',accountId='acct_agentfixture',destinationId='pd_bankfixture';
 let providerState='pending',wrongDestination=false,loseAcknowledgement=false,funded=0,bankPosts=0,actualBankPayouts=0,recoveryAmount=0;
 function bachsMock(){
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
   const path=new URL(url).pathname,body=init?.body?JSON.parse(String(init.body)):null;
   if(path==='/v1/accounts/me')return Response.json({id:platformId,enabled_capabilities:['connect','payouts']});
   if(path==='/v1/accounts/'+accountId)return Response.json({id:accountId,parent_organization_id:platformId,capabilities:{payouts:{status:'active'},transfers:{status:'active'}}});
   if(path==='/v1/payouts/destinations/'+destinationId)return Response.json({id:destinationId,is_usable:true,currency:'NGN',account_name:'Synthetic verified owner',bank_code:'058',account_number:wrongDestination?'1111111111':'0123456789'});
   if(path==='/v1/payouts/quotes')return Response.json({from_currency:'NGN',to_currency:'NGN',from_amount:body.amount,to_amount:(Number(body.amount)-100).toFixed(2),exchange_rate:'1.00'});
   if(path==='/v1/transfers'&&body.destination===accountId){funded=Number(body.amount)*100;return Response.json({id:'tr_fundingfixture',source:platformId,destination:accountId,amount:body.amount,currency:'NGN',status:'paid',transfer_group:body.transfer_group});}
   if(path==='/v1/transfers/tr_fundingfixture')return Response.json({id:'tr_fundingfixture',source:platformId,destination:accountId,amount:(funded/100).toFixed(2),currency:'NGN',status:'paid',transfer_group:bachsReference});
   if(path==='/v1/payouts'&&body){bankPosts++;if(actualBankPayouts===0)actualBankPayouts++;if(loseAcknowledgement){loseAcknowledgement=false;throw Error('Lost provider acknowledgement');}return Response.json(payoutProof(body.reference));}
   if(path==='/v1/payouts/pay_bankfixture')return Response.json(payoutProof(bachsReference));
   if(path==='/v1/balances')return Response.json({account_id:accountId,balances:[{currency:'NGN',available_balance:((providerState==='completed'?funded-654000:funded)/100).toFixed(2)}]});
   if(path==='/v1/transfers'&&body.destination==='self'){recoveryAmount=Number(body.amount)*100;return Response.json({id:'tr_recoveryfixture',source:accountId,destination:platformId,amount:body.amount,currency:'NGN',status:'paid',transfer_group:body.transfer_group});}
   if(path==='/v1/transfers/tr_recoveryfixture')return Response.json({id:'tr_recoveryfixture',source:accountId,destination:platformId,amount:(recoveryAmount/100).toFixed(2),currency:'NGN',status:'paid',transfer_group:bachsReference});
   throw Error('Unexpected Bachs test path: '+path);
  }));
 }
 let bachsReference='';
 function payoutProof(reference:string){return {id:'pay_bankfixture',status:providerState,amount:'6440.00',fee:'100.00',total_debited:'6540.00',currency:'NGN',source_currency:'NGN',destination:destinationId,reference,completed_at:providerState==='completed'?new Date().toISOString():null};}
 async function fixture(){
  providerState='pending';wrongDestination=false;loseAcknowledgement=false;funded=0;bankPosts=0;actualBankPayouts=0;recoveryAmount=0;bachsMock();
  const f=await payoutFixture(),setup=crypto.randomUUID(),policy=crypto.randomUUID();
  env.BACHS_PRICED_CHECKOUT_ENABLED='true';env.BACHS_AGENT_PAYOUTS_ENABLED='true';env.BACHS_API_KEY='sk_live_synthetic_fixture';env.ENVIRONMENT='production';env.KYC_ENCRYPTION_KEY='ab'.repeat(32);
  const envelope=await encryptBankDetails(env,{bankCode:'058',accountNumber:'0123456789',accountName:'Synthetic verified owner',contactEmail:'synthetic@example.invalid'},f.owner.user,campus,setup);
  await pg.query("update app_private.payout_account_setups set status='SUPERSEDED' where id=$1",[f.setup]);
  await pg.query("insert into app_private.payout_account_setups(id,user_id,agent_profile_id,application_id,institution_id,request_hash,status,bank_code,bank_name,account_name,account_last4,recipient_code,provider_mode,reviewed_by,reviewed_at,provider,connected_account_id,bank_details_envelope)values($1,$2,$3,$4,$5,'synthetic','APPROVED','058','Synthetic Bank','Synthetic verified owner','6789',$6,'live',$7,now(),'BACHS',$8,$9::jsonb)",[setup,f.owner.user,f.owner.profile,f.application,campus,destinationId,buyer,accountId,JSON.stringify(envelope)]);
  await pg.query("update agent_applications set bank_provider='BACHS',bank_recipient_code=$2 where id=$1",[f.application,destinationId]);
  await pg.query("insert into app_private.payout_cost_policies(id,university_id,agent_type,version,fee_bearer,low_fee_kobo,middle_fee_kobo,high_fee_kobo,duty_threshold_kobo,duty_kobo,minimum_withdrawal_kobo,commission_tiers,provider,source_url,approval_note,approved_by)values($1,$2,'VENDOR',$1::uuid::text,'PLATFORM',0,0,0,1000000,0,200000,$3::jsonb,'BACHS','https://docs.bachs.io/connect/payouts','Reviewed withdrawal commission; Bachs provider costs absorbed',$4)",[policy,campus,JSON.stringify(withdrawalCommissionTiers),buyer]);
  await pg.query("update app_private.active_payout_cost_policies set policy_id=$1 where university_id=$2 and agent_type='VENDOR'",[policy,campus]);
  const q=await payoutQuote(f),p=await payoutRequest(f,q);bachsReference=p.saved.provider_reference;
  return {f,q,p,path:'/v1/admin/operations/payouts/'+p.saved.id};
 }
 afterEach(()=>{env.BACHS_PRICED_CHECKOUT_ENABLED=undefined;env.BACHS_AGENT_PAYOUTS_ENABLED=undefined;env.BACHS_API_KEY=undefined;env.ENVIRONMENT='local';env.KYC_ENCRYPTION_KEY=undefined;});
 async function payoutEvent(eventId:string,reference:string,type='payout.paid'){
  env.BACHS_WEBHOOK_SECRET='synthetic-payout-webhook-secret';
  const raw=JSON.stringify({id:eventId,type,data:{id:'pay_bankfixture',reference,amount:'1.00',status:'completed'}}),timestamp=String(Math.floor(Date.now()/1000));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.BACHS_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+raw));
  const signature=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
  return app.request('/payments/bachs/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Bachs-Signature-V2':`t=${timestamp},v1=${signature}`},body:raw},env);
 }
 it('funds and pays the exact bank amount once; a pending provider receipt never books commission',async()=>{
  const {f,q,p,path}=await fixture();expect(q.bankNetKobo).toBe(644000);expect(q.provider).toBe('BACHS');
  expect((await json(await request(path+'/approve',buyer,'POST',{confirm:true}))).status).toBe('PROCESSING');
  expect((await json(await request(path+'/approve',buyer,'POST',{confirm:true}))).status).toBe('PROCESSING');
  expect(funded).toBe(700000);expect(bankPosts).toBe(1);expect(actualBankPayouts).toBe(1);expect(await balance(f.owner,'VENDOR_PAYOUT_RESERVED')).toBe(700000);
  expect((await pg.query("select id from ledger_transactions where idempotency_key=$1",['payout-paid:'+p.saved.provider_reference])).rows).toHaveLength(0);
  providerState='completed';await json(await request(path+'/check',buyer,'POST',{}));await json(await request(path+'/check',buyer,'POST',{}));
  expect((await pg.query("select status from payout_requests where id=$1",[p.saved.id])).rows[0]?.status).toBe('PAID');
  expect(await balance(f.owner,'VENDOR_PAYOUT_RESERVED')).toBe(0);expect(await balance(f.owner,'VENDOR_AVAILABLE')).toBe(300000);
  const entries=(await pg.query("select a.account_code,l.direction,l.amount_kobo from ledger_lines l join ledger_accounts a on a.id=l.account_id join ledger_transactions t on t.id=l.transaction_id where t.idempotency_key=$1",['payout-paid:'+p.saved.provider_reference])).rows;
  expect(entries).toContainEqual(expect.objectContaining({account_code:'PLATFORM_COMMISSION',direction:'CREDIT',amount_kobo:56000}));
  expect((await pg.query("select id from ledger_transactions where idempotency_key=$1",['bachs-payout-fee:'+p.saved.provider_reference])).rows).toHaveLength(1);
  expect((await pg.query("select recovery_amount_kobo,recovery_journal_id from app_private.bachs_payout_bridges where payout_id=$1",[p.saved.id])).rows[0]).toMatchObject({recovery_amount_kobo:46000,recovery_journal_id:expect.any(String)});
  expect((await pg.query("select sum(case when l.direction='DEBIT' then l.amount_kobo else -l.amount_kobo end)::bigint as net from ledger_lines l join ledger_accounts a on a.id=l.account_id join ledger_transactions t on t.id=l.transaction_id where a.account_code='BACHS_PAYOUT_CLEARING' and t.reference_type='AGENT_PAYOUT' and t.reference_id=$1",[p.saved.id])).rows[0]?.net).toBe(0);
 });
 it('keeps a lost acknowledgement on the same idempotency key and restores all funds after verified bank failure',async()=>{
  const {f,p,path}=await fixture();loseAcknowledgement=true;
  expect((await request(path+'/approve',buyer,'POST',{confirm:true})).status).toBe(503);
  expect(actualBankPayouts).toBe(1);expect(await balance(f.owner,'VENDOR_PAYOUT_RESERVED')).toBe(700000);
  await json(await request(path+'/approve',buyer,'POST',{confirm:true}));expect(actualBankPayouts).toBe(1);expect(bankPosts).toBe(2);
  providerState='failed';await json(await request(path+'/check',buyer,'POST',{}));await json(await request(path+'/check',buyer,'POST',{}));
  expect(await balance(f.owner,'VENDOR_AVAILABLE')).toBe(1000000);expect(await balance(f.owner,'VENDOR_PAYOUT_RESERVED')).toBe(0);
  expect((await pg.query("select recovery_journal_id from app_private.bachs_payout_bridges where payout_id=$1",[p.saved.id])).rows[0]?.recovery_journal_id).toBeTruthy();
  expect((await pg.query("select id from ledger_transactions where idempotency_key=$1",['payout-paid:'+p.saved.provider_reference])).rows).toHaveLength(0);
 });
 it('rejects a changed bank destination before funding or payout creation',async()=>{
  const {f,path}=await fixture();wrongDestination=true;
  expect((await request(path+'/approve',buyer,'POST',{confirm:true})).status).toBe(409);expect(bankPosts).toBe(0);expect(funded).toBe(0);
  expect(await balance(f.owner,'VENDOR_PAYOUT_RESERVED')).toBe(700000);
 });
 it('keeps new agent transfers paused even if Connect is active until separately enabled',async()=>{
  const {f,path}=await fixture();env.BACHS_AGENT_PAYOUTS_ENABLED='false';
  const response=await request(path+'/approve',buyer,'POST',{confirm:true});
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error:expect.stringContaining('awaiting')});
  expect(bankPosts).toBe(0);expect(funded).toBe(0);expect(await balance(f.owner,'VENDOR_PAYOUT_RESERVED')).toBe(700000);
 });
 it('uses signed payout events only to trigger a fresh provider check and deduplicates final receipts',async()=>{
  const {f,p,path}=await fixture();
  await json(await request(path+'/approve',buyer,'POST',{confirm:true}));
  expect((await app.request('/payments/bachs/webhook',{method:'POST',body:'{}'},env)).status).toBe(401);
  expect((await payoutEvent('evt_payout_fixture_success',p.saved.provider_reference)).status).toBe(503);
  expect(await balance(f.owner,'VENDOR_PAYOUT_RESERVED')).toBe(700000);
  providerState='completed';
  expect((await payoutEvent('evt_payout_fixture_success',p.saved.provider_reference)).status).toBe(200);
  expect((await payoutEvent('evt_payout_fixture_success',p.saved.provider_reference)).status).toBe(200);
  expect((await pg.query("select count(*)::int as count from ledger_transactions where idempotency_key=$1",['payout-paid:'+p.saved.provider_reference])).rows[0]?.count).toBe(1);
  expect(await balance(f.owner,'VENDOR_PAYOUT_RESERVED')).toBe(0);
 });
 it('reports verified bank failure automatically and restores the full withdrawal without commission',async()=>{
  const {f,p,path}=await fixture();await json(await request(path+'/approve',buyer,'POST',{confirm:true}));providerState='failed';
  expect((await payoutEvent('evt_payout_fixture_failed',p.saved.provider_reference,'payout.failed')).status).toBe(200);
  expect(await balance(f.owner,'VENDOR_AVAILABLE')).toBe(1000000);
  expect((await pg.query("select status from payout_requests where id=$1",[p.saved.id])).rows[0]?.status).toBe('FAILED');
 });
});

describe('campus combined orders and private learning playlists',()=>{
 it('reconciles historical delivered earnings once while preserving paid, disputed and unverified holds',async()=>{
  const seller=await person(crypto.randomUUID(),campus,'VENDOR'),item=crypto.randomUUID();
  await pg.query("insert into vendor_storefronts(vendor_profile_id,university_id,display_name,description,contact_phone_e164,pickup_location,opening_hours,status,pickup_enabled,submitted_at,reviewed_at,reviewed_by_user_id,moderated_revision)select $1,university_id,'Historical release fixture',description,contact_phone_e164,pickup_location,opening_hours,status,true,submitted_at,reviewed_at,reviewed_by_user_id,1 from vendor_storefronts where vendor_profile_id=$2",[seller.profile,vendor]);
  await pg.query("insert into vendor_products(id,university_id,vendor_profile_id,name,description,category,category_id,price_kobo,stock_quantity,status,moderated_revision,submitted_at,reviewed_at,reviewed_by_user_id,package_weight_grams,package_length_cm,package_width_cm,package_height_cm,bicycle_delivery_eligible)select $1,university_id,$2,'Historical release item',description,category,category_id,price_kobo,20,status,1,submitted_at,reviewed_at,reviewed_by_user_id,300,10,10,10,true from vendor_products where id=$3",[item,seller.profile,product]);
  const catalog=await json(await request('/student/store',buyer));
  const unitPrice=Number(catalog.products.find((p:{id:string})=>p.id===item).price_kobo);
  async function order(paid=true){
   const input={...quoteInput('PICKUP'),vendorProfileId:seller.profile,items:[{productId:item,quantity:1,expectedUnitPriceKobo:unitPrice}]};
   const q=await json(await request('/student/order-quotes',buyer,'POST',input),201);
   const saved=await json(await request('/student/orders',buyer,'POST',{...input,quoteId:q.quote.id}),201);
   if(paid){
    const ref='K1-O-'+crypto.randomUUID();
    await pg.query("insert into payment_attempts(id,user_id,university_id,resource_type,resource_id,provider_reference,amount_kobo,idempotency_key,status)values($1,$2,$3,'STORE_ORDER',$4,$5,$6,$1::uuid::text,'INITIALIZED')",[crypto.randomUUID(),buyer,campus,saved.id,ref,saved.payableKobo]);
    const settled=await pg.query<{result:string}>('select app_private.record_priced_store_receipt($1,$2,$3,now()) result',[ref,saved.payableKobo,q.quote.pricing.estimatedProcessingKobo??0]);
    expect(settled.rows[0]?.result).toBe('PAID');
   }
   return saved.id as string;
  }
  const delivered=await order(),paid=await order(),disputed=await order(),openDispute=await order(),unverified=await order(false);
  // Reproduce records left by the previous release policy, inside this isolated
  // database only. The production migration requires the real trigger enabled.
  await pg.exec('alter table orders disable trigger priced_store_earnings_release');
  try{
   await pg.query("update orders set status='DELIVERED',completed_at=now()-interval '1 hour',earnings_state='PENDING'where id=any($1::uuid[])",[[delivered,openDispute,unverified]]);
   await pg.query("update orders set status='DISPUTED',completed_at=now()-interval '1 hour',earnings_state='RESERVED'where id=$1",[disputed]);
   for(const id of [disputed,openDispute])await pg.query("insert into disputes(id,university_id,opened_by_user_id,order_id,reason)values($1,$2,$3,$4,'Historical release hold fixture')",[crypto.randomUUID(),campus,buyer,id]);
  }finally{await pg.exec('alter table orders enable trigger priced_store_earnings_release');}
  const beforePending=await balance(seller,'VENDOR_PENDING');
  const net=Number((await pg.query<{seller_net_kobo:number}>('select seller_net_kobo from app_private.order_price_snapshots where order_id=$1',[delivered])).rows[0]!.seller_net_kobo);
  const migration=readFileSync(new URL('../../database/neon/migrations/20261017163000_release_completed_store_earnings.sql',import.meta.url),'utf8');
  await pg.exec(migration);
  await pg.exec(migration);
  expect(await balance(seller,'VENDOR_AVAILABLE')).toBe(net);
  expect(await balance(seller,'VENDOR_PENDING')).toBe(beforePending-net);
  const states=(await pg.query<{id:string;status:string;earnings_state:string}>('select id,status,earnings_state from orders where id=any($1::uuid[])',[[delivered,paid,disputed,openDispute,unverified]])).rows;
  expect(states.find(o=>o.id===delivered)?.earnings_state).toBe('AVAILABLE');
  expect(states.find(o=>o.id===paid)?.status).toBe('PAID');
  expect(states.find(o=>o.id===disputed)?.earnings_state).toBe('RESERVED');
  expect(states.find(o=>o.id===openDispute)?.earnings_state).toBe('PENDING');
  expect(states.find(o=>o.id===unverified)?.earnings_state).toBe('PENDING');
  const posted=(await pg.query<{count:number;net:number}>("select count(distinct t.id)::int as count,sum(case when l.direction='DEBIT'then l.amount_kobo else-l.amount_kobo end)::bigint as net from ledger_transactions t join ledger_lines l on l.transaction_id=t.id where t.idempotency_key=$1",['store-release:'+delivered])).rows[0]!;
  expect(posted.count).toBe(1);expect(Number(posted.net)).toBe(0);
  expect(Number((await json(await request('/agents/earnings',seller.user))).store.available_kobo)).toBe(net);
  await pg.exec('alter table orders disable trigger priced_store_earnings_release');
  try{await expect(pg.exec(migration)).rejects.toThrow('STORE_RELEASE_TRIGGER_REQUIRED');}
  finally{await pg.exec('rollback; alter table orders enable trigger priced_store_earnings_release');}
 });
 it('reserves two vendors once, pays each share once, coordinates pickup and releases only after the buyer code',async()=>{
  const second=await person(crypto.randomUUID(),campus,'VENDOR'),p2=crypto.randomUUID();
  await pg.query("insert into vendor_storefronts(vendor_profile_id,university_id,display_name,description,contact_phone_e164,pickup_location,opening_hours,status,pickup_enabled,submitted_at,reviewed_at,reviewed_by_user_id,moderated_revision)select $1,university_id,'Second fixture store',description,contact_phone_e164,'Second fixture address',opening_hours,status,true,submitted_at,reviewed_at,reviewed_by_user_id,1 from vendor_storefronts where vendor_profile_id=$2",[second.profile,vendor]);
  await pg.query("insert into vendor_products(id,university_id,vendor_profile_id,name,description,category,category_id,price_kobo,stock_quantity,status,moderated_revision,submitted_at,reviewed_at,reviewed_by_user_id,package_weight_grams,package_length_cm,package_width_cm,package_height_cm,bicycle_delivery_eligible)select $1,university_id,$2,'Second fixture item',description,category,category_id,200000,20,status,1,submitted_at,reviewed_at,reviewed_by_user_id,300,10,10,10,true from vendor_products where id=$3",[p2,second.profile,product]);
  await pg.query("insert into commerce_pickup_hubs(university_id,name,position)values($1,'Engineering',1)on conflict do nothing",[campus]);
  const catalog=await json(await request('/student/store',buyer)),first=catalog.products.find((p:any)=>p.id===product),other=catalog.products.find((p:any)=>p.id===p2);
  const input={...quoteInput('PICKUP'),pickupPointName:'Engineering',items:[{productId:product,quantity:1,expectedUnitPriceKobo:Number(first.price_kobo)},{productId:p2,quantity:2,expectedUnitPriceKobo:Number(other.price_kobo)}]};
  const q=await json(await request('/student/order-quotes',buyer,'POST',input),201);
  const o=await json(await request('/student/orders',buyer,'POST',{...input,quoteId:q.quote.id}),201);
  const allocations=(await pg.query<{vendor_user_id:string;seller_net_kobo:number}>('select * from app_private.order_vendor_allocations where order_id=$1',[o.id])).rows;expect(allocations).toHaveLength(2);
  const snapshot=(await pg.query<{seller_net_kobo:number}>('select seller_net_kobo from app_private.order_price_snapshots where order_id=$1',[o.id])).rows[0]!;
  expect(allocations.reduce((n,a)=>n+Number(a.seller_net_kobo),0)).toBe(Number(snapshot.seller_net_kobo));
  const ref='K1-O-'+crypto.randomUUID();await pg.query("insert into payment_attempts(id,user_id,university_id,resource_type,resource_id,provider_reference,amount_kobo,idempotency_key,status)values($1,$2,$3,'STORE_ORDER',$4,$5,$6,$1::uuid::text,'INITIALIZED')",[crypto.randomUUID(),buyer,campus,o.id,ref,o.payableKobo]);
  const fee=q.quote.pricing.estimatedProcessingKobo??0;
  const settled=(await pg.query<{result:string}>('select app_private.record_priced_store_receipt($1,$2,$3,now()) result',[ref,o.payableKobo,fee])).rows[0]!.result;expect(settled).toBe('PAID');
  const pending=await balance(second,'VENDOR_PENDING'),available=await balance(second,'VENDOR_AVAILABLE');expect(pending).toBeGreaterThan(0);expect(available).toBe(0);
  expect((await pg.query<{result:string}>('select app_private.record_priced_store_receipt($1,$2,$3,now()) result',[ref,o.payableKobo,fee])).rows[0]!.result).toBe('ALREADY_PAID');expect(await balance(second,'VENDOR_PENDING')).toBe(pending);
  const mine=await json(await request('/agents/orders/'+o.id,second.user));expect(mine.items).toHaveLength(1);expect(mine.items[0].quantity).toBe(2);
  const wrong=await person();expect((await request('/agents/orders/'+o.id,wrong.user)).status).toBe(403);
  await json(await request('/agents/orders/'+o.id+'/status',second.user,'PATCH',{status:'ACCEPTED'}));await json(await request('/agents/orders/'+o.id+'/status',second.user,'PATCH',{status:'READY'}));
  expect((await pg.query<{status:string}>('select status from orders where id=$1',[o.id])).rows[0]!.status).toBe('PAID');
  expect((await pg.query<{result:string}>("select app_private.coordinate_campus_order($1,$2,'READY',null) result",[o.id,otherCampus])).rows[0]!.result).toBe('INVALID_STATE');
  await pg.query("select app_private.coordinate_campus_order($1,$2,'READY',null)",[o.id,campus]);
  expect((await pg.query<{result:string}>("select app_private.coordinate_campus_order($1,$2,'COMPLETE','wrong') result",[o.id,campus])).rows[0]!.result).toBe('INCORRECT');expect(await balance(second,'VENDOR_AVAILABLE')).toBe(0);
  const code=await deriveHandoffCode(env,o.id,'delivery');expect((await pg.query<{result:string}>("select app_private.coordinate_campus_order($1,$2,'COMPLETE',$3) result",[o.id,campus,code.hash])).rows[0]!.result).toBe('OK');
  expect(await balance(second,'VENDOR_PENDING')).toBe(0);expect(await balance(second,'VENDOR_AVAILABLE')).toBe(pending);
  await pg.query("update orders set status='DELIVERED' where id=$1",[o.id]);expect(await balance(second,'VENDOR_AVAILABLE')).toBe(pending);
  const dispute=crypto.randomUUID();await pg.query("insert into disputes(id,university_id,opened_by_user_id,order_id,reason)values($1,$2,$3,$4,'Synthetic delivered item dispute')",[dispute,campus,buyer,o.id]);
  await pg.query("update orders set status='DISPUTED',earnings_state='RESERVED'where id=$1",[o.id]);expect(await balance(second,'VENDOR_AVAILABLE')).toBe(0);expect(await balance(second,'VENDOR_PENDING')).toBe(pending);
  await pg.query("update disputes set status='RESOLVED',resolution_code='RELEASE_EARNINGS'where id=$1",[dispute]);await pg.query("update orders set status='DELIVERED',earnings_state='PENDING'where id=$1",[o.id]);expect(await balance(second,'VENDOR_AVAILABLE')).toBe(pending);expect(await balance(second,'VENDOR_PENDING')).toBe(0);
  await expect(pg.query('update app_private.order_vendor_allocations set seller_net_kobo=1 where order_id=$1',[o.id])).rejects.toThrow('IMMUTABLE');
 });
 it('publishes a video playlist and gives every free part private, campus-scoped access',async()=>{
  const tutor=await person(crypto.randomUUID(),campus,'TUTOR'),part1=crypto.randomUUID(),part2=crypto.randomUUID();
  for(const id of [part1,part2])await pg.query("insert into media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name)values($1,$2,$3,'resource',$1::uuid::text,'video/mp4',100,'fixture.mp4')",[id,tutor.user,campus]);
  const details={requestId:crypto.randomUUID(),title:'Physics playlist',description:'Two parts of synthetic physics lessons.',courseCode:'PHY102',subject:'Physics',resourceType:'VIDEO',accessModel:'FREE',priceKobo:0,parts:[{mediaId:part1,title:'Part one'},{mediaId:part2,title:'Part two'}]};
  const published=await json(await request('/agents/learning-publish',tutor.user,'POST',details),201);expect((await request('/agents/learning-publish',tutor.user,'POST',{...details,title:'Different title'})).status).toBe(409);
  const detail=await json(await request('/student/tutorial-resources/'+published.id,buyer));expect(detail.resource.parts).toHaveLength(2);expect(detail.resource.can_access).toBe(true);
  const media=await json(await request('/media/'+part2+'/access',buyer,'POST',{}));expect(media).toBeTruthy();
  const stranger=await person(crypto.randomUUID(),otherCampus);expect((await request('/media/'+part2+'/access',stranger.user,'POST',{},otherCampus)).status).toBe(403);
  await pg.query("update agent_profiles set status='PAUSED',suspension_ends_at=now()+interval '2 days',suspension_reason='Fixture review' where id=$1",[tutor.profile]);
  expect((await request('/agents/tutorials',tutor.user)).status).toBe(200);expect((await request('/agents/learning-publish',tutor.user,'POST',{...details,requestId:crypto.randomUUID()})).status).toBe(403);
  expect((await request('/media/'+part2+'/access',buyer,'POST',{})).status).toBe(403);
 });
});
