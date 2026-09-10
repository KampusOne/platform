import { sql } from "drizzle-orm";
import { Hono } from "hono";

import {
  agentApplicationSchema,
  completionConfirmationSchema,
  handoffCodeSchema,
  listingStateSchema,
  orderStateSchema,
  payoutRequestSchema,
  riderPresenceSchema,
  tutorialAvailabilitySchema,
  tutorialListingSchema,
  vendorProductSchema,
} from "@kampusone/contracts";

import { recordAudit } from "../lib/audit";
import { database, firstRow, sqlClient } from "../lib/database";
import { AppError } from "../lib/errors";
import { requireFeature } from "../lib/features";
import { deriveHandoffCode, hashOtp } from "../lib/security";
import { currentUser, requireAuth } from "../middleware/auth";
import type { Bindings, Variables } from "../types";

export const agentRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();
agentRoutes.use("/*", requireAuth);

async function body(context: { req: { json(): Promise<unknown> } }) {
  return context.req.json().catch(() => null);
}

async function approvedProfile(env: Bindings, userId: string, type: "TUTOR" | "VENDOR" | "RIDER") {
  const result = await database(env).execute<{ id: string; university_id: string }>(sql`
    select id, university_id from public.agent_profiles
    where user_id = ${userId}::uuid and agent_type = ${type} and status = 'ACTIVE'
    limit 1
  `);
  const profile = firstRow(result);
  if (!profile) {
    throw new AppError(403, "FORBIDDEN", `Your ${type.toLowerCase()} application must be approved first.`);
  }
  return profile;
}

agentRoutes.get("/dashboard", async (context) => {
  const user = currentUser(context);
  const [applications, profiles, tutorialStats, vendorStats, deliveryStats, recentBookings, recentOrders] = await Promise.all([
    database(context.env).execute(sql`
      select id, agent_type, display_name, phone_e164, legal_name, kyc_status,
        bank_status, phone_verified_at, status, review_note, submitted_at,
        reviewed_at, updated_at
      from public.agent_applications where user_id = ${user.id}::uuid
      order by submitted_at desc
    `),
    database(context.env).execute(sql`
      select id, agent_type, display_name, biography, status, verified_at
      from public.agent_profiles where user_id = ${user.id}::uuid order by verified_at desc
    `),
    database(context.env).execute(sql`
      select count(distinct listings.id)::int as listings,
        count(bookings.id)::int as bookings,
        count(bookings.id) filter (where bookings.status = 'COMPLETED')::int as completed,
        coalesce(sum(bookings.amount_kobo) filter (where bookings.status in ('CONFIRMED','COMPLETED')), 0)::bigint as gross_revenue_kobo,
        coalesce(sum(bookings.amount_kobo) filter (where bookings.earnings_state = 'PENDING'), 0)::bigint as pending_earnings_kobo,
        coalesce(sum(bookings.amount_kobo) filter (where bookings.earnings_state = 'AVAILABLE'), 0)::bigint as available_earnings_kobo
      from public.agent_profiles profiles
      left join public.tutorial_listings listings on listings.tutor_profile_id = profiles.id
      left join public.tutorial_bookings bookings on bookings.listing_id = listings.id
      where profiles.user_id = ${user.id}::uuid and profiles.agent_type = 'TUTOR'
    `),
    database(context.env).execute(sql`
      with vendor_profiles as (
        select profiles.id from public.agent_profiles profiles
        where profiles.user_id = ${user.id}::uuid and profiles.agent_type = 'VENDOR'
      ), product_stats as (
        select count(*)::int as products from public.vendor_products products
        where products.vendor_profile_id in (select id from vendor_profiles)
      ), order_stats as (
        select count(*)::int as orders,
          count(*) filter (where orders.status = 'DELIVERED')::int as delivered,
          coalesce(sum(orders.subtotal_kobo) filter (where orders.status in ('PAID','ACCEPTED','READY','IN_DELIVERY','DELIVERED')), 0)::bigint as gross_revenue_kobo,
          coalesce(sum(orders.subtotal_kobo) filter (where orders.earnings_state = 'PENDING'), 0)::bigint as pending_earnings_kobo,
          coalesce(sum(orders.subtotal_kobo) filter (where orders.earnings_state = 'AVAILABLE'), 0)::bigint as available_earnings_kobo
        from public.orders orders where orders.vendor_profile_id in (select id from vendor_profiles)
      )
      select product_stats.products, order_stats.orders, order_stats.delivered,
        order_stats.gross_revenue_kobo, order_stats.pending_earnings_kobo,
        order_stats.available_earnings_kobo from product_stats cross join order_stats
    `),
    database(context.env).execute(sql`
      select count(jobs.id)::int as jobs,
        count(jobs.id) filter (where jobs.status = 'DELIVERED')::int as delivered,
        count(jobs.id) filter (where jobs.status in ('RESERVED','PICKED_UP'))::int as active,
        coalesce(sum(jobs.rider_earning_kobo) filter (where jobs.earnings_state = 'PENDING'), 0)::bigint as pending_earnings_kobo,
        coalesce(sum(jobs.rider_earning_kobo) filter (where jobs.earnings_state = 'AVAILABLE'), 0)::bigint as available_earnings_kobo
      from public.agent_profiles profiles
      left join public.delivery_jobs jobs on jobs.rider_profile_id = profiles.id
      where profiles.user_id = ${user.id}::uuid and profiles.agent_type = 'RIDER'
    `),
    database(context.env).execute(sql`
      select bookings.id, listings.title, bookings.status, bookings.amount_kobo,
        bookings.scheduled_for, bookings.created_at
      from public.tutorial_bookings bookings
      join public.tutorial_listings listings on listings.id = bookings.listing_id
      join public.agent_profiles profiles on profiles.id = listings.tutor_profile_id
      where profiles.user_id = ${user.id}::uuid order by bookings.created_at desc limit 12
    `),
    database(context.env).execute(sql`
      select orders.id, orders.status, orders.subtotal_kobo, orders.delivery_fee_kobo,
        orders.total_kobo, orders.created_at
      from public.orders orders
      join public.agent_profiles profiles on profiles.id = orders.vendor_profile_id
      where profiles.user_id = ${user.id}::uuid order by orders.created_at desc limit 12
    `),
  ]);

  return context.json({
    applications: applications.rows,
    profiles: profiles.rows,
    metrics: {
      tutorials: firstRow(tutorialStats),
      store: firstRow(vendorStats),
      deliveries: firstRow(deliveryStats),
    },
    activity: { bookings: recentBookings.rows, orders: recentOrders.rows },
  });
});

