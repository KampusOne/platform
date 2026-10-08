import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../types";
import {
  bachsNgnToKobo,
  createBachsCheckout,
  getBachsCheckout,
  getBachsPayment,
  koboToBachsNgn,
  validBachsSignature,
} from "./bachs";

const sandbox = {
  ENVIRONMENT: "local",
  BACHS_API_KEY: "sk_sandbox_synthetic",
  BACHS_WEBHOOK_SECRET: "synthetic-bachs-webhook-key",
} as Bindings;

const request = {
  email: "buyer@example.invalid",
  amountKobo: 123_456,
  reference: "K1-O-test-checkout-1",
  metadata: { resourceType: "STORE_ORDER" },
};

afterEach(() => vi.unstubAllGlobals());

describe("Bachs isolated checkout foundation", () => {
  it("preserves whole kobo without floating-point money calculations", () => {
    expect(koboToBachsNgn(123_456)).toBe("1234.56");
    expect(bachsNgnToKobo("1234.56")).toBe(123_456);
    expect(bachsNgnToKobo("12")).toBe(1200);
    expect(bachsNgnToKobo("0.01")).toBe(1);
    expect(() => koboToBachsNgn(1.5)).toThrow("whole-kobo");
    expect(() => bachsNgnToKobo("1.005")).toThrow("amount");
    expect(() => bachsNgnToKobo("1e5")).toThrow("amount");
    expect(() => bachsNgnToKobo("-12.00")).toThrow("amount");
  });

  it("posts NGN raw pricing with a stable reference and only allows a trusted checkout host", async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://sandbox-api.bachs.io/v1/checkout-sessions");
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("Idempotency-Key")).toBe(request.reference);
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer sk_sandbox_synthetic");
      expect(JSON.parse(String(init.body))).toMatchObject({
        pricing: { currency: "NGN", amount: "1234.56" },
        customer: { email: request.email },
        reference: request.reference,
        metadata: request.metadata,
      });
      return Response.json({
        checkout_id: "chk_123456789",
        checkout_url: "https://sandbox-checkout.bachs.io/c/abc123",
        status: "OPEN",
        reference: request.reference,
      }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await createBachsCheckout(sandbox, request)).toEqual({
      checkoutId: "chk_123456789",
      checkoutUrl: "https://sandbox-checkout.bachs.io/c/abc123",
      expiresAt: null,
      reference: request.reference,
    });
  });

  it("rejects mismatched provider receipts, fake checkout domains and invalid credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      checkout_id: "chk_123456789",
      checkout_url: "https://fake-bachs.io/c/abc123",
      status: "open",
      reference: request.reference,
    }, { status: 201 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(createBachsCheckout(sandbox, request)).rejects.toThrow("inconsistent checkout");

    fetcher.mockResolvedValue(Response.json({
      checkout_id: "chk_123456789",
      checkout_url: "https://checkout.bachs.io/c/abc123",
      status: "open",
      reference: "other-order",
    }, { status: 201 }));
    await expect(createBachsCheckout(sandbox, request)).rejects.toThrow("inconsistent checkout");

    await expect(createBachsCheckout({
      ...sandbox, ENVIRONMENT: "production",
    }, request)).rejects.toThrow("credentials");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fetches provider evidence without granting access or changing ledgers", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({
        checkout_id: "chk_123456789",
        reference: request.reference,
        status: "completed",
        charge: { payment_id: "ch_123456789", status: "succeeded" },
      }))
      .mockResolvedValueOnce(Response.json({
        payment_id: "ch_123456789",
        checkout_id: "chk_123456789",
        reference: request.reference,
        status: "succeeded",
        amount: "1234.56",
        currency: "NGN",
        fees: { amount: "18.52", currency: "NGN" },
      }));
    vi.stubGlobal("fetch", fetcher);
    expect((await getBachsCheckout(sandbox, "chk_123456789")).status).toBe("completed");
    expect((await getBachsPayment(sandbox, "ch_123456789")).fees).toEqual({
      amount: "18.52", currency: "NGN",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(getBachsCheckout(sandbox, "../../etc/passwd")).rejects.toThrow("Invalid");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("verifies raw-body HMAC-SHA256, rejects modifications and stale or missing timestamps", async () => {
    const body = JSON.stringify({ id: "evt_test", type: "collection.succeeded" });
    const now = Date.now();
    const timestamp = String(Math.floor(now / 1000));
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(sandbox.BACHS_WEBHOOK_SECRET!),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const bytes = await crypto.subtle.sign(
      "HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`),
    );
    const signature = [...new Uint8Array(bytes)]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await validBachsSignature(sandbox, body, timestamp, signature, now)).toBe(true);
    expect(await validBachsSignature(sandbox, body + " ", timestamp, signature, now)).toBe(false);
    expect(await validBachsSignature(sandbox, body, timestamp, "malformed", now)).toBe(false);
    expect(await validBachsSignature(sandbox, body, timestamp, undefined, now)).toBe(false);
    expect(await validBachsSignature(sandbox, body, timestamp, signature, now + 301000)).toBe(false);
  });
});
