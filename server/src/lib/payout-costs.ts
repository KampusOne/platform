/** Payout costs are separate from collection fees and commercial commission. */
export type PayoutCostPolicy = {
  feeBearer: "PLATFORM" | "PAYEE";
  lowFeeKobo: number;
  middleFeeKobo: number;
  highFeeKobo: number;
  dutyThresholdKobo: number;
  dutyKobo: number;
  minimumWithdrawalKobo: number;
};

export function payoutCostQuote(walletDebitKobo: number, policy: PayoutCostPolicy) {
  if (!Number.isSafeInteger(walletDebitKobo) || walletDebitKobo <= 0 || walletDebitKobo > 1_000_000_000)
    throw new RangeError("Choose a valid withdrawal amount.");
  if (walletDebitKobo < policy.minimumWithdrawalKobo)
    throw new RangeError(`The minimum withdrawal is ₦${(policy.minimumWithdrawalKobo / 100).toLocaleString("en-NG")} for this account.`);
  for (const value of [policy.lowFeeKobo, policy.middleFeeKobo, policy.highFeeKobo, policy.dutyThresholdKobo, policy.dutyKobo, policy.minimumWithdrawalKobo])
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("The reviewed payout cost policy is invalid.");
  const band = (amount: number) => amount <= 500_000 ? policy.lowFeeKobo : amount <= 5_000_000 ? policy.middleFeeKobo : policy.highFeeKobo;
  // Reserve the requested-amount band. The actual provider band applies to the
  // sealed bank transfer; any unused transfer allowance is returned after GET proof.
  const transferFeeAllowanceKobo = policy.feeBearer === "PAYEE" ? band(walletDebitKobo) : 0;
  const bankNetKobo = walletDebitKobo - transferFeeAllowanceKobo;
  if (bankNetKobo <= 0) throw new RangeError("That amount does not cover the reviewed transfer fee.");
  const expectedTransferFeeKobo = band(bankNetKobo);
  const expectedStatutoryDutyKobo = bankNetKobo >= policy.dutyThresholdKobo ? policy.dutyKobo : 0;
  return {
    walletDebitKobo,
    bankNetKobo,
    expectedTransferFeeKobo,
    expectedStatutoryDutyKobo,
    transferFeeAllowanceKobo,
    statutoryDutyAllowanceKobo: 0,
    minimumWithdrawalKobo: policy.minimumWithdrawalKobo,
    feeBearer: policy.feeBearer,
    statutoryDutyBearer: "PLATFORM" as const,
    statutoryDutyPolicy: "PLATFORM_ABSORBS_PENDING_STATEMENT" as const,
    statutoryDutyReconciliation: expectedStatutoryDutyKobo > 0 ? "AWAITING_BALANCE_STATEMENT" as const : "NOT_EXPECTED" as const,
    bankDeductionStatus: "NOT_VERIFIED" as const,
  };
}