agentRoutes.post("/applications", async (context) => {
  const user = currentUser(context);
  const parsed = agentApplicationSchema.safeParse(await body(context));
  if (!parsed.success) {
    throw new AppError(400, "BAD_REQUEST", "Check the application details and try again.", {
      fields: parsed.error.flatten().fieldErrors,
    });
  }
  if (user.universityId && user.universityId !== parsed.data.universityId) {
    throw new AppError(403, "FORBIDDEN", "Apply through the university attached to your student profile.");
  }
  const id = crypto.randomUUID();
  const result = await database(context.env).execute<{ id: string; status: string }>(sql`
    insert into public.agent_applications (
      id, university_id, user_id, agent_type, display_name, phone_e164, statement,
      legal_name, address_text, emergency_contact_name, emergency_contact_phone,
      terms_version, terms_accepted_at, kyc_status
    ) values (
      ${id}::uuid, ${parsed.data.universityId}::uuid, ${user.id}::uuid,
      ${parsed.data.agentType}, ${parsed.data.displayName}, ${parsed.data.phoneE164}, ${parsed.data.statement},
      ${parsed.data.legalName}, ${parsed.data.address}, ${parsed.data.emergencyContactName},
      ${parsed.data.emergencyContactPhone}, ${parsed.data.termsVersion}, now(), 'PENDING'
    )
    on conflict (university_id, user_id, agent_type) do update set
      display_name = excluded.display_name, phone_e164 = excluded.phone_e164,
      statement = excluded.statement, legal_name = excluded.legal_name,
      address_text = excluded.address_text, emergency_contact_name = excluded.emergency_contact_name,
      emergency_contact_phone = excluded.emergency_contact_phone, terms_version = excluded.terms_version,
      terms_accepted_at = now(), kyc_status = 'PENDING', status = 'SUBMITTED', review_note = null,
      reviewer_user_id = null, reviewed_at = null, submitted_at = now(), updated_at = now()
    where agent_applications.status in ('DRAFT','NEEDS_CORRECTION','REJECTED')
    returning id, status
  `);
  const application = firstRow(result);
  if (!application) {
    throw new AppError(409, "CONFLICT", "This application is already under review or approved.");
  }
  await recordAudit(context.env, {
    actorUserId: user.id,
    universityId: parsed.data.universityId,
    action: "agent.application.submitted",
    targetType: "agent_application",
    targetId: application.id,
    requestId: context.get("requestId"),
    metadata: { agentType: parsed.data.agentType },
  });
  return context.json(application, 201);
});

