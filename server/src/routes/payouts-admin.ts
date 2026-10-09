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
  ledgerPayoutsReady,
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
 a.display_name,a.agent_type,s.bank_net_kobo,s.fee_allowance_kobo,s.cost_recorded_kobo,s.provider_status,s.initiated_at,s.failure_release_journal_id is not null as returned_to_wallet,q.estimated_fee_kobo,b.bank_name,b.account_last4,
 q.expected_transfer_fee_kobo,q.expected_statutory_duty_kobo,q.transfer_fee_allowance_kobo,q.statutory_duty_allowance_kobo,q.minimum_withdrawal_kobo,q.statutory_duty_policy,
 s.statutory_duty_reserved_kobo,s.actual_statutory_duty_kobo,s.statutory_duty_source,s.last_verified_at,
 (select o.fee_kobo from app_private.verified_payout_observations o where o.payout_id=p.id order by o.provider_updated_at desc,o.recorded_at desc limit 1) as actual_transfer_fee_kobo,
 case when s.actual_statutory_duty_kobo is null then 'AWAITING_BALANCE_STATEMENT' else 'RECONCILED' end as statutory_duty_reconciliation,
 case when s.last_verified_at is not null then 'PAYSTACK_TRANSFER_VERIFY'::text end as transfer_fee_source,s.cost_recorded_kobo-q.expected_transfer_fee_kobo as transfer_fee_variance_kobo,
 s.actual_statutory_duty_kobo-q.expected_statutory_duty_kobo as statutory_duty_variance_kobo
 from public.payout_requests p join public.agent_profiles a on a.id=p.agent_profile_id
 left join app_private.agent_payout_settlements s on s.payout_id=p.id left join app_private.agent_payout_quotes q on q.id=s.quote_id
 left join app_private.payout_account_setups b on b.id=q.account_setup_id
 where (${scope}::uuid is null or p.university_id=${scope}::uuid) and (${status ?? null}::text is null or p.status=${status ?? null}) order by p.requested_at desc limit 100`);
  return c.json({
    ready: true,
    withdrawalsEnabled:
      c.env.PAYOUTS_ENABLED === "true" && c.env.PAYMENTS_ENABLED === "true",
    payouts: payouts.rows,
  });
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
  if (!(await ledgerPayoutsReady(c.env)))
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
      status: string;
    }>(sql`
 select s.university_id,s.user_id,s.provider_reference,s.bank_net_kobo,s.transfer_code,s.provider_mode,p.status from app_private.agent_payout_settlements s join public.payout_requests p on p.id=s.payout_id where s.payout_id=${payoutId}::uuid`),
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
    sql`update app_private.agent_payout_settlements set transfer_code=coalesce(transfer_code,${ack.transferCode}),provider_status=${ack.status} where payout_id=${payoutId}::uuid`,
  );
  await database(c.env).execute(
    sql`update public.payout_requests set status=${ack.status === "otp" ? "OTP_REQUIRED" : "PROCESSING"},updated_at=now()where id=${payoutId}::uuid and status in('APPROVED','PROCESSING','FAILED','OTP_REQUIRED')`,
  );
}
payoutAdminRoutes.post("/:id/transfer", async (c) => {
  await requireLedgerPayouts(c.env);
  const payoutId = id(c.req.param("id")),
    s = await scoped(c, payoutId, "payouts.approve"),
    user = currentUser(c);
  if (s.user_id === user.id)
    throw new AppError(
      403,
      "FORBIDDEN",
      "Another finance reviewer must transfer your withdrawal.",
    );
  if (s.provider_mode !== transferMode(c.env))
    throw new AppError(
      409,
      "CONFLICT",
      "The configured provider mode differs from this sealed bank account.",
    );
  await input(c, z.object({ confirm: z.literal(true) }).strict());
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
  const ack = await initiatePaystackTransferOnce(c.env, {
    reference: transfer!.provider_reference,
    amountKobo: Number(transfer!.bank_net_kobo),
    recipientCode: transfer!.recipient_code,
  });
  await saveAcknowledgement(c, payoutId, ack);
  return c.json({
    status: ack.status === "otp" ? "OTP_REQUIRED" : "PROCESSING",
    reference: ack.reference,
  });
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
