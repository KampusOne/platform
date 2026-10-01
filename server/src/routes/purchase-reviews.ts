import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { database, firstRow } from "../lib/database";
import { id } from "../lib/input";
import { AppError } from "../lib/errors";
import { currentUser, requireAuth } from "../middleware/auth";
import {
  purchaseReviewSchemaReady,
  queueDuePurchaseReviews,
} from "../services/purchase-reviews";
import type { Bindings, Variables } from "../types";

export const purchaseReviewRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();
purchaseReviewRoutes.use("/*", requireAuth);
purchaseReviewRoutes.get("/", async (context) => {
  const user = currentUser(context);
  if (!(await purchaseReviewSchemaReady(context.env)))
    return context.json({ reminders: [], available: false });
  await queueDuePurchaseReviews(context.env, user.id);
  const result = await database(context.env).execute(sql`
    select r.id,r.resource_type,r.resource_id,
      case when r.resource_type='STORE_ORDER' then '/order-detail?id='||r.resource_id::text||'&review=1' else '/purchases' end as path,
      coalesce(s.display_name,l.title,'Your purchase') as purchase_name
    from app_private.purchase_review_reminders r
    left join public.orders o on r.resource_type='STORE_ORDER' and o.id=r.resource_id
    left join public.vendor_storefronts s on s.vendor_profile_id=o.vendor_profile_id
    left join public.tutorial_bookings b on r.resource_type='TUTORIAL_BOOKING' and b.id=r.resource_id
    left join public.tutorial_listings l on l.id=b.listing_id
    where r.user_id=${user.id}::uuid and r.university_id=${user.universityId}::uuid and r.state='PENDING'
      and r.due_at<=now() and r.due_at>now()-interval '30 days'
      and ((o.status='DELIVERED' and o.buyer_user_id=r.user_id and o.university_id=r.university_id
        and not exists(select 1 from public.product_reviews v where v.order_id=o.id and v.buyer_user_id=r.user_id))
        or (b.status='COMPLETED' and b.student_user_id=r.user_id and b.university_id=r.university_id
          and not exists(select 1 from public.tutorial_reviews v where v.booking_id=b.id and v.student_user_id=r.user_id)))
    order by r.due_at,r.id limit 10
  `);
  return context.json({ reminders: result.rows, available: true });
});
purchaseReviewRoutes.post("/:id/show", async (context) => {
  if (!(await purchaseReviewSchemaReady(context.env)))
    return context.json({ claimed: false });
  const user = currentUser(context),
    reminderId = id(context.req.param("id"));
  const claimed = firstRow(
    await database(context.env).execute(sql`
    update app_private.purchase_review_reminders r set state='SHOWN',shown_at=now(),updated_at=now()
    where r.id=${reminderId}::uuid and r.user_id=${user.id}::uuid and r.university_id=${user.universityId}::uuid
      and r.state='PENDING' and r.due_at<=now() and r.due_at>now()-interval '30 days'
      and ((r.resource_type='STORE_ORDER' and exists(select 1 from public.orders o where o.id=r.resource_id
        and o.status='DELIVERED' and o.buyer_user_id=r.user_id and o.university_id=r.university_id
        and not exists(select 1 from public.product_reviews v where v.order_id=o.id and v.buyer_user_id=r.user_id)))
        or (r.resource_type='TUTORIAL_BOOKING' and exists(select 1 from public.tutorial_bookings b where b.id=r.resource_id
          and b.status='COMPLETED' and b.student_user_id=r.user_id and b.university_id=r.university_id
          and not exists(select 1 from public.tutorial_reviews v where v.booking_id=b.id and v.student_user_id=r.user_id)))) returning r.id
  `),
  );
  return context.json({ claimed: Boolean(claimed) });
});
purchaseReviewRoutes.post("/:id/dismiss", async (context) => {
  if (!(await purchaseReviewSchemaReady(context.env)))
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "Review reminders are awaiting the database update.",
    );
  const user = currentUser(context);
  await database(context.env)
    .execute(sql`update app_private.purchase_review_reminders set state='DISMISSED',updated_at=now()
    where id=${id(context.req.param("id"))}::uuid and user_id=${user.id}::uuid and university_id=${user.universityId}::uuid and state in ('PENDING','SHOWN')`);
  return context.json({ dismissed: true });
});
