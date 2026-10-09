/** BACHS NGN economics. Quotes are computed by the server, never by a client. */
import { checkoutPrice, collectionFeeKobo, inclusiveGrossKobo, listingPrice, percentageKobo, roundDisplayKobo, type CollectionFees, type CommerceFees } from "./pricing";

export const bachsFeeContexts = ["CHECKOUT_BANK_TRANSFER", "VIRTUAL_ACCOUNT_DEPOSIT", "LOCAL_CARD", "BANK_WITHDRAWAL"] as const;
export type BachsFeeContext = typeof bachsFeeContexts[number];
export type BachsCheckoutContext = "CHECKOUT_BANK_TRANSFER" | "LOCAL_CARD";
export type BachsFeeProfile = {
  id: string;
  universityId: string;
  version: string;
  context: BachsFeeContext;
  collection: CollectionFees;
  status: "APPROVED" | "DISABLED";
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceUrl: string;
  varianceToleranceKobo: number;
};
const rule = (basisPoints: number, capKobo: number | null, flatKobo = 0): CollectionFees =>
  ({ basisPoints, flatKobo, flatWaivedBelowKobo: 0, capKobo });

/** Published defaults checked 2026-10-09. References are never merchant approvals. */
export const publishedBachsProfiles: BachsFeeProfile[] = [
  ["CHECKOUT_BANK_TRANSFER", rule(150, 200_000)],
  ["VIRTUAL_ACCOUNT_DEPOSIT", rule(150, 30_000)],
  ["LOCAL_CARD", rule(200, null)],
  ["BANK_WITHDRAWAL", rule(0, null, 5_000)],
].map(([context, collection]) => ({
  id: `reference:${context}`, universityId: "", provider: "BACHS", currency: "NGN",
  version: `BACHS_NGN_${context}_20261009_REFERENCE`, context: context as BachsFeeContext,
  collection: collection as CollectionFees, status: "DISABLED",
  effectiveFrom: "2026-10-09T00:00:00Z", effectiveTo: null,
  sourceUrl: "https://docs.bachs.io/for-you/fees", varianceToleranceKobo: 100,
}));

export function assertBachsProfile(profile: BachsFeeProfile, context: BachsFeeContext, at = Date.now()) {
  if (!bachsFeeContexts.includes(context) || profile.context !== context)
    throw new RangeError("The BACHS fee profile belongs to a different payment product.");
  const starts = Date.parse(profile.effectiveFrom), ends = profile.effectiveTo === null ? null : Date.parse(profile.effectiveTo);
  if (!Number.isFinite(at) || !Number.isFinite(starts) || (ends !== null && (!Number.isFinite(ends) || ends <= starts)) ||
      profile.status !== "APPROVED" || starts > at || (ends !== null && ends <= at))
    throw new RangeError("This BACHS fee version is disabled, not yet effective, or expired.");
  collectionFeeKobo(600_000, profile.collection);
}
function amount(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_000_000_000)
    throw new RangeError("Use a nonnegative whole-kobo amount within the payment limit.");
  return value;
}
export type BachsQuoteInput = {
  subtotalKobo: number;
  deliveryKobo?: number;
  /** Additional commercial revenue before fee recovery. Fixed list prices already include it. */
  platformRevenueKobo?: number;
  discountPercent?: number;
  /** Kira's list price is FIXED_TOTAL: processing is already inside that price. */
  priceMode: "FIXED_TOTAL" | "RECOVER_FEES";
  roundingMode?: CollectionFees["roundingMode"];
  maxPricingAdjustmentKobo?: number;
  expiresInMinutes?: number;
};
export type BachsPricingQuote = {
  provider: "BACHS";
  currency: "NGN";
  context: BachsCheckoutContext;
  profile: BachsFeeProfile;
  input: BachsQuoteInput;
  createdAt: string;
  expiresAt: string;
  subtotalKobo: number;
  discountPercent: number;
  discountKobo: number;
  discountedSubtotalKobo: number;
  deliveryKobo: number;
  platformRevenueKobo: number;
  rawRequirementKobo: number;
  pricingAdjustmentKobo: number;
  includedProcessingKobo: number;
  estimatedProviderFeeKobo: number;
  estimatedNetKobo: number;
  finalCustomerAmountKobo: number;
  providerAmountKobo: number;
};

