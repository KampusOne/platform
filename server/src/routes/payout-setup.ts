import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import type { Bindings, Variables } from "../types";
import { currentUser, requireAuth } from "../middleware/auth";
import { database, firstRow, sqlClient } from "../lib/database";
import { AppError } from "../lib/errors";
import { input } from "../lib/input";
import { requireAgentIdentity, requireFullKyc } from "../lib/kyc";
import { resolveAdminScope } from "../lib/admin-access";
import {
  accountRequestHash,
  compareBankName,
  listNigerianBanks,
  requirePayoutProvider,
  resolvePayoutAccount,
} from "../lib/payout-provider";

export const payoutSetupRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();
payoutSetupRoutes.use("*", requireAuth);
payoutSetupRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  await next();
});
const accountFields = sql`id,agent_profile_id,status,bank_code,bank_name,account_name,account_last4,name_match,review_note,provider_mode,created_at`;
async function accountById(env: Bindings, id: string) {
  return firstRow(
    await database(env).execute(
      sql`select ${accountFields} from app_private.payout_account_setups where id=${id}::uuid`,
    ),
  );
}

payoutSetupRoutes.get("/", async (c) => {
  const user = currentUser(c),
    db = database(c.env);
  const profiles = await db.execute<{
    id: string;
    agent_type: string;
    display_name: string;
    university_id: string;
    bank_status: string;
  }>(
    sql`select p.id,p.agent_type,p.display_name,p.university_id,a.bank_status from public.agent_profiles p join public.agent_applications a on a.id=p.application_id where p.user_id=${user.id}::uuid and p.status='ACTIVE' and a.status='APPROVED' order by p.created_at`,
  );
  const records = await db.execute<
    Record<string, unknown> & { agent_profile_id: string }
  >(
    sql`select distinct on(agent_profile_id) ${accountFields} from app_private.payout_account_setups where user_id=${user.id}::uuid and status not in('SUPERSEDED','FAILED') order by agent_profile_id,created_at desc`,
  );
  return c.json({
    profiles: profiles.rows.map((profile) => ({
      ...profile,
      account:
        records.rows.find(
          (account) => account.agent_profile_id === profile.id,
        ) ?? null,
    })),
    providerAvailable:
      c.env.PAYMENTS_ENABLED === "true" &&
      Boolean(c.env.PAYSTACK_SECRET_KEY && c.env.KYC_FINGERPRINT_SECRET),
  });
});
payoutSetupRoutes.get("/banks", async (c) => {
  const user = currentUser(c);
  if (
    !firstRow(
      await database(c.env).execute(
        sql`select id from public.agent_profiles where user_id=${user.id}::uuid and status='ACTIVE' limit 1`,
      ),
    )
  )
    throw new AppError(
      403,
      "FORBIDDEN",
      "An approved agent profile is required.",
    );
  const rate = firstRow(
    await database(c.env).execute<{ allowed: boolean }>(
      sql`select app_private.consume_request_rate_limit('PAYOUT_BANK_LIST',${user.id},20,3600,3600) allowed`,
    ),
  );
  if (!rate?.allowed)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "The bank list has been requested too often. Please try again later.",
    );
  return c.json({ banks: await listNigerianBanks(c.env) });
});
payoutSetupRoutes.post("/resolve", async (c) => {
  const user = currentUser(c),
    db = database(c.env),
    providerMode = requirePayoutProvider(c.env);
  const d = await input(
    c,
    z.object({
      agentProfileId: z.string().uuid(),
      bankCode: z.string().regex(/^[0-9]{3,20}$/),
      accountNumber: z.string().regex(/^[0-9]{10}$/),
      requestId: z.string().uuid(),
      authorizedAccount: z.literal(true),
    }),
  );
  const hash = await accountRequestHash(
    c.env,
    JSON.stringify([user.id, d.agentProfileId, d.bankCode, d.accountNumber]),
  );
  await db.execute(
    sql`update app_private.payout_account_setups set status='FAILED',updated_at=now() where user_id=${user.id}::uuid and agent_profile_id=${d.agentProfileId}::uuid and status='RESOLVING' and updated_at<now()-interval '2 minutes'`,
  );
  const previous = firstRow(
    await db.execute<{ user_id: string; request_hash: string; status: string }>(
      sql`select user_id,request_hash,status from app_private.payout_account_setups where id=${d.requestId}::uuid`,
    ),
  );
  if (previous) {
    if (previous.user_id !== user.id || previous.request_hash !== hash)
      throw new AppError(
        409,
        "CONFLICT",
        "That request identifier was already used. Start a new account setup.",
      );
    if (previous.status === "RESOLVING")
      throw new AppError(
        409,
        "CONFLICT",
        "This account verification is already in progress.",
      );
    if (previous.status === "FAILED")
      throw new AppError(
        409,
        "CONFLICT",
        "That verification did not complete. Start a new attempt.",
        { restartRequired: true },
      );
    return c.json({ account: await accountById(c.env, d.requestId) });
  }
  const profile = firstRow(
    await db.execute<{
      application_id: string;
      university_id: string;
      legal_name: string;
    }>(
      sql`select p.application_id,p.university_id,a.legal_name from public.agent_profiles p join public.agent_applications a on a.id=p.application_id where p.id=${d.agentProfileId}::uuid and p.user_id=${user.id}::uuid and p.status='ACTIVE' and a.status='APPROVED'`,
    ),
  );
  if (!profile)
    throw new AppError(403, "FORBIDDEN", "Choose your approved agent profile.");
  await requireAgentIdentity(c.env, profile.application_id);
  if (
    firstRow(
      await db.execute(
        sql`select id from public.payout_requests where agent_profile_id=${d.agentProfileId}::uuid and status in('REQUESTED','IN_REVIEW','APPROVED','PROCESSING','FAILED') limit 1`,
      ),
    )
  )
    throw new AppError(
      409,
      "CONFLICT",
      "Wait for your pending payout to be resolved before changing its destination.",
    );
  const rate = firstRow(
    await db.execute<{ allowed: boolean }>(
      sql`select app_private.consume_request_rate_limit('PAYOUT_ACCOUNT',${user.id},5,86400,86400) allowed`,
    ),
  );
  if (!rate?.allowed)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Your account verification limit has been reached. Try again tomorrow.",
    );
  const reserved = firstRow(
    await db.execute(
      sql`insert into app_private.payout_account_setups(id,user_id,agent_profile_id,application_id,institution_id,request_hash,status,bank_code,provider_mode) values(${d.requestId}::uuid,${user.id}::uuid,${d.agentProfileId}::uuid,${profile.application_id}::uuid,${profile.university_id}::uuid,${hash},'RESOLVING',${d.bankCode},${providerMode}) on conflict do nothing returning id`,
    ),
  );
  if (!reserved)
    throw new AppError(
      409,
      "CONFLICT",
      "An account verification is already in progress.",
    );
  try {
    const resolved = await resolvePayoutAccount(
      c.env,
      d.bankCode,
      d.accountNumber,
    );
    const match = compareBankName(profile.legal_name ?? "", resolved.name);
    const client = sqlClient(c.env);
    // Transaction takes the same profile lock as payout requests, then ensures no
    // payout was reserved while the external bank request was in flight.
    await client.transaction([
      client`select id from public.agent_profiles where id=${d.agentProfileId}::uuid for update`,
      client`update app_private.payout_account_setups set status='PENDING_REVIEW',bank_name=${resolved.bankName},account_name=${resolved.name},account_last4=${resolved.last4},recipient_code=${resolved.recipientCode},name_match=${match},updated_at=now() where id=${d.requestId}::uuid and status='RESOLVING' and exists(select 1 from public.agent_profiles p join public.agent_applications a on a.id=p.application_id where p.id=${d.agentProfileId}::uuid and p.status='ACTIVE' and a.status='APPROVED') and not exists(select 1 from public.payout_requests where agent_profile_id=${d.agentProfileId}::uuid and status in('REQUESTED','IN_REVIEW','APPROVED','PROCESSING','FAILED'))`,
      client`update app_private.payout_account_setups set status='SUPERSEDED',updated_at=now() where agent_profile_id=${d.agentProfileId}::uuid and id<>${d.requestId}::uuid and status not in('RESOLVING','FAILED','SUPERSEDED') and exists(select 1 from app_private.payout_account_setups where id=${d.requestId}::uuid and status='PENDING_REVIEW') and not exists(select 1 from public.payout_requests where agent_profile_id=${d.agentProfileId}::uuid and status in('REQUESTED','IN_REVIEW','APPROVED','PROCESSING','FAILED'))`,
      client`update public.agent_applications set bank_status='PENDING',bank_provider='PAYSTACK',bank_recipient_code=null,bank_account_name=${resolved.name},bank_account_last4=${resolved.last4},updated_at=now() where id=${profile.application_id}::uuid and exists(select 1 from app_private.payout_account_setups where id=${d.requestId}::uuid and status='PENDING_REVIEW')`,
      client`insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata) select ${user.id}::uuid,${profile.university_id}::uuid,'payout.account_resolved','payout_account',${d.requestId},${c.get("requestId") ?? null},'succeeded',${JSON.stringify({ nameMatch: match, providerMode })}::jsonb where exists(select 1 from app_private.payout_account_setups where id=${d.requestId}::uuid and status='PENDING_REVIEW')`,
    ]);
    const account = await accountById(c.env, d.requestId);
    if (account?.status !== "PENDING_REVIEW")
      throw new AppError(
        409,
        "CONFLICT",
        "Your agent or payout status changed. Review it before trying again.",
      );
    return c.json({ account }, 201);
  } catch (caught) {
    await db.execute(
      sql`update app_private.payout_account_setups set status='FAILED',updated_at=now() where id=${d.requestId}::uuid and status='RESOLVING'`,
    );
    if (caught instanceof AppError) {
      throw new AppError(caught.status, caught.code, caught.message, {
        ...caught.details,
        restartRequired: true,
      });
    }
    throw caught;
  }
});

