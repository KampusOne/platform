import { sql } from "drizzle-orm";
import type { Bindings } from "../types";
import { database, firstRow } from "./database";
import { AppError } from "./errors";
import { createBachsCheckout, getBachsCheckout, getBachsPayment, bachsNgnToKobo } from "./bachs";
import { assertBachsProfile, assertBachsQuote, bachsCheckoutCorridor, bachsPaymentMethodMatches, createBachsPricingQuote, type BachsFeeContext, type BachsFeeProfile, type BachsPricingQuote, type BachsQuoteInput } from "./bachs-pricing";

export async function bachsPricingReady(env: Bindings) {
  return firstRow(await database(env).execute<{ ready: boolean }>(sql`select to_regprocedure('app_private.record_bachs_pricing_receipt(uuid,text,text,bigint,bigint,timestamptz)') is not null as ready`))?.ready === true;
}
async function requireReady(env: Bindings) {
  if (!await bachsPricingReady(env)) throw new AppError(503, "FEATURE_DISABLED", "BACHS pricing is awaiting its database update.");
}
export async function resolveBachsProfile(env: Bindings, universityId: string, context: BachsFeeContext) {
  await requireReady(env);
  const profile = firstRow(await database(env).execute<BachsFeeProfile>(sql`
    select id,university_id as "universityId",version,context,collection,status,effective_from as "effectiveFrom",effective_to as "effectiveTo",source_url as "sourceUrl",variance_tolerance_kobo::integer as "varianceToleranceKobo"
    from app_private.bachs_fee_profiles where university_id=${universityId}::uuid and context=${context} and effective_from<=now()
    order by effective_from desc,approved_at desc,id desc limit 1`));
  if (!profile) throw new AppError(503, "FEATURE_DISABLED", "BACHS pricing is not available for this campus and payment method.");
  try { assertBachsProfile(profile, context); } catch (error) {
    throw new AppError(503, "FEATURE_DISABLED", error instanceof Error ? error.message : "BACHS pricing is unavailable.");
  }
  return profile;
}
type StoredQuote = { id: string; userId: string; universityId: string; resourceType: string; resourceId: string; resourceFingerprint: string; reference: string; quote: BachsPricingQuote };
const storedColumns = sql`id,user_id as "userId",university_id as "universityId",resource_type as "resourceType",resource_id as "resourceId",resource_fingerprint as "resourceFingerprint",provider_reference as reference,quote`;
type JsonValue = null | boolean | string | number | JsonValue[] | { [key: string]: JsonValue };
export type BachsPurchaseSnapshot = { [key: string]: JsonValue };

/** Stable fingerprint of the domain's authoritative details, including commercial allocations. */
export async function fingerprintBachsPurchase(snapshot: BachsPurchaseSnapshot) {
  function canonical(value: JsonValue): JsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map(canonical);
    if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]));
    throw new RangeError("The purchase snapshot must contain plain JSON values.");
  }
  if (!snapshot || Array.isArray(snapshot) || Object.getPrototypeOf(snapshot) !== Object.prototype)
    throw new RangeError("The purchase snapshot must be a plain JSON object.");
  const json = new TextEncoder().encode(JSON.stringify(canonical(snapshot)));
  if (json.byteLength > 32_000) throw new RangeError("The purchase snapshot exceeds the supported size.");
  const hash = await crypto.subtle.digest("SHA-256", json);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Internal domain boundary: call only after fetching/authorizing authoritative products, plans, discounts and delivery. No HTTP endpoint accepts these amounts. */
