/** Currency arithmetic is integer kobo; projections never initialize a payment. */
export type CollectionFees = {
  basisPoints: number;
  flatKobo: number;
  flatWaivedBelowKobo: number;
  capKobo: number | null;
  /** Display increment approved with this policy; legacy policies use ₦1. */
  displayRoundKobo?: number;
};
export type CommerceFees = {
  id: string;
  buyerBasisPoints: number;
  buyerFlatPerItemKobo: number;
  sellerCommissionBasisPoints: number;
  collection: CollectionFees;
  checkoutSavings: boolean;
  allowProcessorSubsidy: boolean;
};
export const publishedNigeriaLocalFees: CollectionFees = {
  basisPoints: 150,
  flatKobo: 10000,
  flatWaivedBelowKobo: 250000,
  capKobo: 200000,
};
const MAX_KOBO = 2_000_000_000;
function money(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_KOBO)
    throw new RangeError("Amount is outside the supported range.");
  return BigInt(value);
}
function bps(value: number) {
  if (!Number.isInteger(value) || value < 0 || value >= 10000)
    throw new RangeError("Percentage must be below 100%.");
  return BigInt(value);
}
function ceilRatio(top: bigint, bottom: bigint) {
  return (top + bottom - 1n) / bottom;
}
function validateFees(policy: CollectionFees) {
  bps(policy.basisPoints);
  money(policy.flatKobo);
  money(policy.flatWaivedBelowKobo);
  if (policy.capKobo !== null) money(policy.capKobo);
  if(policy.displayRoundKobo !== undefined && (!Number.isSafeInteger(policy.displayRoundKobo)||policy.displayRoundKobo<100||policy.displayRoundKobo>100000||policy.displayRoundKobo%100!==0))
    throw new RangeError('Choose a whole-naira display increment between ₦1 and ₦1,000.');
}
export function roundDisplayKobo(value:number,policy:CollectionFees){
  money(value);validateFees(policy);
  const increment=BigInt(policy.displayRoundKobo??100);
  const rounded=Number(ceilRatio(BigInt(value),increment)*increment);
  money(rounded);return rounded;
}
export function percentageKobo(
  amount: number,
  basisPoints: number,
  round: "floor" | "ceil" = "floor",
) {
  const numerator = money(amount) * bps(basisPoints);
  return Number(
    round === "ceil" ? ceilRatio(numerator, 10000n) : numerator / 10000n,
  );
}
export function collectionFeeKobo(amount: number, policy: CollectionFees) {
  const gross = money(amount);
  validateFees(policy);
  if (!gross) return 0;
  let fee =
    ceilRatio(gross * BigInt(policy.basisPoints), 10000n) +
    (amount < policy.flatWaivedBelowKobo ? 0n : BigInt(policy.flatKobo));
  if (policy.capKobo !== null && fee > BigInt(policy.capKobo))
    fee = BigInt(policy.capKobo);
  return Number(fee);
}
/** The flat-fee threshold is a discontinuity: search each band separately. */
export function inclusiveGrossKobo(net: number, policy: CollectionFees) {
  money(net);
  validateFees(policy);
  if (net === 0) return 0;
  const threshold = policy.flatWaivedBelowKobo;
  const bands =
    threshold > 0
      ? [
          [0, threshold - 1],
          [threshold, MAX_KOBO],
        ]
      : [[0, MAX_KOBO]];
  const candidates: number[] = [];
  for (const [start, end] of bands) {
    let low = Math.max(start!, net),
      high = end!;
    if (low > high || high - collectionFeeKobo(high, policy) < net) continue;
    while (low < high) {
      const mid = low + Math.floor((high - low) / 2);
      if (mid - collectionFeeKobo(mid, policy) >= net) high = mid;
      else low = mid + 1;
    }
    candidates.push(low);
  }
  if (!candidates.length)
    throw new RangeError("This amount cannot fit the payment limit.");
  return Math.min(...candidates);
}
export function listingPrice(baseKobo: number, policy: CommerceFees) {
  money(baseKobo);
  bps(policy.buyerBasisPoints);
  bps(policy.sellerCommissionBasisPoints);
  money(policy.buyerFlatPerItemKobo);
  if (baseKobo === 0)
    return {
      baseKobo: 0,
      buyerComponentKobo: 0,
      customerPriceKobo: 0,
      processingAllowanceKobo: 0,
      ruleId: policy.id,
    };
  const buyerComponentKobo =
    percentageKobo(baseKobo, policy.buyerBasisPoints, "ceil") +
    policy.buyerFlatPerItemKobo;
  const target = baseKobo + buyerComponentKobo;
  money(target);
  const customerPriceKobo = roundDisplayKobo(inclusiveGrossKobo(target, policy.collection),policy.collection);
  money(customerPriceKobo);
  return {
    baseKobo,
    buyerComponentKobo,
    customerPriceKobo,
    processingAllowanceKobo: customerPriceKobo - target,
    ruleId: policy.id,
  };
}
export function campusFare(routeMetres: number) {
  if (!Number.isFinite(routeMetres) || routeMetres < 0 || routeMetres > 100_000)
    throw new RangeError("A usable campus route is required.");
  // ₦300 through 1 km, ₦50 for each subsequent started kilometre, capped at ₦450.
  const fareKobo = Math.min(
    45000,
    30000 + Math.ceil(Math.max(0, routeMetres - 1000) / 1000) * 5000,
  );
  const commissionKobo = percentageKobo(fareKobo, 1000);
  return {
    fareKobo,
    commissionKobo,
    riderNetKobo: fareKobo - commissionKobo,
    routeMetres: Math.ceil(routeMetres),
    tariffVersion: "campus-300-450-v1",
  };
}
export function checkoutPrice(
  items: { baseKobo: number; quantity: number }[],
  policy: CommerceFees,
  delivery: {
    fareKobo: number;
    paymentMethod: "IN_APP" | "CASH";
    riderNetKobo: number;
  } | null,
) {
  if (!items.length || items.length > 30)
    throw new RangeError("Choose between one and thirty products.");
  let baseKobo = 0,
    buyerComponentKobo = 0,
    listedItemsKobo = 0;
  for (const item of items) {
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 100
    )
      throw new RangeError("Invalid product quantity.");
    const price = listingPrice(item.baseKobo, policy);
    baseKobo += price.baseKobo * item.quantity;
    buyerComponentKobo += price.buyerComponentKobo * item.quantity;
    listedItemsKobo += price.customerPriceKobo * item.quantity;
  }
  money(baseKobo);
  money(buyerComponentKobo);
  money(listedItemsKobo);
  const fareKobo = delivery?.fareKobo ?? 0,
    cashDueKobo = delivery?.paymentMethod === "CASH" ? fareKobo : 0,
    digitalDeliveryKobo = fareKobo - cashDueKobo;
  money(fareKobo);
  money(delivery?.riderNetKobo ?? 0);
  if ((delivery?.riderNetKobo ?? 0) > fareKobo)
    throw new RangeError("Rider net cannot exceed the fare.");
  const budgetPayableKobo = listedItemsKobo + digitalDeliveryKobo;
  money(budgetPayableKobo);
  const targetGross = roundDisplayKobo(
      inclusiveGrossKobo(
        baseKobo + buyerComponentKobo + digitalDeliveryKobo,
        policy.collection,
      ), policy.collection);
  const discountKobo = policy.checkoutSavings
    ? Math.max(0, budgetPayableKobo - targetGross)
    : 0;
  const payableKobo = budgetPayableKobo - discountKobo,
    totalKobo = payableKobo + cashDueKobo;
  money(totalKobo);
  const sellerCommissionKobo = percentageKobo(
      baseKobo,
      policy.sellerCommissionBasisPoints,
    ),
    sellerNetKobo = baseKobo - sellerCommissionKobo;
  const estimatedProcessingKobo = collectionFeeKobo(
    payableKobo,
    policy.collection,
  );
  const riderDigitalNetKobo =
    delivery?.paymentMethod === "IN_APP" ? delivery.riderNetKobo : 0;
  const projectedPlatformNetKobo =
    payableKobo - estimatedProcessingKobo - sellerNetKobo - riderDigitalNetKobo;
  if (projectedPlatformNetKobo < 0 && !policy.allowProcessorSubsidy)
    throw new RangeError("The approved policy does not cover this checkout.");
  return {
    baseKobo,
    buyerComponentKobo,
    listedItemsKobo,
    discountKobo,
    fareKobo,
    cashDueKobo,
    payableKobo,
    totalKobo,
    sellerCommissionKobo,
    sellerNetKobo,
    estimatedProcessingKobo,
    projectedPlatformNetKobo,
    ruleId: policy.id,
  };
}
export function kiraSubscriptionPrice(listedAmountKobo: number, discountPercent: number, policy: CollectionFees) {
  money(listedAmountKobo);
  if (listedAmountKobo < 100000 || listedAmountKobo > 100000000)
    throw new RangeError("Set a monthly price between ₦1,000 and ₦1,000,000.");
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 90)
    throw new RangeError("Set a whole-number discount between 0% and 90%.");
  const discountKobo = percentageKobo(listedAmountKobo, discountPercent * 100);
  const customerPriceKobo = listedAmountKobo - discountKobo,
    estimatedProcessingKobo = collectionFeeKobo(customerPriceKobo, policy);
  return {
    listedAmountKobo,
    discountPercent,
    discountKobo,
    customerPriceKobo,
    estimatedProcessingKobo,
    estimatedNetKobo: customerPriceKobo - estimatedProcessingKobo,
    currency: "NGN" as const,
    cadence: "MONTHLY" as const,
  };
}
export function fixedSubscriptionPrice(policy: CollectionFees) {
  return kiraSubscriptionPrice(600000, 0, policy);
}
