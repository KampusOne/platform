import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { currentUser, requireAuth } from "../middleware/auth";
import { input, id } from "../lib/input";
import { AppError } from "../lib/errors";
import { sha256 } from "../lib/security";
import { studentExperienceReady } from "../lib/student-ai-policy";
import { visiblePost } from "../lib/feed-social";
import type { Bindings, Variables, AuthenticatedUser } from "../types";
export const peopleRoutes = new Hono<{Bindings:Bindings;Variables:Variables}>();
peopleRoutes.use("/*",requireAuth);
peopleRoutes.use("/*",async(c,next)=>{c.header("Cache-Control","private, no-store"); if(!await studentExperienceReady(c.env)) throw new AppError(503,"PROVIDER_UNAVAILABLE","Student profiles are being updated. Please try again shortly."); await next();});

async function readService(env: Bindings, user: AuthenticatedUser, serviceId: string) {
  const db=database(env);
  // Role visibility controls discovery on the personal profile, not ownership on
  // a published storefront. Private contact/identity/approval data never appears.
  const service=firstRow(await db.execute<{id:string;agent_type:string;user_id:string;display_name:string;biography:string|null;owner_name:string;profile_image_url:string|null}>(sql`
    select a.id,a.agent_type,a.user_id,a.display_name,a.biography,p.display_name as owner_name,p.profile_image_url
    from public.agent_profiles a join public.profiles p on p.user_id=a.user_id and p.deleted_at is null
    join public.users u on u.id=p.user_id and u.status::text='ACTIVE'
    where a.id=${serviceId}::uuid and a.university_id=${user.universityId}::uuid and a.status='ACTIVE'`));
  if(!service) throw new AppError(404,"NOT_FOUND","This campus service is not available.");
  let products: Record<string,unknown>[]=[],tutorials:Record<string,unknown>[]=[];
  if(service.agent_type==='VENDOR') {
    if(env.STORE_ENABLED!=="true" || env.PHASE_3_SCHEMA_READY!=="true") throw new AppError(503,"PROVIDER_UNAVAILABLE","The campus store is not open yet.");
    const store=firstRow(await db.execute(sql`select display_name,description from public.vendor_storefronts where vendor_profile_id=${service.id}::uuid and university_id=${user.universityId}::uuid and status='APPROVED'`));
    if(!store) throw new AppError(404,"NOT_FOUND","This storefront is not available.");
    service.display_name=String(store.display_name); service.biography=String(store.description ?? '');
    products=(await db.execute(sql`select p.id,p.name,p.description,p.price_kobo,p.stock_quantity,p.image_url
      from public.vendor_products p join public.product_categories cat on cat.id=p.category_id and cat.university_id=p.university_id and cat.status='APPROVED'
      where p.vendor_profile_id=${service.id}::uuid and p.university_id=${user.universityId}::uuid and p.status='PUBLISHED' and p.stock_quantity>0 order by p.updated_at desc limit 100`)).rows;
  }
  if(service.agent_type==='TUTOR') {
    if(env.TUTORIALS_ENABLED!=="true" || env.PHASE_2_SCHEMA_READY!=="true") throw new AppError(503,"PROVIDER_UNAVAILABLE","Tutor discovery is not available right now.");
    tutorials=(await db.execute(sql`select id,title,description,course_code,price_kobo from public.tutorial_listings where tutor_profile_id=${service.id}::uuid and university_id=${user.universityId}::uuid and status='PUBLISHED' and review_status='APPROVED' and deleted_at is null and not is_demo order by updated_at desc limit 100`)).rows;
  }
  return {service,products,tutorials};
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
  const profile=firstRow(await db.execute(sql`select p.user_id,p.display_name,p.username,p.biography,p.profile_image_url,p.cover_image_url,p.current_level,
      uni.name as university_name,d.name as department_name,
      coalesce((to_jsonb(p)->>'public_badge_verified')::boolean,p.verification_status::text='VERIFIED',false) as verified,
      (select count(*)::int from public.profile_follows f where f.followed_id=p.user_id) as follower_count,
      exists(select 1 from public.profile_follows f where f.followed_id=p.user_id and f.follower_id=${u.id}::uuid) as followed,
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
peopleRoutes.put("/:id/follow",async c=>{
  const target=id(c.req.param("id")),u=currentUser(c),d=await input(c,z.object({follow:z.boolean()}).strict());
  if(target===u.id) throw new AppError(400,"BAD_REQUEST","You cannot follow yourself.");
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