agentRoutes.get("/tutorials", async (context) => {
  requireFeature(context.env, "MARKETPLACE_ENABLED", "Tutorial operations are not enabled in this environment.");
  const user = currentUser(context);
  const [listings, bookings] = await Promise.all([
    database(context.env).execute(sql`
      select listings.id, listings.course_code, listings.title, listings.description,
        listings.format, listings.price_kobo, listings.capacity, listings.status,
        listings.created_at, listings.updated_at
      from public.tutorial_listings listings
      join public.agent_profiles profiles on profiles.id = listings.tutor_profile_id
      where profiles.user_id = ${user.id}::uuid order by listings.updated_at desc
    `),
    database(context.env).execute(sql`
      select bookings.id, bookings.status, bookings.amount_kobo, bookings.scheduled_for,
        bookings.student_confirmed_at, bookings.tutor_confirmed_at, bookings.created_at,
        listings.course_code, listings.title,
        coalesce(student_profiles.display_name, student_users.email) as student_name
      from public.tutorial_bookings bookings
      join public.tutorial_listings listings on listings.id = bookings.listing_id
      join public.agent_profiles tutor_profiles on tutor_profiles.id = listings.tutor_profile_id
      join public.users student_users on student_users.id = bookings.student_user_id
      left join public.profiles student_profiles on student_profiles.user_id = student_users.id
      where tutor_profiles.user_id = ${user.id}::uuid
      order by bookings.created_at desc limit 200
    `),
  ]);
  return context.json({ listings: listings.rows, bookings: bookings.rows });
});

agentRoutes.post("/tutorials", async (context) => {
  requireFeature(context.env, "MARKETPLACE_ENABLED", "Tutorial operations are not enabled in this environment.");
  const user = currentUser(context);
  const parsed = tutorialListingSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Check the tutorial details and try again.");
  const profile = await approvedProfile(context.env, user.id, "TUTOR");
  const id = crypto.randomUUID();
  await database(context.env).execute(sql`
    insert into public.tutorial_listings (
      id, university_id, tutor_profile_id, course_id, course_code,
      title, description, format, price_kobo, capacity
    ) values (
      ${id}::uuid, ${profile.university_id}::uuid, ${profile.id}::uuid,
      ${parsed.data.courseId ?? null}::uuid, ${parsed.data.courseCode}, ${parsed.data.title},
      ${parsed.data.description}, ${parsed.data.format}, ${parsed.data.priceKobo}, ${parsed.data.capacity}
    )
  `);
  return context.json({ id, status: "DRAFT" }, 201);
});

agentRoutes.patch("/tutorials/:id/status", async (context) => {
  requireFeature(context.env, "MARKETPLACE_ENABLED", "Tutorial operations are not enabled in this environment.");
  const user = currentUser(context);
  const parsed = listingStateSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Choose a valid listing status.");
  const result = await database(context.env).execute<{ id: string }>(sql`
    update public.tutorial_listings listings set status = ${parsed.data.status}, updated_at = now()
    from public.agent_profiles profiles
    where listings.id = ${context.req.param("id")}::uuid
      and listings.tutor_profile_id = profiles.id and profiles.user_id = ${user.id}::uuid
      and profiles.agent_type = 'TUTOR' and profiles.status = 'ACTIVE'
      and (listings.status = ${parsed.data.status}
        or (listings.status = 'DRAFT' and ${parsed.data.status} in ('PUBLISHED','ARCHIVED'))
        or (listings.status = 'PUBLISHED' and ${parsed.data.status} in ('PAUSED','ARCHIVED'))
        or (listings.status = 'PAUSED' and ${parsed.data.status} in ('PUBLISHED','ARCHIVED')))
    returning listings.id
  `);
  if (!firstRow(result)) throw new AppError(409, "CONFLICT", "That tutorial status change is not allowed.");
  return context.json({ status: parsed.data.status });
});

agentRoutes.get("/tutorial-availability", async (context) => {
  const user = currentUser(context);
  const result = await database(context.env).execute(sql`
    select windows.id, windows.listing_id, listings.title, windows.starts_at,
      windows.ends_at, windows.capacity, windows.status,
      count(bookings.id) filter (where bookings.status in ('CONFIRMED','COMPLETED')
        or (bookings.status = 'PENDING_PAYMENT' and bookings.payment_expires_at > now()))::int as bookings
    from public.tutorial_availability_windows windows
    join public.tutorial_listings listings on listings.id = windows.listing_id
    join public.agent_profiles profiles on profiles.id = listings.tutor_profile_id
    left join public.tutorial_bookings bookings on bookings.availability_window_id = windows.id
    where profiles.user_id = ${user.id}::uuid
    group by windows.id, listings.title order by windows.starts_at
  `);
  return context.json({ windows: result.rows });
});

