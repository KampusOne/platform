/**
 * Bachs hosted-checkout API boundary.
 *
 * New collections use immutable BACHS quotes and separately verified receipts.
 * Historical Paystack transactions keep their original provider and ledger.
 *
 * Docs: https://docs.bachs.io/guides/checkout/checkout-sessions
 *       https://docs.bachs.io/developer-portal/webhooks
 */
import type { Bindings } from "../types";
import { AppError } from "./errors";

const referencePattern = /^[A-Za-z0-9_.-]{1,100}$/;
const providerIdPattern = /^[A-Za-z0-9_-]{8,128}$/;
const checkoutHosts = new Set([
  "checkout.bachs.io",
  "sandbox-checkout.bachs.io",
]);

export type BachsCheckoutInput = {
  email: string;
  amountKobo: number;
  reference: string;
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, unknown>;
  paymentMethodTypes?: ("NGN_BANK_TRANSFER" | "NGN_CARD")[];
  expiresInMinutes?: number;
};

export type BachsCheckout = {
  checkoutId: string;
  checkoutUrl: string;
  reference: string;
  expiresAt: string | null;
};

export type BachsCheckoutDetail = {
  checkout_id: string;
  reference: string | null;
  status: string;
  payment_status?: string | null;
  currency?: string;
  amount?: string;
  charge?: { payment_id?: string; status?: string; amount?: string; currency?: string } | null;
  [key: string]: unknown;
};

export type BachsPaymentDetail = {
  payment_id: string;
  checkout_id?: string;
  reference: string | null;
  status: string;
  amount: string;
  amount_paid?: string;
  currency: string;
  fees?: { amount: string; currency: string } | null;
  completed_at?: string | null;
  payment_method?: string;
  [key: string]: unknown;
};

function providerError(message: string): AppError {
  return new AppError(503, "PROVIDER_UNAVAILABLE", message);
}

function apiConfiguration(env: Bindings) {
  const key = env.BACHS_API_KEY;
  if (!key || !/^sk_(sandbox|live)_[A-Za-z0-9_-]+$/.test(key)) {
    throw providerError("Bachs payments are not securely configured yet.");
  }
  const live = key.startsWith("sk_live_");
  if ((env.ENVIRONMENT === "production") !== live) {
    throw providerError("Bachs payment credentials do not match this environment.");
  }
  return {
    key,
    apiOrigin: live ? "https://api.bachs.io" : "https://sandbox-api.bachs.io",
  };
}

export function koboToBachsNgn(amountKobo: number): string {
  if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0)
    throw new AppError(400, "BAD_REQUEST", "A positive whole-kobo payment amount is required.");
  return `${Math.floor(amountKobo / 100)}.${String(amountKobo % 100).padStart(2, "0")}`;
}

/** Do not use floating-point multiplication for a provider financial receipt. */
export function bachsNgnToKobo(amount: string): number {
  if (typeof amount !== "string" || !/^(0|[1-9][0-9]{0,13})(?:\.[0-9]{1,2})?$/.test(amount))
    throw providerError("Bachs returned an invalid NGN amount.");
  const [whole, fraction = ""] = amount.split(".");
  const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER))
    throw providerError("Bachs returned an NGN amount outside the supported range.");
  return Number(cents);
}

function validHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function apiRequest(
  env: Bindings,
  path: string,
  options?: { method?: "POST"; body?: Record<string, unknown>; idempotencyKey?: string },
): Promise<Record<string, unknown>> {
  const { key, apiOrigin } = apiConfiguration(env);
  let response: Response;
  try {
    response = await fetch(apiOrigin + path, {
      method: options?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw providerError("Bachs could not be reached. Payment status must be checked before retrying.");
  }
  const body = (await response.json().catch(() => null)) as unknown;
  if (response.status === 429)
    throw new AppError(429, "RATE_LIMITED", "Bachs is busy. Check this payment again shortly.");
  if (!response.ok || typeof body !== "object" || !body || Array.isArray(body))
    throw providerError("Bachs could not confirm the payment request. No purchase has been credited.");
  return body as Record<string, unknown>;
}

export async function getBachsCheckoutSettings(env: Bindings) {
  const data = await apiRequest(env, '/v1/accounts/checkout/settings');
  const methods = data.enabled_payment_methods as Record<string, { enabled?: boolean }> | undefined;
  return { bankTransferEnabled: methods?.NGN_BANK_TRANSFER?.enabled === true, feePreference: data.fee_preference };
}

export async function validBachsDelivery(env: Bindings, raw: string, timestamp?: string, signature?: string, v2?: string) {
  if (!v2) return validBachsSignature(env, raw, timestamp, signature);
  const parts = v2.split(',').map(part => part.trim());
  const times = parts.filter(part => part.startsWith('t='));
  const signatures = parts.filter(part => part.startsWith('v1='));
  if (times.length !== 1 || signatures.length < 1 || signatures.length > 5) return false;
  for (const candidate of signatures) if (await validBachsSignature(env, raw, times[0]!.slice(2), candidate.slice(3))) return true;
  return false;
}

/** Create an NGN one-time hosted session. Never infer paid status from this response. */
export async function createBachsCheckout(
  env: Bindings,
  input: BachsCheckoutInput,
): Promise<BachsCheckout> {
  const amount = koboToBachsNgn(input.amountKobo);
  if (!referencePattern.test(input.reference) || !/^\S+@\S+\.\S+$/.test(input.email))
    throw new AppError(400, "BAD_REQUEST", "Bachs checkout reference or email is invalid.");
  if ((input.successUrl && !validHttpsUrl(input.successUrl)) ||
      (input.cancelUrl && !validHttpsUrl(input.cancelUrl)))
    throw new AppError(400, "BAD_REQUEST", "Bachs return URLs must use HTTPS.");
  const metadata = input.metadata ?? {};
  if (input.paymentMethodTypes && (input.paymentMethodTypes.length !== 1 ||
      !["NGN_BANK_TRANSFER", "NGN_CARD"].includes(input.paymentMethodTypes[0]!)))
    throw new AppError(400, "BAD_REQUEST", "Choose one quoted NGN payment corridor.");
  if (input.expiresInMinutes !== undefined && (!Number.isInteger(input.expiresInMinutes) || input.expiresInMinutes < 1 || input.expiresInMinutes > 20))
    throw new AppError(400, "BAD_REQUEST", "Use a checkout expiry between one and twenty minutes.");
  if (Object.keys(metadata).length > 20 || new TextEncoder().encode(JSON.stringify(metadata)).length > 10_240)
    throw new AppError(400, "BAD_REQUEST", "Bachs checkout metadata exceeds its limits.");

  const data = await apiRequest(env, "/v1/checkout-sessions", {
    method: "POST",
    idempotencyKey: input.reference,
    body: {
      pricing: { currency: "NGN", amount },
      customer: { email: input.email },
      reference: input.reference,
      metadata,
      ...(input.paymentMethodTypes ? { payment_method_types: input.paymentMethodTypes } : {}),
      ...(input.expiresInMinutes ? { expires_in_minutes: input.expiresInMinutes } : {}),
      ...(input.successUrl ? { success_url: input.successUrl } : {}),
      ...(input.cancelUrl ? { cancel_url: input.cancelUrl } : {}),
    },
  });
  if (typeof data.checkout_id !== "string" ||
      !providerIdPattern.test(data.checkout_id) ||
      typeof data.checkout_url !== "string" ||
      !validHttpsUrl(data.checkout_url) ||
      !checkoutHosts.has(new URL(data.checkout_url).hostname) ||
      data.reference !== input.reference ||
      typeof data.status !== "string" ||
      data.status.toLowerCase() !== "open") {
    throw providerError("Bachs returned an inconsistent checkout session. The payment remains unconfirmed.");
  }
  return {
    checkoutId: data.checkout_id,
    checkoutUrl: data.checkout_url,
    reference: input.reference,
    expiresAt: typeof data.expires_at === "string" ? data.expires_at : null,
  };
}

/** Read-only provider evidence; callers must bind result to immutable local intent. */
export async function getBachsCheckout(env: Bindings, checkoutId: string): Promise<BachsCheckoutDetail> {
  if (!providerIdPattern.test(checkoutId))
    throw new AppError(400, "BAD_REQUEST", "Invalid Bachs checkout ID.");
  const data = await apiRequest(env, `/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`);
  if (data.checkout_id !== checkoutId || typeof data.status !== "string" ||
      !(data.reference === null || typeof data.reference === "string"))
    throw providerError("Bachs returned inconsistent checkout evidence.");
  return data as BachsCheckoutDetail;
}

/** Read-only provider evidence; payment IDs can be ch_* or pay_* across API samples. */
export async function getBachsPayment(env: Bindings, paymentId: string): Promise<BachsPaymentDetail> {
  if (!/^(?:ch_|pay_)[A-Za-z0-9_-]{6,128}$/.test(paymentId))
    throw new AppError(400, "BAD_REQUEST", "Invalid Bachs payment ID.");
  const data = await apiRequest(env, `/v1/payments/${encodeURIComponent(paymentId)}`);
  if (data.payment_id !== paymentId ||
      typeof data.status !== "string" ||
      typeof data.amount !== "string" ||
      typeof data.currency !== "string" ||
      !(data.reference === null || typeof data.reference === "string"))
    throw providerError("Bachs returned inconsistent payment evidence.");
  return data as BachsPaymentDetail;
}

/**
 * Verify the documented signed delivery over the unparsed body. Always
 * re-fetch the checkout/payment from Bachs before applying any ledger credit.
 * Webhooks have at-least-once delivery and must be deduplicated by event.id.
 */
export async function validBachsSignature(
  env: Bindings,
  rawBody: string,
  timestamp: string | undefined,
  suppliedSignature: string | undefined,
  atMillis = Date.now(),
): Promise<boolean> {
  const secret = env.BACHS_WEBHOOK_SECRET;
  if (!secret || !timestamp || !suppliedSignature ||
      !/^[0-9]{10,12}$/.test(timestamp) ||
      !/^[0-9a-fA-F]{64}$/.test(suppliedSignature)) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(atMillis / 1000) - seconds) > 300)
    return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const hmac = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const expected = [...new Uint8Array(hmac)].map((part) => part.toString(16).padStart(2, "0")).join("");
  let different = 0;
  const signature = suppliedSignature.toLowerCase();
  for (let i = 0; i < 64; i++) different |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return different === 0;
}
