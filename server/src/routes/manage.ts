import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { database, firstRow, sqlClient } from "../lib/database";
import { id, input } from "../lib/input";
import { AppError } from "../lib/errors";
import { recordAudit } from "../lib/audit";
import { identityFingerprint } from "../lib/identity-fingerprint";
import { currentUser, requireAuth } from "../middleware/auth";
import type { Bindings, Variables } from "../types";
export const manageRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();
manageRoutes.use("/*", requireAuth);
manageRoutes.use("/*", async (c, next) => {
  const user = currentUser(c);
  if (user.operatorRoles.includes("PLATFORM_ADMIN")) return next();
  const match = c.req.path.match(
    /^\/v1\/manage\/applications\/([0-9a-f-]{36})\/(documents|identity|guardian)$/,
  );
  if (match) {
    const grant = firstRow(
      await database(c.env).execute(
        sql`select o.id from public.operator_roles o join public.agent_applications a on a.university_id=o.university_id where a.id=${match[1]!}::uuid and o.user_id=${user.id}::uuid and o.role='VERIFICATION_REVIEWER' and(o.expires_at is null or o.expires_at>now()) limit 1`,
      ),
    );
    if (grant) return next();
  }
  throw new AppError(
    403,
    "FORBIDDEN",
    "Your administrator role cannot perform this action.",
  );
});
manageRoutes.get("/communities", async (c) => {
  const scope = c.req.query("universityId")
    ? id(c.req.query("universityId")!)
    : null;
  const r = await database(c.env).execute(
    sql`select cc.id,cc.name,cc.institution_id,cc.admission_year,cc.level_code current_level,cc.rep_user_id,cc.archived_at,(select count(*)::int from public.community_members where community_id=cc.id) members from public.cohort_communities cc where (${scope}::uuid is null or cc.institution_id=${scope}::uuid) order by cc.admission_year desc,cc.name limit 200`,
  );
  return c.json({ rows: r.rows });
});
manageRoutes.post("/communities", async (c) => {
  const d = await input(
    c,
    z.object({
      institutionId: z.string().uuid(),
      departmentId: z.string().uuid(),
      admissionYear: z.number().int().min(2000).max(2100),
      levelCode: z.string().trim().min(1).max(30),
      name: z.string().trim().min(3).max(160),
    }),
  );
  const r = await database(c.env).execute(
    sql`insert into public.cohort_communities(institution_id,department_id,admission_year,level_code,name) select ${d.institutionId}::uuid,dep.id,${d.admissionYear},${d.levelCode},${d.name} from public.departments dep join public.faculties f on f.id=dep.faculty_id where dep.id=${d.departmentId}::uuid and f.university_id=${d.institutionId}::uuid and dep.deleted_at is null on conflict(institution_id,department_id,admission_year) do nothing returning id`,
  );
  if (!firstRow(r))
    throw new AppError(
      409,
      "CONFLICT",
      "Choose a department in this university and a new admission year.",
    );
  await recordAudit(c.env, {
    actorUserId: currentUser(c).id,
    action: "community.created",
    targetType: "community",
    targetId: String(firstRow(r)?.id),
    requestId: c.get("requestId"),
  });
  return c.json(firstRow(r), 201);
});
manageRoutes.get("/communities/:id", async (c) => {
  const target = id(c.req.param("id")),
    db = database(c.env);
  const [community, members, elections, transfers] = await Promise.all([
    db.execute(
      sql`select * from public.cohort_communities where id=${target}::uuid`,
    ),
    db.execute(
      sql`select m.user_id,m.verified_at,p.display_name,p.username,p.matriculation_number,p.current_level from public.community_members m join public.profiles p on p.user_id=m.user_id where m.community_id=${target}::uuid order by m.joined_at limit 500`,
    ),
    db.execute(
      sql`select e.*,p.display_name winner_name from public.community_elections e left join public.profiles p on p.user_id=e.winner_user_id where e.community_id=${target}::uuid order by e.created_at desc limit 10`,
    ),
    db.execute(
      sql`select t.*,p.username from public.community_rep_transfers t join public.profiles p on p.user_id=t.to_user_id where t.community_id=${target}::uuid and t.status in ('PENDING','ACCEPTED')`,
    ),
  ]);
  if (!firstRow(community))
    throw new AppError(404, "NOT_FOUND", "Community not found.");
  await recordAudit(c.env, {
    actorUserId: currentUser(c).id,
    action: "community.members.viewed",
    targetType: "community",
    targetId: target,
    requestId: c.get("requestId"),
  });
  return c.json({
    community: firstRow(community),
    members: members.rows,
    elections: elections.rows,
    transfers: transfers.rows,
  });
});
manageRoutes.patch("/communities/:id", async (c) => {
  const d = await input(
    c,
    z.object({
      levelCode: z.string().trim().min(1).max(30),
      archive: z.boolean(),
      reason: z.string().trim().min(3).max(1000),
    }),
  );
  await database(c.env).execute(
    sql`update public.cohort_communities set level_code=${d.levelCode},archived_at=case when ${d.archive} then coalesce(archived_at,now()) else null end where id=${id(c.req.param("id"))}::uuid`,
  );
  await recordAudit(c.env, {
    actorUserId: currentUser(c).id,
    action: "community.updated",
    targetType: "community",
    targetId: c.req.param("id"),
    requestId: c.get("requestId"),
    metadata: d,
  });
  return c.json({ status: "saved" });
});
manageRoutes.post("/communities/:id/members/:userId/verify", async (c) => {
  const d = await input(
    c,
    z.object({ evidence: z.string().trim().min(20).max(2000) }),
  );
  const r = await database(c.env).execute(
    sql`update public.community_members m set verified_at=now(),verified_by=${currentUser(c).id}::uuid from public.profiles p,public.cohort_communities cc where m.community_id=${id(c.req.param("id"))}::uuid and m.user_id=${id(c.req.param("userId"))}::uuid and p.user_id=m.user_id and cc.id=m.community_id and cc.archived_at is null and p.department_id=cc.department_id and p.university_id=cc.institution_id and nullif(trim(p.matriculation_number),'') is not null returning m.user_id`,
  );
  if (!firstRow(r))
    throw new AppError(
      409,
      "CONFLICT",
      "Check the student’s university, department and matriculation number.",
    );
  await recordAudit(c.env, {
    actorUserId: currentUser(c).id,
    action: "community.member.verified",
    targetType: "community",
    targetId: c.req.param("id"),
    requestId: c.get("requestId"),
    metadata: { memberId: c.req.param("userId"), evidence: d.evidence },
  });
  return c.json({ status: "verified" });
});
manageRoutes.post("/communities/:id/elections", async (c) => {
  const d = await input(
    c,
    z.object({
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
    }),
  );
  if (
    new Date(d.endsAt).getTime() <=
      Math.max(Date.now(), new Date(d.startsAt).getTime()) ||
    new Date(d.endsAt).getTime() - new Date(d.startsAt).getTime() >
      90 * 86400000
  )
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Choose a voting window of up to 90 days.",
    );
  const r = await database(c.env).execute(
    sql`insert into public.community_elections(community_id,starts_at,ends_at,created_by) select id,${d.startsAt}::timestamptz,${d.endsAt}::timestamptz,${currentUser(c).id}::uuid from public.cohort_communities where id=${id(c.req.param("id"))}::uuid and archived_at is null on conflict do nothing returning id`,
  );
  if (!firstRow(r))
    throw new AppError(
      409,
      "CONFLICT",
      "Resolve the existing election before starting another.",
    );
  await recordAudit(c.env, {
    actorUserId: currentUser(c).id,
    action: "community.election.scheduled",
    targetType: "community",
    targetId: c.req.param("id"),
    requestId: c.get("requestId"),
    metadata: d,
  });
  return c.json(firstRow(r), 201);
});
manageRoutes.patch("/communities/:id/elections/:electionId", async (c) => {
  const d = await input(
    c,
    z.object({
      action: z.enum(["CANCEL", "END"]),
      reason: z.string().trim().min(3).max(1000),
    }),
  );
  const target = id(c.req.param("electionId"));
  const r = await database(c.env).execute(
    sql`update public.community_elections set status=case when ${d.action}='CANCEL' then 'CANCELLED' else status end,ends_at=case when ${d.action}='END' then greatest(starts_at+interval '1 millisecond',now()) else ends_at end where id=${target}::uuid and community_id=${id(c.req.param("id"))}::uuid and status='SCHEDULED' and (${d.action}='CANCEL' or starts_at<now()) returning id`,
  );
  if (!firstRow(r))
    throw new AppError(409, "CONFLICT", "That election cannot be changed.");
  if (d.action === "END")
    await database(c.env).execute(
      sql`select app_private.finalize_community_election(${target}::uuid)`,
    );
  await recordAudit(c.env, {
    actorUserId: currentUser(c).id,
    action: "community.election." + d.action.toLowerCase(),
    targetType: "community_election",
    targetId: target,
    requestId: c.get("requestId"),
    metadata: d,
  });
  return c.json({ status: "saved" });
});
manageRoutes.post("/communities/:id/transfers/:transferId", async (c) => {
  const d = await input(
    c,
    z.object({
      approve: z.boolean(),
      reason: z.string().trim().min(3).max(1000),
    }),
  );
  const r = await database(c.env).execute(
    sql`with changed as(update public.community_rep_transfers t set status=case when ${d.approve} then 'APPROVED' else 'CANCELLED' end,approved_by=${currentUser(c).id}::uuid from public.cohort_communities cc,public.community_members m,public.profiles p where t.id=${id(c.req.param("transferId"))}::uuid and cc.id=t.community_id and cc.id=${id(c.req.param("id"))}::uuid and t.status in ('PENDING','ACCEPTED') and (not ${d.approve} or(t.status='ACCEPTED' and cc.rep_user_id=t.from_user_id and cc.archived_at is null)) and m.community_id=cc.id and m.user_id=t.to_user_id and m.verified_at is not null and p.user_id=m.user_id and p.university_id=cc.institution_id and p.department_id=cc.department_id returning t.community_id,t.to_user_id) update public.cohort_communities cc set rep_user_id=case when ${d.approve} then changed.to_user_id else cc.rep_user_id end from changed where cc.id=changed.community_id returning cc.id`,
  );
  if (!firstRow(r))
    throw new AppError(
      409,
      "CONFLICT",
      "The recipient must accept a valid transfer before approval.",
    );
  await recordAudit(c.env, {
    actorUserId: currentUser(c).id,
    action: "community.rep.transfer.reviewed",
    targetType: "community",
    targetId: c.req.param("id"),
    requestId: c.get("requestId"),
    metadata: d,
  });
  return c.json({ status: "saved" });
});
manageRoutes.get("/universities", async (c) => {
  const r = await database(c.env).execute(
    sql`select u.id,u.name,u.slug,coalesce(cfg.status,'CATALOGUED') status,(select count(*)::int from public.profiles p where p.university_id=u.id and p.deleted_at is null) users,(select count(*)::int from public.agent_profiles a where a.university_id=u.id and a.status='ACTIVE') agents from public.universities u left join public.institution_config cfg on cfg.institution_id=u.id where u.deleted_at is null order by u.name limit 500`,
  );
  return c.json({ rows: r.rows });
});
manageRoutes.post("/universities", async (c) => {
  const d = await input(
    c,
    z.object({
      name: z.string().trim().min(3).max(160),
      slug: z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .max(180),
      status: z.enum(["CATALOGUED", "PREPARING", "LIVE", "PAUSED"]),
    }),
  );
  const r = await database(c.env).execute(
    sql`with school as(insert into public.universities(id,name,slug,updated_at) values(gen_random_uuid(),${d.name},${d.slug},now()) returning id) insert into public.institution_config(institution_id,status) select id,${d.status} from school returning institution_id`,
  );
  await recordAudit(c.env, {
    actorUserId: currentUser(c).id,
    action: "university.created",
    targetType: "university",
    targetId: String(firstRow(r)?.institution_id),
    requestId: c.get("requestId"),
  });
  return c.json(firstRow(r), 201);
});
manageRoutes.patch("/universities/:id", async (c) => {
  const d = await input(
    c,
    z.object({ status: z.enum(["CATALOGUED", "PREPARING", "LIVE", "PAUSED"]) }),
  );
  await database(c.env).execute(
    sql`insert into public.institution_config(institution_id,status) values(${id(c.req.param("id"))}::uuid,${d.status}) on conflict(institution_id) do update set status=excluded.status,updated_at=now()`,
  );
  await recordAudit(c.env, {
    actorUserId: currentUser(c).id,
    action: "university.status.updated",
    targetType: "university",
    targetId: c.req.param("id"),
    requestId: c.get("requestId"),
    metadata: d,
  });
  return c.json({ status: "saved" });
});
manageRoutes.get("/trials", async (c) => {
  const scope = c.req.query("universityId")
    ? id(c.req.query("universityId")!)
    : null;
  const filter = c.req.query("status") ?? "ALL";
  const r = await database(c.env).execute(
    sql`with trials as(select t.id,t.user_id,t.institution_id,p.display_name,u.email,t.claimed_at,t.expires_at,t.revoked_at,case when t.revoked_at is not null then 'REVOKED' when t.expires_at<=now() then 'EXPIRED' when t.expires_at<now()+interval '30 days' then 'EXPIRING' else 'ACTIVE' end status from public.agent_trials t join public.users u on u.id=t.user_id left join public.profiles p on p.user_id=u.id) select * from trials where (${scope}::uuid is null or institution_id=${scope}::uuid) and (${filter}='ALL' or status=${filter}) order by claimed_at desc limit 100`,
  );
  return c.json({ rows: r.rows });
});
manageRoutes.post("/trials/:id/revoke", async (c) => {
  const d = await input(
    c,
    z.object({ reason: z.string().trim().min(3).max(1000) }),
  );
  await database(c.env).execute(
    sql`update public.agent_trials set revoked_at=now(),revoked_by=${currentUser(c).id}::uuid,reason=${d.reason} where id=${id(c.req.param("id"))}::uuid and revoked_at is null`,
  );
  await recordAudit(c.env, {
    actorUserId: currentUser(c).id,
    action: "agent.trial.revoked",
    targetType: "agent_trial",
    targetId: c.req.param("id"),
    requestId: c.get("requestId"),
    metadata: d,
  });
  return c.json({ status: "revoked" });
});
manageRoutes.get("/support", async (c) => {
  const scope = c.req.query("universityId")
    ? id(c.req.query("universityId")!)
    : null;
  const r = await database(c.env).execute(
    sql`select s.id,s.user_id,u.email,s.category,s.subject,s.body,s.status,s.reply,s.created_at from public.support_requests s join public.users u on u.id=s.user_id where (${scope}::uuid is null or s.institution_id=${scope}::uuid) order by s.created_at desc limit 100`,
  );
  return c.json({ rows: r.rows });
});
manageRoutes.patch("/support/:id", async (c) => {
  const d = await input(
    c,
    z.object({
      reply: z.string().trim().min(3).max(4000),
      status: z.enum(["OPEN", "IN_REVIEW", "RESOLVED"]),
    }),
  );
  const r = await database(c.env).execute(
    sql`with updated as(update public.support_requests set reply=${d.reply},status=${d.status},updated_at=now() where id=${id(c.req.param("id"))}::uuid returning user_id,institution_id) insert into public.in_app_notifications(user_id,institution_id,title,body,path) select user_id,institution_id,'Support reply',${d.reply},'/support' from updated returning id`,
  );
  if (!firstRow(r)) throw new AppError(404, "NOT_FOUND", "Request not found.");
  await recordAudit(c.env, {
    actorUserId: currentUser(c).id,
    action: "support.replied",
    targetType: "support_request",
    targetId: c.req.param("id"),
    requestId: c.get("requestId"),
  });
  return c.json({ status: "saved" });
});
manageRoutes.get("/agents", async (c) => {
  const scope = c.req.query("universityId")
    ? id(c.req.query("universityId")!)
    : null;
  const type = c.req.query("type") ?? null;
  const r = await database(c.env).execute(
    sql`select a.id,a.user_id,a.agent_type,a.display_name,a.status,u.email,a.university_id,a.verified_at from public.agent_profiles a join public.users u on u.id=a.user_id where (${scope}::uuid is null or a.university_id=${scope}::uuid) and (${type}::text is null or a.agent_type=${type}) order by a.verified_at desc limit 100`,
  );
  return c.json({ rows: r.rows });
});
manageRoutes.get("/users/:id", async (c) => {
  const target = id(c.req.param("id"));
  const [profile, restrictions, posts, orders, applications, streak] =
    await Promise.all([
      database(c.env).execute(
        sql`select u.id,u.email,u.status,u.created_at,p.display_name,p.username,p.university_id,p.current_level,p.matriculation_number from public.users u left join public.profiles p on p.user_id=u.id where u.id=${target}::uuid`,
      ),
      database(c.env).execute(
        sql`select id,kind,reason,ends_at,revoked_at from public.account_restrictions where user_id=${target}::uuid order by starts_at desc limit 20`,
      ),
      database(c.env).execute(
        sql`select id,title,status,created_at from public.feed_posts where author_user_id=${target}::uuid order by created_at desc limit 30`,
      ),
      database(c.env).execute(
        sql`select id,status,total_kobo,created_at from public.orders where buyer_user_id=${target}::uuid order by created_at desc limit 30`,
      ),
      database(c.env).execute(
        sql`select id,agent_type,status,kyc_status from public.agent_applications where user_id=${target}::uuid order by submitted_at desc`,
      ),
      database(c.env).execute(
        sql`select current_days,longest_days,goal_days,last_day from public.user_streaks where user_id=${target}::uuid`,
      ),
    ]);
  if (!firstRow(profile))
    throw new AppError(404, "NOT_FOUND", "User not found.");
  await recordAudit(c.env, {
    actorUserId: currentUser(c).id,
    action: "user.activity.viewed",
    targetType: "user",
    targetId: target,
    requestId: c.get("requestId"),
  });
  return c.json({
    profile: firstRow(profile),
    restrictions: restrictions.rows,
    posts: posts.rows,
    orders: orders.rows,
    applications: applications.rows,
    streak: firstRow(streak),
  });
});
manageRoutes.post("/users/:id/restrictions", async (c) => {
  const actor = currentUser(c);
  const target = id(c.req.param("id"));
  if (actor.id === target)
    throw new AppError(
      409,
      "CONFLICT",
      "Use another administrator to review your account.",
    );
  const d = await input(
    c,
    z.object({
      kind: z.enum(["SUSPENDED", "BANNED"]),
      reason: z.string().trim().min(3).max(1000),
      endsAt: z.string().datetime().nullable(),
    }),
  );
  if (
    d.kind === "SUSPENDED" &&
    (!d.endsAt || new Date(d.endsAt).getTime() <= Date.now())
  )
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Choose a future suspension end time.",
    );
  const eventId = crypto.randomUUID();
  const client = sqlClient(c.env);
  await client.transaction([
    client`insert into public.account_restrictions(id,user_id,institution_id,kind,reason,ends_at,created_by) values(${eventId}::uuid,${target}::uuid,(select university_id from public.profiles where user_id=${target}::uuid),${d.kind},${d.reason},${d.kind === "BANNED" ? null : d.endsAt}::timestamptz,${actor.id}::uuid)`,
    client`insert into public.in_app_notifications(user_id,title,body,path,dedupe_key) values(${target}::uuid,${d.kind === "BANNED" ? "Your account is banned" : "Your account is suspended"},${d.reason},'/restricted',${eventId})`,
    client`insert into app_private.notification_outbox(user_id,channel,subject,body,dedupe_key) values(${target}::uuid,'EMAIL',${d.kind === "BANNED" ? "KampusOne account banned" : "KampusOne account suspended"},${d.reason + " You can appeal through Help & support in the app."},${eventId})`,
  ]);
  await recordAudit(c.env, {
    actorUserId: actor.id,
    action: "account.restricted",
    targetType: "user",
    targetId: target,
    requestId: c.get("requestId"),
    metadata: { kind: d.kind, restrictionId: eventId },
  });
  return c.json({ id: eventId }, 201);
});
manageRoutes.delete("/users/:id/restrictions/:restrictionId", async (c) => {
  await database(c.env).execute(
    sql`update public.account_restrictions set revoked_at=now(),revoked_by=${currentUser(c).id}::uuid where id=${id(c.req.param("restrictionId"))}::uuid and user_id=${id(c.req.param("id"))}::uuid and revoked_at is null`,
  );
  await recordAudit(c.env, {
    actorUserId: currentUser(c).id,
    action: "account.restriction.revoked",
    targetType: "user",
    targetId: c.req.param("id"),
    requestId: c.get("requestId"),
  });
  return c.json({ status: "revoked" });
});
manageRoutes.get("/applications/:id/documents", async (c) => {
  const result = await database(c.env).execute(
    sql`select d.*,a.legal_name,a.phone_e164,a.address_text,a.bank_status,a.bank_account_name,a.bank_account_last4,exists(select 1 from app_private.verified_people v where v.user_id=a.user_id) identity_recorded from public.agent_application_details d join public.agent_applications a on a.id=d.application_id where d.application_id=${id(c.req.param("id"))}::uuid`,
  );
  await recordAudit(c.env, {
    actorUserId: currentUser(c).id,
    action: "verification.documents.viewed",
    targetType: "agent_application",
    targetId: c.req.param("id"),
    requestId: c.get("requestId"),
  });
  return c.json({ details: firstRow(result) ?? null });
});
manageRoutes.post("/applications/:id/identity", async (c) => {
  const applicationId = id(c.req.param("id"));
  const d = await input(
    c,
    z
      .object({
        nin: z.string().regex(/^\d{11}$/),
        evidence: z.string().trim().min(20).max(1000),
      })
      .strict(),
  );
  const fingerprint = await identityFingerprint(c.env, d.nin);
  const result = await database(c.env).execute(sql`with recorded as (
    insert into app_private.verified_people(user_id,identity_fingerprint,verified_by)
    select a.user_id,${fingerprint},${currentUser(c).id}::uuid from public.agent_applications a
    join public.agent_application_details d on d.application_id=a.id
    join public.media_objects m on m.id=d.identity_document_id and m.owner_user_id=a.user_id and m.kind='kyc' and m.deleted_at is null
    where a.id=${applicationId}::uuid
    on conflict do nothing returning user_id
  ) select user_id from recorded union all select a.user_id from public.agent_applications a join app_private.verified_people v on v.user_id=a.user_id where a.id=${applicationId}::uuid and v.identity_fingerprint=${fingerprint} limit 1`);
  if (!firstRow(result))
    throw new AppError(
      409,
      "CONFLICT",
      "This identity is already linked to an account, or the uploaded evidence is unavailable.",
    );
  await recordAudit(c.env, {
    actorUserId: currentUser(c).id,
    action: "identity.review.recorded",
    targetType: "agent_application",
    targetId: applicationId,
    requestId: c.get("requestId"),
    metadata: { evidence: d.evidence },
  });
  return c.json({ status: "recorded" });
});
manageRoutes.post("/applications/:id/guardian", async (c) => {
  const d = await input(
    c,
    z.object({ evidence: z.string().trim().min(20).max(2000) }),
  );
  const r = await database(c.env).execute(
    sql`update public.agent_application_details set guardian_consent_at=now(),guardian_reviewed_by=${currentUser(c).id}::uuid,guardian_evidence=${d.evidence} where application_id=${id(c.req.param("id"))}::uuid and guardian_name is not null and guardian_phone is not null returning application_id`,
  );
  if (!firstRow(r))
    throw new AppError(404, "NOT_FOUND", "Guardian details not found.");
  await recordAudit(c.env, {
    actorUserId: currentUser(c).id,
    action: "guardian.consent.verified",
    targetType: "agent_application",
    targetId: c.req.param("id"),
    requestId: c.get("requestId"),
  });
  return c.json({ status: "verified" });
});
manageRoutes.patch("/users/:id/streak", async (c) => {
  const d = await input(
    c,
    z.object({
      days: z.number().int().min(0).max(10000),
      reason: z.string().trim().min(3).max(1000),
    }),
  );
  await database(c.env).execute(
    sql`insert into public.user_streaks(user_id,current_days,longest_days,last_day) values(${id(c.req.param("id"))}::uuid,${d.days},${d.days},(now() at time zone 'Africa/Lagos')::date) on conflict(user_id) do update set current_days=excluded.current_days,longest_days=greatest(user_streaks.longest_days,excluded.current_days),last_day=excluded.last_day`,
  );
  await recordAudit(c.env, {
    actorUserId: currentUser(c).id,
    action: "streak.adjusted",
    targetType: "user",
    targetId: c.req.param("id"),
    requestId: c.get("requestId"),
    metadata: d,
  });
  return c.json({ status: "saved" });
});
