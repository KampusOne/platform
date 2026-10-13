import {bachsPayoutMode} from "../lib/bachs-connect";
import {sendBachsAgentPayout} from "../lib/bachs-agent-payouts";
import { Hono, type Context } from "hono";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { currentUser } from "../middleware/auth";
import { resolveAdminScope } from "../lib/admin-access";
import { database, firstRow } from "../lib/database";
import { recordAudit } from "../lib/audit";
import { AppError } from "../lib/errors";
import { input, id } from "../lib/input";
import {
  payoutAvailability,
  payoutFeeComponentsReady,
  requireLedgerPayouts,
  payoutRate,
  payoutError,
  reconcilePayout,
} from "../lib/payouts";
import { transferMode } from "../lib/paystack-transfers";
import { initiatePaystackTransferOnce, finalizePaystackTransferOnce } from "../lib/payment-idempotency";
import type { Bindings, Variables } from "../types";
export const payoutAdminRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();
payoutAdminRoutes.get("/", async (c) => {
  const scope = await resolveAdminScope(
    c.env,
    currentUser(c),
    c.req.query("universityId"),
    "finance.view",
  );
  if (!(await payoutFeeComponentsReady(c.env)))
    return c.json({ ready: false, payouts: [], withdrawalsEnabled: false });
  const status = c.req.query("status");
  if (
    status &&
    ![
      "REQUESTED",
      "IN_REVIEW",
      "APPROVED",
      "PROCESSING",
      "OTP_REQUIRED",
      "PAID",
      "FAILED",
      "REVERSED",
      "REQUIRES_REVIEW",
      "REJECTED",
      "CANCELLED",
    ].includes(status)
  )
    throw new AppError(400, "BAD_REQUEST", "Choose a valid withdrawal status.");
  const payouts = await database(c.env)
    .execute(sql`select p.id,p.university_id,p.agent_profile_id,p.requested_by_user_id,p.amount_kobo,p.status,p.requested_at,p.paid_at,p.provider_reference,p.financial_version,
 a.display_name,a.agent_type,s.provider,(select b.provider_failure_reason from app_private.bachs_payout_bridges b where b.payout_id=p.id) as provider_failure_reason,s.bank_net_kobo,s.payout_commission_kobo,s.fee_allowance_kobo,s.cost_recorded_kobo,s.provider_status,s.initiated_at,s.failure_release_journal_id is not null as returned_to_wallet,q.estimated_fee_kobo,b.bank_name,b.account_name,b.account_last4,
 q.expected_transfer_fee_kobo,q.expected_statutory_duty_kobo,q.transfer_fee_allowance_kobo,q.statutory_duty_allowance_kobo,q.minimum_withdrawal_kobo,q.statutory_duty_policy,
 s.statutory_duty_reserved_kobo,s.actual_statutory_duty_kobo,s.statutory_duty_source,s.last_verified_at,
 case when s.provider='BACHS' then (select b.actual_fee_kobo from app_private.bachs_payout_bridges b where b.payout_id=p.id) else (select o.fee_kobo from app_private.verified_payout_observations o where o.payout_id=p.id order by o.provider_updated_at desc,o.recorded_at desc limit 1) end as actual_transfer_fee_kobo,
 case when s.actual_statutory_duty_kobo is null then 'AWAITING_BALANCE_STATEMENT' else 'RECONCILED' end as statutory_duty_reconciliation,
 case when s.last_verified_at is not null then 'PAYSTACK_TRANSFER_VERIFY'::text end as transfer_fee_source,s.cost_recorded_kobo-q.expected_transfer_fee_kobo as transfer_fee_variance_kobo,
 s.actual_statutory_duty_kobo-q.expected_statutory_duty_kobo as statutory_duty_variance_kobo
 from public.payout_requests p join public.agent_profiles a on a.id=p.agent_profile_id
 left join app_private.agent_payout_settlements s on s.payout_id=p.id left join app_private.agent_payout_quotes q on q.id=s.quote_id
 left join app_private.payout_account_setups b on b.id=q.account_setup_id
 where (${scope}::uuid is null or p.university_id=${scope}::uuid) and (${status ?? null}::text is null or p.status=${status ?? null}) order by p.requested_at desc limit 100`);
  const availability=await payoutAvailability(c.env,true);
  return c.json({
    ready: true,
    withdrawalsEnabled:availability.enabled,
    withdrawalUnavailableReason:availability.reason,
    payouts: payouts.rows,
  });
});
payoutAdminRoutes.get("/:id/details",async c=>{
  const payoutId=id(c.req.param("id")),s=await scoped(c,payoutId,"finance.view");
  const payout=firstRow(await database(c.env).execute<{agent_profile_id:string;agent_type:string}>(sql`select p.agent_profile_id,a.agent_type from public.payout_requests p join public.agent_profiles a on a.id=p.agent_profile_id and a.university_id=p.university_id where p.id=${payoutId}::uuid and p.university_id=${s.university_id}::uuid`));
  if(!payout)throw new AppError(404,"NOT_FOUND","This agent record is unavailable.");
  const [profile,history,sales,balances]=await Promise.all([
    database(c.env).execute(sql`select id,user_id,display_name,agent_type,status,biography from public.agent_profiles where id=${payout.agent_profile_id}::uuid and university_id=${s.university_id}::uuid`),
    database(c.env).execute(sql`select t.id,t.reference_type,t.reference_id,t.description,t.created_at,
      sum(case when l.direction='CREDIT' then l.amount_kobo else -l.amount_kobo end)::bigint as available_change_kobo
      from public.ledger_transactions t join public.ledger_lines l on l.transaction_id=t.id join public.ledger_accounts a on a.id=l.account_id
      where a.university_id=${s.university_id}::uuid and a.owner_user_id=${s.user_id}::uuid and a.account_code=${payout.agent_type+'_AVAILABLE'}
      group by t.id order by t.created_at desc,t.id limit 100`),
    database(c.env).execute(sql`select o.id,o.status,o.earnings_state,o.created_at,o.subtotal_kobo,o.total_kobo,
      coalesce((select jsonb_agg(jsonb_build_object('name',p.name,'quantity',i.quantity,'unitPriceKobo',i.unit_price_kobo)) from public.order_items i join public.vendor_products p on p.id=i.product_id where i.order_id=o.id),'[]'::jsonb) as goods
      from public.orders o where o.vendor_profile_id=${payout.agent_profile_id}::uuid and o.university_id=${s.university_id}::uuid order by o.created_at desc limit 100`),
    database(c.env).execute(sql`select app_private.finance_balance(${s.university_id}::uuid,${s.user_id}::uuid,${payout.agent_type+'_AVAILABLE'}) as available_kobo,
      app_private.finance_balance(${s.university_id}::uuid,${s.user_id}::uuid,${payout.agent_type+'_PENDING'}) as pending_kobo,
      app_private.finance_balance(${s.university_id}::uuid,${s.user_id}::uuid,${payout.agent_type+'_PAYOUT_RESERVED'}) as reserved_kobo`),
  ]);
  return c.json({profile:firstRow(profile),balances:firstRow(balances),earningsHistory:history.rows,sales:sales.rows});
});
payoutAdminRoutes.post("/:id/duty-reconciliation", async (c) => {
  if (!(await payoutFeeComponentsReady(c.env))) throw new AppError(503, "FEATURE_DISABLED", "Separate duty reconciliation is awaiting the database update.");
  const payoutId = id(c.req.param("id"));
  const data = await input(c, z.object({
    actualDutyKobo: z.number().int().min(0).max(1_000_000),
    statementReference: z.string().trim().min(3).max(200),
    note: z.string().trim().min(10).max(2000),
  }).strict());
  const settlement = await scoped(c, payoutId, "finance.review");
  let result;
  try {
    result = firstRow(await database(c.env).execute<{ result: string }>(sql`select app_private.reconcile_payout_duty(${payoutId}::uuid,${settlement.university_id}::uuid,${data.actualDutyKobo}::bigint,${data.statementReference},${currentUser(c).id}::uuid,${data.note}) as result`))?.result;
  } catch (error) {
    if (error instanceof Error && error.message.includes("PAYOUT_DUTY_ALREADY_RECONCILED")) throw new AppError(409, "CONFLICT", "This statement duty observation is already sealed. Escalate a correction for finance review.");
    throw error;
  }
  if (result !== "RECONCILED") throw new AppError(409, "CONFLICT", "Verify a final transfer result before reviewing its statement duty.");
  await recordAudit(c.env, { actorUserId: currentUser(c).id, universityId: settlement.university_id, action: "payout.statutory_duty_reconciled", targetType: "payout_request", targetId: payoutId, requestId: c.get("requestId"), metadata: { ...data, source: "PAYSTACK_BALANCE_STATEMENT", variancePolicy: "PLATFORM_ABSORBS" } });
  return c.json({ status: result });
});
async function scoped(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  payoutId: string,
  permission: string,
) {
  if (!(await payoutFeeComponentsReady(c.env)))
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "Verified transfers are awaiting the database update.",
    );
  const s = firstRow(
    await database(c.env).execute<{
      university_id: string;
      user_id: string;
      provider_reference: string;
      bank_net_kobo: number;
      transfer_code: string | null;
      provider_mode: string;
      status: string;provider:string;
    }>(sql`
 select s.university_id,s.user_id,s.provider_reference,s.bank_net_kobo,s.transfer_code,s.provider_mode,p.status,s.provider from app_private.agent_payout_settlements s join public.payout_requests p on p.id=s.payout_id where s.payout_id=${payoutId}::uuid`),
  );
  if (!s)
    throw new AppError(
      404,
      "NOT_FOUND",
      "This withdrawal needs legacy reconciliation or is unavailable.",
    );
  await resolveAdminScope(c.env, currentUser(c), s.university_id, permission);
  return s;
}
async function saveAcknowledgement(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  payoutId: string,
  ack: { status: string; transferCode: string },
) {
  await database(c.env).execute(
    sql`update app_private.agent_payout_settlements set transfer_code=coalesce(transfer_code,${ack.transferCode}),provider_status=case when provider_status in('success','reversed','failed','abandoned','blocked','rejected') then provider_status else ${ack.status} end where payout_id=${payoutId}::uuid`,
  );
  await database(c.env).execute(
    sql`update public.payout_requests set status=${ack.status === "otp" ? "OTP_REQUIRED" : "PROCESSING"},updated_at=now()where id=${payoutId}::uuid and status in('APPROVED','PROCESSING','FAILED','OTP_REQUIRED')`,
  );
}
async function sendApprovedTransfer(c: Context<{ Bindings: Bindings; Variables: Variables }>, payoutId: string, autoVerify=false) {
  const s = await scoped(c, payoutId, "payouts.approve"),
    user = currentUser(c);
  await requireLedgerPayouts(c.env,s.provider);
  if (s.user_id === user.id)
    throw new AppError(
      403,
      "FORBIDDEN",
      "Another finance reviewer must transfer your withdrawal.",
    );
  if (s.provider_mode !== (s.provider==='BACHS'?bachsPayoutMode(c.env):transferMode(c.env)))
    throw new AppError(
      409,
      "CONFLICT",
      "The configured provider mode differs from this sealed bank account.",
    );
  await payoutRate(c.env, user.id, "PAYOUT_TRANSFER", 20);
  let transfer;
  try {
    transfer = firstRow(
      await database(c.env).execute<{
        provider_reference: string;
        bank_net_kobo: number;
        recipient_code: string;
      }>(
        sql`select * from app_private.prepare_ledger_transfer(${payoutId}::uuid,${s.university_id}::uuid)`,
      ),
    );
  } catch (e) {
    payoutError(e);
  }
  await recordAudit(c.env, {
    actorUserId: user.id,
    universityId: s.university_id,
    action: "payout.transfer_requested",
    targetType: "payout_request",
    targetId: payoutId,
    requestId: c.get("requestId"),
    metadata: { reference: s.provider_reference },
  });
  if(s.provider==='BACHS')return c.json(await sendBachsAgentPayout(c.env,payoutId));
  const ack = await initiatePaystackTransferOnce(c.env, {
    reference: transfer!.provider_reference,
    amountKobo: Number(transfer!.bank_net_kobo),
    recipientCode: transfer!.recipient_code,
  });
  await saveAcknowledgement(c, payoutId, ack);
  // Acknowledgements never mark money paid. Start an independent GET check
  // without delaying the admin response; the scheduler also recovers missed results.
  if(autoVerify){const verification = reconcilePayout(c.env, ack.reference, undefined, s.university_id).catch(()=>{
    console.error(JSON.stringify({level:"warn",event:"payout.initial_verification_pending"}));
  });
  try { c.executionCtx.waitUntil(verification); } catch { await verification; }}
  return c.json({status: ack.status === "otp" ? "OTP_REQUIRED" : "PROCESSING",reference: ack.reference});
}
payoutAdminRoutes.post("/:id/transfer", async c=>{
  await input(c,z.object({confirm:z.literal(true)}).strict());
  return sendApprovedTransfer(c,id(c.req.param("id")));
});
payoutAdminRoutes.post("/:id/approve",async c=>{
  const payoutId=id(c.req.param("id")),s=await scoped(c,payoutId,"payouts.approve"),user=currentUser(c);
  await requireLedgerPayouts(c.env,s.provider);
  const data=await input(c,z.object({confirm:z.literal(true),note:z.string().trim().max(1000).optional()}).strict());
  if(s.user_id===user.id)throw new AppError(403,"FORBIDDEN","Another reviewer must approve your withdrawal.");
  if(["REQUESTED","IN_REVIEW"].includes(s.status)){
    const note=data.note?.trim()||"Reviewer confirmed the earnings, saved bank account and exact quoted transfer amount.";
    const reviewed=firstRow(await database(c.env).execute<{state:string}>(sql`
      with decision as (select app_private.review_ledger_payout(${payoutId}::uuid,${s.university_id}::uuid,${user.id}::uuid,'APPROVED',${note}) as state),
      audited as (insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata)
      select ${user.id}::uuid,${s.university_id}::uuid,'payout.approved','payout_request',${payoutId},${c.get("requestId")??null},'succeeded',${JSON.stringify({confirmed:true,note,bankNetKobo:Number(s.bank_net_kobo),reference:s.provider_reference})}::jsonb from decision where state='APPROVED')
      select state from decision
    `));
    if(reviewed?.state!=="APPROVED")throw new AppError(409,"CONFLICT","This withdrawal changed. Refresh its status before approving.");
  }else if(["PAID","REVERSED"].includes(s.status))return c.json({status:s.status,reference:s.provider_reference});
  else if(!["APPROVED","PROCESSING"].includes(s.status))throw new AppError(409,"CONFLICT","This withdrawal cannot start another transfer. Review its saved provider result.");
  return sendApprovedTransfer(c,payoutId,true);
});
payoutAdminRoutes.post("/:id/check", async (c) => {
  const payoutId = id(c.req.param("id")),
    s = await scoped(c, payoutId, "finance.view");
  await reconcilePayout(
    c.env,
    s.provider_reference,
    undefined,
    s.university_id,
  );
  await recordAudit(c.env, {
    actorUserId: currentUser(c).id,
    universityId: s.university_id,
    action: "payout.verified",
    targetType: "payout_request",
    targetId: payoutId,
    requestId: c.get("requestId"),
  });
  return c.json({
    payout: firstRow(
      await database(c.env).execute(
        sql`select id,status,paid_at from public.payout_requests where id=${payoutId}::uuid`,
      ),
    ),
  });
});
payoutAdminRoutes.post("/:id/finalize", async (c) => {
  await requireLedgerPayouts(c.env);
  const payoutId = id(c.req.param("id")),
    s = await scoped(c, payoutId, "payouts.approve"),
    user = currentUser(c);
  if (s.user_id === user.id)
    throw new AppError(
      403,
      "FORBIDDEN",
      "Another reviewer must confirm your withdrawal.",
    );
  if (s.status !== "OTP_REQUIRED" || !s.transfer_code)
    throw new AppError(
      409,
      "CONFLICT",
      "This transfer is not awaiting confirmation.",
    );
  const data = await input(
    c,
    z.object({ otp: z.string().regex(/^\d{6,10}$/) }).strict(),
  );
  await payoutRate(c.env, user.id, "PAYOUT_OTP", 10);
  // OTP is used once in memory, never stored in audit or provider projections.
  const ack = await finalizePaystackTransferOnce(c.env, {
    reference: s.provider_reference,
    amountKobo: Number(s.bank_net_kobo),
    transferCode: s.transfer_code,
    otp: data.otp,
  });
  await saveAcknowledgement(c, payoutId, ack);
  await recordAudit(c.env, {
    actorUserId: user.id,
    universityId: s.university_id,
    action: "payout.otp_confirmed",
    targetType: "payout_request",
    targetId: payoutId,
    requestId: c.get("requestId"),
  });
  return c.json({ status: "PROCESSING" });
});
