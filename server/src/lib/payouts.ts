import {bachsAgentProvider,bachsPayoutMode,requireBachsConnect,bachsPlatform} from "./bachs-connect";
import {reconcileBachsAgentPayout} from "./bachs-agent-payouts";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "./database";
import { AppError } from "./errors";
import { requireFullKyc } from "./kyc";
import { requireTransfers, verifyPaystackTransfer } from "./paystack-transfers";
import { payoutCostQuote } from "./payout-costs";
import type {WithdrawalCommissionTier} from './payout-commission';
import {isoTimestamp} from './wire-timestamps';
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
export async function requireLedgerPayouts(env: Bindings, provider=bachsAgentProvider(env)?'BACHS':'PAYSTACK') {
  if(env.PAYMENTS_ENABLED!=='true'||env.PAYOUTS_ENABLED!=='true')throw new AppError(503,'FEATURE_DISABLED','New withdrawals are paused. Your earnings remain in your account.');
  if(provider==='BACHS'&&env.BACHS_AGENT_PAYOUTS_ENABLED!=='true')throw new AppError(503,'FEATURE_DISABLED','Agent payouts are awaiting Bachs Connect activation and bank-transfer verification. You can save your bank details.');
  const mode = provider==='BACHS'?bachsPayoutMode(env):requireTransfers(env);
  if(provider==='BACHS')await requireBachsConnect(env);
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
    sql`select to_regprocedure('app_private.reconcile_payout_duty(uuid,uuid,bigint,text,uuid,text)') is not null
      and to_regprocedure('app_private.withdrawal_commission(bigint,jsonb)') is not null and to_regprocedure('app_private.record_bachs_agent_payout(uuid,text,bigint,bigint,text,text,text,text,timestamptz)') is not null as ready`,
  ))?.ready === true;
}
export async function payoutAvailability(env:Bindings,schemaReady:boolean){
  if(env.PAYMENTS_ENABLED!=='true'||env.PAYOUTS_ENABLED!=='true')return {enabled:false,reason:'New withdrawals are paused. Your earnings remain in your wallet.'};
  if(!schemaReady)return {enabled:false,reason:'Withdrawals are awaiting the database update. Your earnings remain in your wallet.'};
  if(bachsAgentProvider(env)&&env.BACHS_AGENT_PAYOUTS_ENABLED!=='true')return {enabled:false,reason:'Agent payouts are awaiting Bachs Connect activation and bank-transfer verification. You can save your bank details.'};
  try{
    if(bachsAgentProvider(env)){
      if(!(await bachsPlatform(env)).connect)return {enabled:false,reason:'Bachs Connect activation is pending. You can save bank details; agent payouts will open after activation.'};
    }else requireTransfers(env);
    return {enabled:true,reason:null};
  }catch{return {enabled:false,reason:'The payment provider could not confirm payout availability. Your earnings remain in your wallet.'};}
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
      commission_tiers: WithdrawalCommissionTier[];
      provider:string;connected_account_id:string|null;
      account_last4: string;
    }>(sql`
 select p.application_id,p.agent_type,s.id as setup_id,s.recipient_code,s.bank_name,s.account_last4,c.id as policy_id,c.version,c.fee_bearer,c.low_fee_kobo,c.middle_fee_kobo,c.high_fee_kobo,c.duty_threshold_kobo,c.duty_kobo,c.minimum_withdrawal_kobo,c.commission_tiers,s.provider,s.connected_account_id
 from public.agent_profiles p join public.agent_applications a on a.id=p.application_id
 join app_private.payout_account_setups s on s.agent_profile_id=p.id and s.status='APPROVED' and s.recipient_code=a.bank_recipient_code
 join app_private.active_payout_cost_policies active on active.university_id=p.university_id and active.agent_type=p.agent_type
 join app_private.payout_cost_policies c on c.id=active.policy_id and c.university_id=p.university_id and c.agent_type=p.agent_type
 where p.id=${data.agentProfileId}::uuid and p.user_id=${user.id}::uuid and p.university_id=${user.universityId}::uuid
 and p.status='ACTIVE' and a.status='APPROVED' and s.provider=${bachsAgentProvider(env)?'BACHS':'PAYSTACK'} and c.provider=s.provider and s.provider_mode=${mode} and s.institution_id=p.university_id and s.user_id=p.user_id limit 1`),
  );
  if (!row)
    throw new AppError(
      409,
      "CONFLICT",
      "Complete bank approval and the campus withdrawal policy before requesting a withdrawal.",
    );
  if(data.amountKobo<(row.agent_type==='RIDER'?200000:500000))throw new AppError(409,'CONFLICT',row.agent_type==='RIDER'?'The minimum rider withdrawal is ₦2,000.':'The minimum agent withdrawal is ₦5,000.');
  await requireFullKyc(env, row.application_id);
  let costs;
  try {
    costs = payoutCostQuote(data.amountKobo, {
      feeBearer: row.fee_bearer as "PLATFORM" | "PAYEE",
      lowFeeKobo: Number(row.low_fee_kobo), middleFeeKobo: Number(row.middle_fee_kobo), highFeeKobo: Number(row.high_fee_kobo),
      dutyThresholdKobo: Number(row.duty_threshold_kobo), dutyKobo: Number(row.duty_kobo), minimumWithdrawalKobo: Number(row.minimum_withdrawal_kobo),
      commissionTiers:row.commission_tiers,
    });
  } catch (error) {
    if (error instanceof RangeError) throw new AppError(409, "CONFLICT", error.message);
    throw error;
  }
  const quote = firstRow(
    await database(env).execute<{
      id: string;
      expires_at: string;
    }>(sql`insert into app_private.agent_payout_quotes(id,user_id,university_id,agent_profile_id,agent_type,policy_id,account_setup_id,recipient_code,provider_mode,amount_kobo,estimated_fee_kobo,fee_allowance_kobo,bank_net_kobo,expected_transfer_fee_kobo,expected_statutory_duty_kobo,transfer_fee_allowance_kobo,statutory_duty_allowance_kobo,minimum_withdrawal_kobo,statutory_duty_policy,payout_commission_kobo,provider,connected_account_id)
 values(${crypto.randomUUID()}::uuid,${user.id}::uuid,${user.universityId}::uuid,${data.agentProfileId}::uuid,${row.agent_type},${row.policy_id}::uuid,${row.setup_id}::uuid,${row.recipient_code},${mode},${data.amountKobo},${costs.expectedTransferFeeKobo + costs.expectedStatutoryDutyKobo},${costs.transferFeeAllowanceKobo},${costs.bankNetKobo},${costs.expectedTransferFeeKobo},${costs.expectedStatutoryDutyKobo},${costs.transferFeeAllowanceKobo},${costs.statutoryDutyAllowanceKobo},${costs.minimumWithdrawalKobo},${costs.statutoryDutyPolicy},${costs.payoutCommissionKobo},${row.provider},${row.connected_account_id}) returning id,expires_at`),
  );
  return {
    id: quote!.id,
    amountKobo: data.amountKobo,
    feeKobo: costs.transferFeeAllowanceKobo,
    netKobo: costs.bankNetKobo,
    ...costs,
    provider:row.provider,
    policyId: row.policy_id,
    policyVersion: row.version,
    expiresAt: isoTimestamp(quote!.expires_at),
    bankName: row.bank_name,
    accountLast4: row.account_last4,
  };
}
export function payoutError(error: unknown): never {
  let message = "", current = error;
  for(let depth=0;depth<5&&current instanceof Error;depth++){message += current.message;current=current.cause;}
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
  if (!(await payoutFeeComponentsReady(env))) return false;
  const s = firstRow(
    await database(env).execute<{
      user_id: string;
      initiated_at: string | null;
      provider:string;payout_id:string;
    }>(sql`select user_id,initiated_at,provider,payout_id from app_private.agent_payout_settlements where provider_reference=${reference}
  and (${owner ?? null}::uuid is null or user_id=${owner ?? null}::uuid) and (${uni ?? null}::uuid is null or university_id=${uni ?? null}::uuid)`),
  );
  if (!s) return false;
  if (!s.initiated_at) return true;
  await payoutRate(env, s.user_id, "PAYOUT_CHECK", 60);
  if(s.provider==='BACHS')return reconcileBachsAgentPayout(env,s.payout_id);
  const proof = await verifyPaystackTransfer(env, reference);
  await database(env).execute(
    sql`select app_private.record_ledger_transfer(${reference},${proof.amountKobo}::bigint,${proof.feeKobo}::bigint,${proof.recipientCode},${proof.mode},${proof.status},${proof.transferCode},${proof.updatedAt}::timestamptz)`,
  );
  return true;
}

