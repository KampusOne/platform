import { describe, expect, it } from "vitest";
import {withdrawalCommission,withdrawalCommissionTiers} from "./payout-commission";
import { payoutCostQuote, type PayoutCostPolicy } from "./payout-costs";

const policy: PayoutCostPolicy = { feeBearer: "PLATFORM", lowFeeKobo: 1000, middleFeeKobo: 2500, highFeeKobo: 5000, dutyThresholdKobo: 1_000_000, dutyKobo: 5000, minimumWithdrawalKobo: 1 };
describe("separate NGN payout costs", () => {
  it.each([[100, 1000], [500_000, 1000], [500_100, 2500], [5_000_000, 2500], [5_000_100, 5000]])("quotes transfer band for %i kobo independently of duty", (amount, expected) => {
    const q = payoutCostQuote(amount, policy);
    expect(q.expectedTransferFeeKobo).toBe(expected);
    expect(q.bankNetKobo).toBe(amount);
    expect(q.walletDebitKobo).toBe(amount);
    expect(q.transferFeeAllowanceKobo).toBe(0);
  });
  it("keeps duty separate at the actual transfer threshold and absorbs it pending statement proof", () => {
    expect(payoutCostQuote(999_999, policy).expectedStatutoryDutyKobo).toBe(0);
    const q = payoutCostQuote(1_000_000, policy);
    expect(q.expectedTransferFeeKobo).toBe(2500);
    expect(q.expectedStatutoryDutyKobo).toBe(5000);
    expect(q.statutoryDutyAllowanceKobo).toBe(0);
    expect(q.statutoryDutyReconciliation).toBe("AWAITING_BALANCE_STATEMENT");
    expect(q.statutoryDutyPolicy).toBe("PLATFORM_ABSORBS_PENDING_STATEMENT");
  });
  it("quotes a sealed debit and bank transfer and leaves receiving bank deductions unverified", () => {
    const q = payoutCostQuote(2_000_000, { ...policy, feeBearer: "PAYEE" });
    expect(q.walletDebitKobo).toBe(2_000_000);
    expect(q.bankNetKobo).toBe(1_997_500);
    expect(q.transferFeeAllowanceKobo).toBe(2500);
    expect(q.expectedStatutoryDutyKobo).toBe(5000);
    expect(q.bankDeductionStatus).toBe("NOT_VERIFIED");
  });
  it("minimum is independently configurable, rather than tied to the transfer band", () => {
    expect(() => payoutCostQuote(499_999, { ...policy, minimumWithdrawalKobo: 500_000 })).toThrow("minimum withdrawal");
    expect(payoutCostQuote(100_000, { ...policy, minimumWithdrawalKobo: 100_000 }).expectedTransferFeeKobo).toBe(1000);
  });
});

describe('graduated commission bands',()=>{
 it.each([[200000,16000],[1000000,80000],[1000001,80000],[5000000,320000],[6000000,370000]])('computes %i kobo without a fee cliff', (amount,fee)=>{expect(withdrawalCommission(amount,withdrawalCommissionTiers)).toBe(fee);});
 it('keeps the bank net increasing across boundaries and splitting no cheaper',()=>{for(const n of [999999,1000000,1000001,4999999,5000000,5000001]){const a=payoutCostQuote(n,{...policy,commissionTiers:withdrawalCommissionTiers});const b=payoutCostQuote(n+1,{...policy,commissionTiers:withdrawalCommissionTiers});expect(b.bankNetKobo).toBeGreaterThanOrEqual(a.bankNetKobo);}expect(withdrawalCommission(2000000,withdrawalCommissionTiers)).toBeLessThanOrEqual(2*withdrawalCommission(1000000,withdrawalCommissionTiers));});
 it('rejects increasing rates and incomplete policies',()=>{expect(()=>withdrawalCommission(200000,[{upToKobo:null,basisPoints:801}])).toThrow();expect(()=>withdrawalCommission(200000,[{upToKobo:1000000,basisPoints:500},{upToKobo:null,basisPoints:800}])).toThrow();});
});
