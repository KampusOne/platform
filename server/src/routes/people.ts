import { readPublicBusiness } from "../lib/public-business";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { currentUser, requireAuth } from "../middleware/auth";
import { input, id } from "../lib/input";
import { AppError } from "../lib/errors";
import { sha256 } from "../lib/security";
import { studentExperienceReady } from "../lib/student-ai-policy";
import {
  blockRelationship,
  requireProfileSafety,
  requireUnblocked,
  unblockedAuthor,
} from "../lib/profile-safety";
import { visiblePost } from "../lib/feed-social";
import { profilePostNotificationsReady } from "../services/profile-post-notifications";
import type { Bindings, Variables, AuthenticatedUser } from "../types";
export const peopleRoutes = new Hono<{Bindings:Bindings;Variables:Variables}>();
peopleRoutes.use("/*",requireAuth);
peopleRoutes.use("/*",async(c,next)=>{c.header("Cache-Control","private, no-store"); if(!await studentExperienceReady(c.env)) throw new AppError(503,"PROVIDER_UNAVAILABLE","Student profiles are being updated. Please try again shortly."); await next();});

async function readService(env: Bindings, user: AuthenticatedUser, serviceId: string) {
  return readPublicBusiness(env, user, serviceId);
}
peopleRoutes.get("/services/:id",async c=>c.json(await readService(c.env,currentUser(c),id(c.req.param("id")))));
peopleRoutes.get("/products/:id",async c=>{
  if(c.env.STORE_ENABLED!=="true" || c.env.PHASE_3_SCHEMA_READY!=="true") throw new AppError(503,"PROVIDER_UNAVAILABLE","The campus store is not open yet.");
  const productId=id(c.req.param("id"));
  const product=firstRow(await database(c.env).execute<{vendor_profile_id:string}>(sql`select vendor_profile_id from public.vendor_products where id=${productId}::uuid and university_id=${currentUser(c).universityId}::uuid and status='PUBLISHED' and stock_quantity>0`));
  if(!product) throw new AppError(404,"NOT_FOUND","This product is no longer available.");
  const result=await readService(c.env,currentUser(c),product.vendor_profile_id);
  if(!result.products.some(p=>p.id===productId)) throw new AppError(404,"NOT_FOUND","This product is no longer available.");
  return c.json({...result,selectedProductId:productId});
});
peopleRoutes.get("/:id",async c=>{
  const target=id(c.req.param("id")),u=currentUser(c),db=database(c.env);
  const relationship=await blockRelationship(c.env,u.id,target);
  if(relationship==="BLOCKED_BY_TARGET") {
    throw new AppError(403,"BLOCKED_BY_USER","You have been blocked by this person.",{relationship});
  }
  if(relationship==="BLOCKED_BY_VIEWER") {
    throw new AppError(404,"NOT_FOUND","This student profile is not available.",{relationship});
  }
  const notificationSubscriptionsReady=await profilePostNotificationsReady(c.env);
  const postNotificationsEnabled=notificationSubscriptionsReady
    ? sql`exists(select 1 from public.profile_post_notification_subscriptions subscriptions where subscriptions.subscriber_id=${u.id}::uuid and subscriptions.target_user_id=p.user_id)`
    : sql`false`;
  const visibleFollower=unblockedAuthor(u.id,sql`f.follower_id`);
  const visibleFollowing=unblockedAuthor(u.id,sql`f.followed_id`);
  const profile=firstRow(await db.execute(sql`select p.user_id,p.display_name,p.username,p.biography,p.profile_image_url,p.cover_image_url,p.current_level,
      uni.name as university_name,d.name as department_name,
      case when p.settings->>'hideCgpa' = 'false' then
        (select round(sum(g.quality_points)/nullif(sum(g.earned_units),0), 2) from public.gpa_terms g where g.user_id=p.user_id)
        else null end as cgpa,
      coalesce((to_jsonb(p)->>'public_badge_verified')::boolean,p.verification_status::text='VERIFIED',false) as verified,
      (p.user_id=${u.id}::uuid or not coalesce((p.settings->>'hideReposts')::boolean,false)) as can_view_reposts,
      (select count(*)::int from public.profile_follows f where f.followed_id=p.user_id and ${visibleFollower}) as follower_count,
      (select count(*)::int from public.profile_follows f where f.follower_id=p.user_id and ${visibleFollowing}) as following_count,
      exists(select 1 from public.profile_follows f where f.followed_id=p.user_id and f.follower_id=${u.id}::uuid) as followed,
      ${postNotificationsEnabled} as post_notifications_enabled,
      (select count(*)::int from public.feed_posts posts where posts.author_user_id=p.user_id and ${visiblePost(u.universityId ?? '00000000-0000-0000-0000-000000000000')}) as post_count,
      exists(select 1 from public.feed_posts posts where posts.author_user_id=p.user_id and posts.category='EVENT' and ${visiblePost(u.universityId ?? '00000000-0000-0000-0000-000000000000')}) as has_events
    from public.profiles p join public.users account on account.id=p.user_id and account.status::text='ACTIVE'
    left join public.universities uni on uni.id=p.university_id left join public.departments d on d.id=p.department_id
    where p.user_id=${target}::uuid and p.deleted_at is null`));
  if(!profile) throw new AppError(404,"NOT_FOUND","This student profile is not available.");
  const roles=await db.execute(sql`select a.id,a.agent_type from public.agent_profiles a join public.profiles p on p.user_id=a.user_id
    where a.user_id=${target}::uuid and a.university_id=${u.universityId}::uuid and a.status='ACTIVE'
      and coalesce(p.settings->'publicRoles'->>lower(a.agent_type),'true')='true'
    order by a.agent_type`);
  return c.json({profile,roles:roles.rows,isOwner:target===u.id});
});
const connectionPageSize=40;
async function ensureConnectionTarget(db:ReturnType<typeof database>,target:string){
  const row=firstRow(await db.execute(sql`select p.user_id from public.profiles p join public.users account on account.id=p.user_id and account.status::text='ACTIVE' where p.user_id=${target}::uuid and p.deleted_at is null limit 1`));
  if(!row) throw new AppError(404,"NOT_FOUND","This student profile is not available.");
}
function connectionProjection(viewer:AuthenticatedUser){
  return sql`p.user_id,p.display_name,p.username,p.profile_image_url,p.current_level,
    uni.name as university_name,d.name as department_name,
    coalesce((to_jsonb(p)->>'public_badge_verified')::boolean,p.verification_status::text='VERIFIED',false) as verified,
    exists(select 1 from public.profile_follows mine where mine.follower_id=${viewer.id}::uuid and mine.followed_id=p.user_id) as followed`;
}
peopleRoutes.get("/:id/followers",async c=>{
  const target=id(c.req.param("id")),viewer=currentUser(c),db=database(c.env);
  const cursorValue=c.req.query("cursor"),cursor=cursorValue?id(cursorValue):null;
  await requireUnblocked(c.env,viewer.id,target);
  await ensureConnectionTarget(db,target);
  const connectionVisible=unblockedAuthor(viewer.id,sql`p.user_id`);
  const result=await db.execute(sql`
    select ${connectionProjection(viewer)}
    from public.profile_follows f
    join public.profiles p on p.user_id=f.follower_id and p.deleted_at is null
    join public.users account on account.id=p.user_id and account.status::text='ACTIVE'
    left join public.universities uni on uni.id=p.university_id
    left join public.departments d on d.id=p.department_id
    where f.followed_id=${target}::uuid
      and ${connectionVisible}
      and (${cursor}::uuid is null or p.user_id>${cursor}::uuid)
    order by p.user_id
    limit ${connectionPageSize+1}
  `);
  const people=result.rows.slice(0,connectionPageSize) as Array<{user_id:string}>;
  return c.json({people,nextCursor:result.rows.length>connectionPageSize?people[people.length-1]?.user_id??null:null});
});
peopleRoutes.get("/:id/following",async c=>{
  const target=id(c.req.param("id")),viewer=currentUser(c),db=database(c.env);
  const cursorValue=c.req.query("cursor"),cursor=cursorValue?id(cursorValue):null;
  await requireUnblocked(c.env,viewer.id,target);
  await ensureConnectionTarget(db,target);
  const connectionVisible=unblockedAuthor(viewer.id,sql`p.user_id`);
  const result=await db.execute(sql`
    select ${connectionProjection(viewer)}
    from public.profile_follows f
    join public.profiles p on p.user_id=f.followed_id and p.deleted_at is null
    join public.users account on account.id=p.user_id and account.status::text='ACTIVE'
    left join public.universities uni on uni.id=p.university_id
    left join public.departments d on d.id=p.department_id
    where f.follower_id=${target}::uuid
      and ${connectionVisible}
      and (${cursor}::uuid is null or p.user_id>${cursor}::uuid)
    order by p.user_id
    limit ${connectionPageSize+1}
  `);
  const people=result.rows.slice(0,connectionPageSize) as Array<{user_id:string}>;
  return c.json({people,nextCursor:result.rows.length>connectionPageSize?people[people.length-1]?.user_id??null:null});
});

