import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { id, input } from "../lib/input";
import { AppError } from "../lib/errors";
import { currentUser, requireAuth } from "../middleware/auth";
import { recordAudit } from "../lib/audit";
import type { Bindings, Variables } from "../types";
export const communityRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();
communityRoutes.use("/*", requireAuth);
function explain(caught: unknown): never {
  const e =
    caught instanceof Error ? caught.message + " " + String(caught.cause) : "";
  if (
    /VERIFIED_MEMBERSHIP_REQUIRED|MEMBER_RESTRICTED|COURSE_REP_REQUIRED/.test(e)
  )
    throw new AppError(
      403,
      "FORBIDDEN",
      "Verified class membership and the correct role are required.",
    );
  if (/ELECTION_NOT_OPEN/.test(e))
    throw new AppError(409, "CONFLICT", "Voting is not open.");
  if (/ANNOUNCEMENT_LIMIT/.test(e))
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Announcement limit reached. Try again later.",
    );
  if (/CANDIDATE_NOT_FOUND|COMMUNITY_NOT_FOUND/.test(e))
    throw new AppError(404, "NOT_FOUND", "That record is unavailable.");
  throw caught;
}
communityRoutes.get("/", async (c) => {
  const u = currentUser(c);
  const search = c.req.query("q")?.trim().slice(0, 100) ?? "";
  const r = await database(c.env).execute(
    sql`select cc.id,cc.name,cc.level_code,cc.admission_year,cc.archived_at,cc.rep_user_id,m.joined_at,m.verified_at,(select count(*)::int from public.community_members where community_id=cc.id) members from public.cohort_communities cc left join public.community_members m on m.community_id=cc.id and m.user_id=${u.id}::uuid where cc.institution_id=${u.universityId}::uuid and (${search}='' or cc.name ilike ${"%" + search + "%"}) order by (m.user_id is not null) desc,cc.admission_year desc,cc.name limit 100`,
  );
  return c.json({ rows: r.rows });
});
communityRoutes.get("/:id", async (c) => {
  const u = currentUser(c),
    target = id(c.req.param("id")),
    db = database(c.env);
  const community = firstRow(
    await db.execute<{
      id: string;
      rep_user_id: string | null;
      joined_at: string | null;
      verified_at: string | null;
    }>(
      sql`select cc.*,p.display_name rep_name,m.joined_at,m.verified_at from public.cohort_communities cc left join public.profiles p on p.user_id=cc.rep_user_id left join public.community_members m on m.community_id=cc.id and m.user_id=${u.id}::uuid where cc.id=${target}::uuid and cc.institution_id=${u.universityId}::uuid`,
    ),
  );
  if (!community) throw new AppError(404, "NOT_FOUND", "Community not found.");
  const election = firstRow(
    await db.execute<{ id: string }>(
      sql`select e.*,now()>=starts_at and now()<ends_at and status='SCHEDULED' is_open,(select candidate_id from app_private.community_votes where election_id=e.id and voter_id=${u.id}::uuid) my_vote from public.community_elections e where community_id=${target}::uuid order by created_at desc limit 1`,
    ),
  );
  const [candidates, announcements, transfers] = await Promise.all([
    election
      ? db.execute(
          sql`select c.user_id,p.display_name,p.username,(select count(*)::int from app_private.community_votes where election_id=c.election_id and candidate_id=c.user_id) votes from public.community_candidates c join public.profiles p on p.user_id=c.user_id where c.election_id=${election.id}::uuid order by c.created_at`,
        )
      : Promise.resolve({ rows: [] }),
    community.joined_at
      ? db.execute(
          sql`select id,title,body,created_at from public.community_announcements where community_id=${target}::uuid order by created_at desc limit 50`,
        )
      : Promise.resolve({ rows: [] }),
    db.execute(
      sql`select t.id,t.to_user_id,p.username,t.status from public.community_rep_transfers t join public.profiles p on p.user_id=t.to_user_id where t.community_id=${target}::uuid and (t.from_user_id=${u.id}::uuid or t.to_user_id=${u.id}::uuid) and t.status in ('PENDING','ACCEPTED')`,
    ),
  ]);
  return c.json({
    community,
    election,
    candidates: candidates.rows,
    announcements: announcements.rows,
    transfers: transfers.rows,
    isRep: community.rep_user_id === u.id,
  });
});
communityRoutes.post("/:id/join", async (c) => {
  const u = currentUser(c);
  const r = await database(c.env).execute(
    sql`insert into public.community_members(community_id,user_id) select cc.id,${u.id}::uuid from public.cohort_communities cc join public.profiles p on p.user_id=${u.id}::uuid and p.department_id=cc.department_id and p.university_id=cc.institution_id where cc.id=${id(c.req.param("id"))}::uuid and cc.institution_id=${u.universityId}::uuid and cc.archived_at is null on conflict do nothing returning user_id`,
  );
  if (!firstRow(r))
    throw new AppError(
      409,
      "CONFLICT",
      "Check your department, or open your existing membership.",
    );
  return c.json({ status: "joined" }, 201);
});
communityRoutes.post("/:id/elections/:electionId", async (c) => {
  const u = currentUser(c),
    electionId = id(c.req.param("electionId"));
  const d = await input(
    c,
    z.object({ candidateId: z.string().uuid().optional() }),
  );
  const allowed = firstRow(
    await database(c.env).execute(
      sql`select e.id from public.community_elections e join public.cohort_communities cc on cc.id=e.community_id where e.id=${electionId}::uuid and cc.id=${id(c.req.param("id"))}::uuid and cc.institution_id=${u.universityId}::uuid`,
    ),
  );
  if (!allowed) throw new AppError(404, "NOT_FOUND", "Election not found.");
  try {
    const r = await database(c.env).execute(
      sql`select app_private.community_participate(${electionId}::uuid,${u.id}::uuid,${d.candidateId ?? null}::uuid) status`,
    );
    return c.json(firstRow(r));
  } catch (e) {
    explain(e);
  }
});
communityRoutes.post("/:id/announcements", async (c) => {
  const u = currentUser(c);
  const d = await input(
    c,
    z.object({
      title: z.string().trim().min(3).max(140),
      body: z.string().trim().min(3).max(4000),
      idempotencyKey: z.string().uuid(),
    }),
  );
  const scope = firstRow(
    await database(c.env).execute(
      sql`select id from public.cohort_communities where id=${id(c.req.param("id"))}::uuid and institution_id=${u.universityId}::uuid`,
    ),
  );
  if (!scope) throw new AppError(404, "NOT_FOUND", "Community not found.");
  try {
    await database(c.env).execute(
      sql`select app_private.publish_community_announcement(${c.req.param("id")}::uuid,${u.id}::uuid,${d.title},${d.body},${d.idempotencyKey}::uuid)`,
    );
    return c.json({ status: "published" }, 201);
  } catch (e) {
    explain(e);
  }
});
communityRoutes.post("/:id/transfers", async (c) => {
  const u = currentUser(c);
  const d = await input(
    c,
    z.object({ username: z.string().trim().min(3).max(30) }),
  );
  const r = await database(c.env).execute(
    sql`insert into public.community_rep_transfers(community_id,from_user_id,to_user_id) select cc.id,${u.id}::uuid,p.user_id from public.cohort_communities cc join public.community_members m on m.community_id=cc.id and m.verified_at is not null join public.profiles p on p.user_id=m.user_id and lower(p.username)=lower(${d.username.replace(/^@/, "")}) and p.university_id=cc.institution_id and p.department_id=cc.department_id where cc.id=${id(c.req.param("id"))}::uuid and cc.institution_id=${u.universityId}::uuid and cc.rep_user_id=${u.id}::uuid and cc.archived_at is null and p.user_id<>${u.id}::uuid on conflict do nothing returning id`,
  );
  if (!firstRow(r))
    throw new AppError(
      409,
      "CONFLICT",
      "Choose a verified class member, or resolve the pending transfer.",
    );
  await recordAudit(c.env, {
    actorUserId: u.id,
    action: "community.transfer.requested",
    targetType: "community",
    targetId: c.req.param("id"),
    requestId: c.get("requestId"),
  });
  return c.json(firstRow(r), 201);
});
communityRoutes.post("/:id/transfers/:transferId/accept", async (c) => {
  const u = currentUser(c);
  const r = await database(c.env).execute(
    sql`update public.community_rep_transfers t set status='ACCEPTED' from public.cohort_communities cc,public.community_members m where t.id=${id(c.req.param("transferId"))}::uuid and t.community_id=${id(c.req.param("id"))}::uuid and cc.id=t.community_id and cc.institution_id=${u.universityId}::uuid and cc.archived_at is null and cc.rep_user_id=t.from_user_id and m.community_id=cc.id and m.user_id=${u.id}::uuid and m.verified_at is not null and t.to_user_id=${u.id}::uuid and t.status='PENDING' returning t.id`,
  );
  if (!firstRow(r))
    throw new AppError(409, "CONFLICT", "That transfer cannot be accepted.");
  return c.json({ status: "accepted_pending_review" });
});
