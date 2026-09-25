import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { AppError } from "../lib/errors";
import { id, input } from "../lib/input";
import { currentUser, requireAuth } from "../middleware/auth";
import { resolveAdminScope } from "../lib/admin-access";
import type { AuthenticatedUser, Bindings, Variables } from "../types";

type Env = { Bindings: Bindings; Variables: Variables };
export const publicBadgeAdminRoutes = new Hono<Env>();
export const publicBadgeProfileRoutes = new Hono<Env>();
// A public recognition badge is independent of KYC, enrollment approval and roles.
publicBadgeAdminRoutes.use("/*", requireAuth);
async function authorizeBadge(env:Bindings,user:AuthenticatedUser,target:string) {
  const profile=firstRow(await database(env).execute<{university_id:string|null}>(sql`select university_id from public.profiles where user_id=${target}::uuid and deleted_at is null`));
  const scope=await resolveAdminScope(env,user,profile?.university_id??undefined,"users.verify");
  if(profile&&scope!==null&&profile.university_id!==scope)throw new AppError(403,"FORBIDDEN","This profile is outside your university scope.");
}
publicBadgeAdminRoutes.get("/:id", async (c) => {
  await authorizeBadge(c.env,currentUser(c),id(c.req.param("id")));
  c.header("Cache-Control", "private, no-store");
  const result = firstRow(await database(c.env).execute(sql`
    select p.user_id as id,p.display_name,
      coalesce((to_jsonb(p)->>'public_badge_verified')::boolean,p.verification_status::text='VERIFIED',false) as verified,
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='public_badge_verified') as available
    from public.profiles p join public.users u on u.id=p.user_id
    where p.user_id=${id(c.req.param("id"))}::uuid and p.deleted_at is null and u.deleted_at is null
  `));
  if (!result) throw new AppError(404, "NOT_FOUND", "This user profile is unavailable.");
  return c.json({ badge: result });
});
publicBadgeAdminRoutes.put("/:id", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const actor = currentUser(c), targetId = id(c.req.param("id"));
  await authorizeBadge(c.env,actor,targetId);
  const data = await input(c, z.object({ verified: z.boolean(), expected: z.boolean(), reason: z.string().trim().min(6).max(1000) }).strict());
  const ready = firstRow(await database(c.env).execute<{ ready: boolean }>(sql`
    select exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='public_badge_verified') as ready
  `))?.ready;
  if (!ready) throw new AppError(503, "PROVIDER_UNAVAILABLE", "Apply the conversation-experience migration to enable badge controls.");
  const saved = firstRow(await database(c.env).execute(sql`
    with candidate as (
      select p.user_id,p.university_id,coalesce(p.public_badge_verified,p.verification_status::text='VERIFIED',false) as previous
      from public.profiles p join public.users u on u.id=p.user_id
      where p.user_id=${targetId}::uuid and p.deleted_at is null and u.deleted_at is null for update of p
    ), updated as (
      update public.profiles p set public_badge_verified=${data.verified},updated_at=now()
      from candidate where p.user_id=candidate.user_id and candidate.previous=${data.expected}
      returning p.user_id as id,p.display_name,p.public_badge_verified as verified,p.university_id,candidate.previous
    ), logged as (
      insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata)
      select ${actor.id}::uuid,updated.university_id,${data.verified ? "profile.badge.assigned" : "profile.badge.revoked"},'user',updated.id::text,${c.get("requestId")},'succeeded',
        jsonb_build_object('previous',updated.previous,'verified',updated.verified,'reason',${data.reason}::text)
      from updated returning target_id
    )
    select updated.id,updated.display_name,updated.verified,true as available from updated join logged on logged.target_id=updated.id::text
  `));
  if (!saved) throw new AppError(409, "CONFLICT", "The badge status changed or this profile is unavailable. Refresh the user before applying another decision.");
  return c.json({ badge: saved });
});

// Enrich the existing self-profile response without changing identity verification data.
publicBadgeProfileRoutes.get("/me", requireAuth, async (c, next) => {
  await next();
  if (!c.res.ok || c.env.UNIFIED_SCHEMA_READY !== "true") return;
  const payload = await c.res.clone().json() as { profile?: Record<string, unknown> };
  if (!payload.profile) return;
  const row = firstRow(await database(c.env).execute<{ verified: boolean; profile_image_url: string | null }>(sql`
    select coalesce((to_jsonb(p)->>'public_badge_verified')::boolean,p.verification_status::text='VERIFIED',false) as verified,p.profile_image_url
    from public.profiles p where p.user_id=${currentUser(c).id}::uuid and p.deleted_at is null
  `));
  if (!row) return;
  payload.profile.public_badge_verified = row.verified;
  payload.profile.profile_image_url = row.profile_image_url;
  const headers = new Headers(c.res.headers); headers.delete("Content-Length"); headers.set("Cache-Control", "private, no-store");
  c.res = new Response(JSON.stringify(payload), { status: c.res.status, headers });
});
