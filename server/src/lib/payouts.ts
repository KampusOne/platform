import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "./database";
import { AppError } from "./errors";
import { requireFullKyc } from "./kyc";
import { requireTransfers, verifyPaystackTransfer } from "./paystack-transfers";
import { payoutCostQuote } from "./payout-costs";
import type { Bindings, AuthenticatedUser } from "../types";
export async function ledgerPayoutsReady(env: Bindings) {
  if (
    env.UNIFIED_SCHEMA_READY !== "true" ||
    env.PHASE_3_SCHEMA_READY !== "true"
  )
    return false;
  return (
    firstRow(
      await database(env).execute<{ ready: boolean }>(
        sql`select to_regprocedure('app_private.create_ledger_payout(uuid,uuid,uuid,uuid)') is not null as ready`,
      ),
    )?.ready === true
  );
}
export async function requireLedgerPayouts(env: Bindings) {
  const mode = requireTransfers(env);
  if (!(await payoutFeeComponentsReady(env)))
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "Withdrawals are awaiting the scheduled database update. Your earnings remain available.",
    );
  return mode;
}
export async function payoutFeeComponentsReady(env: Bindings) {
  if (!(await ledgerPayoutsReady(env))) return false;
  return firstRow(await database(env).execute<{ ready: boolean }>(
    sql`select to_regprocedure('app_private.reconcile_payout_duty(uuid,uuid,bigint,text,uuid,text)') is not null as ready`,
  ))?.ready === true;
}
export const payoutQuoteSchema = z
  .object({
    agentProfileId: z.string().uuid(),
    amountKobo: z.number().int().positive().max(1_000_000_000),
  })
  .strict();
