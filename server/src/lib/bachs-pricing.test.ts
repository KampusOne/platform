import { describe, expect, it } from "vitest";
import { collectionFeeKobo } from "./pricing";
import {
  assertBachsQuote,
  bachsCheckoutCorridor,
  bachsPaymentMethodMatches,
  bachsMarketplacePrices,
  bachsWithdrawalQuote,
  createBachsPricingQuote,
  publishedBachsProfiles,
  type BachsFeeContext,
  type BachsFeeProfile,
} from "./bachs-pricing";

const now = Date.parse("2026-10-09T12:00:00Z");
function profile(context: BachsFeeContext = "CHECKOUT_BANK_TRANSFER"): BachsFeeProfile {
  return {
    ...structuredClone(publishedBachsProfiles.find(item => item.context === context)!),
    id: "33333333-3333-4333-8333-333333333333",
    universityId: "11111111-1111-4111-8111-111111111111",
    status: "APPROVED",
  };
}

describe("BACHS prices accepted once", () => {
  it("uses the BACHS NGN products without inheriting Paystack's flat fee or virtual-account rate", () => {
    const bank = profile().collection;
    expect(collectionFeeKobo(249_999, bank)).toBe(3_750);
    expect(collectionFeeKobo(250_000, bank)).toBe(3_750);
    expect(collectionFeeKobo(600_000, bank)).toBe(9_000);
    expect(collectionFeeKobo(20_000_000, bank)).toBe(200_000);
    expect(collectionFeeKobo(600_000, profile("LOCAL_CARD").collection)).toBe(12_000);
    expect(collectionFeeKobo(20_000_000, profile("LOCAL_CARD").collection)).toBe(400_000);
    expect(collectionFeeKobo(600_000, profile("VIRTUAL_ACCOUNT_DEPOSIT").collection)).toBe(9_000);
    expect(collectionFeeKobo(20_000_000, profile("VIRTUAL_ACCOUNT_DEPOSIT").collection)).toBe(30_000);
    expect(publishedBachsProfiles.every(item => item.status === "DISABLED")).toBe(true);
  });

  it("keeps a ₦6,000 Kira list price exact, including a real 20% discount", () => {
    const full = createBachsPricingQuote({ subtotalKobo: 600_000, priceMode: "FIXED_TOTAL" }, profile(), now);
    expect(full).toMatchObject({ finalCustomerAmountKobo: 600_000, providerAmountKobo: 600_000, estimatedProviderFeeKobo: 9_000, estimatedNetKobo: 591_000 });
    const discounted = createBachsPricingQuote({ subtotalKobo: 600_000, discountPercent: 20, priceMode: "FIXED_TOTAL" }, profile(), now);
    expect(discounted).toMatchObject({ discountKobo: 120_000, discountedSubtotalKobo: 480_000, finalCustomerAmountKobo: 480_000, providerAmountKobo: 480_000, estimatedProviderFeeKobo: 7_200, pricingAdjustmentKobo: 0 });
    expect(() => createBachsPricingQuote({ subtotalKobo: 600_000, priceMode: "FIXED_TOTAL", roundingMode: "FRIENDLY_9" }, profile(), now)).toThrow("advertised discount");
    expect(() => createBachsPricingQuote({ subtotalKobo: 600_000, priceMode: "FIXED_TOTAL", platformRevenueKobo: 100 }, profile(), now)).toThrow("already includes");
  });

  it("recovers economics before clean rounding and submits exactly the accepted total", () => {
    const quote = createBachsPricingQuote({ subtotalKobo: 600_000, priceMode: "RECOVER_FEES" }, profile(), now);
    expect(quote).toMatchObject({ rawRequirementKobo: 609_138, finalCustomerAmountKobo: 610_000, providerAmountKobo: 610_000, estimatedProviderFeeKobo: 9_150, estimatedNetKobo: 600_850, pricingAdjustmentKobo: 862 });
    expect(quote.estimatedNetKobo).toBeGreaterThanOrEqual(600_000);
    expect(() => assertBachsQuote(quote, 610_000, now + 1000)).not.toThrow();
    expect(() => assertBachsQuote(quote, 600_000, now + 1000)).toThrow("total changed");
    expect(() => createBachsPricingQuote({ subtotalKobo: 600_000, priceMode: "RECOVER_FEES", maxPricingAdjustmentKobo: 100 }, profile(), now)).toThrow("maximum");
    expect(() => createBachsPricingQuote({ subtotalKobo: 615_000, priceMode: "RECOVER_FEES", roundingMode: "NEAREST_100" }, profile(), now)).toThrow("subsidy");
  });

  it("discounts items only, then includes delivery and commercial revenue in the economic target", () => {
    const quote = createBachsPricingQuote({ subtotalKobo: 600_000, discountPercent: 25, deliveryKobo: 30_000, platformRevenueKobo: 5_000, priceMode: "RECOVER_FEES", roundingMode: "NONE" }, profile(), now);
    expect(quote.discountKobo).toBe(150_000);
    expect(quote.estimatedNetKobo).toBeGreaterThanOrEqual(485_000);
    expect(quote.finalCustomerAmountKobo).toBe(quote.providerAmountKobo);
    expect(quote.pricingAdjustmentKobo).toBe(0);
    expect(quote.includedProcessingKobo).toBe(quote.finalCustomerAmountKobo - 485_000);
  });

  it("pins the fee version and expires at the earlier of the quote or profile deadline", () => {
    const fees = profile(); fees.effectiveTo = new Date(now + 3 * 60_000).toISOString();
    const quote = createBachsPricingQuote({ subtotalKobo: 600_000, priceMode: "FIXED_TOTAL" }, fees, now);
    fees.collection.basisPoints = 900;
    expect(quote.profile.collection.basisPoints).toBe(150);
    expect(quote.expiresAt).toBe("2026-10-09T12:03:00.000Z");
    expect(() => assertBachsQuote(quote, 600_000, now + 3 * 60_000)).toThrow("expired");
    expect(() => assertBachsQuote({ ...quote, providerAmountKobo: 609_000 }, 600_000, now + 1000)).toThrow("inconsistent");
    expect(() => assertBachsQuote({ ...quote, discountKobo: 1 }, 600_000, now + 1000)).toThrow("inconsistent");
    expect(() => assertBachsQuote({ ...quote, expiresAt: "invalid" }, 600_000, now + 1000)).toThrow("expired");
  });

  it("requires account-approved, effective rules and an isolated checkout corridor", () => {
    expect(() => createBachsPricingQuote({ subtotalKobo: 600_000, priceMode: "FIXED_TOTAL" }, { ...profile(), status: "DISABLED" }, now)).toThrow("disabled");
    expect(() => createBachsPricingQuote({ subtotalKobo: 600_000, priceMode: "FIXED_TOTAL" }, { ...profile(), effectiveFrom: "2026-10-10T00:00:00Z" }, now)).toThrow("effective");
    for (const context of ["BANK_WITHDRAWAL", "VIRTUAL_ACCOUNT_DEPOSIT"] as const)
      expect(() => createBachsPricingQuote({ subtotalKobo: 600_000, priceMode: "FIXED_TOTAL" }, profile(context), now)).toThrow("hosted checkout");
    expect(bachsCheckoutCorridor("CHECKOUT_BANK_TRANSFER")).toBe("NGN_BANK_TRANSFER");
    expect(bachsCheckoutCorridor("LOCAL_CARD")).toBe("NGN_CARD");
    expect(bachsPaymentMethodMatches("LOCAL_CARD", "CARD")).toBe(true);
    expect(bachsPaymentMethodMatches("CHECKOUT_BANK_TRANSFER", "NGN_CARD")).toBe(false);
  });

  it("quotes the merchant withdrawal fee separately from recipient money", () => {
    const withdrawal = profile("BANK_WITHDRAWAL");
    expect(bachsWithdrawalQuote(100_000, withdrawal, "RECIPIENT_AMOUNT", now)).toMatchObject({ recipientAmountKobo: 100_000, providerFeeKobo: 5_000, totalDebitKobo: 105_000 });
    expect(bachsWithdrawalQuote(100_000, withdrawal, "TOTAL_DEBIT", now)).toMatchObject({ recipientAmountKobo: 95_000, providerFeeKobo: 5_000, totalDebitKobo: 100_000 });
    expect(() => bachsWithdrawalQuote(5_000, withdrawal, "TOTAL_DEBIT", now)).toThrow("does not cover");
    expect(() => bachsWithdrawalQuote(100_000, profile(), "TOTAL_DEBIT", now)).toThrow("withdrawal profile");
  });

  it("keeps marketplace listings, combined checkout savings and cash delivery consistent", () => {
    const commercial = { id: "approved-commercial-v1", buyerBasisPoints: 0, buyerFlatPerItemKobo: 5_000, sellerCommissionBasisPoints: 500, checkoutSavings: true, allowProcessorSubsidy: false, feeBearer: "INCLUDED_IN_PRICE" as const };
    const digital = bachsMarketplacePrices({ items: [{ baseKobo: 550_000, quantity: 2 }], commercial, delivery: { fareKobo: 30_000, riderNetKobo: 27_000, paymentMethod: "IN_APP" } }, profile(), now);
    const displayed = digital.listings[0]!.customerPriceKobo * 2 + 30_000;
    expect(digital.checkout.totalKobo).toBeLessThanOrEqual(displayed);
    expect(digital.checkout.totalKobo + digital.checkout.discountKobo).toBe(displayed);
    expect(digital.providerAmountKobo).toBe(digital.checkout.totalKobo);
    expect(digital.checkout.projectedPlatformNetKobo).toBeGreaterThanOrEqual(0);
    const cash = bachsMarketplacePrices({ items: [{ baseKobo: 550_000, quantity: 1 }], commercial, delivery: { fareKobo: 30_000, riderNetKobo: 27_000, paymentMethod: "CASH" } }, profile(), now);
    expect(cash.checkout.cashDueKobo).toBe(30_000);
    expect(cash.providerAmountKobo).toBe(cash.checkout.totalKobo - 30_000);
    const paymentQuote = createBachsPricingQuote({ subtotalKobo: cash.providerAmountKobo, priceMode: "FIXED_TOTAL" }, profile(), now);
    expect(paymentQuote.providerAmountKobo).toBe(cash.providerAmountKobo);
  });

  it("supports approved platform, seller, buyer and split fee policies without losing the fee allocation", () => {
    for (const feeBearer of ["PLATFORM_ABSORBS", "SELLER_ABSORBS", "BUYER_VISIBLE", "INCLUDED_IN_PRICE", "SPLIT"] as const) {
      const pricing = bachsMarketplacePrices({ items: [{ baseKobo: 600_000, quantity: 1 }], delivery: null, commercial: {
        id: "approved-commercial-v1", buyerBasisPoints: 0, buyerFlatPerItemKobo: 0, sellerCommissionBasisPoints: 500, checkoutSavings: true, allowProcessorSubsidy: false, feeBearer,
        feeSplit: { platformBasisPoints: 2000, buyerBasisPoints: 5000, sellerBasisPoints: 3000 },
      } }, profile(), now);
      const allocation = pricing.checkout.feeAllocation;
      expect(allocation.buyerKobo + allocation.sellerKobo + allocation.platformKobo).toBe(pricing.checkout.estimatedProcessingKobo);
      expect(pricing.checkout.projectedPlatformNetKobo).toBeGreaterThanOrEqual(0);
      expect(pricing.policy.collection.flatKobo).toBe(0);
      expect(pricing.providerAmountKobo).toBe(pricing.checkout.totalKobo);
    }
  });

  it("rejects unusable amounts, fake discounts and unsupported quote lifetimes", () => {
    for (const value of [0, -1, 0.5, NaN, Infinity, 2_000_000_001])
      expect(() => createBachsPricingQuote({ subtotalKobo: value, priceMode: "FIXED_TOTAL" }, profile(), now)).toThrow();
    for (const discountPercent of [-1, 1.5, 91, NaN])
      expect(() => createBachsPricingQuote({ subtotalKobo: 600_000, priceMode: "FIXED_TOTAL", discountPercent }, profile(), now)).toThrow("discount");
    for (const expiresInMinutes of [0, 21, 1.5])
      expect(() => createBachsPricingQuote({ subtotalKobo: 600_000, priceMode: "FIXED_TOTAL", expiresInMinutes }, profile(), now)).toThrow("minutes");
  });
});
