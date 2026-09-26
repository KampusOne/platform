import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { currentUser } from "../middleware/auth";
import { resolveAdminScope } from "../lib/admin-access";
import { database, firstRow } from "../lib/database";
import { recordAudit } from "../lib/audit";
import { AppError } from "../lib/errors";
import { input } from "../lib/input";
import type { Bindings, Variables } from "../types";

export const adminCommunityRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const uuid = z.string().uuid();
function validId(value: unknown) { const parsed=uuid.safeParse(value); if(!parsed.success) throw new AppError(400,"BAD_REQUEST","Choose a valid account or request."); return parsed.data; }
function offsetFrom(value: unknown) { const parsed=z.coerce.number().int().min(0).max(100000).safeParse(value??0); if(!parsed.success) throw new AppError(400,"BAD_REQUEST","Choose a valid page."); return parsed.data; }
const policySchema = z.object({ blockProtected: z.boolean(), notifyAllInApp: z.boolean(), notifyAllPush: z.boolean(), reason: z.string().trim().min(5).max(1000) });

adminCommunityRoutes.get("/users/:id/social-policy", async c => {
  const id = validId(c.req.param("id"));
  const scope = await resolveAdminScope(c.env, currentUser(c), c.req.query("universityId"));
  const profile = firstRow(await database(c.env).execute(sql`select p.user_id, p.university_id,
    coalesce(policy.block_protected,false) block_protected, coalesce(policy.notify_all_in_app,false) notify_all_in_app,
    coalesce(policy.notify_all_push,false) notify_all_push
    from public.profiles p left join public.profile_social_policies policy on policy.user_id=p.user_id
    where p.user_id=${id}::uuid and (${scope}::uuid is null or p.university_id=${scope}::uuid)`));
  if (!profile) throw new AppError(404,"NOT_FOUND","This account is not available in your university scope.");
  c.header("Cache-Control","private, no-store");
  return c.json({policy:profile});
});
adminCommunityRoutes.put("/users/:id/social-policy", async c => {
  const id = validId(c.req.param("id")), data = await input(c, policySchema), user = currentUser(c);
  const profile = firstRow(await database(c.env).execute<{university_id:string|null;notify_all_in_app:boolean;notify_all_push:boolean}>(sql`select p.university_id, coalesce(policy.notify_all_in_app,false) notify_all_in_app, coalesce(policy.notify_all_push,false) notify_all_push from public.profiles p left join public.profile_social_policies policy on policy.user_id=p.user_id where p.user_id=${id}::uuid and p.deleted_at is null`));
  if (!profile?.university_id) throw new AppError(409,"CONFLICT","This account needs a university before campus-wide policies can be assigned.");
  await resolveAdminScope(c.env,user,profile.university_id,"users.manage");
  if (data.notifyAllInApp !== profile.notify_all_in_app || data.notifyAllPush !== profile.notify_all_push) await resolveAdminScope(c.env,user,profile.university_id,"notifications.manage");
  const policy = firstRow(await database(c.env).execute(sql`insert into public.profile_social_policies(user_id,institution_id,block_protected,notify_all_in_app,notify_all_push,updated_by)
    values(${id}::uuid,${profile.university_id}::uuid,${data.blockProtected},${data.notifyAllInApp},${data.notifyAllPush},${user.id}::uuid)
    on conflict(user_id) do update set institution_id=excluded.institution_id,block_protected=excluded.block_protected,
      notify_all_in_app=excluded.notify_all_in_app,notify_all_push=excluded.notify_all_push,updated_by=excluded.updated_by,updated_at=now() returning *`));
  await recordAudit(c.env,{actorUserId:user.id,universityId:profile.university_id,action:"profile.social_policy.updated",targetType:"user",targetId:id,requestId:c.get("requestId"),metadata:data});
  return c.json({policy});
});
adminCommunityRoutes.get("/social-moderation", async c => {
  const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query("universityId"));
  const target=c.req.query("userId") ? validId(c.req.query("userId")) : null;
  const offset=offsetFrom(c.req.query("offset"));
  const db=database(c.env);
  const [blocks,reports]=await Promise.all([
    db.execute(sql`select b.blocker_id,b.blocked_id,b.reason,b.details,b.created_at,p.display_name target_name,p.username target_username,a.display_name actor_name,
      count(*) over(partition by b.blocked_id)::int total_blocks
      from public.user_blocks b join public.profiles p on p.user_id=b.blocked_id left join public.profiles a on a.user_id=b.blocker_id
      where (${scope}::uuid is null or b.institution_id=${scope}::uuid) and (${target}::uuid is null or b.blocked_id=${target}::uuid)
      order by b.created_at desc limit 50 offset ${offset}`),
    db.execute(sql`select r.id,r.user_id,r.reporter_id,r.reason,r.details,r.created_at,p.display_name target_name,p.username target_username,a.display_name actor_name
      from public.profile_reports r join public.profiles p on p.user_id=r.user_id left join public.profiles a on a.user_id=r.reporter_id
      where (${scope}::uuid is null or r.institution_id=${scope}::uuid) and (${target}::uuid is null or r.user_id=${target}::uuid)
      order by r.created_at desc limit 50 offset ${offset}`),
  ]);
  await recordAudit(c.env,{actorUserId:currentUser(c).id,universityId:scope,action:"profile.moderation.viewed",targetType:"user",...(target?{targetId:target}:{}),requestId:c.get("requestId"),metadata:{offset}});
  c.header("Cache-Control","private, no-store");
  return c.json({blocks:blocks.rows,reports:reports.rows,offset,hasMore:blocks.rows.length===50||reports.rows.length===50});
});
adminCommunityRoutes.get("/ai-feedback", async c => {
  const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query("universityId"));
  const filter=z.enum(["like","dislike","all"]).safeParse(c.req.query("rating")??"all");
  if(!filter.success) throw new AppError(400,"BAD_REQUEST","Choose a valid feedback rating.");
  const rating=filter.data;
  const offset=offsetFrom(c.req.query("offset"));
  const result=await database(c.env).execute(sql`select r.idempotency_key request_id,r.user_id,r.mode,r.created_at,
    p.display_name,p.username,r.result->>'prompt' prompt,r.result->>'text' response,
    r.result->'feedback'->>'rating' rating,r.result->'feedback'->>'updatedAt' rated_at,
    coalesce(r.result->>'threadId',r.idempotency_key::text) thread_id
    from app_private.ai_requests r join public.profiles p on p.user_id=r.user_id
    where r.status='COMPLETED' and r.result->'feedback'->>'rating' in ('like','dislike')
      and (${scope}::uuid is null or p.university_id=${scope}::uuid)
      and (${rating}='all' or r.result->'feedback'->>'rating'=${rating})
    order by r.created_at desc limit 30 offset ${offset}`);
  await recordAudit(c.env,{actorUserId:currentUser(c).id,universityId:scope,action:"ai.feedback.viewed",targetType:"ai_feedback",requestId:c.get("requestId"),metadata:{rating,offset}});
  c.header("Cache-Control","private, no-store");
  return c.json({feedback:result.rows,hasMore:result.rows.length===30});
});
adminCommunityRoutes.get("/ai-feedback/:userId/:requestId", async c => {
  const userId=validId(c.req.param("userId")),requestId=validId(c.req.param("requestId"));
  const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query("universityId"));
  const request=firstRow(await database(c.env).execute<{thread_id:string}>(sql`select coalesce(r.result->>'threadId',r.idempotency_key::text) thread_id
    from app_private.ai_requests r join public.profiles p on p.user_id=r.user_id
    where r.user_id=${userId}::uuid and r.idempotency_key=${requestId}::uuid and r.result->'feedback'->>'rating' in ('like','dislike')
      and (${scope}::uuid is null or p.university_id=${scope}::uuid)`));
  if (!request) throw new AppError(404,"NOT_FOUND","This feedback is unavailable in your university scope.");
  const turns=await database(c.env).execute(sql`select idempotency_key request_id,created_at,result->>'prompt' prompt,result->>'text' response,
    result->'feedback'->>'rating' rating from app_private.ai_requests where user_id=${userId}::uuid and status='COMPLETED'
    and coalesce(result->>'threadId',idempotency_key::text)=${request.thread_id} and result ? 'text' order by created_at limit 60`);
  await recordAudit(c.env,{actorUserId:currentUser(c).id,universityId:scope,action:"ai.feedback.context.viewed",targetType:"ai_request",targetId:requestId,requestId:c.get("requestId"),metadata:{userId}});
  c.header("Cache-Control","private, no-store");
  return c.json({turns:turns.rows});
});

