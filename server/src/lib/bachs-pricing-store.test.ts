import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../types";
import { createBachsPricingQuote, publishedBachsProfiles, type BachsFeeProfile } from "./bachs-pricing";
const stubs = vi.hoisted(() => ({ execute: vi.fn(), create: vi.fn(), checkout: vi.fn(), payment: vi.fn() }));
vi.mock("./database", () => ({ database: () => ({ execute: stubs.execute }), firstRow: (result: { rows: unknown[] }) => result.rows[0] }));
vi.mock("./bachs", async original => ({ ...await original<typeof import("./bachs")>(), createBachsCheckout: stubs.create, getBachsCheckout: stubs.checkout, getBachsPayment: stubs.payment }));
import { fingerprintBachsPurchase, initializeBachsPricedCheckout, publicBachsQuote, resolveBachsProfile, saveBachsPricingQuote, verifyBachsPricedCheckout } from "./bachs-pricing-store";

const now = Date.parse("2026-10-09T12:00:00Z"), dialect = new PgDialect();
const universityId = "11111111-1111-4111-8111-111111111111", userId = "22222222-2222-4222-8222-222222222222", quoteId = "44444444-4444-4444-8444-444444444444";
const fees: BachsFeeProfile = { ...publishedBachsProfiles[0]!, id: "33333333-3333-4333-8333-333333333333", universityId, status: "APPROVED" };
const quote = createBachsPricingQuote({ subtotalKobo: 600_000, priceMode: "FIXED_TOTAL" }, fees, now);
const resourceSnapshot = { planId: quoteId, planVersion: "reviewed-v1", listedAmountKobo: 600_000, discountPercent: 0 };
const resourceFingerprint = await fingerprintBachsPurchase(resourceSnapshot);
const saved = { id: quoteId, universityId, userId, resourceType: "KIRA_SUBSCRIPTION", resourceId: quoteId, resourceSnapshot, resourceFingerprint, reference: "K1-B-fixture", quote };
const session = { checkoutId: "chk_fixture", checkoutUrl: "https://sandbox-checkout.bachs.io/c/fixture", providerMode: "test", expiresAt: "2026-10-09T12:14:00Z" };
const env = { ENVIRONMENT: "local", PAYMENTS_ENABLED: "true", BACHS_PRICED_CHECKOUT_ENABLED: "true", BACHS_MERCHANT_BEARS_COST_CONFIRMED: "true" } as Bindings;
const input = { quoteId, universityId, userId, resourceFingerprint, acceptedTotalKobo: 600_000, email: "buyer@example.invalid" };
const checkout = { checkout_id: session.checkoutId, reference: saved.reference, status: "completed", amount: "6000.00", currency: "NGN", charge: { payment_id: "ch_fixture", status: "succeeded" } };
const payment = { payment_id: "ch_fixture", checkout_id: session.checkoutId, reference: saved.reference, status: "succeeded", amount: "6000.00", amount_paid: "6000.00", currency: "NGN", merchant_bears_cost: true, payment_method: "NGN_BANK_TRANSFER", fees: { amount: "90.00", currency: "NGN" }, completed_at: "2026-10-09T12:01:00Z" };

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now + 1000); vi.resetAllMocks();
  stubs.checkout.mockResolvedValue(structuredClone(checkout));
  stubs.payment.mockResolvedValue(structuredClone(payment));
});
afterEach(() => vi.useRealTimers());
function rows(...values: unknown[]) { return { rows: values }; }