export function createBachsPricingQuote(
  input: BachsQuoteInput,
  profile: BachsFeeProfile,
  at = Date.now(),
  referencePreview = false,
): BachsPricingQuote {
  if (!["CHECKOUT_BANK_TRANSFER", "LOCAL_CARD"].includes(profile.context))
    throw new RangeError("Virtual-account and withdrawal fees cannot price hosted checkout.");
  if (!referencePreview) assertBachsProfile(profile, profile.context, at);
  const subtotalKobo = amount(input.subtotalKobo), deliveryKobo = amount(input.deliveryKobo ?? 0),
    platformRevenueKobo = amount(input.platformRevenueKobo ?? 0), discountPercent = input.discountPercent ?? 0;
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 90)
    throw new RangeError("Use a whole-number discount between 0% and 90%.");
  if (!["FIXED_TOTAL", "RECOVER_FEES"].includes(input.priceMode))
    throw new RangeError("Choose a fixed total or fee recovery pricing policy.");
  const minutes = input.expiresInMinutes ?? 15;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 20)
    throw new RangeError("Checkout quotes last between one and twenty minutes.");
  const discountKobo = percentageKobo(subtotalKobo, discountPercent * 100),
    discountedSubtotalKobo = subtotalKobo - discountKobo,
    targetKobo = amount(discountedSubtotalKobo + deliveryKobo + platformRevenueKobo);
  if (targetKobo === 0) throw new RangeError("Free purchases do not need a paid checkout.");
  // A fixed list price, including Kira, must retain its exact discount arithmetic.
  if (input.priceMode === "FIXED_TOTAL" && input.roundingMode && input.roundingMode !== "NONE")
    throw new RangeError("A fixed total cannot be rounded after applying its advertised discount.");
  if (input.priceMode === "FIXED_TOTAL" && platformRevenueKobo !== 0)
    throw new RangeError("A fixed list price already includes platform revenue.");
  const rawRequirementKobo = input.priceMode === "RECOVER_FEES" ? inclusiveGrossKobo(targetKobo, profile.collection) : targetKobo;
  const finalCustomerAmountKobo = input.priceMode === "RECOVER_FEES" ? roundDisplayKobo(rawRequirementKobo, {
    ...profile.collection, roundingMode: input.roundingMode ?? "CEIL_100",
    maxPricingAdjustmentKobo: input.maxPricingAdjustmentKobo ?? 10_000,
  }) : targetKobo;
  const estimatedProviderFeeKobo = collectionFeeKobo(finalCustomerAmountKobo, profile.collection);
  if (estimatedProviderFeeKobo >= finalCustomerAmountKobo)
    throw new RangeError("The approved fee exceeds this purchase's proceeds.");
  const expiresAt = Math.min(at + minutes * 60_000, profile.effectiveTo === null ? Infinity : Date.parse(profile.effectiveTo));
  if (!Number.isFinite(at) || !Number.isFinite(expiresAt) || expiresAt <= at)
    throw new RangeError("This fee profile cannot produce a valid checkout quote.");
  return {
    provider: "BACHS", currency: "NGN", context: profile.context as BachsCheckoutContext,
    profile: structuredClone(profile), input: structuredClone(input), createdAt: new Date(at).toISOString(), expiresAt: new Date(expiresAt).toISOString(),
    subtotalKobo, discountPercent, discountKobo, discountedSubtotalKobo, deliveryKobo, platformRevenueKobo,
    rawRequirementKobo, pricingAdjustmentKobo: finalCustomerAmountKobo - rawRequirementKobo,
    includedProcessingKobo: finalCustomerAmountKobo - targetKobo,
    estimatedProviderFeeKobo, estimatedNetKobo: finalCustomerAmountKobo - estimatedProviderFeeKobo,
    finalCustomerAmountKobo, providerAmountKobo: finalCustomerAmountKobo,
  };
}

/** Saved quotes are the authority. Never initialize from an admin preview or client amount. */
export function assertBachsQuote(quote: BachsPricingQuote, acceptedTotalKobo: number, at = Date.now()) {
  const created = Date.parse(quote.createdAt), expires = Date.parse(quote.expiresAt);
  if (quote.provider !== "BACHS" || quote.currency !== "NGN" ||
      !Number.isFinite(at) || !Number.isFinite(created) || !Number.isFinite(expires) || created > at || expires <= at ||
      acceptedTotalKobo !== quote.finalCustomerAmountKobo)
    throw new RangeError("This quote expired or its total changed. Review the price before paying.");
  const expected = createBachsPricingQuote(quote.input, quote.profile, created);
  for (const key of ["expiresAt", "context", "providerAmountKobo", "finalCustomerAmountKobo", "subtotalKobo", "discountPercent", "discountKobo", "discountedSubtotalKobo", "deliveryKobo", "platformRevenueKobo", "rawRequirementKobo", "estimatedProviderFeeKobo", "estimatedNetKobo", "includedProcessingKobo", "pricingAdjustmentKobo"] as const)
    if (quote[key] !== expected[key]) throw new RangeError("The saved BACHS quote is inconsistent.");
}

