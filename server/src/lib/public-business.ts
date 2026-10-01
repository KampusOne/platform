import { sql } from "drizzle-orm";
import { database, firstRow } from "./database";
import { AppError } from "./errors";
import { requireUnblocked, unblockedAuthor } from "./profile-safety";
import type { AuthenticatedUser, Bindings } from "../types";

type Service = {
  id: string;
  agent_type: "VENDOR" | "TUTOR" | "RIDER";
  user_id: string;
  display_name: string;
  biography: string | null;
  owner_name: string;
  username: string | null;
  profile_image_url: string | null;
  cover_image_url: string | null;
  public_details: Record<string, unknown>;
  follower_count: number;
  followed: boolean;
};
type Item = Record<string, unknown>;
const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** Public projection only. Never serialize application evidence or the full profile. */
export async function readPublicBusiness(
  env: Bindings,
  viewer: AuthenticatedUser,
  serviceId: string,
) {
  const db = database(env);
  const followerVisible = unblockedAuthor(viewer.id, sql`f.follower_id`);
  const record = firstRow(
    await db.execute<Service>(sql`
    select a.id,a.agent_type,a.user_id,a.display_name,a.biography,
      p.display_name as owner_name,p.username,p.profile_image_url,p.cover_image_url,
      coalesce(to_jsonb(a)->'public_details','{}'::jsonb) as public_details,
      (select count(*)::int from public.profile_follows f where f.followed_id=a.user_id and ${followerVisible}) as follower_count,
      exists(select 1 from public.profile_follows f where f.followed_id=a.user_id and f.follower_id=${viewer.id}::uuid) as followed
    from public.agent_profiles a
    join public.profiles p on p.user_id=a.user_id and p.deleted_at is null
    join public.users u on u.id=a.user_id and u.status::text='ACTIVE'
    where a.id=${serviceId}::uuid and a.university_id=${viewer.universityId}::uuid and a.status='ACTIVE'
    limit 1
  `),
  );
  if (!record)
    throw new AppError(
      404,
      "NOT_FOUND",
      "This campus business is not available.",
    );
  await requireUnblocked(env, viewer.id, record.user_id);
  const details = record.public_details;
  let store: Item | undefined,
    products: Item[] = [],
    tutorials: Item[] = [],
    reviews: Item[] = [];
  let commerceAvailable = false,
    completedTrips = 0;
  const reviewVisible = unblockedAuthor(viewer.id, sql`reviewer.user_id`);
  if (record.agent_type === "VENDOR" && env.PHASE_3_SCHEMA_READY === "true") {
    store = firstRow(
      await db.execute(sql`
      select display_name,description,contact_phone_e164,pickup_location,pickup_instructions,status
      from public.vendor_storefronts where vendor_profile_id=${record.id}::uuid
        and university_id=${viewer.universityId}::uuid and status='APPROVED'
    `),
    );
    commerceAvailable = !!store && env.STORE_ENABLED === "true";
    if (commerceAvailable) {
      const schema = firstRow(
        await db.execute<{ reviews: boolean }>(
          sql`select to_regclass('public.product_reviews') is not null as reviews`,
        ),
      );
      const results = await Promise.all([
        db.execute(sql`
          select p.id,p.name,p.description,p.price_kobo,p.stock_quantity,p.image_url,cat.name as category,
            count(*) over()::int as total_count
          from public.vendor_products p
          join public.product_categories cat on cat.id=p.category_id and cat.university_id=p.university_id and cat.status='APPROVED'
          where p.vendor_profile_id=${record.id}::uuid and p.university_id=${viewer.universityId}::uuid and p.status='PUBLISHED'
          order by p.updated_at desc,p.id limit 100
        `),
        schema?.reviews
          ? db.execute(sql`
          select r.id,r.rating,r.body,r.created_at,reviewer.display_name as reviewer_name,
            reviewer.profile_image_url as reviewer_image_url,reviewer.user_id as reviewer_id,
            p.name as item_name,true as verified_purchase,
            round(avg(r.rating) over()::numeric,1) as average_rating,count(*) over()::int as total_count
          from public.product_reviews r
          join public.vendor_products p on p.id=r.product_id and p.university_id=r.university_id
          join public.orders o on o.id=r.order_id and o.university_id=r.university_id
            and o.buyer_user_id=r.buyer_user_id and o.vendor_profile_id=p.vendor_profile_id and o.status='DELIVERED'
          join public.profiles reviewer on reviewer.user_id=r.buyer_user_id and reviewer.deleted_at is null
          where p.vendor_profile_id=${record.id}::uuid and r.university_id=${viewer.universityId}::uuid
            and r.status='PUBLISHED' and ${reviewVisible}
            and exists(select 1 from public.order_items item where item.order_id=o.id and item.product_id=p.id)
          order by r.created_at desc,r.id limit 20
        `)
          : Promise.resolve({ rows: [] }),
      ]);
      products = results[0].rows;
      reviews = results[1].rows;
    }
  } else if (record.agent_type === "TUTOR") {
    commerceAvailable =
      env.TUTORIALS_ENABLED === "true" && env.PHASE_2_SCHEMA_READY === "true";
    if (commerceAvailable) {
      const results = await Promise.all([
        db.execute(sql`
          select id,title,description,course_code,price_kobo,count(*) over()::int as total_count
          from public.tutorial_listings where tutor_profile_id=${record.id}::uuid
            and university_id=${viewer.universityId}::uuid and status='PUBLISHED'
            and review_status='APPROVED' and deleted_at is null and not is_demo order by updated_at desc,id limit 100
        `),
        db.execute(sql`
          select r.id,r.rating,r.body,r.created_at,reviewer.display_name as reviewer_name,
            reviewer.profile_image_url as reviewer_image_url,reviewer.user_id as reviewer_id,
            l.title as item_name,true as verified_purchase,
            round(avg(r.rating) over()::numeric,1) as average_rating,count(*) over()::int as total_count
          from public.tutorial_reviews r
          join public.tutorial_listings l on l.id=r.listing_id and l.university_id=r.university_id
          join public.tutorial_bookings b on b.id=r.booking_id and b.university_id=r.university_id
            and b.listing_id=l.id and b.student_user_id=r.student_user_id and b.status='COMPLETED'
          join public.profiles reviewer on reviewer.user_id=r.student_user_id and reviewer.deleted_at is null
          where l.tutor_profile_id=${record.id}::uuid and r.university_id=${viewer.universityId}::uuid
            and r.status='PUBLISHED' and ${reviewVisible}
          order by r.created_at desc,r.id limit 20
        `),
      ]);
      tutorials = results[0].rows;
      reviews = results[1].rows;
    }
  } else if (record.agent_type === "RIDER") {
    completedTrips = Number(
      firstRow(
        await db.execute(sql`
      select count(*)::int as total from public.delivery_jobs
      where rider_profile_id=${record.id}::uuid and university_id=${viewer.universityId}::uuid and status='DELIVERED'
    `),
      )?.total ?? 0,
    );
  }
  const categories = Array.isArray(details.categories)
    ? details.categories
        .filter((value): value is string => typeof value === "string")
        .slice(0, 8)
    : [
        ...new Set(
          products.map((item) => String(item.category ?? "")).filter(Boolean),
        ),
      ].slice(0, 8);
  return {
    service: {
      id: record.id,
      agent_type: record.agent_type,
      user_id: record.user_id,
      display_name:
        text(details.displayName) ??
        text(store?.display_name) ??
        record.display_name,
      biography:
        typeof details.biography === "string"
          ? details.biography
          : (text(store?.description) ?? record.biography),
      owner_name: record.owner_name,
      username: record.username,
      profile_image_url:
        text(details.profileImageUrl) ?? record.profile_image_url,
      cover_image_url: text(details.coverImageUrl) ?? record.cover_image_url,
      contact_phone_e164: text(details.phone),
      whatsapp_e164: text(details.whatsapp),
      pickup_location:
        text(details.pickupLocation) ?? text(store?.pickup_location),
      categories,
      follower_count: Number(record.follower_count),
      followed: record.followed,
      product_count: Number(products[0]?.total_count ?? 0),
      tutorial_count: Number(tutorials[0]?.total_count ?? 0),
      completed_trip_count: completedTrips,
      rating: Number(reviews[0]?.average_rating ?? 0),
      review_count: Number(reviews[0]?.total_count ?? 0),
      verified: true,
    },
    products,
    tutorials,
    reviews,
    commerceAvailable,
    isOwner: viewer.id === record.user_id,
  };
}
