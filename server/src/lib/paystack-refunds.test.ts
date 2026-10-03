import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyPaystackRefund, paystackRefundPolicy } from "./paystack-refunds";
import type { Bindings } from "../types";

const env = {ENVIRONMENT: "production",PAYMENTS_ENABLED: "true",PAYSTACK_SECRET_KEY: "sk_live_synthetic"} as Bindings;
const expected = {providerRefundId: "812",originalReference: "K1-T-synthetic",originalAmountKobo: 600000,originalFeeKobo: 19000,customerRefundKobo: 600000};
const refund = {id: 812,transaction: 123,currency: "NGN",domain: "live",amount: 600000,deducted_amount: 600000,fully_deducted: true,status: "processed",refunded_at: "2026-10-03T10:00:00Z"};
const transaction = {id: 123,reference: expected.originalReference,currency: "NGN",domain: "live",amount: 600000,fees: 19000,status: "reversed",paid_at: "2026-10-02T10:00:00Z"};
function provider(refundChange: Record<string, unknown> = {}, transactionChange: Record<string, unknown> = {}) {
  const fetcher = vi.fn(async (url: string, options: RequestInit) => {
    expect(options.method).toBeUndefined(); // This adapter cannot send a real refund.
    return Response.json({status: true,data: url.includes("/refund/") ? {...refund,...refundChange} : {...transaction,...transactionChange}});
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => vi.unstubAllGlobals());
describe("verified refund provider boundary", () => {
  it("binds original transaction ID and retains non-refundable actual collection charges", async () => {
    const fetcher = provider();
    expect(await verifyPaystackRefund(env, expected)).toMatchObject({status: "processed",amountKobo: 600000,providerTransactionId: "123",collectionFeeReturnedKobo: 0,refundProcessingFeeKobo: null});
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(paystackRefundPolicy.collectionFeeTreatment).toBe("NON_REFUNDABLE");
  });
  it.each(["pending", "processing", "failed", "needs-attention"])("preserves %s without treating API call success as refund success", async status => {
    provider({status,refunded_at: null,deducted_amount: null,fully_deducted: false});
    expect(await verifyPaystackRefund(env, expected)).toMatchObject({status,refundedAt: null});
  });
  it("rejects wrong ID, currency, amount, transaction, incomplete processed evidence and test mode", async () => {
    for (const change of [{id: 813},{currency: "USD"},{amount: 600001},{amount: 600000.5},{transaction: 999},{fully_deducted: false},{deducted_amount: 590000},{refunded_at: "invalid"},{domain: "test"},{status: "success"}]) {
      provider(change);
      await expect(verifyPaystackRefund(env, expected)).rejects.toMatchObject({status: 503});
    }
    for (const change of [{reference: "wrong"},{currency: "USD"},{fees: 18000},{amount: 600001},{id: null}]) {
      provider({}, change);
      await expect(verifyPaystackRefund(env, expected)).rejects.toMatchObject({status: 503});
    }
  });
  it("uses the payment kill switch, validates references and controls timeouts", async () => {
    const fetcher = provider();
    await expect(verifyPaystackRefund({...env,PAYMENTS_ENABLED: "false"}, expected)).rejects.toMatchObject({status: 503});
    await expect(verifyPaystackRefund(env, {...expected,providerRefundId: "../refund"})).rejects.toMatchObject({status: 400});
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRejectedValue(new Error("Synthetic timeout"));
    await expect(verifyPaystackRefund(env, expected)).rejects.toMatchObject({code: "PROVIDER_UNAVAILABLE"});
  });
});
