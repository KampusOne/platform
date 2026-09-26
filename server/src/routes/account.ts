import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { database, firstRow, sqlClient } from "../lib/database";
import { input, id } from "../lib/input";
import { AppError } from "../lib/errors";
import { recordAudit } from "../lib/audit";
import { currentUser, requireAuth } from "../middleware/auth";
import type { Bindings, Variables } from "../types";

export const accountRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();
accountRoutes.use("/*", requireAuth);
accountRoutes.get("/capabilities", async (c) => {
  const u = currentUser(c);
  const profiles = await database(c.env).execute(
    sql`select id,agent_type,display_name from public.agent_profiles where user_id=${u.id}::uuid and status='ACTIVE'`,
  );
  const communities = await database(c.env).execute(
    sql`select id,name from public.cohort_communities where rep_user_id=${u.id}::uuid and archived_at is null`,
  );
  return c.json({ profiles: profiles.rows, communities: communities.rows });
});
const settingsSchema = z
  .object({
    appearance: z.enum(["system", "light", "dark"]),
    notifications: z.boolean(),
    marketing: z.boolean(),
    haptics: z.boolean(),
    hideCgpa: z.boolean(),
    hideReposts: z.boolean().optional(),
    notifyLikes: z.boolean().optional(),
    notifyReposts: z.boolean().optional(),
    notifyReplies: z.boolean().optional(),
  })
  .strict();
accountRoutes.get("/settings", async (c) => {
  const result = await database(c.env).execute(
    sql`select settings from public.profiles where user_id=${currentUser(c).id}::uuid`,
  );
  return c.json({ settings: firstRow(result)?.settings ?? {} });
});
accountRoutes.put("/settings", async (c) => {
  const settings = await input(c, settingsSchema);
  await database(c.env).execute(
    sql`update public.profiles set settings=coalesce(settings,'{}'::jsonb) || ${JSON.stringify(settings)}::jsonb, updated_at=now() where user_id=${currentUser(c).id}::uuid`,
  );
  return c.json({ settings });
});
accountRoutes.patch("/profile/roles",async c=>{
  const publicRoles=await input(c,z.object({vendor:z.boolean(),tutor:z.boolean(),rider:z.boolean()}).strict());
  await database(c.env).execute(sql`update public.profiles set settings=coalesce(settings,'{}'::jsonb) || jsonb_build_object('publicRoles',${JSON.stringify(publicRoles)}::jsonb),updated_at=now() where user_id=${currentUser(c).id}::uuid`);
  return c.json({publicRoles});
});
accountRoutes.patch("/profile", async (c) => {
  const user = currentUser(c);
  const data = await input(
    c,
    z
      .object({
        firstName: z.string().trim().min(1).max(60),
        lastName: z.string().trim().min(1).max(60),
        username: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9_]{3,30}$/),
        biography: z.string().trim().max(300),
        publicRoles: z.object({ vendor:z.boolean(), tutor:z.boolean(), rider:z.boolean() }).strict().optional(),
      })
      .strict(),
  );
  const conflict = await database(c.env).execute(
    sql`select id from public.profiles where lower(username)=${data.username} and user_id<>${user.id}::uuid and deleted_at is null limit 1`,
  );
  if (firstRow(conflict))
    throw new AppError(409, "CONFLICT", "That username is already in use.");
  await database(c.env).execute(
    sql`update public.profiles set first_name=${data.firstName},last_name=${data.lastName},display_name=${data.firstName + " " + data.lastName},username=${data.username},biography=${data.biography},settings=case when ${data.publicRoles !== undefined} then coalesce(settings,'{}'::jsonb) || jsonb_build_object('publicRoles',${JSON.stringify(data.publicRoles ?? {})}::jsonb) else settings end,updated_at=now() where user_id=${user.id}::uuid`,
  );
  await recordAudit(c.env, {
    actorUserId: user.id,
    action: "profile.updated",
    targetType: "user",
    targetId: user.id,
    requestId: c.get("requestId"),
  });
  return c.json({ status: "saved" });
});
accountRoutes.get("/sessions", async (c) => {
  const result = await database(c.env).execute(
    sql`select id,device_label,last_used_at,created_at,expires_at from public.refresh_tokens where user_id=${currentUser(c).id}::uuid and revoked_at is null and expires_at>now() order by last_used_at desc limit 30`,
  );
  return c.json({ sessions: result.rows });
});
accountRoutes.delete("/sessions/:id", async (c) => {
  await database(c.env).execute(
    sql`update public.refresh_tokens set revoked_at=coalesce(revoked_at,now()) where user_id=${currentUser(c).id}::uuid and family_id in(select family_id from public.refresh_tokens where id=${id(c.req.param("id"))}::uuid and user_id=${currentUser(c).id}::uuid)`,
  );
  return c.json({ status: "revoked" });
});
accountRoutes.get("/support", async (c) => {
  const result = await database(c.env).execute(
    sql`select id,category,subject,body,status,reply,created_at from public.support_requests where user_id=${currentUser(c).id}::uuid order by created_at desc limit 50`,
  );
  return c.json({ requests: result.rows });
});
accountRoutes.post("/support", async (c) => {
  const user = currentUser(c);
  const data = await input(
    c,
    z
      .object({
        category: z.enum([
          "ACCOUNT",
          "ORDER",
          "TUTORIAL",
          "DELIVERY",
          "PAYMENT",
          "SAFETY",
          "CONTENT",
          "APPEAL",
          "PRIVACY",
        ]),
        subject: z.string().trim().min(3).max(160),
        body: z.string().trim().min(5).max(4000),
      })
      .strict(),
  );
  const count = await database(c.env).execute<{ total: number }>(
    sql`select count(*)::int total from public.support_requests where user_id=${user.id}::uuid and created_at>now()-interval '1 hour'`,
  );
  if (Number(firstRow(count)?.total) >= 5)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Please wait before opening another request.",
    );
  const result = await database(c.env).execute(
    sql`insert into public.support_requests(user_id,institution_id,category,subject,body) values(${user.id}::uuid,${user.universityId}::uuid,${data.category},${data.subject},${data.body}) returning id,status`,
  );
  return c.json(firstRow(result), 201);
});
accountRoutes.get("/notifications", async (c) => {
  const result = await database(c.env).execute(
    sql`select id,title,body,path,read_at,created_at from public.in_app_notifications where user_id=${currentUser(c).id}::uuid order by created_at desc limit 50`,
  );
  return c.json({ notifications: result.rows });
});
accountRoutes.patch("/notifications/:id", async (c) => {
  await database(c.env).execute(
    sql`update public.in_app_notifications set read_at=coalesce(read_at,now()) where id=${id(c.req.param("id"))}::uuid and user_id=${currentUser(c).id}::uuid`,
  );
  return c.json({ status: "read" });
});
accountRoutes.get("/restrictions", async (c) => {
  const result = await database(c.env).execute(
    sql`select kind,reason,ends_at from public.account_restrictions where user_id=${currentUser(c).id}::uuid and revoked_at is null and starts_at<=now() and (ends_at is null or ends_at>now()) order by starts_at desc limit 1`,
  );
  return c.json({ restriction: firstRow(result) ?? null });
});
type StreakRow = {
  current_days: number;
  longest_days: number;
  goal_days: number;
  last_day: string | null;
};

