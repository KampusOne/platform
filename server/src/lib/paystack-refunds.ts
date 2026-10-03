import type { Bindings } from "../types";
import { AppError } from "./errors";
import { verifyPaystack } from "./paystack";

export const paystackRefundPolicy = {
  collectionFeeTreatment: "NON_REFUNDABLE" as const,
  sourceUrl: "https://support.paystack.com/en/articles/2127106",
  statusSourceUrl: "https://support.paystack.com/en/articles/2130434",
};

export type RefundExpectation = {
  providerRefundId: string;
  originalReference: string;
  originalAmountKobo: number;
  originalFeeKobo: number;
  customerRefundKobo: number;
};

/** Read-only: a Dashboard refund must already exist. API-call success is not refund success. */
export async function verifyPaystackRefund(env: Bindings, expected: RefundExpectation) {
  if (!/^[1-9][0-9]{0,19}$/.test(expected.providerRefundId) ||
      !Number.isSafeInteger(expected.customerRefundKobo) || expected.customerRefundKobo <= 0 ||
      expected.customerRefundKobo > expected.originalAmountKobo)
    throw new AppError(400, "BAD_REQUEST", "Choose a valid original payment and refund amount.");
  if (env.PAYMENTS_ENABLED !== "true" || !env.PAYSTACK_SECRET_KEY ||
      (env.ENVIRONMENT === "production" && !env.PAYSTACK_SECRET_KEY.startsWith("sk_live_")))
    throw new AppError(503, "FEATURE_DISABLED", "Refund reconciliation is not enabled.");
  let payload: {status?: boolean;data?: Record<string, unknown>} | null;
  try {
    const response = await fetch(`https://api.paystack.co/refund/${expected.providerRefundId}`, {
      headers: {Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`},
      signal: AbortSignal.timeout(10_000),
    });
    payload = await response.json().catch(() => null) as typeof payload;
    if (!response.ok || payload?.status !== true) throw new Error("Unavailable");
  } catch {
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "The refund could not be verified. Accounting has not changed.");
  }
  const data = payload?.data;
  const transaction = data?.transaction;
  const transactionId = typeof transaction === "object" && transaction !== null
    ? (transaction as Record<string, unknown>).id : transaction;
  const providerId = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? String(value) : typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value) ? value : null;
  if (!data || providerId(data.id) !== expected.providerRefundId || data.currency !== "NGN" ||
      data.amount !== expected.customerRefundKobo || !providerId(transactionId) ||
      (env.ENVIRONMENT === "production" && data.domain !== "live"))
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "The refund receipt does not match the approved snapshot.");
  // Fetching the original transaction binds Paystack's numeric transaction ID to
  // our immutable reference, amount, actual collection fee, currency and mode.
  // Reversed transactions are valid here; the saved original receipt proves collection.
  const original = await verifyPaystack(env, expected.originalReference);
  if (original.providerTransactionId !== providerId(transactionId) ||
      original.amountKobo !== expected.originalAmountKobo || original.feeKobo !== expected.originalFeeKobo)
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "The refund belongs to a different original payment.");
  const status = typeof data.status === "string" ? data.status : "unknown";
  if (!["pending", "processing", "processed", "failed", "needs-attention"].includes(status))
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "The refund needs finance review before accounting can change.");
  if (status === "processed" &&
      (data.deducted_amount !== expected.customerRefundKobo || data.fully_deducted !== true ||
       typeof data.refunded_at !== "string" || !Number.isFinite(Date.parse(data.refunded_at))))
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "The completed refund receipt is incomplete.");
  return {
    providerRefundId: expected.providerRefundId,
    originalReference: expected.originalReference,
    currency: "NGN" as const,
    amountKobo: expected.customerRefundKobo,
    status,
    refundedAt: status === "processed" ? data.refunded_at as string : null,
    collectionFeeReturnedKobo: 0,
    // The Refund API does not establish a separate refund processing fee.
    refundProcessingFeeKobo: null,
    providerTransactionId: providerId(transactionId)!,
  };
}
