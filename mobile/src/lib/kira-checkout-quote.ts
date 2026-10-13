export type KiraPricingQuote = {
  quoteId: string;
  tier: 'standard' | 'pro';
  version: string;
  amountKobo: number;
  listedAmountKobo: number;
  discountAmountKobo: number;
  discountPercent: number;
  offerDiscountPercent: number;
  couponDiscountPercent: number;
  discountCode: string | null;
  expiresAt: string;
  paystackAmountKobo: number;
  estimatedProcessingKobo: number;
  feeBearer: 'LEGACY_INCLUSIVE' | 'CUSTOMER_PASSTHROUGH' | 'MERCHANT_ABSORBS';
};

/** The customer total includes processing; a passthrough provider collects the fee itself. */
export function readKiraCheckoutQuote(value: unknown, tier: KiraPricingQuote['tier']): KiraPricingQuote {
  const q = value as Partial<KiraPricingQuote> | null;
  const money = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
  if (!q || q.tier !== tier || typeof q.quoteId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q.quoteId) ||
      !money(q.amountKobo) || !money(q.paystackAmountKobo) || !money(q.estimatedProcessingKobo) ||
      typeof q.expiresAt !== 'string' || !Number.isFinite(Date.parse(q.expiresAt)) ||
      !['LEGACY_INCLUSIVE', 'CUSTOMER_PASSTHROUGH', 'MERCHANT_ABSORBS'].includes(q.feeBearer ?? '') ||
      q.paystackAmountKobo !== q.amountKobo - (q.feeBearer === 'CUSTOMER_PASSTHROUGH' ? q.estimatedProcessingKobo : 0))
    throw new Error('Your checkout quote could not be read. Try again.');
  return q as KiraPricingQuote;
}