function databaseErrorCode(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return undefined;
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function isStreakSchemaDrift(error: unknown) {
  const code = databaseErrorCode(error);
  // 42P01 = missing relation, 42883 = missing function. Older production
  // schemas can still have user_streaks while the activity ledger rolls out.
  return code === "42P01" || code === "42883";
}

async function streakSnapshot(env: Bindings, userId: string) {
  const db = database(env);
  const result = await db.execute<StreakRow>(sql`select
    case when last_day >= (now() at time zone 'Africa/Lagos')::date-1 then current_days else 0 end current_days,
    longest_days,goal_days,last_day::text
    from public.user_streaks where user_id=${userId}::uuid`);
  const streak =
    firstRow(result) ?? {
      current_days: 0,
      longest_days: 0,
      goal_days: 7,
      last_day: null,
    };

  let activityDays: string[];
  try {
    const activity = await db.execute<{ day: string }>(
      sql`select day::text from public.streak_activity_days where user_id=${userId}::uuid and day >= (now() at time zone 'Africa/Lagos')::date-365 order by day`,
    );
    activityDays = activity.rows.map((row) => row.day);
  } catch (error) {
    if (!isStreakSchemaDrift(error)) throw error;
    // The legacy streak row still records the genuine last check-in. Preserve
    // that day instead of failing the entire page while the activity table is
    // unavailable.
    const activityDaysFromCurrentRun: string[] = [];
    if (streak.last_day && streak.current_days > 0) {
      const end = new Date(streak.last_day + "T12:00:00Z");
      for (let index = streak.current_days - 1; index >= 0; index -= 1) {
        const day = new Date(end);
        day.setUTCDate(end.getUTCDate() - index);
        activityDaysFromCurrentRun.push(day.toISOString().slice(0, 10));
      }
    }
    activityDays = activityDaysFromCurrentRun;
  }

  const clock = firstRow(
    await db.execute<{ today: string }>(
      sql`select (now() at time zone 'Africa/Lagos')::date::text as today`,
    ),
  );
  return {
    streak,
    activityDays,
    timezone: "Africa/Lagos",
    today: clock?.today,
  };
}

async function checkInStreak(env: Bindings, userId: string) {
  const db = database(env);
  try {
    await db.execute(
      sql`select * from app_private.check_in_streak(${userId}::uuid)`,
    );
    return;
  } catch (error) {
    if (!isStreakSchemaDrift(error)) throw error;
  }

  // Compatibility path for a database that has the original user_streaks
  // table but has not completed the activity-ledger/function rollout yet.
  await db.execute(sql`
    insert into public.user_streaks(user_id,current_days,longest_days,last_day)
    values(${userId}::uuid,1,1,(now() at time zone 'Africa/Lagos')::date)
    on conflict(user_id) do update set
      current_days=case
        when user_streaks.last_day=excluded.last_day then user_streaks.current_days
        when user_streaks.last_day=excluded.last_day-1 then user_streaks.current_days+1
        else 1
      end,
      longest_days=greatest(
        user_streaks.longest_days,
        case
          when user_streaks.last_day=excluded.last_day then user_streaks.current_days
          when user_streaks.last_day=excluded.last_day-1 then user_streaks.current_days+1
          else 1
        end
      ),
      last_day=excluded.last_day,
      updated_at=now()
  `);
}

accountRoutes.get("/streak", async (c) =>
  c.json(await streakSnapshot(c.env, currentUser(c).id)),
);
accountRoutes.post("/streak", async (c) => {
  await checkInStreak(c.env, currentUser(c).id);
  return c.json(await streakSnapshot(c.env, currentUser(c).id));
});
accountRoutes.post("/streak/check-in", async (c) => {
  await checkInStreak(c.env, currentUser(c).id);
  return c.json(await streakSnapshot(c.env, currentUser(c).id));
});
accountRoutes.patch("/streak", async (c) => {
  const data = await input(
    c,
    z.object({ goalDays: z.number().int().min(1).max(365) }),
  );
  await database(c.env).execute(
    sql`insert into public.user_streaks(user_id,goal_days) values(${currentUser(c).id}::uuid,${data.goalDays}) on conflict(user_id) do update set goal_days=excluded.goal_days,updated_at=now()`,
  );
  return c.json({ status: "saved" });
});
accountRoutes.get("/guidelines", async (c) => {
  const user = currentUser(c);
  try {
    const result = await database(c.env).execute(
      sql`select
        g.id,
        g.title,
        g.body,
        g.source_url,
        g.published_at,
        nullif(to_jsonb(g)->>'source_page','')::integer as source_page,
        to_jsonb(g)->>'issuing_institution' as issuing_institution,
        nullif(to_jsonb(g)->>'document_date','')::date as document_date,
        nullif(to_jsonb(g)->>'effective_from','')::date as effective_from,
        to_jsonb(g)->>'session_label' as session_label,
        to_jsonb(g)->>'programme_name' as programme_name,
        coalesce(nullif(to_jsonb(g)->>'version','')::integer,1) as version
      from public.institution_guidelines g
      join public.profiles p on p.user_id=${user.id}::uuid
      left join public.courses course on course.id=p.course_id
      where g.institution_id=p.university_id
        and (g.department_id is null or g.department_id=p.department_id)
        and (
          nullif(to_jsonb(g)->>'faculty_id','') is null
          or nullif(to_jsonb(g)->>'faculty_id','')::uuid=p.faculty_id
        )
        and (
          nullif(to_jsonb(g)->>'programme_name','') is null
          or to_jsonb(g)->>'programme_name'=course.name
        )
        and (
          nullif(to_jsonb(g)->>'session_label','') is null
          or to_jsonb(g)->>'session_label'=p.settings->>'academicSession'
        )
        and (
          nullif(to_jsonb(g)->>'effective_from','') is null
          or nullif(to_jsonb(g)->>'effective_from','')::date<=(now() at time zone 'Africa/Lagos')::date
        )
        and g.status='PUBLISHED'
      order by g.updated_at desc
      limit 50`,
    );
    return c.json({ guidelines: result.rows });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01") {
      return c.json({ guidelines: [] });
    }
    throw error;
  }
});
