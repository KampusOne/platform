import type { Bindings } from "../types";
import { AppError } from "./errors";

type InitializeInput = {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl?: string;
  metadata: Record<string, unknown>;
};

export async function initializePaystack(env: Bindings, input: InitializeInput) {
  if (!env.PAYSTACK_SECRET_KEY) {
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "Secure payments are not configured yet.");
  }
  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: input.email,
      amount: input.amountKobo,
      reference: input.reference,
      metadata: input.metadata,
      ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null) as {
    status?: boolean;
    message?: string;
    data?: { authorization_url?: string; access_code?: string; reference?: string };
  } | null;
  if (!response.ok || !payload?.status || !payload.data?.authorization_url) {
    throw new AppError(503, "PROVIDER_UNAVAILABLE", payload?.message ?? "The payment provider is unavailable.");
  }
  return payload.data;
}

export async function validPaystackSignature(env: Bindings, rawBody: string, supplied?: string) {
  const secret = env.PAYSTACK_WEBHOOK_SECRET ?? env.PAYSTACK_SECRET_KEY;
  if (!secret || !supplied) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (expected.length !== supplied.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return difference === 0;
}
