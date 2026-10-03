import { Hono, type Context } from "hono";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { currentUser, requireAuth } from "../middleware/auth";
import { resolveAdminScope } from "../lib/admin-access";
import { database, firstRow } from "../lib/database";
import { recordAudit } from "../lib/audit";
import { input, id } from "../lib/input";
import { AppError } from "../lib/errors";
import { paystackRefundPolicy, verifyPaystackRefund } from "../lib/paystack-refunds";
import type { Bindings, Variables } from "../types";

type Env = {Bindings: Bindings;Variables: Variables};
type RefundRow = {
  id: string;university_id: string;buyer_user_id: string;status: string;
  provider_refund_id: string | null;original_reference: string;
  original_principal_kobo: number;original_collection_fee_kobo: number;customer_refund_kobo: number;
};
export const financeRefundRoutes = new Hono<Env>();
financeRefundRoutes.use("*", requireAuth);
const noteSchema = z.object({reviewNote: z.string().trim().min(10).max(2000)}).strict();

async function ready(c: Context<Env>) {
  const row = firstRow(await database(c.env).execute<{ready: boolean}>(sql`
    select to_regprocedure('app_private.record_verified_refund(uuid,uuid,uuid,text,text,text,bigint,text,timestamp with time zone)') is not null as ready
  `));
  if (!row?.ready) throw new AppError(503, "FEATURE_DISABLED", "Refund review is awaiting the verified accounting database update.");
}
async function scoped(c: Context<Env>, refundId: string, permission: string) {
  await ready(c);
  const r = firstRow(await database(c.env).execute<RefundRow>(sql`
    select id,university_id,buyer_user_id,status,provider_refund_id,original_reference,
      original_principal_kobo,original_collection_fee_kobo,customer_refund_kobo
    from app_private.verified_refund_requests where id=${refundId}::uuid
  `));
  if (!r) throw new AppError(404, "NOT_FOUND", "That refund request could not be found.");
  await resolveAdminScope(c.env, currentUser(c), r.university_id, permission);
  return r;
}
function refundError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (/REFUND_TENANT_MISMATCH|REFUND_INDEPENDENT_REVIEW_REQUIRED/.test(message))
    throw new AppError(403, "FORBIDDEN", "A different authorized finance reviewer must review this refund in its university scope.");
  if (/REFUND_NOT_FOUND/.test(message)) throw new AppError(404, "NOT_FOUND", "That refund request could not be found.");
  if (/REFUND_|verified_refund_one_original|verified_refund_requests_provider_refund_id_key/.test(message))
    throw new AppError(409, "CONFLICT", "This refund needs review against the original receipt, immutable price and approved policy before accounting can change.");
  throw error;
}
async function audit(c: Context<Env>, refundId: string, universityId: string, action: string, metadata?: Record<string, unknown>) {
  await recordAudit(c.env, {actorUserId: currentUser(c).id,universityId,action,
    targetType: "verified_refund_request",targetId: refundId,requestId: c.get("requestId"),
    ...(metadata ? {metadata} : {}),
  });
}