adminCommunityRoutes.get("/promoted-shops",async c=>{
 const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query("universityId"));
 const result=await database(c.env).execute(sql`select a.id vendor_profile_id,a.user_id,a.university_id,s.display_name,s.pickup_location,p.profile_image_url,
   coalesce((to_jsonb(p)->>'public_badge_verified')::boolean,false) verified,
   coalesce(promotion.active,false) active,coalesce(promotion.sort_order,0) sort_order,promotion.starts_at,promotion.ends_at
   from public.agent_profiles a join public.vendor_storefronts s on s.vendor_profile_id=a.id
   join public.profiles p on p.user_id=a.user_id left join public.marketplace_promotions promotion on promotion.vendor_profile_id=a.id
   where a.agent_type='VENDOR' and a.status='ACTIVE' and s.status='APPROVED' and (${scope}::uuid is null or a.university_id=${scope}::uuid)
   order by promotion.active desc nulls last,s.display_name limit 300`);
 c.header("Cache-Control","private, no-store");return c.json({shops:result.rows});
});
adminCommunityRoutes.put("/promoted-shops/:id",async c=>{
 const id=validId(c.req.param("id")),user=currentUser(c);
 const d=await input(c,z.object({active:z.boolean(),sortOrder:z.number().int().min(0).max(10000),endsAt:z.string().datetime().nullable().default(null),reason:z.string().trim().min(5).max(1000)}));
 if(d.endsAt && Date.parse(d.endsAt)<=Date.now())throw new AppError(400,"BAD_REQUEST","The promotion end must be in the future.");
 const shop=firstRow(await database(c.env).execute<{university_id:string;verified:boolean}>(sql`select a.university_id,coalesce((to_jsonb(p)->>'public_badge_verified')::boolean,false) verified
  from public.agent_profiles a join public.vendor_storefronts s on s.vendor_profile_id=a.id join public.profiles p on p.user_id=a.user_id
  where a.id=${id}::uuid and a.agent_type='VENDOR' and a.status='ACTIVE' and s.status='APPROVED'`));
 if(!shop)throw new AppError(404,"NOT_FOUND","Choose an active approved campus shop.");
 await resolveAdminScope(c.env,user,shop.university_id,"marketplace.manage");
 if(d.active&&!shop.verified)throw new AppError(409,"CONFLICT","Assign this account a public verification badge before promoting its shop.");
 await database(c.env).execute(sql`insert into public.marketplace_promotions(vendor_profile_id,institution_id,active,sort_order,ends_at,updated_by)
  values(${id}::uuid,${shop.university_id}::uuid,${d.active},${d.sortOrder},${d.endsAt}::timestamptz,${user.id}::uuid)
  on conflict(vendor_profile_id) do update set active=excluded.active,sort_order=excluded.sort_order,starts_at=now(),ends_at=excluded.ends_at,updated_by=excluded.updated_by,updated_at=now()`);
 await recordAudit(c.env,{actorUserId:user.id,universityId:shop.university_id,action:"marketplace.promotion.updated",targetType:"agent_profile",targetId:id,requestId:c.get("requestId"),metadata:d});return c.json({status:"saved"});
});
