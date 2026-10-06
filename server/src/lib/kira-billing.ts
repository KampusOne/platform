import { sql } from "drizzle-orm";
import { database, firstRow } from "./database";
import { initializePaystack, verifyPaystack } from "./paystack";
import { resolveProviderCollection } from "./payment-pricing";
import { AppError } from "./errors";
import { recordAudit } from "./audit";
import { providerConfiguration } from "./ai-provider";
import {resolveAIQuota, activePaidAITier, type AITier} from './ai-quota';
import { kiraSubscriptionPrice, type CollectionFees } from './pricing';
import type { AuthenticatedUser, Bindings } from "../types";
export async function kiraBillingReady(env: Bindings) {
  if (
    env.UNIFIED_SCHEMA_READY !== "true" ||
    env.PHASE_3_SCHEMA_READY !== "true"
  )
    return false;
  return (
    firstRow(
      await database(env).execute<{ ready: boolean }>(
        sql`select to_regprocedure('app_private.create_quoted_kira_checkout(uuid,uuid,uuid,text,uuid,text,integer)') is not null as ready`,
      ),
    )?.ready === true
  );
}
export type KiraOffer = { offerActive: boolean; offerStartsAt: string | null; offerEndsAt: string | null; discountPercent: number };
export function resolveKiraPlanPrice(listedAmountKobo: number, offer: KiraOffer, collection: CollectionFees, at = new Date()) {
  const start = offer.offerStartsAt === null ? null : Date.parse(offer.offerStartsAt);
  const end = offer.offerEndsAt === null ? null : Date.parse(offer.offerEndsAt);
  if ((start !== null && !Number.isFinite(start)) || (end !== null && !Number.isFinite(end)) || (start !== null && end !== null && end <= start)) throw new RangeError('Choose a valid discount date range.');
  const effective = offer.offerActive && (start === null || at.getTime() >= start) && (end === null || at.getTime() < end);
  const percent = effective ? offer.discountPercent : 0;
  const calculated = listedAmountKobo === 0
    ? { listedAmountKobo: 0, discountPercent: 0, discountKobo: 0, customerPriceKobo: 0, estimatedProcessingKobo: 0, estimatedNetKobo: 0, currency: 'NGN' as const, cadence: 'MONTHLY' as const }
    : kiraSubscriptionPrice(listedAmountKobo,percent,collection);
  return { ...calculated, amountKobo: calculated.customerPriceKobo, discountAmountKobo: calculated.discountKobo, expectedNetKobo: calculated.estimatedNetKobo, offerActive: effective && percent > 0, offerStartsAt: offer.offerStartsAt, offerEndsAt: offer.offerEndsAt };
}
type PlanRow = { id:string; tier:AITier; version:string; listed_amount_kobo:number; discount_percent:number; offer_active:boolean; offer_starts_at:string|null; offer_ends_at:string|null; available:boolean; active_status:boolean; collection:CollectionFees; included_capabilities:unknown; limits:unknown; feature_flags:unknown; model_access:AITier };
export async function kiraBillingStatus(
  env: Bindings,
  user: AuthenticatedUser,
) {
  const complimentary=(await resolveAIQuota(env,user)).unlimited;
  const ready = await kiraBillingReady(env);
  if (!ready)
    return {
      available: false,
      complimentary,
      checkoutEnabled: false,
      cadence: "monthly",
      amountKobo: 600000,
      listedAmountKobo: 600000,
      discountPercent: 0,
      version: null,
      currency: "NGN",
      autoRenew: false,
      currentPeriodEnd: null,
      checkout: null,
      currentTier: complimentary ? 'pro' : 'standard',
      selectedTier: complimentary ? 'pro' : 'standard',
      catalog: {standard: {tier:'standard',planId:null,version:null,listedAmountKobo:0,amountKobo:0,discountPercent:0,discountAmountKobo:0,available:true,active:true,checkoutEnabled:false,offer:{active:false,startsAt:null,endsAt:null,percent:0}},pro:null},
    };
  const subscription = firstRow(
    await database(env).execute<{ status: string; current_period_end: string }>(
      sql`select status,current_period_end from app_private.ai_subscriptions where user_id=${user.id}::uuid and current_period_end>now()`,
    ),
  );
  const plans = await database(env).execute<PlanRow>(sql`select p.* from app_private.active_kira_price_plans a join app_private.kira_price_plans p on p.id=a.plan_id and p.university_id=a.university_id and p.tier=a.tier where a.university_id=${user.universityId}::uuid`);
  const pending = firstRow(
    await database(env).execute<{
      reference: string;
      status: string;
      amount_kobo: number;
      listed_amount_kobo: number;
      offer_discount_percent: number;
      expires_at: string;
      request_id:string;discount_code:string|null;
    }>(
      sql`select k.provider_reference as reference,k.status,k.amount_kobo,k.listed_amount_kobo,k.offer_discount_percent,k.expires_at,k.request_id,k.tier,k.quote_id,k.listed_amount_kobo-k.amount_kobo as discount_amount_kobo,coalesce(q.coupon_discount_percent,d.percent,0) as coupon_discount_percent,d.code as discount_code from app_private.kira_checkouts k left join app_private.discount_codes d on d.id=k.discount_id left join app_private.kira_subscription_quotes q on q.id=k.quote_id where k.user_id=${user.id}::uuid and k.status in ('CREATED','INITIALIZED','REQUIRES_REVIEW') and (k.status='REQUIRES_REVIEW' or k.expires_at>now()) order by k.created_at desc limit 1`,
    ),
  );
  const early =
    subscription?.status === "ACTIVE" &&
    Date.parse(subscription.current_period_end) > Date.now() + 7 * 86400000;
  const paidTier = await activePaidAITier(env,user);
  const catalog = Object.fromEntries(plans.rows.map(plan => {
    const price=resolveKiraPlanPrice(Number(plan.listed_amount_kobo),{offerActive:plan.offer_active,offerStartsAt:plan.offer_starts_at,offerEndsAt:plan.offer_ends_at,discountPercent:Number(plan.discount_percent)},plan.collection);
    return [plan.tier,{tier:plan.tier,planId:plan.id,version:plan.version,...price,available:plan.available,active:plan.active_status,checkoutEnabled:!complimentary && plan.available && plan.active_status && price.amountKobo>0 && !early && !!env.PAYSTACK_SECRET_KEY && (env.ENVIRONMENT!=='production'||env.PAYSTACK_SECRET_KEY.startsWith('sk_live_')) && env.KIRA_SUBSCRIPTIONS_ENABLED==='true' && env.PAYMENTS_ENABLED==='true' && env.AI_ASSISTANT_ENABLED==='true' && providerConfiguration(env,'study',undefined,undefined,plan.tier).configured,offer:{active:price.offerActive,startsAt:plan.offer_starts_at,endsAt:plan.offer_ends_at,percent:price.discountPercent},includedCapabilities:plan.included_capabilities,limits:plan.limits,modelAccess:plan.model_access,featureFlags:plan.feature_flags}];
  })) as unknown as Record<AITier, { amountKobo:number;listedAmountKobo:number;discountPercent:number;version:string;checkoutEnabled:boolean;available:boolean } | null>;
  catalog.standard ??= {tier:'standard',planId:null,version:null,listedAmountKobo:0,amountKobo:0,discountPercent:0,discountAmountKobo:0,available:true,active:true,checkoutEnabled:false,offer:{active:false,startsAt:null,endsAt:null,percent:0}} as unknown as NonNullable<typeof catalog.standard>;
  const plan = catalog.pro;
  return {
    complimentary,
    available: !!plan?.available,
    checkoutEnabled: plan?.checkoutEnabled ?? false,
    cadence: "monthly",
    amountKobo: Number(plan?.amountKobo ?? 600000),
    listedAmountKobo: Number(plan?.listedAmountKobo ?? 600000),
    discountPercent: Number(plan?.discountPercent ?? 0),
    version: typeof plan?.version === 'string' ? plan.version : null,
    currency: "NGN",
    autoRenew: false,
    currentPeriodEnd:
      subscription?.status === "ACTIVE"
        ? subscription.current_period_end
        : null,
    checkout: pending ?? null,
    currentTier: complimentary ? 'pro' : paidTier ?? 'standard',
    paidTier,
    selectedTier: complimentary ? 'pro' : paidTier ?? 'standard',
    catalog,
  };
}
function kiraPricingError(error:unknown):never {
  if(error instanceof Error && /KIRA_|DISCOUNT_|BUYER_TENANT_MISMATCH/.test(error.message)) {
    const reason=/KIRA_QUOTE_EXPIRED/.test(error.message)?'KIRA_QUOTE_EXPIRED':/KIRA_PRICE_CHANGED/.test(error.message)?'KIRA_PRICE_CHANGED':/DISCOUNT_CANNOT_COMBINE/.test(error.message)?'DISCOUNT_CANNOT_COMBINE':/DISCOUNT_/.test(error.message)?'DISCOUNT_UNAVAILABLE':'KIRA_CHECKOUT_CONFLICT';
    throw new AppError(409,'CONFLICT',reason==='DISCOUNT_CANNOT_COMBINE'?'This Kira offer already includes a discount. Discount codes cannot be combined with it.':reason==='DISCOUNT_UNAVAILABLE'?'This discount is unavailable or its use limit has been reached. Check the code and try again.':'Refresh your Kira plan and review its current total before paying.',{reason,reaccept:true});
  }
  throw error;
}
export async function quoteKira(env:Bindings,user:AuthenticatedUser,tier:AITier,discountCode='',requestId:string=crypto.randomUUID()) {
  const status=await kiraBillingStatus(env,user);
  if(!status.catalog[tier]?.checkoutEnabled) throw new AppError(409,'CONFLICT','This Kira plan is not available for payment.',{reason:'KIRA_PLAN_UNAVAILABLE'});
  if (env.ENVIRONMENT === 'production') {
    const plan=firstRow(await database(env).execute<{collection:CollectionFees}>(sql`select p.collection from app_private.active_kira_price_plans a join app_private.kira_price_plans p on p.id=a.plan_id where a.university_id=${user.universityId}::uuid and a.tier=${tier}`));
    await resolveProviderCollection(env,user.universityId,plan?.collection.providerProfileId);
  }
  const rate=firstRow(await database(env).execute<{allowed:boolean}>(sql`select app_private.consume_request_rate_limit('KIRA_QUOTE',${user.id},30,3600,3600) as allowed`));
  if(!rate?.allowed) throw new AppError(429,'RATE_LIMITED','Please wait before requesting another Kira quote.');
  try {
    const q=firstRow(await database(env).execute<{id:string;tier:AITier;plan_id:string;plan_version:string;listed_amount_kobo:number;amount_kobo:number;offer_discount_percent:number;coupon_discount_percent:number;discount_code:string;expires_at:string;estimated_processing_kobo:number;provider_fee_mode:string}>(sql`select * from app_private.quote_kira_subscription(${crypto.randomUUID()}::uuid,${user.id}::uuid,${user.universityId}::uuid,${requestId}::uuid,${tier},${discountCode.trim().toUpperCase()})`))!;
    return {quoteId:q.id,tier:q.tier,planId:q.plan_id,version:q.plan_version,listedAmountKobo:Number(q.listed_amount_kobo),amountKobo:Number(q.amount_kobo),discountPercent:Number(q.offer_discount_percent)+Number(q.coupon_discount_percent),discountAmountKobo:Number(q.listed_amount_kobo)-Number(q.amount_kobo),offerDiscountPercent:Number(q.offer_discount_percent),couponDiscountPercent:Number(q.coupon_discount_percent),discountCode:q.discount_code,currency:'NGN',expiresAt:q.expires_at,feeBearer:q.provider_fee_mode,paystackAmountKobo:Number(q.amount_kobo)-(q.provider_fee_mode==='CUSTOMER_PASSTHROUGH'?Number(q.estimated_processing_kobo):0),estimatedProcessingKobo:Number(q.estimated_processing_kobo)};
  } catch(e) {kiraPricingError(e);}
}
export async function initializeKira(
  env: Bindings,
  user: AuthenticatedUser,
  requestId: string,
  traceId?: string,
  discountCode = '',
  expectedAmountKobo?: number,
  quoteId?: string,
  tier: AITier = 'pro',
) {
  const status = await kiraBillingStatus(env, user);
  if (!status.catalog[tier]?.checkoutEnabled)
    throw new AppError(
      409,
      "CONFLICT",
      status.currentPeriodEnd
        ? "Your paid month is active. Renewal opens in its final seven days."
        : "Kira subscriptions are not open yet.",
    );
  let checkout: {
    id: string;
    provider_reference: string;
    amount_kobo: number;
    status: string;
    authorization_url: string | null;
    access_code: string | null;
    expires_at: string;
  };
  try {
    checkout = firstRow(
      await database(env).execute<typeof checkout>(
        quoteId && expectedAmountKobo!==undefined
          ? sql`select * from app_private.create_quoted_kira_checkout(${user.id}::uuid,${user.universityId}::uuid,${requestId}::uuid,${"K1-AI-" + crypto.randomUUID()},${quoteId}::uuid,${tier},${expectedAmountKobo})`
          : sql`select * from app_private.kira_checkouts where user_id=${user.id}::uuid and university_id=${user.universityId}::uuid and request_id=${requestId}::uuid and tier=${tier} and quote_id is null and amount_kobo=${expectedAmountKobo ?? -1}`,
      ),
    )!;
  } catch (e) {
    kiraPricingError(e);
  }
  if(!checkout) throw new AppError(409,'CONFLICT','Review a current Kira quote before opening payment.',{reason:'KIRA_QUOTE_REQUIRED',reaccept:true});
  if(Date.parse(checkout.expires_at)<=Date.now()) throw new AppError(409,'CONFLICT','Your Kira quote expired. Review the current total before paying.',{reason:'KIRA_QUOTE_EXPIRED',reaccept:true});
  if (!["CREATED", "INITIALIZED"].includes(checkout.status))
    throw new AppError(
      409,
      "CONFLICT",
      "This payment has finished or needs review. Check its status before starting another.",
    );
  if (expectedAmountKobo !== undefined && checkout.amount_kobo !== expectedAmountKobo)
    throw new AppError(409, "CONFLICT", "Your Kira price has changed. Review the updated total before paying.", { reason: "KIRA_PRICE_CHANGED" });
  if (
    checkout.status === "INITIALIZED" &&
    checkout.authorization_url &&
    checkout.access_code
  )
    return {
      authorizationUrl: checkout.authorization_url,
      reference: checkout.provider_reference,
      amountKobo: checkout.amount_kobo,
      tier,
    };
  const rate = firstRow(
    await database(env).execute<{ allowed: boolean }>(
      sql`select app_private.consume_request_rate_limit('KIRA_CHECKOUT',${user.id},20,3600,3600) as allowed`,
    ),
  );
  if (!rate?.allowed)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Please wait before opening another checkout.",
    );
  const initialized = await initializePaystack(env, {
    email: user.email,
    amountKobo: checkout.amount_kobo,
    reference: checkout.provider_reference,
    ...(env.APP_ORIGIN
      ? { callbackUrl: env.APP_ORIGIN.replace(/\/$/, "") + "/payment/return" }
      : {}),
    metadata: {
      resourceType: "KIRA_SUBSCRIPTION",
      resourceId: checkout.id,
      userId: user.id,
      tier,
      ...(quoteId ? {pricingQuoteId:quoteId} : {}),
    },
  });
  await database(env).execute(
    sql`update app_private.kira_checkouts set status='INITIALIZED',authorization_url=${initialized.authorization_url!},access_code=${initialized.access_code ?? null} where id=${checkout.id}::uuid and status='CREATED'`,
  );
  await recordAudit(env, {
    actorUserId: user.id,
    universityId: user.universityId,
    action: "kira.checkout.initialized",
    targetType: "kira_checkout",
    targetId: checkout.id,
    ...(traceId ? { requestId: traceId } : {}),
    metadata: {
      reference: checkout.provider_reference,
      amountKobo: checkout.amount_kobo,
      tier,
      ...(quoteId ? {quoteId} : {}),
    },
  });
  return {
    authorizationUrl: initialized.authorization_url!,
    reference: checkout.provider_reference,
    amountKobo: checkout.amount_kobo,
    tier,
  };
}
export async function reconcileKira(
  env: Bindings,
  reference: string,
  userId?: string,
) {
  if (!(await kiraBillingReady(env))) return false;
  const intent = firstRow(
    await database(env).execute<{ status: string }>(
      sql`select status from app_private.kira_checkouts where provider_reference=${reference} and (${userId ?? null}::uuid is null or user_id=${userId ?? null}::uuid)`,
    ),
  );
  if (!intent) return false;
  if (intent.status === "PAID") return true;
  const rate = firstRow(
    await database(env).execute<{ allowed: boolean }>(
      sql`select app_private.consume_request_rate_limit('KIRA_RECEIPT',${reference},60,3600,3600) as allowed`,
    ),
  );
  if (!rate?.allowed)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Please wait before checking this payment again.",
    );
  const receipt = await verifyPaystack(env, reference);
  if (receipt.status === "success")
    await database(env).execute(
      sql`select app_private.record_kira_receipt(${reference},${receipt.amountKobo}::bigint,${receipt.feeKobo}::bigint,${receipt.paidAt}::timestamptz)`,
    );
  return true;
}