export async function payoutRate(
  env: Bindings,
  userId: string,
  kind = "PAYOUT_CHECK",
  limit = 30,
) {
  if (
    !firstRow(
      await database(env).execute<{ allowed: boolean }>(
        sql`select app_private.consume_request_rate_limit(${kind},${userId},${limit},3600,3600) as allowed`,
      ),
    )?.allowed
  )
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Please wait before trying this withdrawal again.",
    );
}
export async function quotePayout(
  env: Bindings,
  user: AuthenticatedUser,
  data: z.infer<typeof payoutQuoteSchema>,
) {
  const mode = await requireLedgerPayouts(env);
  await payoutRate(env, user.id, "PAYOUT_QUOTE");
  const row = firstRow(
    await database(env).execute<{
      application_id: string;
      agent_type: string;
      setup_id: string;
      recipient_code: string;
      policy_id: string;
      fee_bearer: string;
      low_fee_kobo: number;
      middle_fee_kobo: number;
      high_fee_kobo: number;
      duty_threshold_kobo: number;
      duty_kobo: number;
      minimum_withdrawal_kobo: number;
      version: string;
      bank_name: string;
      account_last4: string;
    }>(sql`
 select p.application_id,p.agent_type,s.id as setup_id,s.recipient_code,s.bank_name,s.account_last4,c.id as policy_id,c.version,c.fee_bearer,c.low_fee_kobo,c.middle_fee_kobo,c.high_fee_kobo,c.duty_threshold_kobo,c.duty_kobo,c.minimum_withdrawal_kobo
 from public.agent_profiles p join public.agent_applications a on a.id=p.application_id
 join app_private.payout_account_setups s on s.agent_profile_id=p.id and s.status='APPROVED' and s.recipient_code=a.bank_recipient_code
 join app_private.active_payout_cost_policies active on active.university_id=p.university_id and active.agent_type=p.agent_type
 join app_private.payout_cost_policies c on c.id=active.policy_id and c.university_id=p.university_id and c.agent_type=p.agent_type
 where p.id=${data.agentProfileId}::uuid and p.user_id=${user.id}::uuid and p.university_id=${user.universityId}::uuid
 and p.status='ACTIVE' and a.status='APPROVED' and s.provider_mode=${mode} and s.institution_id=p.university_id and s.user_id=p.user_id limit 1`),
  );
  if (!row)
    throw new AppError(
      409,
      "CONFLICT",
      "Complete bank approval and the campus withdrawal policy before requesting a withdrawal.",
    );
  await requireFullKyc(env, row.application_id);
  let costs;
  try {
    costs = payoutCostQuote(data.amountKobo, {
      feeBearer: row.fee_bearer as "PLATFORM" | "PAYEE",
      lowFeeKobo: Number(row.low_fee_kobo), middleFeeKobo: Number(row.middle_fee_kobo), highFeeKobo: Number(row.high_fee_kobo),
      dutyThresholdKobo: Number(row.duty_threshold_kobo), dutyKobo: Number(row.duty_kobo), minimumWithdrawalKobo: Number(row.minimum_withdrawal_kobo),
    });
  } catch (error) {
    if (error instanceof RangeError) throw new AppError(409, "CONFLICT", error.message);
    throw error;
  }
  const quote = firstRow(
    await database(env).execute<{
      id: string;
      expires_at: string;
    }>(sql`insert into app_private.agent_payout_quotes(id,user_id,university_id,agent_profile_id,agent_type,policy_id,account_setup_id,recipient_code,provider_mode,amount_kobo,estimated_fee_kobo,fee_allowance_kobo,bank_net_kobo,expected_transfer_fee_kobo,expected_statutory_duty_kobo,transfer_fee_allowance_kobo,statutory_duty_allowance_kobo,minimum_withdrawal_kobo,statutory_duty_policy)
 values(${crypto.randomUUID()}::uuid,${user.id}::uuid,${user.universityId}::uuid,${data.agentProfileId}::uuid,${row.agent_type},${row.policy_id}::uuid,${row.setup_id}::uuid,${row.recipient_code},${mode},${data.amountKobo},${costs.expectedTransferFeeKobo + costs.expectedStatutoryDutyKobo},${costs.transferFeeAllowanceKobo},${costs.bankNetKobo},${costs.expectedTransferFeeKobo},${costs.expectedStatutoryDutyKobo},${costs.transferFeeAllowanceKobo},${costs.statutoryDutyAllowanceKobo},${costs.minimumWithdrawalKobo},${costs.statutoryDutyPolicy}) returning id,expires_at`),
  );
  return {
    id: quote!.id,
    amountKobo: data.amountKobo,
    feeKobo: costs.transferFeeAllowanceKobo,
    netKobo: costs.bankNetKobo,
    ...costs,
    policyId: row.policy_id,
    policyVersion: row.version,
    expiresAt: quote!.expires_at,
    bankName: row.bank_name,
    accountLast4: row.account_last4,
  };
}
export function payoutError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    PAYOUT_FAILURE_ALREADY_RELEASED: 'This failed withdrawal has been returned to your available wallet. Review a new withdrawal instead of retrying its old reference.',
    PAYOUT_REQUEST_CHANGED:
      "This request already belongs to another quote. Refresh before continuing.",
    PAYOUT_QUOTE_UNAVAILABLE:
      "That withdrawal quote is not available for your account and campus.",
    PAYOUT_QUOTE_EXPIRED: "The quote expired. Review a fresh quote.",
    PAYOUT_ACCOUNT_UNVERIFIED:
      "Your identity or bank approval changed. Complete verification before withdrawing.",
    PAYOUT_ALREADY_PENDING:
      "A withdrawal is already pending. Check its status before requesting another.",
    PAYOUT_COMMISSION_DUE:
      "Pay your outstanding ride commissions before withdrawing.",
    PAYOUT_BALANCE_INSUFFICIENT:
      "The requested amount is more than your available earnings.",
    PAYOUT_NOT_APPROVED: "This withdrawal is not approved for a transfer.",
    PAYOUT_UNAVAILABLE: "That withdrawal is not available.",
  };
  const code = Object.keys(messages).find((k) => message.includes(k));
  if (code) throw new AppError(409, "CONFLICT", messages[code]!);
  throw error;
}
export async function reconcilePayout(
  env: Bindings,
  reference: string,
  owner?: string,
  uni?: string | null,
) {
  if (!(await ledgerPayoutsReady(env))) return false;
  const s = firstRow(
    await database(env).execute<{
      user_id: string;
      initiated_at: string | null;
    }>(sql`select user_id,initiated_at from app_private.agent_payout_settlements where provider_reference=${reference}
  and (${owner ?? null}::uuid is null or user_id=${owner ?? null}::uuid) and (${uni ?? null}::uuid is null or university_id=${uni ?? null}::uuid)`),
  );
  if (!s) return false;
  if (!s.initiated_at) return true;
  await payoutRate(env, s.user_id, "PAYOUT_CHECK", 60);
  const proof = await verifyPaystackTransfer(env, reference);
  await database(env).execute(
    sql`select app_private.record_ledger_transfer(${reference},${proof.amountKobo}::bigint,${proof.feeKobo}::bigint,${proof.recipientCode},${proof.mode},${proof.status},${proof.transferCode},${proof.updatedAt}::timestamptz)`,
  );
  return true;
}

/** Recover provider results even when a webhook or the user's network was missed. */
export async function reconcileDuePayouts(env:Bindings){
  if(!env.PAYSTACK_SECRET_KEY||!await ledgerPayoutsReady(env))return {checked:0};
  const due=await database(env).execute<{provider_reference:string;university_id:string}>(sql`
    select s.provider_reference,s.university_id from app_private.agent_payout_settlements s
    join public.payout_requests p on p.id=s.payout_id
    where s.initiated_at is not null and s.failure_release_journal_id is null
      and p.status in('PROCESSING','OTP_REQUIRED','FAILED','REQUIRES_REVIEW')
      and(s.last_verified_at is null or s.last_verified_at<now()-interval '5 minutes')
    order by s.last_verified_at nulls first,s.created_at limit 20
  `);
  let checked=0;
  for(const row of due.rows){try{await reconcilePayout(env,row.provider_reference,undefined,row.university_id);checked++;}catch{
    console.error(JSON.stringify({level:'error',event:'payout.scheduled_verification_unavailable'}));
  }}
  return {checked};
}
