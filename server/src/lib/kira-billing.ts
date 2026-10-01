import { sql } from "drizzle-orm";
import { database, firstRow } from "./database";
import { initializePaystack, verifyPaystack } from "./paystack";
import { AppError } from "./errors";
import { recordAudit } from "./audit";
import { providerConfiguration } from "./ai-provider";
import type { AuthenticatedUser, Bindings } from "../types";
export async function kiraBillingReady(env: Bindings) {
  if (
    env.UNIFIED_SCHEMA_READY !== "true" ||
    env.PHASE_3_SCHEMA_READY !== "true"
  )
    return false;
  return (
    firstRow(
      await database(env).execute<{ ready: boolean }>(
        sql`select to_regprocedure('app_private.record_kira_receipt(text,bigint,bigint,timestamp with time zone)') is not null as ready`,
      ),
    )?.ready === true
  );
}
export async function kiraBillingStatus(
  env: Bindings,
  user: AuthenticatedUser,
) {
  const ready = await kiraBillingReady(env);
  if (!ready)
    return {
      available: false,
      checkoutEnabled: false,
      cadence: "monthly",
      amountKobo: 600000,
      currency: "NGN",
      autoRenew: false,
      currentPeriodEnd: null,
      checkout: null,
    };
  const subscription = firstRow(
    await database(env).execute<{ status: string; current_period_end: string }>(
      sql`select status,current_period_end from app_private.ai_subscriptions where user_id=${user.id}::uuid and current_period_end>now()`,
    ),
  );
  const plan = firstRow(
    await database(env).execute(
      sql`select plan_id from app_private.active_kira_price_plans where university_id=${user.universityId}::uuid`,
    ),
  );
  const pending = firstRow(
    await database(env).execute<{
      reference: string;
      status: string;
      amount_kobo: number;
      expires_at: string;
    }>(
      sql`select provider_reference as reference,status,amount_kobo,expires_at from app_private.kira_checkouts where user_id=${user.id}::uuid and status in ('CREATED','INITIALIZED','REQUIRES_REVIEW') order by created_at desc limit 1`,
    ),
  );
  const early =
    subscription?.status === "ACTIVE" &&
    Date.parse(subscription.current_period_end) > Date.now() + 7 * 86400000;
  return {
    available: !!plan,
    checkoutEnabled:
      !!plan &&
      !early &&
      env.KIRA_SUBSCRIPTIONS_ENABLED === "true" &&
      env.PAYMENTS_ENABLED === "true" &&
      env.AI_ASSISTANT_ENABLED === "true" &&
      providerConfiguration(env, "study", undefined, undefined, "pro")
        .configured,
    cadence: "monthly",
    amountKobo: 600000,
    currency: "NGN",
    autoRenew: false,
    currentPeriodEnd:
      subscription?.status === "ACTIVE"
        ? subscription.current_period_end
        : null,
    checkout: pending ?? null,
  };
}
export async function initializeKira(
  env: Bindings,
  user: AuthenticatedUser,
  requestId: string,
  traceId?: string,
) {
  const status = await kiraBillingStatus(env, user);
  if (!status.checkoutEnabled)
    throw new AppError(
      409,
      "CONFLICT",
      status.currentPeriodEnd
        ? "Your paid month is active. Renewal opens in its final seven days."
        : "Kira subscriptions are not open yet.",
    );
  let checkout: {
    id: string;
    provider_reference: string;
    amount_kobo: number;
    status: string;
    authorization_url: string | null;
    access_code: string | null;
  };
  try {
    checkout = firstRow(
      await database(env).execute<typeof checkout>(
        sql`select * from app_private.create_kira_checkout(${crypto.randomUUID()}::uuid,${user.id}::uuid,${user.universityId}::uuid,${requestId}::uuid,${"K1-AI-" + crypto.randomUUID()})`,
      ),
    )!;
  } catch (e) {
    if (
      e instanceof Error &&
      /KIRA_ALREADY_ACTIVE|KIRA_PLAN_UNAVAILABLE|BUYER_TENANT_MISMATCH/.test(
        e.message,
      )
    )
      throw new AppError(
        409,
        "CONFLICT",
        "Refresh your plan or campus before opening checkout.",
      );
    throw e;
  }
  if (!["CREATED", "INITIALIZED"].includes(checkout.status))
    throw new AppError(
      409,
      "CONFLICT",
      "This payment has finished or needs review. Check its status before starting another.",
    );
  if (
    checkout.status === "INITIALIZED" &&
    checkout.authorization_url &&
    checkout.access_code
  )
    return {
      authorizationUrl: checkout.authorization_url,
      reference: checkout.provider_reference,
      amountKobo: checkout.amount_kobo,
    };
  const rate = firstRow(
    await database(env).execute<{ allowed: boolean }>(
      sql`select app_private.consume_request_rate_limit('KIRA_CHECKOUT',${user.id},20,3600,3600) as allowed`,
    ),
  );
  if (!rate?.allowed)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Please wait before opening another checkout.",
    );
  const initialized = await initializePaystack(env, {
    email: user.email,
    amountKobo: checkout.amount_kobo,
    reference: checkout.provider_reference,
    ...(env.APP_ORIGIN
      ? { callbackUrl: env.APP_ORIGIN.replace(/\/$/, "") + "/payment/return" }
      : {}),
    metadata: {
      resourceType: "KIRA_SUBSCRIPTION",
      resourceId: checkout.id,
      userId: user.id,
    },
  });
  await database(env).execute(
    sql`update app_private.kira_checkouts set status='INITIALIZED',authorization_url=${initialized.authorization_url!},access_code=${initialized.access_code ?? null} where id=${checkout.id}::uuid and status='CREATED'`,
  );
  await recordAudit(env, {
    actorUserId: user.id,
    universityId: user.universityId,
    action: "kira.checkout.initialized",
    targetType: "kira_checkout",
    targetId: checkout.id,
    ...(traceId ? { requestId: traceId } : {}),
    metadata: {
      reference: checkout.provider_reference,
      amountKobo: checkout.amount_kobo,
    },
  });
  return {
    authorizationUrl: initialized.authorization_url!,
    reference: checkout.provider_reference,
    amountKobo: checkout.amount_kobo,
  };
}
export async function reconcileKira(
  env: Bindings,
  reference: string,
  userId?: string,
) {
  if (!(await kiraBillingReady(env))) return false;
  const intent = firstRow(
    await database(env).execute<{ status: string }>(
      sql`select status from app_private.kira_checkouts where provider_reference=${reference} and (${userId ?? null}::uuid is null or user_id=${userId ?? null}::uuid)`,
    ),
  );
  if (!intent) return false;
  if (intent.status === "PAID") return true;
  const rate = firstRow(
    await database(env).execute<{ allowed: boolean }>(
      sql`select app_private.consume_request_rate_limit('KIRA_RECEIPT',${reference},60,3600,3600) as allowed`,
    ),
  );
  if (!rate?.allowed)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Please wait before checking this payment again.",
    );
  const receipt = await verifyPaystack(env, reference);
  if (receipt.status === "success")
    await database(env).execute(
      sql`select app_private.record_kira_receipt(${reference},${receipt.amountKobo}::bigint,${receipt.feeKobo}::bigint,${receipt.paidAt}::timestamptz)`,
    );
  return true;
}