describe("saved BACHS checkout pricing", () => {
  it("fails closed before creating a provider session when payments, rollout or fee-bearing confirmation is missing", async () => {
    for (const flag of ["PAYMENTS_ENABLED", "BACHS_PRICED_CHECKOUT_ENABLED", "BACHS_MERCHANT_BEARS_COST_CONFIRMED"] as const)
      await expect(initializeBachsPricedCheckout({ ...env, [flag]: "false" }, input)).rejects.toMatchObject({ status: 503 });
    expect(stubs.create).not.toHaveBeenCalled(); expect(stubs.execute).not.toHaveBeenCalled();
  });

  it("enforces buyer and campus ownership and reacceptance of a changed total", async () => {
    stubs.execute.mockResolvedValueOnce(rows({ ready: true })).mockResolvedValueOnce(rows());
    await expect(initializeBachsPricedCheckout(env, input)).rejects.toMatchObject({ status: 404 });
    const query = dialect.sqlToQuery(stubs.execute.mock.calls[1]![0]);
    expect(query.params).toEqual([quoteId, userId, universityId]);
    stubs.execute.mockResolvedValueOnce(rows({ ready: true })).mockResolvedValueOnce(rows(saved));
    await expect(initializeBachsPricedCheckout(env, { ...input, acceptedTotalKobo: 609_000 })).rejects.toMatchObject({ status: 409 });
    expect(stubs.create).not.toHaveBeenCalled();
  });

  it("creates a single corridor checkout with the saved amount and bounded expiry", async () => {
    stubs.execute.mockResolvedValueOnce(rows({ ready: true })).mockResolvedValueOnce(rows(saved)).mockResolvedValueOnce(rows()).mockResolvedValueOnce(rows()).mockResolvedValueOnce(rows(session));
    stubs.create.mockResolvedValue({ ...session, reference: saved.reference });
    const initialized = await initializeBachsPricedCheckout(env, input);
    expect(initialized.amountKobo).toBe(600_000);
    expect(stubs.create).toHaveBeenCalledWith(env, expect.objectContaining({ amountKobo: 600_000, paymentMethodTypes: ["NGN_BANK_TRANSFER"], expiresInMinutes: 14, reference: saved.reference }));
    expect(stubs.checkout).toHaveBeenCalledWith(env, session.checkoutId);
  });

  it("reuses an existing session without adding another provider fee", async () => {
    stubs.execute.mockResolvedValueOnce(rows({ ready: true })).mockResolvedValueOnce(rows(saved)).mockResolvedValueOnce(rows(session));
    expect(await initializeBachsPricedCheckout(env, input)).toMatchObject({ checkoutId: session.checkoutId, amountKobo: 600_000 });
    expect(stubs.create).not.toHaveBeenCalled();
  });

  it("requires a new quote when purchase details change even if the price stays the same", async () => {
    stubs.execute.mockResolvedValueOnce(rows({ ready: true })).mockResolvedValueOnce(rows(saved));
    await expect(initializeBachsPricedCheckout(env, { ...input, resourceFingerprint: "b".repeat(64) })).rejects.toMatchObject({ status: 409 });
    expect(stubs.create).not.toHaveBeenCalled();
  });

  it("holds a provider session that changes the accepted amount or extends the quote", async () => {
    for (const changed of [{ ...checkout, amount: "6090.00" }, { ...checkout, currency: "USD" }]) {
      stubs.execute.mockResolvedValueOnce(rows({ ready: true })).mockResolvedValueOnce(rows(saved)).mockResolvedValueOnce(rows());
      stubs.create.mockResolvedValue({ ...session, reference: saved.reference }); stubs.checkout.mockResolvedValue(changed);
      await expect(initializeBachsPricedCheckout(env, input)).rejects.toMatchObject({ status: 503 });
    }
    stubs.execute.mockResolvedValueOnce(rows({ ready: true })).mockResolvedValueOnce(rows(saved)).mockResolvedValueOnce(rows());
    stubs.create.mockResolvedValue({ ...session, reference: saved.reference, expiresAt: "2026-10-09T12:30:00Z" }); stubs.checkout.mockResolvedValue(checkout);
    await expect(initializeBachsPricedCheckout(env, input)).rejects.toMatchObject({ status: 503 });
    expect(stubs.execute).toHaveBeenCalledTimes(9);
  });

  it("cannot fall back past a disabled latest campus profile", async () => {
    stubs.execute.mockResolvedValueOnce(rows({ ready: true })).mockResolvedValueOnce(rows({ ...fees, status: "DISABLED" }));
    await expect(resolveBachsProfile(env, universityId, "CHECKOUT_BANK_TRANSFER")).rejects.toMatchObject({ status: 503 });
    expect(stubs.execute).toHaveBeenCalledTimes(2);
  });

  it("saves the authoritative purchase quote and returns its existing ID on an identical retry", async () => {
    for (let retry = 0; retry < 2; retry++) {
      stubs.execute.mockResolvedValueOnce(rows({ ready: true })).mockResolvedValueOnce(rows(fees)).mockResolvedValueOnce(rows()).mockResolvedValueOnce(rows(saved));
      expect(await saveBachsPricingQuote(env, { userId, universityId, resourceType: "KIRA_SUBSCRIPTION", resourceId: quoteId, resourceSnapshot, resourceFingerprint, reference: saved.reference, context: "CHECKOUT_BANK_TRANSFER", pricing: quote.input })).toMatchObject({ quoteId, finalCustomerAmountKobo: 600_000, discountKobo: 0 });
    }
    expect(stubs.create).not.toHaveBeenCalled();
  });

  it("fingerprints equivalent objects consistently and refuses a changed purchase snapshot", async () => {
    expect(await fingerprintBachsPurchase({ discountPercent: 0, listedAmountKobo: 600_000, planVersion: "reviewed-v1", planId: quoteId })).toBe(resourceFingerprint);
    await expect(saveBachsPricingQuote(env, { ...saved, resourceType: "KIRA_SUBSCRIPTION", resourceSnapshot: { ...resourceSnapshot, planVersion: "v2" }, context: "CHECKOUT_BANK_TRANSFER", pricing: quote.input })).rejects.toMatchObject({ status: 409 });
    expect(stubs.execute).not.toHaveBeenCalled();
  });

  it("keeps Kira's accepted list price free of a second fee-recovery allowance", async () => {
    await expect(saveBachsPricingQuote(env, { ...saved, context: "CHECKOUT_BANK_TRANSFER", resourceType: "KIRA_SUBSCRIPTION", pricing: { subtotalKobo: 600_000, priceMode: "RECOVER_FEES" } })).rejects.toMatchObject({ status: 409 });
    expect(stubs.execute).not.toHaveBeenCalled();
    const visible = publicBachsQuote(quote);
    expect(visible.lines.reduce((sum, line) => sum + line.amountKobo, 0)).toBe(visible.finalCustomerAmountKobo);
    expect(visible).not.toHaveProperty("platformRevenueKobo"); expect(visible).not.toHaveProperty("profile");
  });
});

