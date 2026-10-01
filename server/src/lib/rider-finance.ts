import { sql } from "drizzle-orm";
import { database, firstRow } from "./database";
import { AppError } from "./errors";
import { phase3SchemaReady } from "./features";
import { verifyPaystack } from "./paystack";
import type { Bindings } from "../types";

export async function riderFinanceReady(env: Bindings) {
  if (!phase3SchemaReady(env)) return false;
  return Boolean(
    firstRow(
      await database(env).execute<{ ready: boolean }>(sql`
    select to_regprocedure('app_private.record_rider_commission_receipt(text,bigint,bigint,timestamptz)') is not null as ready
  `),
    )?.ready,
  );
}
export async function riderFinanceSummary(
  env: Bindings,
  userId: string,
  universityId: string | null,
) {
  if (!(await riderFinanceReady(env))) return null;
  return firstRow(
    await database(env).execute<{
      pending_kobo: number;
      available_kobo: number;
      withdrawable_kobo: number;
      commission_due_kobo: number;
      unpaid_commissions: number;
      rides_suspended: boolean;
      cash_collected_kobo: number;
      reserved_kobo: number;
      withdrawn_kobo: number;
    }>(sql`
    with debt as (select coalesce(sum(outstanding_kobo) filter(where university_id=${universityId}::uuid),0)::bigint as due,
      count(*)::integer as count from app_private.rider_unpaid_commissions(${userId}::uuid)), balance as (
      select app_private.finance_balance(${universityId}::uuid,${userId}::uuid,'RIDER_AVAILABLE') as available)
    select app_private.finance_balance(${universityId}::uuid,${userId}::uuid,'RIDER_PENDING') as pending_kobo,
      balance.available-debt.due as available_kobo,balance.available as withdrawable_kobo,
      debt.due as commission_due_kobo,debt.count as unpaid_commissions,debt.count>=4 as rides_suspended,
      (select coalesce(sum(fare_kobo),0)::bigint from app_private.rider_cash_commissions where rider_user_id=${userId}::uuid
        and university_id=${universityId}::uuid) as cash_collected_kobo,
      app_private.finance_balance(${universityId}::uuid,${userId}::uuid,'RIDER_PAYOUT_RESERVED') as reserved_kobo,
      0::bigint as withdrawn_kobo from debt cross join balance
  `),
  );
}
/** Server-only proof: neither a redirect nor a client's success flag settles debt. */
export async function reconcileRiderCommission(
  env: Bindings,
  reference: string,
  userId?: string,
) {
  if (!(await riderFinanceReady(env))) return false;
  const intent = firstRow(
    await database(env).execute<{
      user_id: string;
      amount_kobo: number;
      status: string;
    }>(sql`
    select user_id,amount_kobo,status from app_private.rider_commission_checkouts where provider_reference=${reference}
      and (${userId ?? null}::uuid is null or user_id=${userId ?? null}::uuid)
  `),
  );
  if (!intent) return false;
  if (intent.status === "PAID") return true;
  const rate = firstRow(
    await database(env).execute<{ allowed: boolean }>(
      sql`select app_private.consume_request_rate_limit('RIDER_RECEIPT',${intent.user_id},60,3600,3600) as allowed`,
    ),
  );
  if (!rate?.allowed)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Please wait before checking this payment again. Verified callbacks can still reconcile it later.",
    );
  const receipt = await verifyPaystack(env, reference);
  if (receipt.status !== "success") return true;
  await database(env)
    .execute(sql`select app_private.record_rider_commission_receipt(
    ${reference},${receipt.amountKobo}::bigint,${receipt.feeKobo}::bigint,${receipt.paidAt}::timestamptz
  )`);
  return true;
}
