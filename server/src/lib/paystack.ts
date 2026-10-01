import type { Bindings } from "../types";
import { AppError } from "./errors";

type InitializeInput = {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl?: string;
  metadata: Record<string, unknown>;
};

export async function initializePaystack(
  env: Bindings,
  input: InitializeInput,
) {
  if (!Number.isSafeInteger(input.amountKobo) || input.amountKobo <= 0) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "A positive whole-kobo payment amount is required.",
    );
  }
  if (!env.PAYSTACK_SECRET_KEY) {
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Secure payments are not configured yet.",
    );
  }
  if (
    env.ENVIRONMENT === "production" &&
    !env.PAYSTACK_SECRET_KEY.startsWith("sk_live_")
  )
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Live payment configuration is not ready. Your purchase remains unpaid.",
    );
  let response: Response;
  try {
    response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: input.email,
        amount: input.amountKobo,
        reference: input.reference,
        currency: "NGN",
        metadata: input.metadata,
        ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Checkout could not connect. Your purchase is saved; check its status before retrying.",
    );
  }
  const payload = (await response.json().catch(() => null)) as {
    status?: boolean;
    message?: string;
    data?: {
      authorization_url?: string;
      access_code?: string;
      reference?: string;
    };
  } | null;
  if (
    !response.ok ||
    !payload?.status ||
    !payload.data?.authorization_url ||
    payload.data.reference !== input.reference
  ) {
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      payload?.message ?? "The payment provider is unavailable.",
    );
  }
  try {
    if (new URL(payload.data.authorization_url).protocol !== "https:")
      throw new Error();
  } catch {
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "The payment provider returned an invalid checkout link. Your purchase remains unpaid.",
    );
  }
  return payload.data;
}

export async function verifyPaystack(env: Bindings, reference: string) {
  if (!env.PAYSTACK_SECRET_KEY)
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Secure payments are not configured yet.",
    );
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(reference))
    throw new AppError(
      400,
      "BAD_REQUEST",
      "That payment reference is invalid.",
    );
  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` },
      signal: AbortSignal.timeout(10000),
    },
  );
  const payload = (await response.json().catch(() => null)) as {
    status?: boolean;
    data?: {
      status?: string;
      reference?: string;
      currency?: string;
      amount?: number;
      fees?: number;
      paid_at?: string;
      domain?: string;
    };
  } | null;
  const data = payload?.data;
  if (
    !response.ok ||
    payload?.status !== true ||
    !data ||
    data.reference !== reference ||
    data.currency !== "NGN" ||
    !Number.isSafeInteger(data.amount) ||
    Number(data.amount) <= 0 ||
    (env.ENVIRONMENT === "production" && data.domain !== "live")
  )
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "The payment receipt could not be verified. Your balance has not changed.",
    );
  if (
    data.status === "success" &&
    (!Number.isSafeInteger(data.fees) ||
      Number(data.fees) < 0 ||
      typeof data.paid_at !== "string" ||
      !Number.isFinite(Date.parse(data.paid_at)))
  )
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "The payment receipt is incomplete. It will be reconciled before funds are released.",
    );
  return {
    status: data.status ?? "pending",
    reference,
    amountKobo: Number(data.amount),
    feeKobo: Number(data.fees ?? 0),
    paidAt: data.paid_at ?? null,
  };
}

export async function validPaystackSignature(
  env: Bindings,
  rawBody: string,
  supplied?: string,
) {
  // Paystack signs events with the merchant secret key, not a separate webhook token.
  const secret = env.PAYSTACK_SECRET_KEY ?? env.PAYSTACK_WEBHOOK_SECRET;
  if (!secret || !supplied) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const expected = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (expected.length !== supplied.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return difference === 0;
}