describe("BACHS actual-fee evidence", () => {
  function verificationRows() { stubs.execute.mockResolvedValueOnce(rows({ ready: true })).mockResolvedValueOnce(rows(saved)).mockResolvedValueOnce(rows(session)); }

  it("records the actual NGN fee while preserving the accepted price and permits delayed reconciliation", async () => {
    vi.setSystemTime(now + 60 * 60_000); verificationRows();
    stubs.payment.mockResolvedValue({ ...payment, fees: { amount: "92.00", currency: "NGN" } });
    stubs.execute.mockResolvedValueOnce(rows({ amount_kobo: 600_000, actual_fee_kobo: 9_200, variance_kobo: 200, variance_alert: true }));
    expect(await verifyBachsPricedCheckout(env, quoteId, userId, universityId)).toMatchObject({ status: "verified", receipt: { amount_kobo: 600_000, actual_fee_kobo: 9_200, variance_alert: true } });
    const observation = dialect.sqlToQuery(stubs.execute.mock.calls[3]![0]);
    expect(observation.params).toEqual([quoteId, "test", "ch_fixture", 600_000, 9_200, payment.completed_at]);
  });

  it.each([
    { status: "accepted" }, { amount_paid: "5999.00" }, { amount: "6001.00" },
    { currency: "USD" }, { fees: { amount: "0.60", currency: "USD" } },
    { merchant_bears_cost: false }, { payment_method: "NGN_CARD" },
    { checkout_id: "chk_other" }, { reference: "K1-B-other" },
    { fees: { amount: "6000.00", currency: "NGN" } }, { completed_at: "invalid" },
  ])("holds incompatible payment evidence %j", async change => {
    verificationRows(); stubs.payment.mockResolvedValue({ ...payment, ...change });
    await expect(verifyBachsPricedCheckout(env, quoteId, userId, universityId)).rejects.toMatchObject({ status: 503 });
    expect(stubs.execute).toHaveBeenCalledTimes(3);
  });

  it("returns an unpaid session's status without recording revenue", async () => {
    verificationRows(); stubs.checkout.mockResolvedValue({ ...checkout, status: "open" });
    expect(await verifyBachsPricedCheckout(env, quoteId, userId, universityId)).toEqual({ status: "open", quoteId });
    expect(stubs.payment).not.toHaveBeenCalled(); expect(stubs.execute).toHaveBeenCalledTimes(3);
  });

  it("refuses verified status if the evidence was not durably recorded", async () => {
    verificationRows(); stubs.execute.mockResolvedValueOnce(rows());
    await expect(verifyBachsPricedCheckout(env, quoteId, userId, universityId)).rejects.toMatchObject({ status: 503 });
  });
});
