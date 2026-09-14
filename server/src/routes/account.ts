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
    sql`update public.profiles set settings=${JSON.stringify(settings)}::jsonb, updated_at=now() where user_id=${currentUser(c).id}::uuid`,
  );
  return c.json({ settings });
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
      })
      .strict(),
  );
  const conflict = await database(c.env).execute(
    sql`select id from public.profiles where lower(username)=${data.username} and user_id<>${user.id}::uuid and deleted_at is null limit 1`,
  );
  if (firstRow(conflict))
    throw new AppError(409, "CONFLICT", "That username is already in use.");
  await database(c.env).execute(
    sql`update public.profiles set first_name=${data.firstName},last_name=${data.lastName},display_name=${data.firstName + " " + data.lastName},username=${data.username},biography=${data.biography},updated_at=now() where user_id=${user.id}::uuid`,
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
accountRoutes.post("/streak", async (c) => {
  const result = await database(c.env).execute(
    sql`select * from app_private.check_in_streak(${currentUser(c).id}::uuid)`,
  );
  return c.json({ streak: firstRow(result) });
});
accountRoutes.patch("/streak", async (c) => {
  const data = await input(
    c,
    z.object({ goalDays: z.number().int().min(1).max(365) }),
  );
  await database(c.env).execute(
    sql`update public.user_streaks set goal_days=${data.goalDays} where user_id=${currentUser(c).id}::uuid`,
  );
  return c.json({ status: "saved" });
});
accountRoutes.get("/guidelines", async (c) => {
  const user = currentUser(c);
  const result = await database(c.env).execute(
    sql`select g.id,g.title,g.body,g.source_url,g.published_at from public.institution_guidelines g join public.profiles p on p.user_id=${user.id}::uuid where g.institution_id=p.university_id and (g.department_id is null or g.department_id=p.department_id) and g.status='PUBLISHED' order by g.updated_at desc limit 50`,
  );
  return c.json({ guidelines: result.rows });
});