peopleRoutes.put("/:id/follow",async c=>{
  const target=id(c.req.param("id")),u=currentUser(c),d=await input(c,z.object({follow:z.boolean()}).strict());
  if(target===u.id) throw new AppError(400,"BAD_REQUEST","You cannot follow yourself.");
  await requireUnblocked(c.env,u.id,target);
  const db=database(c.env);
  const allowed=firstRow(await db.execute<{allowed:boolean}>(sql`select app_private.consume_request_rate_limit('PROFILE_FOLLOW',${await sha256(u.id)},120,3600,3600) as allowed`));
  if(!allowed?.allowed) throw new AppError(429,"RATE_LIMITED","Please wait before changing more follows.");
  if(d.follow) {
    const targetRow=firstRow(await db.execute(sql`select p.user_id from public.profiles p join public.users a on a.id=p.user_id and a.status::text='ACTIVE' where p.user_id=${target}::uuid and p.deleted_at is null`));
    if(!targetRow) throw new AppError(404,"NOT_FOUND","This student profile is not available.");
    await db.execute(sql`insert into public.profile_follows(follower_id,followed_id) values(${u.id}::uuid,${target}::uuid) on conflict do nothing`);
  } else await db.execute(sql`delete from public.profile_follows where follower_id=${u.id}::uuid and followed_id=${target}::uuid`);
  const counts=firstRow(await db.execute(sql`select count(*)::int as follower_count from public.profile_follows where followed_id=${target}::uuid`));
  return c.json({followed:d.follow,follower_count:counts?.follower_count ?? 0});
});

