import { z } from "@kampusone/contracts";
import { AppError } from "./errors";
import type { Bindings } from "../types";

const referenceSchema = z.string().regex(/^[a-z0-9_-]{16,50}$/);
const transferSchema = z.object({
  reference: referenceSchema,
  amount: z.number().int().positive().max(1_000_000_000),
  currency: z.literal("NGN"),
  domain: z.enum(["live", "test"]),
  status: z.enum([
    "pending",
    "processing",
    "otp",
    "success",
    "failed",
    "reversed",
    "abandoned",
    "blocked",
    "rejected",
    "received",
  ]),
  transfer_code: z.string().regex(/^TRF_[A-Za-z0-9]+$/),
});
export function transferMode(env: Bindings) {
  if (
    !env.PAYSTACK_SECRET_KEY ||
    !/^sk_(live|test)_/.test(env.PAYSTACK_SECRET_KEY) ||
    (env.ENVIRONMENT === "production" &&
      !env.PAYSTACK_SECRET_KEY.startsWith("sk_live_"))
  )
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Verified bank transfers are not configured.",
    );
  return env.PAYSTACK_SECRET_KEY.startsWith("sk_live_")
    ? ("live" as const)
    : ("test" as const);
}
export function requireTransfers(env: Bindings) {
  if (env.PAYMENTS_ENABLED !== "true" || env.PAYOUTS_ENABLED !== "true")
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "New withdrawals are paused. Your earnings remain in your account.",
    );
  return transferMode(env);
}
async function request(
  env: Bindings,
  path: string,
  body?: Record<string, unknown>,
) {
  transferMode(env);
  let response: Response;
  try {
    response = await fetch("https://api.paystack.co" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "The transfer result is uncertain. The funds remain reserved; check its saved reference before retrying.",
    );
  }
  const data = (await response.json().catch(() => null)) as {
    status?: boolean;
    data?: unknown;
  } | null;
  if (response.status === 404)
    throw new AppError(
      404,
      "NOT_FOUND",
      "The provider has not found this transfer yet.",
    );
  if (response.status === 429)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Transfer verification is busy. Please try again later.",
    );
  if (!response.ok || data?.status !== true)
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "The provider could not confirm this transfer. Its reservation and saved reference remain available.",
    );
  return data.data;
}
function acknowledgement(
  env: Bindings,
  data: unknown,
  reference: string,
  amountKobo: number,
) {
  const result = transferSchema.safeParse(data);
  if (
    !result.success ||
    result.data.reference !== reference ||
    result.data.amount !== amountKobo ||
    result.data.domain !== transferMode(env)
  )
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "The provider returned inconsistent transfer details. Keep the saved reference for review.",
    );
  return {
    reference: result.data.reference,
    transferCode: result.data.transfer_code,
    status: result.data.status,
  };
}
export async function initiatePaystackTransfer(
  env: Bindings,
  input: { reference: string; amountKobo: number; recipientCode: string },
) {
  requireTransfers(env);
  if (
    !referenceSchema.safeParse(input.reference).success ||
    !/^RCP_[A-Za-z0-9]+$/.test(input.recipientCode) ||
    !Number.isSafeInteger(input.amountKobo) ||
    input.amountKobo <= 0 ||
    input.amountKobo > 1_000_000_000
  )
    throw new AppError(
      400,
      "BAD_REQUEST",
      "The sealed transfer details are invalid.",
    );
  return acknowledgement(
    env,
    await request(env, "/transfer", {
      source: "balance",
      currency: "NGN",
      amount: input.amountKobo,
      recipient: input.recipientCode,
      reference: input.reference,
      reason: "KampusOne earnings withdrawal",
    }),
    input.reference,
    input.amountKobo,
  );
}
export async function finalizePaystackTransfer(
  env: Bindings,
  input: {
    reference: string;
    amountKobo: number;
    transferCode: string;
    otp: string;
  },
) {
  requireTransfers(env);
  if (
    !/^TRF_[A-Za-z0-9]+$/.test(input.transferCode) ||
    !/^\d{6,10}$/.test(input.otp)
  )
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Enter the transfer confirmation code.",
    );
  return acknowledgement(
    env,
    await request(env, "/transfer/finalize_transfer", {
      transfer_code: input.transferCode,
      otp: input.otp,
    }),
    input.reference,
    input.amountKobo,
  );
}
export async function verifyPaystackTransfer(env: Bindings, reference: string) {
  if (!referenceSchema.safeParse(reference).success)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Choose a valid transfer reference.",
    );
  const verified = transferSchema
    .extend({
      fee_charged: z.number().int().min(0).max(1_000_000_000),
      recipient: z.object({
        recipient_code: z.string().regex(/^RCP_[A-Za-z0-9]+$/),
        currency: z.literal("NGN"),
        domain: z.enum(["test", "live"]),
      }),
      updatedAt: z.string().refine((v) => Number.isFinite(Date.parse(v))),
    })
    .safeParse(
      await request(env, "/transfer/verify/" + encodeURIComponent(reference)),
    );
  if (
    !verified.success ||
    verified.data.reference !== reference ||
    verified.data.domain !== transferMode(env) ||
    verified.data.recipient.domain !== verified.data.domain
  )
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "The provider proof is incomplete or inconsistent. The withdrawal remains reserved for review.",
    );
  return {
    reference,
    status: verified.data.status,
    amountKobo: verified.data.amount,
    feeKobo: verified.data.fee_charged,
    recipientCode: verified.data.recipient.recipient_code,
    mode: verified.data.domain,
    transferCode: verified.data.transfer_code,
    updatedAt: verified.data.updatedAt,
  };
}
