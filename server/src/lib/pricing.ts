/** Currency arithmetic is integer kobo; projections never initialize a payment. */
export type CollectionFees = {
  basisPoints: number;
  flatKobo: number;
  flatWaivedBelowKobo: number;
  capKobo: number | null;
  /** Display increment approved with this policy; legacy policies use ₦1. */
  displayRoundKobo?: number;
  roundingMode?: "NONE" | "NEAREST_50" | "CEIL_50" | "NEAREST_100" | "CEIL_100" | "FRIENDLY_9";
  maxPricingAdjustmentKobo?: number;
  providerProfileId?: string;
  providerProfileVersion?: string;
  transactionClass?: string;
};
export type FeeBearer = "PLATFORM_ABSORBS" | "SELLER_ABSORBS" | "BUYER_VISIBLE" | "INCLUDED_IN_PRICE" | "SPLIT";
export type CommerceFees = {
  id: string;
  buyerBasisPoints: number;
  buyerFlatPerItemKobo: number;
  sellerCommissionBasisPoints: number;
  collection: CollectionFees;
  checkoutSavings: boolean;
  allowProcessorSubsidy: boolean;
  feeBearer?: FeeBearer;
  providerFeeMode?: "LEGACY_INCLUSIVE" | "CUSTOMER_PASSTHROUGH";
  customerFeeDisplay?: "INCLUDED" | "SEPARATE";
  feeSplit?: { platformBasisPoints: number; buyerBasisPoints: number; sellerBasisPoints: number };
  providerProfileId?: string;
  roundingMode?: CollectionFees["roundingMode"];
  maxPricingAdjustmentKobo?: number;
  minimumCommissionKobo?:number;
  maximumCommissionKobo?:number|null;
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
  if (policy.maxPricingAdjustmentKobo !== undefined) money(policy.maxPricingAdjustmentKobo);
  if (policy.roundingMode !== undefined && !["NONE", "NEAREST_50", "CEIL_50", "NEAREST_100", "CEIL_100", "FRIENDLY_9"].includes(policy.roundingMode))
    throw new RangeError("Choose an approved price rounding mode.");
}
export function roundDisplayKobo(value:number,policy:CollectionFees,allowSubsidy=false){
  money(value);validateFees(policy);
  if(value===0)return 0;
  const mode=policy.roundingMode;
  const increment=BigInt(mode?.endsWith("_50")?5000:mode?.endsWith("_100")?10000:policy.displayRoundKobo??100);
  const rounded=mode==="NONE"?value:mode==="FRIENDLY_9"?Number(ceilRatio(BigInt(value)+100n,100000n)*100000n-100n):
    mode?.startsWith("NEAREST")?Number(((BigInt(value)+increment/2n)/increment)*increment):Number(ceilRatio(BigInt(value),increment)*increment);
  if (rounded < value && !allowSubsidy) throw new RangeError("This rounding mode needs an approved subsidy to cover its economic minimum.");
  if (policy.maxPricingAdjustmentKobo !== undefined && Math.abs(rounded-value)>policy.maxPricingAdjustmentKobo)
    throw new RangeError("The price rounding adjustment exceeds the approved maximum.");
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
export function collectionFeeAllocation(amountKobo:number,policy:CommerceFees){
  const fee=collectionFeeKobo(amountKobo,policy.collection),mode=policy.feeBearer??"INCLUDED_IN_PRICE";
  if (!["PLATFORM_ABSORBS","SELLER_ABSORBS","BUYER_VISIBLE","INCLUDED_IN_PRICE","SPLIT"].includes(mode)) throw new RangeError("Choose an approved fee bearer.");
  let buyer=mode==="BUYER_VISIBLE"||mode==="INCLUDED_IN_PRICE"?fee:0,seller=mode==="SELLER_ABSORBS"?fee:0;
  if(mode==="SPLIT"){
    const split=policy.feeSplit;
    if(!split||![split.platformBasisPoints,split.buyerBasisPoints,split.sellerBasisPoints].every(v=>Number.isInteger(v)&&v>=0)||split.platformBasisPoints+split.buyerBasisPoints+split.sellerBasisPoints!==10000)throw new RangeError("Fee split shares must total 100%.");
    buyer=Number(BigInt(fee)*BigInt(split.buyerBasisPoints)/10000n);seller=Number(BigInt(fee)*BigInt(split.sellerBasisPoints)/10000n);
  }
  return { buyerKobo:buyer,sellerKobo:seller,platformKobo:fee-buyer-seller,feeKobo:fee,feeBearer:mode };
}
function displayPolicy(policy:CommerceFees):CollectionFees{
  return {...policy.collection,...(policy.roundingMode?{roundingMode:policy.roundingMode}:{}),...(policy.maxPricingAdjustmentKobo!==undefined?{maxPricingAdjustmentKobo:policy.maxPricingAdjustmentKobo}: {})};
}
function commissionKobo(base:number,policy:CommerceFees){
  const minimum=policy.minimumCommissionKobo??0,maximum=policy.maximumCommissionKobo??base;
  money(minimum);money(maximum);
  if(minimum>maximum)throw new RangeError("Minimum commission must not exceed its maximum.");
  const value=Math.min(maximum,Math.max(minimum,percentageKobo(base,policy.sellerCommissionBasisPoints)));
  if(value>base)throw new RangeError("The commission exceeds the seller's item value.");
  return value;
}
function commercialGrossKobo(net:number,policy:CommerceFees){
  if(policy.providerFeeMode==="CUSTOMER_PASSTHROUGH")return inclusiveGrossKobo(net,policy.collection);
  const mode=policy.feeBearer??"INCLUDED_IN_PRICE";
  if(mode==="INCLUDED_IN_PRICE"||mode==="BUYER_VISIBLE")return inclusiveGrossKobo(net,policy.collection);
  if(mode!=="SPLIT"){collectionFeeAllocation(net,policy);return net;}
  // Find each threshold band separately, because the flat fee jumps at ₦2,500.
  const threshold=policy.collection.flatWaivedBelowKobo,candidates:number[]=[];
  for(const [start,end]of threshold>0?[[0,threshold-1],[threshold,MAX_KOBO]]:[[0,MAX_KOBO]]){
    let low=Math.max(net,start!),high=end!;
    if(low>high||high-collectionFeeAllocation(high,policy).buyerKobo<net)continue;
    while(low<high){const mid=low+Math.floor((high-low)/2);if(mid-collectionFeeAllocation(mid,policy).buyerKobo>=net)high=mid;else low=mid+1;}
    candidates.push(low);
  }
  if(!candidates.length)throw new RangeError("This amount cannot fit the payment limit.");
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
      rawRequirementKobo:0,
      pricingAdjustmentKobo:0,
      providerProfileId:policy.providerProfileId??policy.collection.providerProfileId??null,
      providerProfileVersion:policy.collection.providerProfileVersion??null,
      ruleId: policy.id,
    };
  const buyerComponentKobo =
    percentageKobo(baseKobo, policy.buyerBasisPoints, "ceil") +
    policy.buyerFlatPerItemKobo;
  const target = baseKobo + buyerComponentKobo;
  money(target);
  const rawRequirementKobo=commercialGrossKobo(target,policy);
  const customerPriceKobo = roundDisplayKobo(rawRequirementKobo,displayPolicy(policy),policy.allowProcessorSubsidy);
  money(customerPriceKobo);
  return {
    baseKobo,
    buyerComponentKobo,
    customerPriceKobo,
    processingAllowanceKobo: customerPriceKobo - target,
    rawRequirementKobo,
    pricingAdjustmentKobo:customerPriceKobo-rawRequirementKobo,
    providerProfileId:policy.providerProfileId??policy.collection.providerProfileId??null,
    providerProfileVersion:policy.collection.providerProfileVersion??null,
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
  const rawRequirementKobo=commercialGrossKobo(
        baseKobo + buyerComponentKobo + digitalDeliveryKobo,
        policy);
  const targetGross = roundDisplayKobo(rawRequirementKobo,displayPolicy(policy),policy.allowProcessorSubsidy);
  const discountKobo = policy.checkoutSavings
    ? Math.max(0, budgetPayableKobo - targetGross)
    : 0;
  const payableKobo = budgetPayableKobo - discountKobo,
    totalKobo = payableKobo + cashDueKobo;
  // New configurable policies bound the selected cart total, not merely an
  // intermediate rounded target. Legacy policies retain their original math.
  const pricingAdjustmentKobo=payableKobo-rawRequirementKobo;
  if(policy.maxPricingAdjustmentKobo!==undefined&&Math.abs(pricingAdjustmentKobo)>policy.maxPricingAdjustmentKobo)
    throw new RangeError("This cart exceeds the approved price adjustment. Review its items or approve a pricing policy that covers this cart.");
  if((policy.roundingMode!==undefined||policy.maxPricingAdjustmentKobo!==undefined)&&pricingAdjustmentKobo<0&&!policy.allowProcessorSubsidy)
    throw new RangeError("The displayed item budget does not cover this cart's economic minimum. Review the items or approve an explicit subsidy.");
  money(totalKobo);
  const allocation=collectionFeeAllocation(payableKobo,policy);
  const sellerCommissionKobo = commissionKobo(baseKobo,policy),
    sellerNetKobo = baseKobo - sellerCommissionKobo-(policy.providerFeeMode==="CUSTOMER_PASSTHROUGH"?0:allocation.sellerKobo);
  if(sellerNetKobo<0)throw new RangeError("This fee policy exceeds the seller's earnings.");
  const estimatedProcessingKobo = collectionFeeKobo(
    payableKobo,
    policy.collection,
  );
  const riderDigitalNetKobo =
    delivery?.paymentMethod === "IN_APP" ? delivery.riderNetKobo : 0;
  const projectedPlatformNetKobo =
    (policy.providerFeeMode==="CUSTOMER_PASSTHROUGH"?baseKobo+buyerComponentKobo+digitalDeliveryKobo:payableKobo-estimatedProcessingKobo) - sellerNetKobo - riderDigitalNetKobo;
  if (projectedPlatformNetKobo < 0 && !policy.allowProcessorSubsidy)
    throw new RangeError("The approved policy does not cover this checkout.");
  return {
    baseKobo,
    ...(policy.providerFeeMode==="CUSTOMER_PASSTHROUGH"?{providerFeeMode:policy.providerFeeMode,providerSubtotalKobo:baseKobo+buyerComponentKobo+digitalDeliveryKobo}:{}),
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
    rawRequirementKobo,
    pricingAdjustmentKobo,
    visibleProcessingKobo:allocation.feeBearer==="BUYER_VISIBLE"||policy.customerFeeDisplay==="SEPARATE"?allocation.buyerKobo:0,
    feeAllocation:allocation,
    feeBearer:allocation.feeBearer,
    providerProfileId:policy.providerProfileId??policy.collection.providerProfileId??null,
    providerProfileVersion:policy.collection.providerProfileVersion??null,
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