financeRefundRoutes.get("/refunds", async (c) => {
  const scope = await resolveAdminScope(c.env, currentUser(c), c.req.query("universityId"), "finance.view");
  await ready(c);
  const refunds = await database(c.env).execute(sql`
    select id,university_id,original_reference,resource_type,resource_id,currency,original_principal_kobo,
      customer_refund_kobo,original_collection_fee_kobo,collection_fee_treatment,collection_fee_returned_kobo,
      refund_processing_fee_kobo,fee_policy_source,seller_reversal_kobo,commission_reversal_kobo,
      delivery_refund_kobo,delivery_treatment,accounting_mode,status,reason,review_reason,provider_refund_id,
      provider_status,journal_id,requested_at,approved_at,completed_at
    from app_private.verified_refund_requests where (${scope}::uuid is null or university_id=${scope}::uuid)
    order by requested_at desc,id desc limit 100
  `);
  return c.json({refunds: refunds.rows,providerInitiation: "MANUAL_DASHBOARD",feePolicy: paystackRefundPolicy});
});
financeRefundRoutes.post("/refunds", async (c) => {
  const data = await input(c, z.object({
    universityId: z.string().uuid(),reference: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
    amountKobo: z.number().int().positive().max(2_000_000_000),requestId: z.string().uuid(),
    reason: z.string().trim().min(10).max(1000),
  }).strict());
  const actor = currentUser(c);
  await resolveAdminScope(c.env, actor, data.universityId, "finance.review");
  await ready(c);
  let refund;
  try {
    refund = firstRow(await database(c.env).execute<{id: string;status: string;review_reason: string|null}>(sql`
      select id,status,review_reason from app_private.create_verified_refund_request(${crypto.randomUUID()}::uuid,
        ${data.universityId}::uuid,${actor.id}::uuid,${data.requestId}::uuid,${data.reference},${data.amountKobo}::bigint,${data.reason})
    `));
  } catch (error) {refundError(error);}
  if (!refund) throw new AppError(409, "CONFLICT", "The original verified purchase snapshot is required.");
  await audit(c, refund.id, data.universityId, "finance.refund_requested", {reference: data.reference,status: refund.status});
  return c.json({refund,providerInitiation: "MANUAL_DASHBOARD"}, 201);
});
financeRefundRoutes.post("/refunds/:id/approve", async (c) => {
  const refundId = id(c.req.param("id")), r = await scoped(c, refundId, "finance.review");
  const data = await input(c, noteSchema.extend({confirm: z.literal(true)}).strict());
  let result;
  try {result = firstRow(await database(c.env).execute<{status: string}>(sql`
    select app_private.approve_verified_refund(${refundId}::uuid,${r.university_id}::uuid,${currentUser(c).id}::uuid,${data.reviewNote}) as status
  `));} catch (error) {refundError(error);}
  await audit(c, refundId, r.university_id, "finance.refund_approved");
  return c.json({status: result?.status,providerInitiation: "MANUAL_DASHBOARD"});
});
financeRefundRoutes.post("/refunds/:id/provider", async (c) => {
  const refundId = id(c.req.param("id")), r = await scoped(c, refundId, "finance.review");
  const data = await input(c, noteSchema.extend({providerRefundId: z.string().regex(/^[1-9][0-9]{0,19}$/)}).strict());
  let result;
  try {result = firstRow(await database(c.env).execute<{status: string}>(sql`
    select app_private.bind_verified_refund_provider(${refundId}::uuid,${r.university_id}::uuid,${currentUser(c).id}::uuid,${data.providerRefundId},${data.reviewNote}) as status
  `));} catch (error) {refundError(error);}
  await audit(c, refundId, r.university_id, "finance.refund_provider_bound", {providerRefundId: data.providerRefundId});
  return c.json({status: result?.status,verified: false});
});
financeRefundRoutes.post("/refunds/:id/check", async (c) => {
  const refundId = id(c.req.param("id")), r = await scoped(c, refundId, "finance.review");
  const actor = currentUser(c);
  if (r.buyer_user_id === actor.id) throw new AppError(403, "FORBIDDEN", "Another finance reviewer must reconcile your refund.");
  if (!r.provider_refund_id || !["PROVIDER_PENDING", "FAILED", "SUCCEEDED"].includes(r.status))
    throw new AppError(409, "CONFLICT", "Bind an approved Dashboard refund before checking its provider status.");
  const allowed = firstRow(await database(c.env).execute<{allowed: boolean}>(sql`
    select app_private.consume_request_rate_limit('FINANCE_REFUND_VERIFY',${actor.id},30,3600,3600) as allowed
  `));
  if (!allowed?.allowed) throw new AppError(429, "RATE_LIMITED", "Refund verification limit reached. Try again later.");
  const receipt = await verifyPaystackRefund(c.env, {
    providerRefundId: r.provider_refund_id,originalReference: r.original_reference,
    originalAmountKobo: Number(r.original_principal_kobo),originalFeeKobo: Number(r.original_collection_fee_kobo),
    customerRefundKobo: Number(r.customer_refund_kobo),
  });
  let result;
  try {result = firstRow(await database(c.env).execute<{status: string}>(sql`
    select app_private.record_verified_refund(${refundId}::uuid,${r.university_id}::uuid,${actor.id}::uuid,
      ${receipt.providerRefundId},${receipt.originalReference},${receipt.currency},${receipt.amountKobo}::bigint,
      ${receipt.status},${receipt.refundedAt}::timestamptz) as status
  `));} catch (error) {refundError(error);}
  await audit(c, refundId, r.university_id, "finance.refund_verified", {providerStatus: receipt.status,status: result?.status});
  return c.json({status: result?.status,providerStatus: receipt.status});
});
financeRefundRoutes.post("/refunds/:id/cancel", async (c) => {
  const refundId = id(c.req.param("id")), r = await scoped(c, refundId, "finance.review");
  const data = await input(c, noteSchema);
  let result;
  try {result = firstRow(await database(c.env).execute<{status: string}>(sql`
    select app_private.cancel_verified_refund(${refundId}::uuid,${r.university_id}::uuid,${currentUser(c).id}::uuid,${data.reviewNote}) as status
  `));} catch (error) {refundError(error);}
  await audit(c, refundId, r.university_id, "finance.refund_cancelled");
  return c.json({status: result?.status});
});