agentRoutes.post("/tutorial-availability", async (context) => {
  const user = currentUser(context);
  const parsed = tutorialAvailabilitySchema.safeParse(await body(context));
  if (!parsed.success || new Date(parsed.data.startsAt) <= new Date()
    || new Date(parsed.data.endsAt) <= new Date(parsed.data.startsAt)) {
    throw new AppError(400, "BAD_REQUEST", "Choose a valid future availability window.");
  }
  const listing = await database(context.env).execute<{ id: string }>(sql`
    select listings.id from public.tutorial_listings listings
    join public.agent_profiles profiles on profiles.id = listings.tutor_profile_id
    where listings.id = ${parsed.data.listingId}::uuid and profiles.user_id = ${user.id}::uuid
      and profiles.status = 'ACTIVE' limit 1
  `);
  if (!firstRow(listing)) throw new AppError(404, "NOT_FOUND", "That tutorial listing does not exist.");
  const id = crypto.randomUUID();
  await database(context.env).execute(sql`
    insert into public.tutorial_availability_windows (id, listing_id, starts_at, ends_at, capacity)
    values (${id}::uuid, ${parsed.data.listingId}::uuid, ${parsed.data.startsAt}::timestamptz,
      ${parsed.data.endsAt}::timestamptz, ${parsed.data.capacity})
  `);
  return context.json({ id, status: "OPEN" }, 201);
});

agentRoutes.post("/tutorial-bookings/:id/confirm", async (context) => {
  const user = currentUser(context);
  const parsed = completionConfirmationSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Completion confirmation is required.");
  const result = await database(context.env).execute<{ id: string; student_confirmed_at: string | null }>(sql`
    update public.tutorial_bookings bookings set
      tutor_confirmed_at = coalesce(tutor_confirmed_at, now()),
      status = case when student_confirmed_at is not null then 'COMPLETED' else status end,
      completed_at = case when student_confirmed_at is not null then coalesce(completed_at, now()) else completed_at end,
      dispute_deadline = case when student_confirmed_at is not null then coalesce(dispute_deadline, now() + interval '48 hours') else dispute_deadline end,
      earnings_state = case when student_confirmed_at is not null then 'PENDING' else earnings_state end,
      updated_at = now()
    from public.tutorial_listings listings
    join public.agent_profiles profiles on profiles.id = listings.tutor_profile_id
    where bookings.id = ${context.req.param("id")}::uuid and bookings.listing_id = listings.id
      and profiles.user_id = ${user.id}::uuid and bookings.status = 'CONFIRMED'
    returning bookings.id, bookings.student_confirmed_at
  `);
  if (!firstRow(result)) throw new AppError(409, "CONFLICT", "That booking cannot be confirmed.");
  return context.json({ status: firstRow(result)?.student_confirmed_at ? "COMPLETED" : "AWAITING_STUDENT" });
});

agentRoutes.get("/product-categories", async (context) => {
  const user = currentUser(context);
  const universityIds = await database(context.env).execute<{ university_id: string }>(sql`
    select distinct university_id from public.agent_profiles where user_id = ${user.id}::uuid
    union select university_id from public.agent_applications where user_id = ${user.id}::uuid
  `);
  const ids = universityIds.rows.map((item) => item.university_id);
  const result = ids.length ? await database(context.env).execute(sql`
    select id, university_id, name, listing_rules from public.product_categories
    where university_id = any(${ids}::uuid[]) and status = 'APPROVED' order by name
  `) : { rows: [] };
  return context.json({ categories: result.rows });
});

agentRoutes.get("/products", async (context) => {
  requireFeature(context.env, "MARKETPLACE_ENABLED", "Store operations are not enabled in this environment.");
  const user = currentUser(context);
  const result = await database(context.env).execute(sql`
    select products.id, products.name, products.description, products.category,
      products.price_kobo, products.stock_quantity, products.image_url,
      products.status, products.created_at, products.updated_at
    from public.vendor_products products
    join public.agent_profiles profiles on profiles.id = products.vendor_profile_id
    where profiles.user_id = ${user.id}::uuid order by products.updated_at desc
  `);
  return context.json({ products: result.rows });
});

