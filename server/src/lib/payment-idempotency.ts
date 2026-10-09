import { sql } from "drizzle-orm";

import type { Bindings } from "../types";
import { database, firstRow } from "./database";
import { AppError } from "./errors";
import { initializePaystack } from "./paystack";
import { initiatePaystackTransfer, finalizePaystackTransfer } from "./paystack-transfers";

type Initialization = Parameters<typeof initializePaystack>[1];
type CheckoutClaim = {
  claim_state: "CLAIMED" | "IN_PROGRESS" | "READY" | "UNCERTAIN";
  authorization_url: string | null;
  access_code: string | null;
};

/**
 * A provider POST is an irreversible external side effect: claim a durable
 * reference before making it. Replays return the saved session, or surface
 * an in-progress/uncertain reference without making a second provider POST.
 */
export async function initializePaystackOnce(
  env: Bindings,
  input: Initialization,
) {
  const claimed = firstRow(
    await database(env).execute<CheckoutClaim>(sql`
      select * from app_private.claim_payment_initialization(
        ${input.reference},${input.amountKobo}::bigint
      )
    `),
  );
  if (!claimed)
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "This checkout could not be safely reserved.");

  if (claimed.claim_state === "READY") {
    if (!claimed.authorization_url || !claimed.access_code)
      throw new AppError(503, "PROVIDER_UNAVAILABLE", "The saved checkout session needs a review.");
    return {
      authorization_url: claimed.authorization_url,
      access_code: claimed.access_code,
      reference: input.reference,
      reused: true,
    };
  }

  if (claimed.claim_state !== "CLAIMED") {
    throw new AppError(
      409,
      "CONFLICT",
      claimed.claim_state === "IN_PROGRESS"
        ? "This payment is still being prepared. Check its status before trying again."
        : "The payment provider's response is uncertain. Check this reference before starting another payment.",
      { reference: input.reference, reason: claimed.claim_state === "IN_PROGRESS" ? "CHECKOUT_IN_PROGRESS" : "CHECKOUT_REQUIRES_REVIEW" },
    );
  }

  try {
    const initialized = await initializePaystack(env, input);
    if (!initialized.authorization_url || !initialized.access_code)
      throw new AppError(503, "PROVIDER_UNAVAILABLE", "The provider did not return a complete checkout session.");

    const recorded = firstRow(
      await database(env).execute<{ saved: boolean }>(sql`
        select app_private.finish_payment_initialization(
          ${input.reference},'READY',${initialized.authorization_url},${initialized.access_code}
        ) as saved
      `),
    );
    if (!recorded?.saved)
      throw new AppError(503, "PROVIDER_UNAVAILABLE", "The checkout could not be safely saved.");
    return initialized;
  } catch (error) {
    // Never re-POST after a timeout: Paystack may have created the session.
    // Even if this write fails, the IN_PROGRESS claim will age into UNCERTAIN.
    try {
      await database(env).execute(sql`
        select app_private.finish_payment_initialization(${input.reference},'UNCERTAIN')
      `);
    } catch {
      console.error(JSON.stringify({ level: "error", event: "payment.initialization_guard_write_failed" }));
    }
    throw error;
  }
}

type WebhookClaimState = "CLAIMED" | "BUSY" | "DUPLICATE" | "REQUIRES_REVIEW";
export type PaystackWebhookClaim = {
  state: WebhookClaimState;
  token: string;
  hash: string;
};

export async function claimPaystackWebhook(
  env: Bindings,
  event: string,
  reference: string,
  rawBody: string,
): Promise<PaystackWebhookClaim> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody));
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const token = crypto.randomUUID();
  const row = firstRow(
    await database(env).execute<{ state: WebhookClaimState }>(sql`
      select app_private.claim_provider_webhook(
        'PAYSTACK',${event},${reference},${hash},${token}::uuid
      ) as state
    `),
  );
  if (!row) throw new AppError(503, "PROVIDER_UNAVAILABLE", "The signed event could not be reserved.");
  return { state: row.state, token, hash };
}

