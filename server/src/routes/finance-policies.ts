import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { currentUser } from "../middleware/auth";
import { resolveAdminScope } from "../lib/admin-access";
import { recordAudit } from "../lib/audit";
import { database } from "../lib/database";
import { input } from "../lib/input";
import { AppError } from "../lib/errors";
import { inclusiveStoreReady } from "../lib/commerce-pricing";
import { pricedTutorialReady } from "../lib/tutorial-pricing";
import { kiraBillingReady } from "../lib/kira-billing";
import { materialCommerceReady } from "../lib/material-commerce";
import { ledgerPayoutsReady } from "../lib/payouts";
import {
  listingPrice,
  checkoutPrice,
  campusFare,
  publishedNigeriaLocalFees,
  fixedSubscriptionPrice,
  type CommerceFees,
} from "../lib/pricing";
import { sha256 } from "../lib/security";
import type { Bindings, Variables } from "../types";
export const financePolicyRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();
financePolicyRoutes.get("/transfer-policies", async (c) => {
  const scope = await resolveAdminScope(
    c.env,
    currentUser(c),
    c.req.query("universityId"),
    "finance.view",
  );
  if (!(await ledgerPayoutsReady(c.env)))
    return c.json({ ready: false, policies: [] });
  const rows = await database(c.env)
    .execute(sql`select p.id,p.university_id,p.agent_type,p.version,p.fee_bearer,p.low_fee_kobo,p.middle_fee_kobo,p.high_fee_kobo,p.duty_threshold_kobo,p.duty_kobo,p.source_url,p.approval_note,p.approved_at,a.policy_id=p.id as active
  from app_private.payout_cost_policies p left join app_private.active_payout_cost_policies a on a.university_id=p.university_id and a.agent_type=p.agent_type where (${scope}::uuid is null or p.university_id=${scope}::uuid) order by p.approved_at desc limit 100`);
  return c.json({ ready: true, policies: rows.rows });
});
financePolicyRoutes.post("/transfer-policies", async (c) => {
  const data = await input(
    c,
    z
      .object({
        universityId: z.string().uuid(),
        agentType: z.enum(["VENDOR", "TUTOR", "RIDER"]),
        version: z.string().trim().min(3).max(80),
        feeBearer: z.enum(["PLATFORM", "PAYEE"]),
        lowFeeKobo: z.number().int().min(0).max(1000000),
        middleFeeKobo: z.number().int().min(0).max(1000000),
        highFeeKobo: z.number().int().min(0).max(1000000),
        dutyThresholdKobo: z.number().int().min(0).max(2000000000),
        dutyKobo: z.number().int().min(0).max(1000000),
        sourceUrl: z.url().refine((v) => {
          const u = new URL(v);
          return (
            u.protocol === "https:" &&
            [
              "paystack.com",
              "support.paystack.com",
              "dashboard.paystack.com",
            ].includes(u.hostname)
          );
        }),
        approvalNote: z.string().trim().min(10).max(2000),
      })
      .strict(),
  );
  const user = currentUser(c);
  await resolveAdminScope(c.env, user, data.universityId, "finance.review");
  if (!(await ledgerPayoutsReady(c.env)))
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "Transfer policies are awaiting the database update.",
    );
  const policyId = crypto.randomUUID();
  try {
    await database(c.env)
      .execute(sql`with added as(insert into app_private.payout_cost_policies(id,university_id,agent_type,version,fee_bearer,low_fee_kobo,middle_fee_kobo,high_fee_kobo,duty_threshold_kobo,duty_kobo,source_url,approval_note,approved_by)
  values(${policyId}::uuid,${data.universityId}::uuid,${data.agentType},${data.version},${data.feeBearer},${data.lowFeeKobo},${data.middleFeeKobo},${data.highFeeKobo},${data.dutyThresholdKobo},${data.dutyKobo},${data.sourceUrl},${data.approvalNote},${user.id}::uuid) returning *)
  insert into app_private.active_payout_cost_policies(university_id,agent_type,policy_id)select university_id,agent_type,id from added on conflict(university_id,agent_type)do update set policy_id=excluded.policy_id`);
  } catch (e) {
    if (e instanceof Error && e.message.includes("unique"))
      throw new AppError(
        409,
        "CONFLICT",
        "Use a new version for this reviewed transfer policy.",
      );
    throw e;
  }
  await recordAudit(c.env, {
    actorUserId: user.id,
    universityId: data.universityId,
    action: "finance.transfer_policy_approved",
    targetType: "payout_cost_policy",
    targetId: policyId,
    requestId: c.get("requestId"),
    metadata: {
      agentType: data.agentType,
      version: data.version,
      feeBearer: data.feeBearer,
    },
  });
  return c.json({ id: policyId }, 201);
});
const money = z.number().int().min(0).max(2_000_000_000),
  percentage = z.number().int().min(0).max(9999);