agentRoutes.post("/products", async (context) => {
  requireFeature(context.env, "MARKETPLACE_ENABLED", "Store operations are not enabled in this environment.");
  const user = currentUser(context);
  const parsed = vendorProductSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Check the product details and try again.");
  const profile = await approvedProfile(context.env, user.id, "VENDOR");
  const categoryResult = await database(context.env).execute<{ id: string; name: string }>(sql`
    select id, name from public.product_categories
    where id = ${parsed.data.categoryId}::uuid and university_id = ${profile.university_id}::uuid
      and status = 'APPROVED' limit 1
  `);
  const category = firstRow(categoryResult);
  if (!category) throw new AppError(400, "BAD_REQUEST", "Choose an approved product category.");
  const id = crypto.randomUUID();
  await database(context.env).execute(sql`
    insert into public.vendor_products (
      id, university_id, vendor_profile_id, name, description,
      category, category_id, price_kobo, stock_quantity, image_url
    ) values (
      ${id}::uuid, ${profile.university_id}::uuid, ${profile.id}::uuid,
      ${parsed.data.name}, ${parsed.data.description}, ${category.name}, ${category.id}::uuid,
      ${parsed.data.priceKobo}, ${parsed.data.stockQuantity}, ${parsed.data.imageUrl ?? null}
    )
  `);
  return context.json({ id, status: "DRAFT" }, 201);
});

agentRoutes.patch("/products/:id/status", async (context) => {
  const user = currentUser(context);
  const parsed = listingStateSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Choose a valid product status.");
  const result = await database(context.env).execute<{ id: string }>(sql`
    update public.vendor_products products set status = ${parsed.data.status}, updated_at = now()
    from public.agent_profiles profiles, public.product_categories categories
    where products.id = ${context.req.param("id")}::uuid and products.vendor_profile_id = profiles.id
      and profiles.user_id = ${user.id}::uuid and profiles.agent_type = 'VENDOR'
      and profiles.status = 'ACTIVE' and categories.id = products.category_id
      and categories.status = 'APPROVED'
      and (products.status = ${parsed.data.status}
        or (products.status = 'DRAFT' and ${parsed.data.status} in ('PUBLISHED','ARCHIVED'))
        or (products.status = 'PUBLISHED' and ${parsed.data.status} in ('PAUSED','ARCHIVED'))
        or (products.status = 'PAUSED' and ${parsed.data.status} in ('PUBLISHED','ARCHIVED')))
    returning products.id
  `);
  if (!firstRow(result)) throw new AppError(409, "CONFLICT", "That product status change is not allowed.");
  return context.json({ status: parsed.data.status });
});

agentRoutes.get("/orders", async (context) => {
  const user = currentUser(context);
  const result = await database(context.env).execute(sql`
    select orders.id, orders.status, orders.subtotal_kobo, orders.delivery_fee_kobo,
      orders.total_kobo, orders.delivery_note, orders.created_at, orders.updated_at,
      zones.name as zone_name, count(items.id)::int as item_count
    from public.orders orders
    join public.agent_profiles profiles on profiles.id = orders.vendor_profile_id
    left join public.delivery_zones zones on zones.id = orders.delivery_zone_id
    left join public.order_items items on items.order_id = orders.id
    where profiles.user_id = ${user.id}::uuid
    group by orders.id, zones.name order by orders.created_at desc limit 200
  `);
  return context.json({ orders: result.rows });
});

agentRoutes.patch("/orders/:id/status", async (context) => {
  const user = currentUser(context);
  const parsed = orderStateSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Choose a valid order action.");
  const result = parsed.data.status === "CANCELLED"
    ? await database(context.env).execute<{ order_id: string; university_id: string }>(sql`
        select * from app_private.cancel_vendor_order(
          ${context.req.param("id")}::uuid, ${user.id}::uuid
        )
      `).then(({ rows }) => ({ rows: rows.map((row) => ({ id: row.order_id, university_id: row.university_id })) }))
    : await database(context.env).execute<{ id: string; university_id: string }>(sql`
        update public.orders orders set status = ${parsed.data.status}, updated_at = now()
        from public.agent_profiles profiles
        where orders.id = ${context.req.param("id")}::uuid and orders.vendor_profile_id = profiles.id
          and profiles.user_id = ${user.id}::uuid and profiles.status = 'ACTIVE'
          and orders.status = ${parsed.data.status === "ACCEPTED" ? "PAID" : "ACCEPTED"}
        returning orders.id, orders.university_id
      `);
  const order = firstRow(result);
  if (!order) throw new AppError(409, "CONFLICT", "That order action is not allowed from its current state.");
  await recordAudit(context.env, { actorUserId: user.id, universityId: order.university_id,
    action: `order.${parsed.data.status.toLowerCase()}`, targetType: "order", targetId: order.id,
    requestId: context.get("requestId"), ...(parsed.data.note ? { metadata: { note: parsed.data.note } } : {}) });
  return context.json({ status: parsed.data.status });
});