export async function finishPaystackWebhook(
  env: Bindings,
  event: string,
  reference: string,
  claim: PaystackWebhookClaim,
  state: "PROCESSED" | "RETRYABLE" | "REQUIRES_REVIEW",
  reason?: string,
) {
  const updated = firstRow(
    await database(env).execute<{ saved: boolean }>(sql`
      select app_private.finish_provider_webhook(
        'PAYSTACK',${event},${reference},${claim.hash},${claim.token}::uuid,
        ${state},${reason ?? null}
      ) as saved
    `),
  );
  if (!updated?.saved)
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "This signed payment event needs another verification attempt.");
}

type TransferOperation = "INIT" | "FINALIZE";
type TransferClaim = {
  claim_state: "CLAIMED" | "IN_PROGRESS" | "READY" | "UNCERTAIN";
  provider_status: string | null;
  transfer_code: string | null;
};
type TransferAck = { reference: string; transferCode: string; status: string };

async function paystackTransferOnce(
  env: Bindings,
  operation: TransferOperation,
  reference: string,
  amountKobo: number,
  sealedTarget: string,
  perform: () => Promise<TransferAck>,
): Promise<TransferAck> {
  const claim = firstRow(
    await database(env).execute<TransferClaim>(sql`
      select * from app_private.claim_paystack_transfer_operation(
        ${operation},${reference},${amountKobo}::bigint,${sealedTarget}
      )
    `),
  );
  if (!claim)
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "The withdrawal could not be safely reserved.");
  if (claim.claim_state === "READY") {
    if (!claim.provider_status || !claim.transfer_code)
      throw new AppError(503, "PROVIDER_UNAVAILABLE", "The withdrawal acknowledgement needs review.");
    return { reference, status: claim.provider_status, transferCode: claim.transfer_code };
  }
  if (claim.claim_state !== "CLAIMED") {
    throw new AppError(
      409, "CONFLICT",
      claim.claim_state === "IN_PROGRESS"
        ? "This bank transfer is already being processed. Check its saved reference."
        : "The transfer provider's response is uncertain. Verify the saved reference before another action.",
      { reference, reason: claim.claim_state === "IN_PROGRESS" ? "TRANSFER_IN_PROGRESS" : "TRANSFER_REQUIRES_REVIEW" },
    );
  }
  try {
    const ack = await perform();
    const saved = firstRow(
      await database(env).execute<{ saved: boolean }>(sql`
        select app_private.finish_paystack_transfer_operation(
          ${operation},${reference},'READY',${ack.status},${ack.transferCode}
        ) as saved
      `),
    );
    if (!saved?.saved)
      throw new AppError(503, "PROVIDER_UNAVAILABLE", "The provider transfer result could not be safely saved.");
    return ack;
  } catch (error) {
    try {
      await database(env).execute(sql`
        select app_private.finish_paystack_transfer_operation(
          ${operation},${reference},'UNCERTAIN'
        )
      `);
    } catch {
      console.error(JSON.stringify({ level: "error", event: "payment.transfer_guard_write_failed" }));
    }
    throw error;
  }
}

export async function initiatePaystackTransferOnce(
  env: Bindings,
  input: Parameters<typeof initiatePaystackTransfer>[1],
) {
  return paystackTransferOnce(env,"INIT",input.reference,input.amountKobo,input.recipientCode,
    () => initiatePaystackTransfer(env,input));
}

export async function finalizePaystackTransferOnce(
  env: Bindings,
  input: Parameters<typeof finalizePaystackTransfer>[1],
) {
  // Never store or log the OTP. The provider reference and sealed transfer
  // code identify the operation; retries must verify rather than re-submit.
  return paystackTransferOnce(env,"FINALIZE",input.reference,input.amountKobo,input.transferCode,
    () => finalizePaystackTransfer(env,input));
}