export async function saveBachsPricingQuote(env: Bindings, input: {
  userId: string; universityId: string;
  resourceType: "STORE_ORDER" | "TUTORIAL_BOOKING" | "TUTORIAL_PURCHASE" | "KIRA_SUBSCRIPTION" | "RIDER_COMMISSION";
  /** SHA-256 of the authorized item, quantity, plan/discount and delivery snapshot. */
  resourceId: string; resourceSnapshot: BachsPurchaseSnapshot; resourceFingerprint: string; reference: string;
  context: "CHECKOUT_BANK_TRANSFER" | "LOCAL_CARD"; pricing: BachsQuoteInput;
}) {
  const source = structuredClone(input);
  if (!/^[a-f0-9]{64}$/.test(source.resourceFingerprint))
    throw new AppError(400, "BAD_REQUEST", "The purchase needs an authoritative resource fingerprint.");
  if (source.resourceType === "KIRA_SUBSCRIPTION" && (source.pricing.priceMode !== "FIXED_TOTAL" || source.pricing.deliveryKobo || source.pricing.platformRevenueKobo))
    throw new AppError(409, "CONFLICT", "Kira uses its exact discounted list price without delivery or another processing allowance.");
  if (await fingerprintBachsPurchase(source.resourceSnapshot) !== source.resourceFingerprint)
    throw new AppError(409, "CONFLICT", "The purchase snapshot changed. Recalculate its quote before paying.");
  const profile = await resolveBachsProfile(env, source.universityId, source.context);
  const quote = createBachsPricingQuote(source.pricing, profile), id = crypto.randomUUID();
  await database(env).execute(sql`insert into app_private.bachs_checkout_quotes(id,user_id,university_id,resource_type,resource_id,resource_fingerprint,resource_snapshot,provider_reference,fee_profile_id,fee_profile_version,quote,created_at,expires_at)
    values(${id}::uuid,${source.userId}::uuid,${source.universityId}::uuid,${source.resourceType},${source.resourceId}::uuid,${source.resourceFingerprint},${JSON.stringify(source.resourceSnapshot)}::jsonb,${source.reference},${profile.id}::uuid,${profile.version},${JSON.stringify(quote)}::jsonb,${quote.createdAt}::timestamptz,${quote.expiresAt}::timestamptz) on conflict(provider_reference) do nothing`);
  const saved = firstRow(await database(env).execute<StoredQuote>(sql`select ${storedColumns} from app_private.bachs_checkout_quotes
    where provider_reference=${source.reference} and user_id=${source.userId}::uuid and university_id=${source.universityId}::uuid
    and resource_type=${source.resourceType} and resource_id=${source.resourceId}::uuid and resource_fingerprint=${source.resourceFingerprint} and quote->'input'=${JSON.stringify(source.pricing)}::jsonb`));
  if (!saved || saved.quote.context !== source.context || saved.quote.profile.id !== profile.id)
    throw new AppError(409, "CONFLICT", "These purchase details changed. Review a new quote before paying.");
  try { assertBachsQuote(saved.quote, saved.quote.finalCustomerAmountKobo); } catch (error) {
    throw new AppError(409, "CONFLICT", error instanceof Error ? error.message : "Review a new payment quote.");
  }
  return { quoteId: saved.id, ...publicBachsQuote(saved.quote) };
}
export function publicBachsQuote(quote: BachsPricingQuote) {
  return {
    provider: quote.provider, currency: quote.currency, context: quote.context,
    subtotalKobo: quote.subtotalKobo, discountPercent: quote.discountPercent, discountKobo: quote.discountKobo,
    discountedSubtotalKobo: quote.discountedSubtotalKobo, deliveryKobo: quote.deliveryKobo,
    discountAppliesTo: "ITEM_SUBTOTAL",
    lines: [{ label: "Items (processing included)", amountKobo: quote.finalCustomerAmountKobo - quote.deliveryKobo }, { label: "Delivery", amountKobo: quote.deliveryKobo }],
    finalCustomerAmountKobo: quote.finalCustomerAmountKobo, expiresAt: quote.expiresAt,
    notice: "Processing is included. Pay the total shown here.",
  };
}
function rolloutMode(env: Bindings) {
  if (env.PAYMENTS_ENABLED !== "true" || env.BACHS_PRICED_CHECKOUT_ENABLED !== "true" || env.BACHS_MERCHANT_BEARS_COST_CONFIRMED !== "true")
    throw new AppError(503, "FEATURE_DISABLED", "BACHS checkout is awaiting payment migration and account setup.");
  return env.ENVIRONMENT === "production" ? "live" : "test";
}
async function ownedQuote(env: Bindings, quoteId: string, userId: string, universityId: string) {
  await requireReady(env);
  const row = firstRow(await database(env).execute<StoredQuote>(sql`select ${storedColumns} from app_private.bachs_checkout_quotes where id=${quoteId}::uuid and user_id=${userId}::uuid and university_id=${universityId}::uuid`));
  if (!row) throw new AppError(404, "NOT_FOUND", "This checkout quote was not found.");
  return row;
}
type Session = { checkoutId: string; checkoutUrl: string; expiresAt: string; providerMode: string };
/** Provider cutover must call this saved-quote boundary, rather than sending a client amount to BACHS. */
export async function initializeBachsPricedCheckout(env: Bindings, input: {
  quoteId: string; userId: string; universityId: string;
  /** Recomputed by the domain from current authoritative purchase details, never supplied by the client. */
  resourceFingerprint: string; acceptedTotalKobo: number; email: string; successUrl?: string; cancelUrl?: string;
}) {
  const mode = rolloutMode(env), saved = await ownedQuote(env, input.quoteId, input.userId, input.universityId);
  if (!/^[a-f0-9]{64}$/.test(input.resourceFingerprint) || input.resourceFingerprint !== saved.resourceFingerprint)
    throw new AppError(409, "CONFLICT", "These purchase details changed. Review a new quote before paying.");
  try { assertBachsQuote(saved.quote, input.acceptedTotalKobo); } catch (error) {
    throw new AppError(409, "CONFLICT", error instanceof Error ? error.message : "Review the price again.");
  }
  const prior = firstRow(await database(env).execute<Session>(sql`select checkout_id as "checkoutId",checkout_url as "checkoutUrl",expires_at as "expiresAt",provider_mode as "providerMode" from app_private.bachs_priced_sessions where quote_id=${saved.id}::uuid`));
  if (prior) {
    if (prior.providerMode !== mode || Date.parse(prior.expiresAt) <= Date.now()) throw new AppError(409, "CONFLICT", "This payment session expired. Review a new quote.");
    return { ...prior, reference: saved.reference, amountKobo: saved.quote.providerAmountKobo };
  }
  const minutes = Math.floor((Date.parse(saved.quote.expiresAt) - Date.now()) / 60_000);
  if (minutes < 1) throw new AppError(409, "CONFLICT", "This quote is about to expire. Review a new quote before paying.");
  const session = await createBachsCheckout(env, {
    email: input.email, reference: saved.reference, amountKobo: saved.quote.providerAmountKobo,
    paymentMethodTypes: [bachsCheckoutCorridor(saved.quote.context)], expiresInMinutes: minutes,
    ...(input.successUrl ? { successUrl: input.successUrl } : {}),
    ...(input.cancelUrl ? { cancelUrl: input.cancelUrl } : {}),
    metadata: { quoteId: saved.id, resourceType: saved.resourceType, resourceId: saved.resourceId, feeProfileId: saved.quote.profile.id, feeProfileVersion: saved.quote.profile.version },
  });
  const evidence = await getBachsCheckout(env, session.checkoutId);
  if (evidence.reference !== saved.reference || evidence.currency !== "NGN" || typeof evidence.amount !== "string" ||
      bachsNgnToKobo(evidence.amount) !== saved.quote.providerAmountKobo ||
      !session.expiresAt || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now() || Date.parse(session.expiresAt) > Date.parse(saved.quote.expiresAt))
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "BACHS did not confirm the accepted total and expiry. This checkout is held for review.");
  await database(env).execute(sql`insert into app_private.bachs_priced_sessions(quote_id,checkout_id,provider_mode,checkout_url,expires_at) values(${saved.id}::uuid,${session.checkoutId},${mode},${session.checkoutUrl},${session.expiresAt}::timestamptz) on conflict(quote_id) do nothing`);
  const pinned = firstRow(await database(env).execute<Session>(sql`select checkout_id as "checkoutId",checkout_url as "checkoutUrl",expires_at as "expiresAt",provider_mode as "providerMode" from app_private.bachs_priced_sessions where quote_id=${saved.id}::uuid`));
  if (!pinned || pinned.checkoutId !== session.checkoutId || pinned.providerMode !== mode)
    throw new AppError(409, "CONFLICT", "This checkout reference has different provider evidence. Check payment status before retrying.");
  return { ...pinned, reference: saved.reference, amountKobo: saved.quote.providerAmountKobo };
}