agentRoutes.get("/orders/:id/pickup-code", async (context) => {
  const user = currentUser(context);
  const result = await database(context.env).execute<{ id: string }>(sql`
    select orders.id from public.orders orders
    join public.agent_profiles profiles on profiles.id = orders.vendor_profile_id
    join public.delivery_jobs jobs on jobs.order_id = orders.id
    where orders.id = ${context.req.param("id")}::uuid and profiles.user_id = ${user.id}::uuid
      and orders.status in ('READY','IN_DELIVERY') and jobs.status in ('AVAILABLE','RESERVED') limit 1
  `);
  const order = firstRow(result);
  if (!order) throw new AppError(409, "CONFLICT", "The pickup code is available only for a ready order.");
  const code = await deriveHandoffCode(context.env, order.id, "pickup");
  return context.json({ code: code.code });
});

agentRoutes.get("/deliveries", async (context) => {
  requireFeature(context.env, "MARKETPLACE_ENABLED", "Delivery operations are not enabled in this environment.");
  const user = currentUser(context);
  const profile = await approvedProfile(context.env, user.id, "RIDER");
  const [result, presence] = await Promise.all([database(context.env).execute(sql`
    select jobs.id, jobs.order_id, zones.name as zone_name, jobs.status,
      jobs.rider_earning_kobo, jobs.earning_formula_version,
      jobs.reserved_at, jobs.picked_up_at, jobs.delivered_at, jobs.created_at
    from public.delivery_jobs jobs
    join public.delivery_zones zones on zones.id = jobs.zone_id
    where jobs.university_id = ${profile.university_id}::uuid
      and (jobs.status = 'AVAILABLE' or jobs.rider_profile_id = ${profile.id}::uuid)
    order by case when jobs.status = 'AVAILABLE' then 0 else 1 end, jobs.created_at
    limit 100
  `), database(context.env).execute(sql`
    select online, capacity_status, last_seen_at from public.rider_presence
    where rider_profile_id = ${profile.id}::uuid limit 1
  `)]);
  return context.json({ jobs: result.rows, presence: firstRow(presence) ?? { online: false, capacity_status: "AVAILABLE" } });
});

agentRoutes.put("/rider-presence", async (context) => {
  const user = currentUser(context);
  const parsed = riderPresenceSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Choose a valid rider availability state.");
  const profile = await approvedProfile(context.env, user.id, "RIDER");
  await database(context.env).execute(sql`
    insert into public.rider_presence (rider_profile_id, online, capacity_status, last_seen_at, updated_at)
    values (${profile.id}::uuid, ${parsed.data.online}, ${parsed.data.capacityStatus}, now(), now())
    on conflict (rider_profile_id) do update set online = excluded.online,
      capacity_status = excluded.capacity_status, last_seen_at = now(), updated_at = now()
  `);
  return context.json({ online: parsed.data.online, capacityStatus: parsed.data.capacityStatus });
});

agentRoutes.post("/deliveries/:id/reserve", async (context) => {
  requireFeature(context.env, "MARKETPLACE_ENABLED", "Delivery operations are not enabled in this environment.");
  const user = currentUser(context);
  const profile = await approvedProfile(context.env, user.id, "RIDER");
  let result;
  try {
    result = await database(context.env).execute<{ id: string }>(sql`
      select * from app_private.reserve_delivery_job(
        ${context.req.param("id")}::uuid, ${profile.id}::uuid
      )
    `);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    if (message.includes("RIDER_NOT_AVAILABLE") || message.includes("RIDER_AT_CAPACITY")) {
      throw new AppError(409, "CONFLICT", "Go online with available capacity before reserving one delivery.");
    }
    if (message.includes("DELIVERY_UNAVAILABLE")) {
      throw new AppError(409, "CONFLICT", "That delivery is no longer available.");
    }
    throw caught;
  }
  if (!firstRow(result)) throw new AppError(409, "CONFLICT", "That delivery is no longer available.");
  await recordAudit(context.env, {
    actorUserId: user.id, universityId: profile.university_id,
    action: "delivery.reserved", targetType: "delivery_job",
    targetId: context.req.param("id"), requestId: context.get("requestId"),
  });
  return context.json({ status: "RESERVED" });
});

