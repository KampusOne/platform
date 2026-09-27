import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { database } from "../lib/database";
import { featureEnabled } from "../lib/features";
import { currentUser, requireAuth } from "../middleware/auth";
import { profileSafetyReady, unblockedAuthor } from "../lib/profile-safety";
import type { Bindings, Variables } from "../types";
export const agentDiscoveryRoutes = new Hono<{Bindings:Bindings;Variables:Variables}>();
agentDiscoveryRoutes.use("/*",requireAuth);
agentDiscoveryRoutes.get("/popular-shops",async c=>{
  const user=currentUser(c);
  if(!user.universityId || !featureEnabled(c.env,"STORE_ENABLED"))return c.json({shops:[],enabled:false});
  const safety=await profileSafetyReady(c.env);
  const result=await database(c.env).execute(sql`select a.id vendor_profile_id,a.user_id,s.display_name,s.description,s.pickup_location,p.profile_image_url,
    coalesce((to_jsonb(p)->>'public_badge_verified')::boolean,false) verified
    from public.marketplace_promotions promotion join public.agent_profiles a on a.id=promotion.vendor_profile_id
    join public.vendor_storefronts s on s.vendor_profile_id=a.id and s.university_id=promotion.institution_id
    join public.profiles p on p.user_id=a.user_id
    where promotion.institution_id=${user.universityId}::uuid and a.university_id=promotion.institution_id
      and a.agent_type='VENDOR' and a.status='ACTIVE' and s.status='APPROVED'
      and promotion.active and promotion.starts_at<=now() and (promotion.ends_at is null or promotion.ends_at>now())
      and coalesce((to_jsonb(p)->>'public_badge_verified')::boolean,false)
      and ${safety?unblockedAuthor(user.id,sql`a.user_id`):sql`true`}
    order by promotion.sort_order,s.display_name limit 30`);
  c.header("Cache-Control","private, no-store");
  return c.json({shops:result.rows,enabled:true});
});