/** Recover provider results even when a webhook or the user's network was missed. */
export async function reconcileDuePayouts(env:Bindings){
  if((!env.PAYSTACK_SECRET_KEY&&!env.BACHS_API_KEY)||!await payoutFeeComponentsReady(env))return {checked:0};
  const scheduleReady=firstRow(await database(env).execute<{ready:boolean}>(sql`select exists(select 1 from information_schema.columns where table_schema='app_private' and table_name='agent_payout_settlements' and column_name='next_check_at') as ready`))?.ready;
  if(!scheduleReady)return {checked:0};
  const due=await database(env).execute<{payout_id:string;provider_reference:string;university_id:string}>(sql`
    select s.payout_id,s.provider_reference,s.university_id from app_private.agent_payout_settlements s
    join public.payout_requests p on p.id=s.payout_id
    where s.initiated_at is not null and ((s.failure_release_journal_id is null and p.status in('PROCESSING','OTP_REQUIRED','FAILED','REQUIRES_REVIEW')) or(s.provider='BACHS' and exists(select 1 from app_private.bachs_payout_bridges b where b.payout_id=s.payout_id and b.recovery_journal_id is null and ((p.status='FAILED')or(p.status='PAID' and b.funding_amount_kobo>s.bank_net_kobo+coalesce(b.actual_fee_kobo,0))))))
      and s.next_check_at<=now()
    order by s.next_check_at,s.created_at limit 20
  `);
  let checked=0;
  for(const row of due.rows){
    const claimed=firstRow(await database(env).execute(sql`update app_private.agent_payout_settlements set next_check_at=now()+interval '5 minutes' where payout_id=${row.payout_id}::uuid and next_check_at<=now() returning payout_id`));
    if(!claimed)continue;
    try{await reconcilePayout(env,row.provider_reference,undefined,row.university_id);checked++;}catch{
    console.error(JSON.stringify({level:'error',event:'payout.scheduled_verification_unavailable'}));
  }}
  return {checked};
}