agentRoutes.post("/deliveries/:id/pickup", async (context) => {
  const user = currentUser(context);
  const profile = await approvedProfile(context.env, user.id, "RIDER");
  const parsed = handoffCodeSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Enter the six-digit pickup code.");
  const result = await database(context.env).execute<{ result: string }>(sql`
    select app_private.confirm_delivery_pickup(
      ${context.req.param("id")}::uuid, ${profile.id}::uuid, ${user.id}::uuid,
      ${await hashOtp(context.env, parsed.data.code)}
    ) as result
  `);
  const outcome = firstRow(result)?.result ?? "INVALID_STATE";
  if (outcome === "LOCKED") throw new AppError(429, "RATE_LIMITED", "The pickup code is locked or expired. Contact support.");
  if (outcome === "INCORRECT") throw new AppError(400, "BAD_REQUEST", "That pickup code is not correct.");
  if (outcome === "ORDER_NOT_READY") throw new AppError(409, "CONFLICT", "The vendor has not marked this order ready for pickup.");
  if (outcome !== "PICKED_UP") throw new AppError(409, "CONFLICT", "That delivery is not waiting for pickup.");
  await recordAudit(context.env, { actorUserId: user.id, universityId: profile.university_id, action: "delivery.picked_up", targetType: "delivery_job", targetId: context.req.param("id"), requestId: context.get("requestId") });
  return context.json({ status: "PICKED_UP" });
});

agentRoutes.post("/deliveries/:id/complete", async (context) => {
  const user = currentUser(context);
  const profile = await approvedProfile(context.env, user.id, "RIDER");
  const parsed = handoffCodeSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Enter the six-digit delivery code.");
  const result = await database(context.env).execute<{ result: string }>(sql`
    select app_private.confirm_delivery_completion(
      ${context.req.param("id")}::uuid, ${profile.id}::uuid, ${user.id}::uuid,
      ${await hashOtp(context.env, parsed.data.code)}
    ) as result
  `);
  const outcome = firstRow(result)?.result ?? "INVALID_STATE";
  if (outcome === "LOCKED") throw new AppError(429, "RATE_LIMITED", "The delivery code is locked or expired. Contact support.");
  if (outcome === "INCORRECT") throw new AppError(400, "BAD_REQUEST", "That delivery code is not correct.");
  if (outcome !== "DELIVERED") throw new AppError(409, "CONFLICT", "That delivery is not ready for completion.");
  await recordAudit(context.env, { actorUserId: user.id, universityId: profile.university_id, action: "delivery.completed", targetType: "delivery_job", targetId: context.req.param("id"), requestId: context.get("requestId") });
  return context.json({ status: "DELIVERED" });
});

agentRoutes.get("/earnings", async (context) => {
  const user = currentUser(context);
  const [tutorials, store, deliveries, payouts] = await Promise.all([
    database(context.env).execute(sql`
      with earned as (
        select coalesce(sum(bookings.amount_kobo) filter (where bookings.earnings_state = 'PENDING'), 0)::bigint as pending_kobo,
          coalesce(sum(bookings.amount_kobo) filter (where bookings.earnings_state = 'AVAILABLE'), 0)::bigint as gross_available_kobo
        from public.tutorial_bookings bookings join public.tutorial_listings listings on listings.id = bookings.listing_id
        join public.agent_profiles profiles on profiles.id = listings.tutor_profile_id where profiles.user_id = ${user.id}::uuid
      ), payouts as (
        select coalesce(sum(requests.amount_kobo) filter (where requests.status in ('REQUESTED','IN_REVIEW','APPROVED','PROCESSING','FAILED')), 0)::bigint as reserved_kobo,
          coalesce(sum(requests.amount_kobo) filter (where requests.status = 'PAID'), 0)::bigint as withdrawn_kobo
        from public.payout_requests requests join public.agent_profiles profiles on profiles.id = requests.agent_profile_id
        where profiles.user_id = ${user.id}::uuid and profiles.agent_type = 'TUTOR'
      )
      select earned.pending_kobo,
        greatest(earned.gross_available_kobo - payouts.reserved_kobo - payouts.withdrawn_kobo, 0::bigint) as available_kobo,
        payouts.reserved_kobo, payouts.withdrawn_kobo from earned cross join payouts
    `),
    database(context.env).execute(sql`
      with earned as (
        select coalesce(sum(orders.subtotal_kobo) filter (where orders.earnings_state = 'PENDING'), 0)::bigint as pending_kobo,
          coalesce(sum(orders.subtotal_kobo) filter (where orders.earnings_state = 'AVAILABLE'), 0)::bigint as gross_available_kobo
        from public.orders orders join public.agent_profiles profiles on profiles.id = orders.vendor_profile_id where profiles.user_id = ${user.id}::uuid
      ), payouts as (
        select coalesce(sum(requests.amount_kobo) filter (where requests.status in ('REQUESTED','IN_REVIEW','APPROVED','PROCESSING','FAILED')), 0)::bigint as reserved_kobo,
          coalesce(sum(requests.amount_kobo) filter (where requests.status = 'PAID'), 0)::bigint as withdrawn_kobo
        from public.payout_requests requests join public.agent_profiles profiles on profiles.id = requests.agent_profile_id
        where profiles.user_id = ${user.id}::uuid and profiles.agent_type = 'VENDOR'
      )
      select earned.pending_kobo,
        greatest(earned.gross_available_kobo - payouts.reserved_kobo - payouts.withdrawn_kobo, 0::bigint) as available_kobo,
        payouts.reserved_kobo, payouts.withdrawn_kobo from earned cross join payouts
    `),
    database(context.env).execute(sql`
      with earned as (
        select coalesce(sum(jobs.rider_earning_kobo) filter (where jobs.earnings_state = 'PENDING'), 0)::bigint as pending_kobo,
          coalesce(sum(jobs.rider_earning_kobo) filter (where jobs.earnings_state = 'AVAILABLE'), 0)::bigint as gross_available_kobo
        from public.delivery_jobs jobs join public.agent_profiles profiles on profiles.id = jobs.rider_profile_id
        where profiles.user_id = ${user.id}::uuid
      ), payouts as (
        select coalesce(sum(requests.amount_kobo) filter (where requests.status in ('REQUESTED','IN_REVIEW','APPROVED','PROCESSING','FAILED')), 0)::bigint as reserved_kobo,
          coalesce(sum(requests.amount_kobo) filter (where requests.status = 'PAID'), 0)::bigint as withdrawn_kobo
        from public.payout_requests requests join public.agent_profiles profiles on profiles.id = requests.agent_profile_id
        where profiles.user_id = ${user.id}::uuid and profiles.agent_type = 'RIDER'
      )
      select earned.pending_kobo,
        greatest(earned.gross_available_kobo - payouts.reserved_kobo - payouts.withdrawn_kobo, 0::bigint) as available_kobo,
        payouts.reserved_kobo, payouts.withdrawn_kobo from earned cross join payouts
    `),
    database(context.env).execute(sql`
      select requests.id, requests.amount_kobo, requests.status, requests.requested_at,
        profiles.agent_type, profiles.display_name
      from public.payout_requests requests join public.agent_profiles profiles on profiles.id = requests.agent_profile_id
      where requests.requested_by_user_id = ${user.id}::uuid order by requests.requested_at desc limit 100
    `),
  ]);
  return context.json({ tutorials: firstRow(tutorials), store: firstRow(store),
    deliveries: firstRow(deliveries), payoutRequests: payouts.rows });
});