/** Authoritative actual-fee observation, without granting entitlements or mutating wallets. The provider-aware ledger cutover consumes this evidence separately. */
export async function verifyBachsPricedCheckout(env: Bindings, quoteId: string, userId: string, universityId: string) {
  const saved = await ownedQuote(env, quoteId, userId, universityId);
  const session = firstRow(await database(env).execute<Session>(sql`select checkout_id as "checkoutId",checkout_url as "checkoutUrl",expires_at as "expiresAt",provider_mode as "providerMode" from app_private.bachs_priced_sessions where quote_id=${quoteId}::uuid`));
  if (!session || session.providerMode !== (env.ENVIRONMENT === "production" ? "live" : "test"))
    throw new AppError(409, "CONFLICT", "This quote has no matching BACHS session in this environment.");
  const checkout = await getBachsCheckout(env, session.checkoutId);
  if (checkout.reference !== saved.reference || checkout.currency !== "NGN" || typeof checkout.amount !== "string" || bachsNgnToKobo(checkout.amount) !== saved.quote.providerAmountKobo)
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "BACHS returned a different checkout reference, currency or total.");
  if (checkout.status.toLowerCase() !== "completed") return { status: checkout.status.toLowerCase(), quoteId };
  const paymentId = checkout.charge?.payment_id;
  if (!paymentId) throw new AppError(503, "PROVIDER_UNAVAILABLE", "BACHS payment evidence is incomplete.");
  const payment = await getBachsPayment(env, paymentId);
  if (payment.status.toLowerCase() !== "succeeded" || payment.checkout_id !== session.checkoutId ||
      payment.reference !== saved.reference || payment.currency !== "NGN" || payment.fees?.currency !== "NGN" ||
      typeof payment.fees?.amount !== "string" || payment.merchant_bears_cost !== true ||
      !bachsPaymentMethodMatches(saved.quote.context, payment.payment_method) ||
      bachsNgnToKobo(payment.amount) !== saved.quote.providerAmountKobo ||
      typeof payment.amount_paid !== "string" || bachsNgnToKobo(payment.amount_paid) !== saved.quote.providerAmountKobo ||
      typeof payment.completed_at !== "string" || !Number.isFinite(Date.parse(payment.completed_at)))
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "This BACHS receipt does not match the accepted price and payment method. Hold it for reconciliation.");
  const feeKobo = bachsNgnToKobo(payment.fees.amount);
  if (feeKobo >= saved.quote.providerAmountKobo) throw new AppError(503, "PROVIDER_UNAVAILABLE", "BACHS returned an invalid processing fee.");
  const receipt = firstRow(await database(env).execute(sql`select * from app_private.record_bachs_pricing_receipt(${saved.id}::uuid,${session.providerMode},${payment.payment_id},${saved.quote.providerAmountKobo}::bigint,${feeKobo}::bigint,${payment.completed_at}::timestamptz)`));
  if (!receipt) throw new AppError(503, "PROVIDER_UNAVAILABLE", "BACHS fee evidence could not be recorded. Hold this payment for reconciliation.");
  return { status: "verified", quoteId, receipt };
}
