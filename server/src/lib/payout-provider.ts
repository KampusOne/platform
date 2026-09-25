import { z } from "@kampusone/contracts";
import type { Bindings } from "../types";
import { AppError } from "./errors";
import { requireFeature } from "./features";

export function requirePayoutProvider(env: Bindings) {
  requireFeature(
    env,
    "PAYMENTS_ENABLED",
    "Payout account setup is currently unavailable. Please try again later.",
  );
  if (
    !env.PAYSTACK_SECRET_KEY ||
    !/^sk_(test|live)_/.test(env.PAYSTACK_SECRET_KEY)
  )
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Payout account verification is not configured.",
    );
  return env.PAYSTACK_SECRET_KEY.startsWith("sk_live_")
    ? ("live" as const)
    : ("test" as const);
}
async function providerRequest(
  env: Bindings,
  path: string,
  body?: Record<string, unknown>,
  withMeta = false,
) {
  requirePayoutProvider(env);
  let response: Response;
  try {
    response = await fetch("https://api.paystack.co" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "The bank verification service could not be reached. Please try again.",
    );
  }
  const payload = (await response.json().catch(() => null)) as {
    status?: boolean;
    data?: unknown;
  } | null;
  if (response.status === 429)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Bank verification is busy. Please try again later.",
    );
  if (!response.ok || payload?.status !== true) {
    if (response.status === 400 || response.status === 422)
      throw new AppError(
        400,
        "BAD_REQUEST",
        "The bank could not verify those details. Check the bank and account number.",
      );
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "The bank verification service is unavailable. Your account details have not been approved.",
    );
  }
  return withMeta ? payload : payload.data;
}
type Bank = { code: string; name: string };
let bankCache: { expiresAt: number; banks: Bank[] } | undefined;
let bankRequest: Promise<Bank[]> | undefined;
export async function listNigerianBanks(env: Bindings) {
  requirePayoutProvider(env);
  if (bankCache && bankCache.expiresAt > Date.now()) return bankCache.banks;
  if (bankRequest) return bankRequest;
  bankRequest = fetchNigerianBanks(env)
    .then((banks) => {
      bankCache = { banks, expiresAt: Date.now() + 60 * 60 * 1000 };
      return banks;
    })
    .finally(() => {
      bankRequest = undefined;
    });
  return bankRequest;
}
async function fetchNigerianBanks(env: Bindings) {
  const banks = new Map<string, { code: string; name: string }>();
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const query = new URLSearchParams({
      country: "nigeria",
      currency: "NGN",
      perPage: "100",
      use_cursor: "true",
      ...(cursor ? { next: cursor } : {}),
    });
    const parsed = z
      .object({
        data: z.array(
          z.object({
            code: z.string().min(1).max(20),
            name: z.string().min(1).max(180),
            active: z.boolean().optional(),
          }),
        ),
        meta: z
          .object({ next: z.string().max(512).nullable().optional() })
          .optional(),
      })
      .safeParse(await providerRequest(env, "/bank?" + query, undefined, true));
    if (!parsed.success)
      throw new AppError(
        503,
        "PROVIDER_UNAVAILABLE",
        "The bank list could not be loaded.",
      );
    for (const bank of parsed.data.data)
      if (bank.active !== false)
        banks.set(bank.code, { code: bank.code, name: bank.name });
    const next = parsed.data.meta?.next;
    if (!next)
      return [...banks.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (next === cursor) break;
    cursor = next;
  }
  throw new AppError(
    503,
    "PROVIDER_UNAVAILABLE",
    "The complete bank list could not be loaded. Please try again.",
  );
}
export function compareBankName(legalName: string, bankName: string) {
  const tokens = (name: string) =>
    name
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toUpperCase()
      .replace(/[^\p{L}\p{N} ]/gu, " ")
      .split(/\s+/)
      .filter(Boolean);
  const a = tokens(legalName),
    b = tokens(bankName);
  if (a.length < 2 || b.length < 2) return "REVIEW_REQUIRED" as const;
  if (a.join(" ") === b.join(" ")) return "EXACT" as const;
  return [...a].sort().join(" ") === [...b].sort().join(" ")
    ? ("REORDERED" as const)
    : ("REVIEW_REQUIRED" as const);
}
export async function accountRequestHash(env: Bindings, value: string) {
  const secret = env.KYC_FINGERPRINT_SECRET;
  if (!secret || secret.length < 24)
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Account verification needs secure configuration.",
    );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode("kampusone:payout-setup:v1:" + value),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export async function resolvePayoutAccount(
  env: Bindings,
  bankCode: string,
  accountNumber: string,
) {
  const query = new URLSearchParams({
    bank_code: bankCode,
    account_number: accountNumber,
  });
  const resolved = z
    .object({
      account_number: z.string().regex(/^\d{10}$/),
      account_name: z.string().trim().min(2).max(180),
    })
    .safeParse(await providerRequest(env, "/bank/resolve?" + query));
  if (!resolved.success || resolved.data.account_number !== accountNumber)
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "The bank returned inconsistent account details. Please try again.",
    );
  // Creating a recipient only tokenizes the destination; it never transfers money.
  const recipient = z
    .object({
      recipient_code: z.string().regex(/^RCP_[A-Za-z0-9]+$/),
      active: z.boolean(),
      details: z.object({
        bank_code: z.string(),
        bank_name: z.string().min(1).max(180),
        account_number: z.string(),
      }),
    })
    .safeParse(
      await providerRequest(env, "/transferrecipient", {
        type: "nuban",
        name: resolved.data.account_name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: "NGN",
      }),
    );
  if (
    !recipient.success ||
    !recipient.data.active ||
    recipient.data.details.bank_code !== bankCode ||
    recipient.data.details.account_number !== accountNumber
  )
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "The payout destination could not be confirmed. Please try again.",
    );
  return {
    name: resolved.data.account_name,
    last4: accountNumber.slice(-4),
    recipientCode: recipient.data.recipient_code,
    bankName: recipient.data.details.bank_name,
  };
}