agentRoutes.post("/payouts", async (context) => {
  const user = currentUser(context);
  const parsed = payoutRequestSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Check the payout amount and account.");
  const profileResult = await database(context.env).execute<{ id: string; university_id: string; agent_type: string }>(sql`
    select id, university_id, agent_type from public.agent_profiles
    where id = ${parsed.data.agentProfileId}::uuid and user_id = ${user.id}::uuid and status = 'ACTIVE' limit 1
  `);
  const profile = firstRow(profileResult);
  if (!profile) throw new AppError(404, "NOT_FOUND", "That agent profile does not exist.");
  const application = await database(context.env).execute<{ bank_status: string }>(sql`
    select bank_status from public.agent_applications where user_id = ${user.id}::uuid
      and university_id = ${profile.university_id}::uuid and agent_type = ${profile.agent_type} limit 1
  `);
  if (firstRow(application)?.bank_status !== "VERIFIED") {
    throw new AppError(409, "CONFLICT", "A verified payout account is required before requesting a withdrawal.");
  }
  const id = crypto.randomUUID();
  try {
    await database(context.env).execute(sql`
      select * from app_private.request_agent_payout(
        ${id}::uuid, ${profile.id}::uuid, ${user.id}::uuid, ${parsed.data.amountKobo}::bigint
      )
    `);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    if (message.includes("PAYOUT_BALANCE_INSUFFICIENT")) {
      throw new AppError(409, "CONFLICT", "The requested amount is more than the available balance.");
    }
    if (message.includes("PAYOUT_ACCOUNT_UNVERIFIED")) {
      throw new AppError(409, "CONFLICT", "A verified payout account is required before requesting a withdrawal.");
    }
    if (message.includes("PAYOUT_PROFILE_UNAVAILABLE")) {
      throw new AppError(404, "NOT_FOUND", "That agent profile is no longer available.");
    }
    throw caught;
  }
  await recordAudit(context.env, { actorUserId: user.id, universityId: profile.university_id, action: "payout.requested", targetType: "payout_request", targetId: id, requestId: context.get("requestId"), metadata: { amountKobo: parsed.data.amountKobo } });
  return context.json({ id, status: "REQUESTED" }, 201);
});