export function bachsCheckoutCorridor(context: BachsCheckoutContext): "NGN_BANK_TRANSFER" | "NGN_CARD" {
  if (context === "CHECKOUT_BANK_TRANSFER") return "NGN_BANK_TRANSFER";
  if (context === "LOCAL_CARD") return "NGN_CARD";
  throw new RangeError("This quote has no supported BACHS checkout corridor.");
}
export function bachsPaymentMethodMatches(context: BachsCheckoutContext, method: string | undefined) {
  const corridor = bachsCheckoutCorridor(context);
  return method === corridor || method === (context === "CHECKOUT_BANK_TRANSFER" ? "BANK_TRANSFER" : "CARD");
}

/** Shared commercial math with BACHS fees and no provider-side fee pass-through.
 * Domain callers fetch the approved commercial policy and authoritative goods first.
 * Save the resulting payable amount as FIXED_TOTAL; never gross it up a second time.
 */
export function bachsMarketplacePrices(input: {
  items: { baseKobo: number; quantity: number }[];
  commercial: Omit<CommerceFees, "collection" | "providerFeeMode" | "providerProfileId">;
  delivery: Parameters<typeof checkoutPrice>[2];
}, profile: BachsFeeProfile, at = Date.now()) {
  if (profile.context !== "CHECKOUT_BANK_TRANSFER" && profile.context !== "LOCAL_CARD")
    throw new RangeError("Use a hosted-checkout profile for marketplace prices.");
  assertBachsProfile(profile, profile.context, at);
  const policy: CommerceFees = {
    ...input.commercial,
    providerFeeMode: "LEGACY_INCLUSIVE", providerProfileId: profile.id,
    roundingMode: input.commercial.roundingMode ?? "CEIL_100",
    collection: { ...structuredClone(profile.collection), providerProfileId: profile.id, providerProfileVersion: profile.version },
  };
  const listings = input.items.map(item => ({ ...listingPrice(item.baseKobo, policy), quantity: item.quantity }));
  const checkout = checkoutPrice(input.items, policy, input.delivery);
  return {
    provider: "BACHS" as const, currency: "NGN" as const, context: profile.context,
    profileVersion: profile.version, listings, checkout, providerAmountKobo: checkout.payableKobo,
    policy: structuredClone(policy),
  };
}

/** The published NGN withdrawal fee is for merchant withdrawals, not Connect transfers. */
export function bachsWithdrawalQuote(
  requestedKobo: number,
  profile: BachsFeeProfile,
  mode: "RECIPIENT_AMOUNT" | "TOTAL_DEBIT" = "RECIPIENT_AMOUNT",
  at = Date.now(),
  referencePreview = false,
) {
  amount(requestedKobo);
  if (profile.context !== "BANK_WITHDRAWAL") throw new RangeError("Use a withdrawal profile, not a collection fee.");
  if (!referencePreview) assertBachsProfile(profile, "BANK_WITHDRAWAL", at);
  if (!["RECIPIENT_AMOUNT", "TOTAL_DEBIT"].includes(mode)) throw new RangeError("Choose a valid withdrawal amount mode.");
  if (!requestedKobo) throw new RangeError("A withdrawal must be positive.");
  let recipientAmountKobo = requestedKobo;
  if (mode === "TOTAL_DEBIT") {
    let low = 0, high = requestedKobo;
    while (low < high) {
      const mid = low + Math.ceil((high - low) / 2);
      if (mid + collectionFeeKobo(mid, profile.collection) <= requestedKobo) low = mid;
      else high = mid - 1;
    }
    recipientAmountKobo = low;
  }
  if (!recipientAmountKobo) throw new RangeError("This withdrawal does not cover its fee.");
  const providerFeeKobo = collectionFeeKobo(recipientAmountKobo, profile.collection),
    totalDebitKobo = amount(recipientAmountKobo + providerFeeKobo);
  return { provider: "BACHS", currency: "NGN", recipientAmountKobo, providerFeeKobo, totalDebitKobo, profileVersion: profile.version };
}
