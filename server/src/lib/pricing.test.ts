import { describe, expect, it } from "vitest";
import {
  campusFare,
  checkoutPrice,
  collectionFeeKobo,
  fixedSubscriptionPrice,
  inclusiveGrossKobo,
  listingPrice,
  publishedNigeriaLocalFees,
  type CommerceFees,
} from "./pricing";
const policy: CommerceFees = {
  id: "synthetic-policy",
  buyerBasisPoints: 0,
  buyerFlatPerItemKobo: 0,
  sellerCommissionBasisPoints: 500,
  collection: publishedNigeriaLocalFees,
  checkoutSavings: true,
  allowProcessorSubsidy: false,
};
describe("inclusive campus pricing", () => {
  it("uses the gross amount for the ₦2,500 threshold and applies the cap", () => {
    expect(collectionFeeKobo(50000, policy.collection)).toBe(750);
    expect(collectionFeeKobo(249999, policy.collection)).toBe(3750);
    expect(collectionFeeKobo(250000, policy.collection)).toBe(13750);
    expect(collectionFeeKobo(20_000_000, policy.collection)).toBe(200000);
  });
  it("finds a minimal payable amount on either side of the non-monotonic fee threshold", () => {
    for (const net of [
      1, 49000, 240000, 246249, 246250, 250000, 350000, 600000, 15_000_000,
    ]) {
      const gross = inclusiveGrossKobo(net, policy.collection);
      expect(
        gross - collectionFeeKobo(gross, policy.collection),
      ).toBeGreaterThanOrEqual(net);
      expect(
        gross - 1 - collectionFeeKobo(gross - 1, policy.collection),
      ).toBeLessThan(net);
      if (gross >= 250000)
        expect(
          249999 - collectionFeeKobo(249999, policy.collection),
        ).toBeLessThan(net);
    }
  });
  it("shows the same inclusive single-item budget through checkout, with exact digital delivery added", () => {
    const price = listingPrice(350000, policy),
      fare = campusFare(700);
    const quote = checkoutPrice([{ baseKobo: 350000, quantity: 1 }], policy, {
      ...fare,
      paymentMethod: "IN_APP",
    });
    expect(price.customerPriceKobo).toBe(365500);
    expect(quote.totalKobo).toBe(price.customerPriceKobo + 30000);
    expect(quote.payableKobo).toBe(quote.totalKobo);
    expect(quote.projectedPlatformNetKobo).toBeGreaterThanOrEqual(0);
  });
  it("accounts for transaction-level fees and never increases a cart above displayed items and the accepted fare", () => {
    const items = [
      { baseKobo: 350000, quantity: 3 },
      { baseKobo: 50000, quantity: 2 },
    ];
    const budget = items.reduce(
      (sum, i) =>
        sum + listingPrice(i.baseKobo, policy).customerPriceKobo * i.quantity,
      0,
    );
    const quote = checkoutPrice(items, policy, null);
    expect(quote.totalKobo).toBeLessThanOrEqual(budget);
    expect(quote.discountKobo).toBeGreaterThan(0);
    expect(quote.totalKobo + quote.discountKobo).toBe(budget);
    expect(
      quote.payableKobo - quote.estimatedProcessingKobo,
    ).toBeGreaterThanOrEqual(quote.baseKobo + quote.buyerComponentKobo);
  });
  it("handles combined low-priced items crossing the flat-fee threshold through the approved margin, and refuses an unfunded subsidy", () => {
    const quote = checkoutPrice(
      [{ baseKobo: 50000, quantity: 5 }],
      policy,
      null,
    );
    expect(quote.totalKobo).toBe(254000);
    expect(quote.sellerNetKobo).toBe(237500);
    expect(quote.projectedPlatformNetKobo).toBe(2690);
    expect(() =>
      checkoutPrice(
        [{ baseKobo: 50000, quantity: 5 }],
        { ...policy, sellerCommissionBasisPoints: 0 },
        null,
      ),
    ).toThrow("does not cover");
  });
  it("separates cash fare from the amount sent to Paystack; cash never creates rider digital earnings", () => {
    const price = listingPrice(350000, policy),
      fare = campusFare(1000);
    const quote = checkoutPrice([{ baseKobo: 350000, quantity: 1 }], policy, {
      ...fare,
      paymentMethod: "CASH",
    });
    expect(quote.payableKobo).toBe(price.customerPriceKobo);
    expect(quote.cashDueKobo).toBe(30000);
    expect(quote.totalKobo).toBe(quote.payableKobo + 30000);
    expect(fare).toMatchObject({ commissionKobo: 3000, riderNetKobo: 27000 });
  });
  it("calculates ₦300–₦450 in campus distance bands and a ten percent commission", () => {
    expect(
      [0, 1000, 1001, 2000, 2001, 3001, 5000].map(
        (m) => campusFare(m).fareKobo,
      ),
    ).toEqual([30000, 30000, 35000, 35000, 40000, 45000, 45000]);
    expect(campusFare(3001)).toMatchObject({
      commissionKobo: 4500,
      riderNetKobo: 40500,
    });
  });
  it("keeps Kira Pro fixed at ₦6,000; local published processing leaves an estimated ₦5,810", () => {
    expect(fixedSubscriptionPrice(policy.collection)).toMatchObject({
      customerPriceKobo: 600000,
      estimatedProcessingKobo: 19000,
      estimatedNetKobo: 581000,
    });
  });
  it("rejects fractional, unsafe, negative or invalid money and preserves zero-priced goods", () => {
    for (const amount of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER])
      expect(() => listingPrice(amount, policy)).toThrow();
    expect(() =>
      inclusiveGrossKobo(100000, { ...policy.collection, basisPoints: 10000 }),
    ).toThrow();
    expect(listingPrice(0, policy).customerPriceKobo).toBe(0);
    expect(collectionFeeKobo(0, policy.collection)).toBe(0);
  });
});
