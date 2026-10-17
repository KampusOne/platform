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
  roundDisplayKobo,
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
  it('applies the requested 2.5% product commission once and preserves the seller base amount',()=>{
    const productPolicy={...policy,buyerBasisPoints:250,sellerCommissionBasisPoints:0};
    const listing=listingPrice(400000,productPolicy);
    expect(listing.buyerComponentKobo).toBe(10000);
    const quote=checkoutPrice([{baseKobo:400000,quantity:1}],productPolicy,null);
    expect(quote.sellerNetKobo).toBe(400000);
    expect(quote.totalKobo).toBe(listing.customerPriceKobo);
    expect(quote.totalKobo-quote.estimatedProcessingKobo).toBeGreaterThanOrEqual(410000);
  });
  it('rounds the inclusive display upward at the approved increment and submits no second processing allowance',()=>{
    const rounded={...policy,buyerFlatPerItemKobo:5000,collection:{...policy.collection,displayRoundKobo:10000}};
    const listing=listingPrice(550000,rounded);
    expect(listing.customerPriceKobo).toBe(580000);
    const quote=checkoutPrice([{baseKobo:550000,quantity:1}],rounded,null);
    expect(quote.payableKobo).toBe(580000);
    expect(quote.totalKobo).toBe(listing.customerPriceKobo);
    expect(quote.payableKobo-quote.estimatedProcessingKobo).toBeGreaterThanOrEqual(555000);
    const withDelivery=checkoutPrice([{baseKobo:550000,quantity:1}],rounded,{fareKobo:30000,riderNetKobo:27000,paymentMethod:'IN_APP'});
    expect(withDelivery.totalKobo).toBe(listing.customerPriceKobo+30000);
    expect(withDelivery.payableKobo).toBe(withDelivery.totalKobo);
    expect(withDelivery.projectedPlatformNetKobo).toBeGreaterThanOrEqual(0);
  });
  it('uses integer ceiling rounding and rejects unsafe display policies',()=>{
    expect(roundDisplayKobo(570001,{...policy.collection,displayRoundKobo:10000})).toBe(580000);
    expect(roundDisplayKobo(580000,{...policy.collection,displayRoundKobo:10000})).toBe(580000);
    for(const increment of [0,1,150,NaN,Infinity,100001])expect(()=>roundDisplayKobo(50000,{...policy.collection,displayRoundKobo:increment})).toThrow();
  });
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
    expect(quote.totalKobo).toBe(price.customerPriceKobo + 50000);
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
    expect(quote.cashDueKobo).toBe(50000);
    expect(quote.totalKobo).toBe(quote.payableKobo + 50000);
    expect(fare).toMatchObject({ commissionKobo: 0, riderNetKobo: 50000 });
  });
  it("calculates ₦500–₦1,500 in campus distance bands with withdrawal-only commission", () => {
    expect(
      [0, 1000, 1001, 2000, 2001, 3001, 5000].map(
        (m) => campusFare(m).fareKobo,
      ),
    ).toEqual([50000, 50000, 60000, 60000, 70000, 80000, 90000]);
    expect(campusFare(3001)).toMatchObject({
      commissionKobo: 0,
      riderNetKobo: 80000,
    });
  });
  it('charges more for ten slippers than one on the same route, accounts for volume and caps at ₦1,500',()=>{
    const one=campusFare(700,{quantity:1,weightGrams:300,volumeCm3:0,pickupStops:1}),ten=campusFare(700,{quantity:10,weightGrams:3000,volumeCm3:0,pickupStops:1});
    expect(ten.fareKobo).toBeGreaterThan(one.fareKobo);
    expect(campusFare(700,{quantity:1,weightGrams:300,volumeCm3:100000,pickupStops:1}).fareKobo).toBeGreaterThan(one.fareKobo);
    expect(campusFare(99000,{quantity:99,weightGrams:99000,volumeCm3:999999,pickupStops:3}).fareKobo).toBe(150000);
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
