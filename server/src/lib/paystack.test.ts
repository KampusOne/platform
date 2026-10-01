import { afterEach, describe, it, expect, vi } from "vitest";
import {
  initializePaystack,
  verifyPaystack,
  validPaystackSignature,
} from "./paystack";
import type { Bindings } from "../types";
const env = {
  ENVIRONMENT: "local",
  PAYSTACK_SECRET_KEY: "synthetic-key",
  PAYSTACK_WEBHOOK_SECRET: "synthetic-separate-token",
} as Bindings;
const reference = "K1-O-synthetic";
const validReceipt = {
  reference,
  currency: "NGN",
  amount: 600000,
  fees: 19000,
  status: "success",
  paid_at: "2026-09-30T10:00:00.000Z",
  domain: "live",
};
afterEach(() => vi.unstubAllGlobals());
describe("Paystack receipt boundary", () => {
  it("initializes exactly the agreed amount and rejects a different provider reference", async () => {
    const fetcher = vi.fn().mockImplementation(async (_url, init) => {
      const input = JSON.parse(init.body);
      expect(input).toMatchObject({
        amount: 600000,
        currency: "NGN",
        reference,
      });
      return Response.json({
        status: true,
        data: {
          reference: "another-reference",
          authorization_url: "https://checkout.paystack.com/synthetic",
          access_code: "synthetic",
        },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(
      initializePaystack(env, {
        email: "synthetic@example.invalid",
        amountKobo: 600000,
        reference,
        metadata: {},
      }),
    ).rejects.toThrow("unavailable");
    await expect(
      initializePaystack(env, {
        email: "synthetic@example.invalid",
        amountKobo: 1.5,
        reference,
        metadata: {},
      }),
    ).rejects.toThrow("whole-kobo");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reads transaction success and actual processing fees independently of API call success", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          status: true,
          data: {
            ...validReceipt,
            status: "pending",
            fees: undefined,
            paid_at: undefined,
          },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    expect((await verifyPaystack(env, reference)).status).toBe("pending");
    fetcher.mockResolvedValue(
      Response.json({ status: true, data: validReceipt }),
    );
    expect(await verifyPaystack(env, reference)).toMatchObject({
      status: "success",
      amountKobo: 600000,
      feeKobo: 19000,
    });
  });
  it("rejects wrong currency or reference, fractional money, missing fees and test receipts in production", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const change of [
      { reference: "wrong" },
      { currency: "USD" },
      { amount: 1.5 },
      { fees: undefined },
      { fees: -1 },
      { paid_at: "invalid" },
    ]) {
      fetcher.mockResolvedValue(
        Response.json({ status: true, data: { ...validReceipt, ...change } }),
      );
      await expect(verifyPaystack(env, reference)).rejects.toThrow("receipt");
    }
    fetcher.mockResolvedValue(
      Response.json({
        status: true,
        data: { ...validReceipt, domain: "test" },
      }),
    );
    await expect(
      verifyPaystack({ ...env, ENVIRONMENT: "production" }, reference),
    ).rejects.toThrow("receipt");
  });
  it("refuses invalid references and incomplete provider responses before any balance mutation", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("bad-json", { status: 502 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(verifyPaystack(env, "../other-reference")).rejects.toThrow(
      "invalid",
    );
    expect(fetcher).not.toHaveBeenCalled();
    await expect(verifyPaystack(env, reference)).rejects.toThrow("receipt");
  });
  it("verifies the raw webhook HMAC using the merchant key and rejects modified payloads", async () => {
    const raw = JSON.stringify({
        event: "charge.success",
        data: { reference },
      }),
      key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(env.PAYSTACK_SECRET_KEY!),
        { name: "HMAC", hash: "SHA-512" },
        false,
        ["sign"],
      );
    const bytes = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(raw),
      ),
      signature = [...new Uint8Array(bytes)]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
    expect(await validPaystackSignature(env, raw, signature)).toBe(true);
    expect(await validPaystackSignature(env, raw + " ", signature)).toBe(false);
    expect(await validPaystackSignature(env, raw, "short")).toBe(false);
    expect(await validPaystackSignature(env, raw)).toBe(false);
  });
});
