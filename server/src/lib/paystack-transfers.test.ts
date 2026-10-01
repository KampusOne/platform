import { afterEach, describe, it, expect, vi } from "vitest";
import {
  initiatePaystackTransfer,
  verifyPaystackTransfer,
} from "./paystack-transfers";
import type { Bindings } from "../types";
const env = {
  ENVIRONMENT: "production",
  PAYMENTS_ENABLED: "true",
  PAYOUTS_ENABLED: "true",
  PAYSTACK_SECRET_KEY: "sk_live_synthetic-not-a-real-key",
} as Bindings;
const reference = "k1-po-10000000-0000-4000-8000-000000000001";
const proof = {
  reference,
  amount: 700000,
  currency: "NGN",
  domain: "live",
  status: "success",
  transfer_code: "TRF_synthetic",
  updatedAt: new Date().toISOString(),
  fee_charged: 2500,
  recipient: {
    recipient_code: "RCP_synthetic",
    currency: "NGN",
    domain: "live",
  },
};
afterEach(() => vi.unstubAllGlobals());
describe("server transfer proof", () => {
  it("rejects test credentials in production and new transfers when paused before calling the provider", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      verifyPaystackTransfer(
        { ...env, PAYSTACK_SECRET_KEY: "sk_test_synthetic" },
        reference,
      ),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      initiatePaystackTransfer(
        { ...env, PAYOUTS_ENABLED: "false" },
        { reference, amountKobo: 700000, recipientCode: "RCP_synthetic" },
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects currency, mode, reference and missing fee or recipient proof instead of trusting request success", async () => {
    for (const change of [
      { currency: "USD" },
      { domain: "test" },
      { reference: "k1-po-20000000-0000-4000-8000-000000000002" },
      { fee_charged: undefined },
      { recipient: 1 },
      { recipient: { ...proof.recipient, domain: "test" } },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({ status: true, data: { ...proof, ...change } }),
        ),
      );
      await expect(
        verifyPaystackTransfer(env, reference),
      ).rejects.toMatchObject({ status: 503 });
    }
  });
  it("checks the transfer status and exact NGN fee through server GET while transfer creation is paused", async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.paystack.co/transfer/verify/" + reference);
      expect(init.method).toBe("GET");
      return Response.json({
        status: true,
        data: { ...proof, status: "pending" },
      });
    });
    vi.stubGlobal("fetch", fetch);
    const result = await verifyPaystackTransfer(
      { ...env, PAYOUTS_ENABLED: "false", PAYMENTS_ENABLED: "false" },
      reference,
    );
    expect(result.status).toBe("pending");
    expect(result.feeKobo).toBe(2500);
    expect(result.recipientCode).toBe("RCP_synthetic");
  });
});
