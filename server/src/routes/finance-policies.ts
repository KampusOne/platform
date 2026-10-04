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
import { kiraBillingReady, resolveKiraPlanPrice } from "../lib/kira-billing";
import { resolveProviderCollection } from "../lib/payment-pricing";
import { materialCommerceReady } from "../lib/material-commerce";
import { payoutFeeComponentsReady } from "../lib/payouts";
import {
  listingPrice,
  checkoutPrice,
  campusFare,
  publishedNigeriaLocalFees,
  kiraSubscriptionPrice,
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
  if (!(await payoutFeeComponentsReady(c.env)))
    return c.json({ ready: false, policies: [] });
  const rows = await database(c.env)
    .execute(sql`select p.id,p.university_id,p.agent_type,p.version,p.fee_bearer,p.low_fee_kobo,p.middle_fee_kobo,p.high_fee_kobo,p.duty_threshold_kobo,p.duty_kobo,p.minimum_withdrawal_kobo,p.statutory_duty_policy,p.source_url,p.approval_note,p.approved_at,a.policy_id=p.id as active
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
        minimumWithdrawalKobo: z.number().int().min(1).max(1_000_000_000).default(500000),
        statutoryDutyPolicy: z.literal("PLATFORM_ABSORBS_PENDING_STATEMENT").default("PLATFORM_ABSORBS_PENDING_STATEMENT"),
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
  if (!(await payoutFeeComponentsReady(c.env)))
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "Transfer policies are awaiting the database update.",
    );
  const policyId = crypto.randomUUID();
  const previous = (await database(c.env).execute(sql`select p.* from app_private.active_payout_cost_policies a join app_private.payout_cost_policies p on p.id=a.policy_id where a.university_id=${data.universityId}::uuid and a.agent_type=${data.agentType}`)).rows[0] ?? null;
  try {
    await database(c.env)
      .execute(sql`with added as(insert into app_private.payout_cost_policies(id,university_id,agent_type,version,fee_bearer,low_fee_kobo,middle_fee_kobo,high_fee_kobo,duty_threshold_kobo,duty_kobo,minimum_withdrawal_kobo,statutory_duty_policy,source_url,approval_note,approved_by)
  values(${policyId}::uuid,${data.universityId}::uuid,${data.agentType},${data.version},${data.feeBearer},${data.lowFeeKobo},${data.middleFeeKobo},${data.highFeeKobo},${data.dutyThresholdKobo},${data.dutyKobo},${data.minimumWithdrawalKobo},${data.statutoryDutyPolicy},${data.sourceUrl},${data.approvalNote},${user.id}::uuid) returning *)
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
      previousPolicy: previous,
      approvedPolicy: data,
      reason: data.approvalNote,
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
    providerProfileId: z.string().uuid().optional(),
    feeBearer: z.enum(["PLATFORM_ABSORBS","SELLER_ABSORBS","BUYER_VISIBLE","INCLUDED_IN_PRICE","SPLIT"]).optional(),
    customerFeeDisplay: z.enum(["INCLUDED","SEPARATE"]).optional(),
    feeSplit: z.object({platformBasisPoints:z.number().int().min(0).max(10000),sellerBasisPoints:z.number().int().min(0).max(10000),buyerBasisPoints:z.number().int().min(0).max(10000)}).strict().optional(),
    roundingMode: z.enum(["NONE","NEAREST_50","CEIL_50","NEAREST_100","CEIL_100","FRIENDLY_9"]).optional(),
    maxPricingAdjustmentKobo: money.optional(),
    minimumCommissionKobo: money.optional(),
    maximumCommissionKobo: money.nullable().optional(),
    collection: z
      .object({
        basisPoints: percentage,
        flatKobo: money,
        flatWaivedBelowKobo: money,
        capKobo: money.nullable(),
        displayRoundKobo: z.number().int().min(100).max(100000).multipleOf(100).default(10000),
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
async function reviewedCommercePolicy(env: Bindings, data: z.infer<typeof commercePolicySchema>, id: string): Promise<CommerceFees> {
  const collection: CommerceFees["collection"] = data.providerProfileId || env.ENVIRONMENT === "production"
    ? await resolveProviderCollection(env, data.universityId, data.providerProfileId)
    : data.collection;
  if (data.feeBearer === "SPLIT" && (!data.feeSplit || Object.values(data.feeSplit).reduce((sum,value)=>sum+value,0)!==10000))
    throw new AppError(400,"BAD_REQUEST","The platform, seller and buyer fee shares must total 100%.");
  if (data.maximumCommissionKobo !== undefined && data.maximumCommissionKobo !== null && (data.minimumCommissionKobo??0)>data.maximumCommissionKobo)
    throw new AppError(400,"BAD_REQUEST","The minimum commission must not exceed the maximum.");
  const options = Object.fromEntries(["feeBearer","customerFeeDisplay","feeSplit","roundingMode","maxPricingAdjustmentKobo","minimumCommissionKobo","maximumCommissionKobo"].filter(key=>(data as Record<string,unknown>)[key]!==undefined).map(key=>[key,(data as Record<string,unknown>)[key]])) as Partial<CommerceFees>;
  return {...options,id,collection,buyerBasisPoints:data.buyerBasisPoints,buyerFlatPerItemKobo:data.buyerFlatPerItemKobo,sellerCommissionBasisPoints:data.sellerCommissionBasisPoints,checkoutSavings:data.checkoutSavings,allowProcessorSubsidy:data.allowProcessorSubsidy,...(collection.providerProfileId?{providerProfileId:collection.providerProfileId}:{})};
}
export const kiraPlanSchema = commercePolicySchema.pick({universityId:true}).extend({
  // Routine changes need only the actual price and offer. The server records
  // the actor and generates the immutable version and change note.
  version:commercePolicySchema.shape.version.default(()=>`KIRA_${new Date().toISOString()}_${crypto.randomUUID().slice(0,8)}`),
  sourceUrl:commercePolicySchema.shape.sourceUrl.default('https://paystack.com/pricing'),
  approvalNote:commercePolicySchema.shape.approvalNote.default('Administrator saved Kira monthly pricing and offer settings.'),
  collection:commercePolicySchema.shape.collection.optional(),providerProfileId:z.string().uuid().optional(),
  tier:z.enum(['standard','pro']).default('pro'),amountKobo:z.number().int().min(0).max(100000000).default(600000),discountPercent:z.number().int().min(0).max(90).default(0),
  active:z.boolean().default(true),available:z.boolean().default(true),offerActive:z.boolean().default(true),
  offerStartsAt:z.string().datetime({offset:true}).nullable().default(null),offerEndsAt:z.string().datetime({offset:true}).nullable().default(null),
}).strict().superRefine((d,ctx)=>{
  if((d.tier==='pro' && d.amountKobo<100000)||(d.tier==='standard' && d.amountKobo!==0 && d.amountKobo<100000))ctx.addIssue({code:'custom',path:['amountKobo'],message:'Set a monthly price of at least ₦1,000, or keep Standard free.'});
  if(d.amountKobo===0 && d.discountPercent!==0)ctx.addIssue({code:'custom',path:['discountPercent'],message:'A free plan cannot claim a discount.'});
  if(d.offerStartsAt && d.offerEndsAt && Date.parse(d.offerEndsAt)<=Date.parse(d.offerStartsAt))ctx.addIssue({code:'custom',path:['offerEndsAt'],message:'The offer must end after it starts.'});
});
async function kiraApprovalPrice(env:Bindings,data:z.infer<typeof kiraPlanSchema>){
  const collection=env.ENVIRONMENT==='local' && !data.providerProfileId && data.collection?data.collection:await resolveProviderCollection(env,data.universityId,data.providerProfileId);
  const nominal=resolveKiraPlanPrice(data.amountKobo,{offerActive:true,offerStartsAt:null,offerEndsAt:null,discountPercent:data.discountPercent},collection),price=resolveKiraPlanPrice(data.amountKobo,data,collection);
  if(data.amountKobo>0 && nominal.expectedNetKobo<=0)throw new AppError(400,'BAD_REQUEST','The processing rule must leave a positive net after the discount.');
  return {collection,nominal,price};
}
financePolicyRoutes.post('/kira-plans/preview',async c=>{const data=await input(c,kiraPlanSchema);await resolveAdminScope(c.env,currentUser(c),data.universityId,'finance.review');const {price,collection}=await kiraApprovalPrice(c.env,data);return c.json({...price,price,collection});});
financePolicyRoutes.get("/kira-plans", async (c) => {
  const scope = await resolveAdminScope(
    c.env,
    currentUser(c),
    c.req.query("universityId"),
    "finance.view",
  );
  if (!(await kiraBillingReady(c.env)))
    return c.json({ ready: false, plans: [] });
  const plans = await database(c.env)
    .execute(sql`select p.id,p.university_id,p.tier,p.version,p.amount_kobo,p.listed_amount_kobo,p.discount_percent,p.collection,p.estimated_processing_kobo,p.approved_at,p.available,p.offer_active,p.offer_starts_at,p.offer_ends_at,p.active_status and a.plan_id=p.id as active,a.plan_id=p.id as selected,p.included_capabilities,p.limits,p.model_access,p.feature_flags
    from app_private.kira_price_plans p left join app_private.active_kira_price_plans a on a.university_id=p.university_id and a.tier=p.tier
    where (${scope}::uuid is null or p.university_id=${scope}::uuid) order by p.approved_at desc limit 100`);
  return c.json({ ready: true, plans: plans.rows.map(row=>{
    const p=row as unknown as {listed_amount_kobo:number;discount_percent:number;offer_active:boolean;offer_starts_at:string|null;offer_ends_at:string|null;collection:Parameters<typeof resolveKiraPlanPrice>[2]};
    const price=resolveKiraPlanPrice(Number(p.listed_amount_kobo),{offerActive:p.offer_active,discountPercent:Number(p.discount_percent),offerStartsAt:p.offer_starts_at,offerEndsAt:p.offer_ends_at},p.collection);
    return {...row,configured_discount_percent:p.discount_percent,amount_kobo:price.amountKobo,discount_percent:price.discountPercent,discount_amount_kobo:price.discountAmountKobo,estimated_processing_kobo:price.estimatedProcessingKobo,effective_offer_active:price.offerActive};
  }) });
});
financePolicyRoutes.post("/kira-plans", async (c) => {
  const data = await input(c,kiraPlanSchema);
  const user = currentUser(c);
  await resolveAdminScope(c.env, user, data.universityId, "finance.review");
  if (!(await kiraBillingReady(c.env)))
    throw new AppError(
      409,
      "CONFLICT",
      "Kira billing is awaiting its verified subscription database update.",
    );
  const {price,nominal,collection}=await kiraApprovalPrice(c.env,data);
  const id = crypto.randomUUID();
  try {
    await database(c.env).execute(sql`with new_plan as (
    insert into app_private.kira_price_plans(id,university_id,tier,plan_name,version,amount_kobo,listed_amount_kobo,discount_percent,active_status,available,offer_active,offer_starts_at,offer_ends_at,collection,estimated_processing_kobo,approved_by,approval_note,source_url,model_access,limits,included_capabilities)
    values(${id}::uuid,${data.universityId}::uuid,${data.tier},${data.tier==='pro'?'Kira Pro':'Kira Standard'},${data.version},${nominal.customerPriceKobo},${data.amountKobo},${data.discountPercent},${data.active},${data.available},${data.offerActive},${data.offerStartsAt}::timestamptz,${data.offerEndsAt}::timestamptz,${JSON.stringify(collection)}::jsonb,${nominal.estimatedProcessingKobo},${user.id}::uuid,${data.approvalNote},${data.sourceUrl},${data.tier},${JSON.stringify(data.tier==='pro'?{studyPerMonth:100,chatPerWindow:60,importsPerWeek:30}:{studyTrials:5,chatPerWindow:15,importsPerWeek:5})}::jsonb,${JSON.stringify(data.tier==='pro'?['Ask Kira','Study tools','Academic imports']:['Ask Kira','Manual academic tools','Standard study trials'])}::jsonb) returning id,university_id,tier
  ) insert into app_private.active_kira_price_plans(university_id,tier,plan_id)select university_id,tier,id from new_plan on conflict(university_id,tier)do update set plan_id=excluded.plan_id`);
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
    coalesce(q.pricing->>'estimatedProcessingKobo',${tutorialReady ? sql`tp.estimated_processing_kobo::text` : sql`null::text`},${kiraReady ? sql`coalesce(kq.estimated_processing_kobo,kp.estimated_processing_kobo)::text` : sql`null::text`},${materialReady ? sql`mq.pricing->>'estimatedProcessingKobo'` : sql`null::text`}) as estimated_processing_kobo,
    exists(select 1 from public.ledger_transactions t where t.idempotency_key in ('priced-payment:'||r.provider_reference,'rider-repayment:'||r.provider_reference,'tutorial-payment:'||r.provider_reference,'kira-payment:'||r.provider_reference,'material-payment:'||r.provider_reference)) as allocated
    from app_private.verified_paystack_receipts r left join app_private.order_price_snapshots s on s.order_id=r.resource_id and r.purpose='STORE_ORDER'
      left join app_private.store_checkout_quotes q on q.id=s.quote_id
      ${tutorialReady ? sql`left join app_private.tutorial_booking_prices tp on tp.booking_id=r.resource_id and r.purpose='TUTORIAL_BOOKING'` : sql``}
      ${kiraReady ? sql`left join app_private.kira_checkouts kc on kc.id=r.resource_id and r.purpose='KIRA_SUBSCRIPTION' left join app_private.kira_price_plans kp on kp.id=kc.plan_id left join app_private.kira_subscription_quotes kq on kq.id=kc.quote_id` : sql``}
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
  const policy = await reviewedCommercePolicy(c.env, data, "preview");
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
  const policy = await reviewedCommercePolicy(c.env, data, "approval-validation");
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
  const previous = (await database(c.env).execute(sql`select p.* from app_private.commerce_fee_policies p join app_private.active_commerce_fee_policies a on a.policy_id=p.id where a.university_id=${data.universityId}::uuid and a.kind=${data.kind}`)).rows[0]??null;
  const policyConfig = Object.fromEntries(["feeBearer","customerFeeDisplay","feeSplit","providerProfileId","roundingMode","maxPricingAdjustmentKobo","minimumCommissionKobo","maximumCommissionKobo"].filter(key=>(policy as unknown as Record<string,unknown>)[key]!==undefined).map(key=>[key,(policy as unknown as Record<string,unknown>)[key]]));
  try {
    await database(c.env).execute(sql`with new_policy as (
    insert into app_private.commerce_fee_policies(id,university_id,kind,version,buyer_basis_points,buyer_flat_per_item_kobo,seller_commission_basis_points,collection,checkout_savings,allow_processor_subsidy,source_url,approval_note,approved_by,policy_config)
    values(${policyId}::uuid,${data.universityId}::uuid,${data.kind},${data.version},${data.buyerBasisPoints},${data.buyerFlatPerItemKobo},${data.sellerCommissionBasisPoints},${JSON.stringify(policy.collection)}::jsonb,
      ${data.checkoutSavings},${data.allowProcessorSubsidy},${data.sourceUrl},${data.approvalNote},${user.id}::uuid,${JSON.stringify(policyConfig)}::jsonb) returning id,university_id,kind
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
      previousPolicy: previous,
      approvedPolicy: {...data, collection:policy.collection, ...policyConfig},
      reason: data.approvalNote,
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