export const commercePolicySchema = z
  .object({
    universityId: z.string().uuid(),
    kind: z.enum(["STORE", "TUTORIAL"]),
    version: z.string().trim().min(3).max(80),
    buyerBasisPoints: percentage,
    buyerFlatPerItemKobo: money.max(10000000),
    sellerCommissionBasisPoints: percentage,
    collection: z
      .object({
        basisPoints: percentage,
        flatKobo: money,
        flatWaivedBelowKobo: money,
        capKobo: money.nullable(),
      })
      .strict(),
    checkoutSavings: z.boolean(),
    allowProcessorSubsidy: z.boolean(),
    sourceUrl: z.url().refine((v) => {
      const u = new URL(v);
      return (
        u.protocol === "https:" &&
        [
          "paystack.com",
          "support.paystack.com",
          "dashboard.paystack.com",
        ].includes(u.hostname)
      );
    }),
    approvalNote: z.string().trim().min(10).max(2000),
  })
  .strict();
financePolicyRoutes.get("/kira-plans", async (c) => {
  const scope = await resolveAdminScope(
    c.env,
    currentUser(c),
    c.req.query("universityId"),
    "finance.view",
  );
  if (!(await kiraBillingReady(c.env)))
    return c.json({ ready: false, plans: [], amountKobo: 600000 });
  const plans = await database(c.env)
    .execute(sql`select p.id,p.university_id,p.version,p.amount_kobo,p.collection,p.estimated_processing_kobo,p.approved_at,a.plan_id=p.id as active
    from app_private.kira_price_plans p left join app_private.active_kira_price_plans a on a.university_id=p.university_id
    where (${scope}::uuid is null or p.university_id=${scope}::uuid) order by p.approved_at desc limit 100`);
  return c.json({ ready: true, plans: plans.rows, amountKobo: 600000 });
});
financePolicyRoutes.post("/kira-plans", async (c) => {
  const data = await input(
    c,
    commercePolicySchema.pick({
      universityId: true,
      version: true,
      collection: true,
      sourceUrl: true,
      approvalNote: true,
    }),
  );
  const user = currentUser(c);
  await resolveAdminScope(c.env, user, data.universityId, "finance.review");
  if (!(await kiraBillingReady(c.env)))
    throw new AppError(
      409,
      "CONFLICT",
      "Kira billing is awaiting its verified subscription database update.",
    );
  const price = fixedSubscriptionPrice(data.collection);
  if (price.estimatedNetKobo <= 0)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "The processing rule must leave a positive net at the fixed ₦6,000 plan price.",
    );
  const id = crypto.randomUUID();
  try {
    await database(c.env).execute(sql`with new_plan as (
    insert into app_private.kira_price_plans(id,university_id,version,collection,estimated_processing_kobo,approved_by,approval_note,source_url)
    values(${id}::uuid,${data.universityId}::uuid,${data.version},${JSON.stringify(data.collection)}::jsonb,${price.estimatedProcessingKobo},${user.id}::uuid,${data.approvalNote},${data.sourceUrl}) returning id,university_id
  ) insert into app_private.active_kira_price_plans(university_id,plan_id)select university_id,id from new_plan on conflict(university_id)do update set plan_id=excluded.plan_id`);
  } catch (e) {
    if (
      e instanceof Error &&
      e.message.includes("kira_price_plans_university_id_version_key")
    )
      throw new AppError(
        409,
        "CONFLICT",
        "That Kira plan version is already approved. Use a new version name.",
      );
    throw e;
  }
  await recordAudit(c.env, {
    actorUserId: user.id,
    universityId: data.universityId,
    action: "kira.price_plan.approved",
    targetType: "kira_price_plan",
    targetId: id,
    requestId: c.get("requestId"),
    metadata: { ...data, ...price },
  });
  return c.json({ id, price }, 201);
});
async function ready(env: Bindings) {
  if (!(await inclusiveStoreReady(env)))
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "Price policies are awaiting the scheduled financial database update.",
    );
}
financePolicyRoutes.get("/fee-policies", async (c) => {
  const scope = await resolveAdminScope(
    c.env,
    currentUser(c),
    c.req.query("universityId"),
    "finance.view",
  );
  if (!(await inclusiveStoreReady(c.env)))
    return c.json({
      ready: false,
      policies: [],
      publishedLocalBaseline: publishedNigeriaLocalFees,
    });
  const rows = await database(c.env)
    .execute(sql`select p.*,a.policy_id=p.id as active from app_private.commerce_fee_policies p
    left join app_private.active_commerce_fee_policies a on a.university_id=p.university_id and a.kind=p.kind
    where (${scope}::uuid is null or p.university_id=${scope}::uuid) order by p.approved_at desc limit 100`);
  return c.json({
    ready: true,
    policies: rows.rows,
    publishedLocalBaseline: publishedNigeriaLocalFees,
  });
});
financePolicyRoutes.get("/receipts", async (c) => {
  const scope = await resolveAdminScope(
    c.env,
    currentUser(c),
    c.req.query("universityId"),
    "finance.view",
  );
  if (!(await inclusiveStoreReady(c.env)))
    return c.json({ ready: false, receipts: [] });
  const tutorialReady = await pricedTutorialReady(c.env),
    kiraReady = await kiraBillingReady(c.env),
    materialReady = await materialCommerceReady(c.env);
  const receipts = await database(c.env)
    .execute(sql`select r.provider_reference,r.university_id,r.purpose,r.resource_id,r.amount_kobo,r.provider_fee_kobo,r.paid_at,
    coalesce(q.pricing->>'estimatedProcessingKobo',${tutorialReady ? sql`tp.estimated_processing_kobo::text` : sql`null::text`},${kiraReady ? sql`kp.estimated_processing_kobo::text` : sql`null::text`},${materialReady ? sql`mq.pricing->>'estimatedProcessingKobo'` : sql`null::text`}) as estimated_processing_kobo,
    exists(select 1 from public.ledger_transactions t where t.idempotency_key in ('priced-payment:'||r.provider_reference,'rider-repayment:'||r.provider_reference,'tutorial-payment:'||r.provider_reference,'kira-payment:'||r.provider_reference,'material-payment:'||r.provider_reference)) as allocated
    from app_private.verified_paystack_receipts r left join app_private.order_price_snapshots s on s.order_id=r.resource_id and r.purpose='STORE_ORDER'
      left join app_private.store_checkout_quotes q on q.id=s.quote_id
      ${tutorialReady ? sql`left join app_private.tutorial_booking_prices tp on tp.booking_id=r.resource_id and r.purpose='TUTORIAL_BOOKING'` : sql``}
      ${kiraReady ? sql`left join app_private.kira_checkouts kc on kc.id=r.resource_id and r.purpose='KIRA_SUBSCRIPTION' left join app_private.kira_price_plans kp on kp.id=kc.plan_id` : sql``}
      ${materialReady ? sql`left join app_private.material_checkout_quotes mq on mq.id=r.resource_id and r.purpose='TUTORIAL_PURCHASE'` : sql``}
    where (${scope}::uuid is null or r.university_id=${scope}::uuid) order by r.recorded_at desc limit 100`);
  return c.json({ ready: true, receipts: receipts.rows });
});
financePolicyRoutes.get("/delivery-zones", async (c) => {
  const scope = await resolveAdminScope(
    c.env,
    currentUser(c),
    c.req.query("universityId"),
    "finance.view",
  );
  if (!(await inclusiveStoreReady(c.env)))
    return c.json({ ready: false, zones: [] });
  const zones = await database(c.env)
    .execute(sql`select id,university_id,name,active,route_distance_metres,base_fee_kobo,rider_earning_kobo
    from public.delivery_zones where (${scope}::uuid is null or university_id=${scope}::uuid) order by name limit 200`);
  return c.json({ ready: true, zones: zones.rows });
});
financePolicyRoutes.put("/delivery-zones/:id/distance", async (c) => {
  const data = await input(
    c,
    z.object({
      universityId: z.string().uuid(),
      distanceMetres: z.number().int().min(0).max(100000),
      reason: z.string().trim().min(10).max(1000),
    }),
  );
  const user = currentUser(c);
  await resolveAdminScope(c.env, user, data.universityId, "finance.review");
  await ready(c.env);
  const zoneId = z.string().uuid().safeParse(c.req.param("id"));
  if (!zoneId.success)
    throw new AppError(400, "BAD_REQUEST", "Choose a valid delivery zone.");
  const fare = campusFare(data.distanceMetres);
  const updated = await database(c.env)
    .execute(sql`update public.delivery_zones set route_distance_metres=${data.distanceMetres},base_fee_kobo=${fare.fareKobo},
    rider_earning_kobo=${fare.riderNetKobo},earning_formula_version=${fare.tariffVersion},updated_at=now()
    where id=${zoneId.data}::uuid and university_id=${data.universityId}::uuid returning id`);
  if (!updated.rows.length)
    throw new AppError(
      404,
      "NOT_FOUND",
      "That delivery zone is outside this campus scope.",
    );
  await recordAudit(c.env, {
    actorUserId: user.id,
    universityId: data.universityId,
    action: "finance.campus_zone_distance_reviewed",
    targetType: "delivery_zone",
    targetId: zoneId.data,
    requestId: c.get("requestId"),
    metadata: { ...fare, basis: "CAMPUS_ZONE", reason: data.reason },
  });
  return c.json({ fare: { ...fare, distanceBasis: "CAMPUS_ZONE" } });
});
financePolicyRoutes.post("/fee-policy-preview", async (c) => {
  const data = await input(
    c,
    commercePolicySchema.extend({
      samples: z
        .array(
          z.object({
            baseKobo: money,
            quantity: z.number().int().min(1).max(100),
          }),
        )
        .min(1)
        .max(30),
    }),
  );
  await resolveAdminScope(
    c.env,
    currentUser(c),
    data.universityId,
    "finance.review",
  );
  const policy: CommerceFees = { ...data, id: "preview" };
  try {
    return c.json({
      listings: data.samples.map((i) => listingPrice(i.baseKobo, policy)),
      checkout: checkoutPrice(data.samples, policy, null),
      approved: false,
    });
  } catch (e) {
    if (e instanceof RangeError)
      throw new AppError(400, "BAD_REQUEST", e.message);
    throw e;
  }
});
financePolicyRoutes.post("/fee-policies", async (c) => {
  const data = await input(c, commercePolicySchema),
    user = currentUser(c);
  await resolveAdminScope(c.env, user, data.universityId, "finance.review");
  await ready(c.env);
  const policy: CommerceFees = { ...data, id: "approval-validation" };
  if (data.kind === "TUTORIAL" && !(await pricedTutorialReady(c.env)))
    throw new AppError(
      409,
      "CONFLICT",
      "Tutorial pricing awaits its verified settlement database update. Previewing a policy is available.",
    );
  // Validate both fee bands, the cap, and a threshold-crossing cart before publishing this version.
  try {
    for (const base of [50000, 249900, 250000, 350000, 600000, 15000000])
      listingPrice(base, policy);
    checkoutPrice([{ baseKobo: 50000, quantity: 5 }], policy, null);
  } catch (e) {
    if (e instanceof RangeError)
      throw new AppError(400, "BAD_REQUEST", e.message);
    throw e;
  }
  const policyId = crypto.randomUUID();
  try {
    await database(c.env).execute(sql`with new_policy as (
    insert into app_private.commerce_fee_policies(id,university_id,kind,version,buyer_basis_points,buyer_flat_per_item_kobo,seller_commission_basis_points,collection,checkout_savings,allow_processor_subsidy,source_url,approval_note,approved_by)
    values(${policyId}::uuid,${data.universityId}::uuid,${data.kind},${data.version},${data.buyerBasisPoints},${data.buyerFlatPerItemKobo},${data.sellerCommissionBasisPoints},${JSON.stringify(data.collection)}::jsonb,
      ${data.checkoutSavings},${data.allowProcessorSubsidy},${data.sourceUrl},${data.approvalNote},${user.id}::uuid) returning id,university_id,kind
  ) insert into app_private.active_commerce_fee_policies(university_id,kind,policy_id) select university_id,kind,id from new_policy
    on conflict(university_id,kind) do update set policy_id=excluded.policy_id`);
  } catch (e) {
    if (
      e instanceof Error &&
      e.message.includes("commerce_fee_policies_university_id_kind_version_key")
    )
      throw new AppError(
        409,
        "CONFLICT",
        "That policy version was already approved. Use a new version name.",
      );
    throw e;
  }
  await recordAudit(c.env, {
    actorUserId: user.id,
    universityId: data.universityId,
    action: "finance.policy_approved",
    targetType: "commerce_fee_policy",
    targetId: policyId,
    requestId: c.get("requestId"),
    metadata: {
      kind: data.kind,
      version: data.version,
      allowProcessorSubsidy: data.allowProcessorSubsidy,
    },
  });
  return c.json({ id: policyId, active: true }, 201);
});
financePolicyRoutes.post("/check-published-fees", async (c) => {
  const data = await input(c, z.object({ universityId: z.string().uuid() })),
    user = currentUser(c);
  await resolveAdminScope(c.env, user, data.universityId, "finance.review");
  const sourceUrl = "https://paystack.com/pricing";
  let html: string;
  try {
    const response = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(10000),
    });
    if (
      !response.ok ||
      Number(response.headers.get("content-length") ?? 0) > 1000000
    )
      throw new Error("Unavailable");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty");
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 1000000) {
        await reader.cancel();
        throw new Error("Too large");
      }
      chunks.push(chunk.value);
    }
    const decoded = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      decoded.set(chunk, offset);
      offset += chunk.length;
    }
    html = new TextDecoder().decode(decoded);
  } catch {
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Paystack’s published pricing page could not be checked. Existing approved prices are unchanged.",
    );
  }
  const page = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const matched =
    /1\.5\s*%/.test(page) &&
    /(?:NGN|₦)\s*100\b/.test(page) &&
    /2,?500/.test(page) &&
    /2,?000/.test(page);
  const checkedAt = new Date().toISOString();
  await recordAudit(c.env, {
    actorUserId: user.id,
    universityId: data.universityId,
    action: "finance.published_fees_checked",
    targetType: "provider_fee_check",
    targetId: crypto.randomUUID(),
    requestId: c.get("requestId"),
    metadata: {
      sourceUrl,
      checkedAt,
      contentHash: await sha256(html),
      matchedPublishedBaseline: matched,
    },
  });
  return c.json({
    status: matched ? "BASELINE_FOUND" : "REVIEW_REQUIRED",
    sourceUrl,
    checkedAt,
    publishedLocalBaseline: matched ? publishedNigeriaLocalFees : null,
    approvalRequired: true,
    message:
      "This check stages published rates. Confirm your merchant fees, taxes and transfer deductions before approving a new price policy. Existing quotes keep their agreed totals.",
  });
});