payoutSetupRoutes.get("/review", async (c) => {
  const user = currentUser(c),
    scope = await resolveAdminScope(
      c.env,
      user,
      c.req.query("universityId"),
      "finance.review",
    );
  const status = c.req.query("status") ?? "PENDING_REVIEW";
  if (!["PENDING_REVIEW", "APPROVED", "REJECTED"].includes(status))
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Choose a valid payout setup status.",
    );
  const offset = Math.max(
    0,
    Math.min(100000, Number(c.req.query("offset") ?? 0) || 0),
  );
  const rows = await database(c.env).execute<
    Record<string, unknown> & {
      application_id: string;
      provider_mode: string;
      status: string;
    }
  >(
    sql`select s.id,s.agent_profile_id,s.application_id,s.status,s.bank_code,s.bank_name,s.account_name,s.account_last4,s.name_match,s.review_note,s.provider_mode,s.created_at,p.display_name,p.agent_type,p.status profile_status,a.status application_status,u.status::text owner_status,s.institution_id university_id,a.legal_name from app_private.payout_account_setups s join public.agent_profiles p on p.id=s.agent_profile_id join public.agent_applications a on a.id=s.application_id join public.users u on u.id=s.user_id where s.status=${status} and (${scope}::uuid is null or s.institution_id=${scope}::uuid) order by s.created_at desc limit 50 offset ${offset}`,
  );
  const accounts = await Promise.all(
    rows.rows.map(async (row) => {
      let eligible = false;
      if (
        row.status === "APPROVED" &&
        row.provider_mode === "live" &&
        row.profile_status === "ACTIVE" &&
        row.application_status === "APPROVED" &&
        row.owner_status === "ACTIVE" &&
        c.env.PAYMENTS_ENABLED === "true" &&
        c.env.PAYSTACK_SECRET_KEY?.startsWith("sk_live_")
      ) {
        try {
          await requireFullKyc(c.env, row.application_id);
          eligible = true;
        } catch {
          eligible = false;
        }
      }
      const { application_id, ...safe } = row;
      return { ...safe, payout_eligible: eligible };
    }),
  );
  return c.json({ accounts, offset, limit: 50 });
});
payoutSetupRoutes.post("/:id/review", async (c) => {
  const user = currentUser(c),
    id = z.string().uuid().safeParse(c.req.param("id"));
  if (!id.success)
    throw new AppError(400, "BAD_REQUEST", "Choose a valid payout setup.");
  const d = await input(
    c,
    z.object({
      decision: z.enum(["APPROVED", "REJECTED"]),
      reason: z.string().trim().min(12).max(1500),
      ownershipConfirmed: z.boolean().optional(),
    }),
  );
  const db = database(c.env);
  const account = firstRow(
    await db.execute<{
      user_id: string;
      application_id: string;
      institution_id: string;
      agent_profile_id: string;
      provider_mode: string;
    }>(
      sql`select user_id,application_id,institution_id,agent_profile_id,provider_mode from app_private.payout_account_setups where id=${id.data}::uuid`,
    ),
  );
  if (!account)
    throw new AppError(404, "NOT_FOUND", "That payout setup was not found.");
  await resolveAdminScope(
    c.env,
    user,
    account.institution_id,
    "finance.review",
  );
  if (account.user_id === user.id)
    throw new AppError(
      403,
      "FORBIDDEN",
      "Another authorized reviewer must review your payout details.",
    );
  if (d.decision === "APPROVED") {
    if (!d.ownershipConfirmed)
      throw new AppError(
        400,
        "BAD_REQUEST",
        "Confirm independent ownership evidence before approving this bank account.",
      );
    await requireAgentIdentity(c.env, account.application_id);
  }
  const verified =
    d.decision === "APPROVED" && account.provider_mode === "live";
  const client = sqlClient(c.env);
  const reviewed = await client.transaction([
    client`select id from public.agent_profiles where id=${account.agent_profile_id}::uuid for update`,
    client`with reviewed as (
  update app_private.payout_account_setups s set status=${d.decision},review_note=${d.reason},reviewed_by=${user.id}::uuid,reviewed_at=now(),updated_at=now()
  where s.id=${id.data}::uuid and s.status='PENDING_REVIEW' and not exists(select 1 from public.payout_requests where agent_profile_id=s.agent_profile_id and status in('REQUESTED','IN_REVIEW','APPROVED','PROCESSING','FAILED')) and exists(select 1 from public.agent_profiles p join public.agent_applications a on a.id=p.application_id where p.id=s.agent_profile_id and p.status='ACTIVE' and a.status='APPROVED') returning *
 ), linked as (
  update public.agent_applications a set bank_status=${verified ? "VERIFIED" : d.decision === "REJECTED" ? "REJECTED" : "PENDING"},bank_provider='PAYSTACK',bank_recipient_code=case when ${verified} then reviewed.recipient_code else null end,bank_account_name=reviewed.account_name,bank_account_last4=reviewed.account_last4,updated_at=now() from reviewed where a.id=reviewed.application_id returning a.id
 ), audited as (
  insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata) select ${user.id}::uuid,reviewed.institution_id,'payout.account_reviewed','payout_account',reviewed.id::text,${c.get("requestId") ?? null},'succeeded',${JSON.stringify({ decision: d.decision, reason: d.reason, ownershipConfirmed: d.ownershipConfirmed === true, providerMode: account.provider_mode })}::jsonb from reviewed returning id
 ) select reviewed.id from reviewed where exists(select 1 from linked) and exists(select 1 from audited)`,
  ]);
  if (!reviewed[1]?.length)
    throw new AppError(
      409,
      "CONFLICT",
      "This setup changed, has a pending payout, or was already reviewed. Reload before continuing.",
    );
  return c.json({ account: await accountById(c.env, id.data) });
});