peopleRoutes.put("/:id/notifications",async c=>{
  const target=id(c.req.param("id")),u=currentUser(c);
  if(target===u.id) throw new AppError(400,"BAD_REQUEST","You cannot turn on post notifications for yourself.");
  if(!u.universityId) throw new AppError(409,"CONFLICT","Complete your student profile before changing post notifications.");
  await requireUnblocked(c.env,u.id,target);
  if(!await profilePostNotificationsReady(c.env)) throw new AppError(503,"PROVIDER_UNAVAILABLE","Post notifications are being connected. Please try again shortly.");
  const data=await input(c,z.object({enabled:z.boolean()}).strict());
  const db=database(c.env);
  const targetProfile=firstRow(await db.execute(sql`select p.user_id from public.profiles p join public.users account on account.id=p.user_id and account.status::text='ACTIVE' where p.user_id=${target}::uuid and p.deleted_at is null limit 1`));
  if(!targetProfile) throw new AppError(404,"NOT_FOUND","This student profile is not available.");
  if(data.enabled) await db.execute(sql`
    insert into public.profile_post_notification_subscriptions(subscriber_id,target_user_id,institution_id)
    values(${u.id}::uuid,${target}::uuid,${u.universityId}::uuid)
    on conflict(subscriber_id,target_user_id) do update set institution_id=excluded.institution_id
  `);
  else await db.execute(sql`
    delete from public.profile_post_notification_subscriptions
    where subscriber_id=${u.id}::uuid and target_user_id=${target}::uuid
  `);
  return c.json({enabled:data.enabled});
});

peopleRoutes.put("/:id/block",async c=>{
  await requireProfileSafety(c.env);
  const target=id(c.req.param("id")),u=currentUser(c);
  if(target===u.id) throw new AppError(400,"BAD_REQUEST","You cannot block yourself.");
  const data=await input(c,z.object({
    reason:z.string().trim().min(1).max(100).optional(),
    details:z.string().trim().min(1).max(1000).optional(),
  }).strict());
  const db=database(c.env);
  const profile=firstRow(await db.execute<{block_protected:boolean}>(sql`
    select p.user_id,coalesce(policy.block_protected,false) as block_protected
    from public.profiles p
    join public.users account on account.id=p.user_id and account.status::text='ACTIVE'
    left join public.profile_social_policies policy on policy.user_id=p.user_id
    where p.user_id=${target}::uuid and p.deleted_at is null
    limit 1`));
  if(!profile) throw new AppError(404,"NOT_FOUND","This student profile is not available.");
  if(profile.block_protected) throw new AppError(403,"FORBIDDEN","This profile cannot be blocked.");
  await db.execute(sql`
    insert into public.user_blocks(blocker_id,blocked_id,institution_id,reason,details)
    values(${u.id}::uuid,${target}::uuid,${u.universityId}::uuid,${data.reason??null},${data.details??null})
    on conflict(blocker_id,blocked_id) do update set
      reason=coalesce(excluded.reason,user_blocks.reason),
      details=coalesce(excluded.details,user_blocks.details)`);
  await db.execute(sql`
    delete from public.profile_follows
    where (follower_id=${u.id}::uuid and followed_id=${target}::uuid)
       or (follower_id=${target}::uuid and followed_id=${u.id}::uuid)`);
  return c.json({blocked:true});
});
peopleRoutes.delete("/:id/block",async c=>{
  await requireProfileSafety(c.env);
  const target=id(c.req.param("id")),u=currentUser(c);
  await database(c.env).execute(sql`
    delete from public.user_blocks
    where blocker_id=${u.id}::uuid and blocked_id=${target}::uuid`);
  return c.json({blocked:false});
});
