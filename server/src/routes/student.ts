import { sql } from "drizzle-orm";
import { Hono } from "hono";

import {
  completionConfirmationSchema,
  disputeSchema,
  gpaTermSchema,
  onboardingProfileSchema,
  storeOrderSchema,
  timetableEntrySchema,
  tutorialBookingSchema,
} from "@kampusone/contracts";

import { database, firstRow, sqlClient } from "../lib/database";
import { AppError } from "../lib/errors";
import { requireFeature } from "../lib/features";
import { deriveHandoffCode } from "../lib/security";
import { currentUser, requireAuth } from "../middleware/auth";
import type { Bindings, Variables } from "../types";

export const studentRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

async function jsonBody(context: { req: { json(): Promise<unknown> } }) {
  return context.req.json().catch(() => null);
}

function requireUniversity(user: ReturnType<typeof currentUser>) {
  if (!user.universityId) {
    throw new AppError(409, "CONFLICT", "Complete your student profile before using this feature.", {
      onboardingRequired: true,
    });
  }
  return user.universityId;
}

studentRoutes.get("/catalog", async (context) => {
  const [universities, faculties, departments, courses] = await Promise.all([
    database(context.env).execute(sql`
      select id, name, slug, country, state
      from public.universities where deleted_at is null order by name
    `),
    database(context.env).execute(sql`
      select id, university_id, name, slug
      from public.faculties where deleted_at is null order by name
    `),
    database(context.env).execute(sql`
      select id, faculty_id, name, slug
      from public.departments where deleted_at is null order by name
    `),
    database(context.env).execute(sql`
      select id, department_id, name, code
      from public.courses where deleted_at is null order by code
    `),
  ]);
  return context.json({
    universities: universities.rows,
    faculties: faculties.rows,
    departments: departments.rows,
    courses: courses.rows,
  });
});

studentRoutes.use("/*", requireAuth);

studentRoutes.get("/me", async (context) => {
  const user = currentUser(context);
  const result = await database(context.env).execute(sql`
    select
      users.id, users.email, users.email_verified_at, users.roles,
      profiles.username, profiles.display_name, profiles.first_name, profiles.last_name,
      profiles.biography, profiles.profile_image_url, profiles.cover_image_url,
      profiles.university_id, universities.name as university_name,
      profiles.faculty_id, faculties.name as faculty_name,
      profiles.department_id, departments.name as department_name,
      profiles.course_id, courses.name as course_name,
      profiles.current_level, profiles.matriculation_number,
      profiles.graduation_year, profiles.verification_status,
      profiles.onboarding_step, profiles.onboarding_completed_at
    from public.users users
    join public.profiles profiles on profiles.user_id = users.id and profiles.deleted_at is null
    left join public.universities universities on universities.id = profiles.university_id
    left join public.faculties faculties on faculties.id = profiles.faculty_id
    left join public.departments departments on departments.id = profiles.department_id
    left join public.courses courses on courses.id = profiles.course_id
    where users.id = ${user.id}::uuid
    limit 1
  `);
  const profile = firstRow(result);
  if (!profile) throw new AppError(404, "NOT_FOUND", "Your profile could not be found.");
  return context.json({ profile, operatorRoles: user.operatorRoles });
});

studentRoutes.patch("/me/onboarding", async (context) => {
  const user = currentUser(context);
  const parsed = onboardingProfileSchema.safeParse(await jsonBody(context));
  if (!parsed.success) {
    throw new AppError(400, "BAD_REQUEST", "Check the school and profile details and try again.", {
      fields: parsed.error.flatten().fieldErrors,
    });
  }

  const selected = await database(context.env).execute<{ university_id: string }>(sql`
    select universities.id as university_id
    from public.universities universities
    join public.faculties faculties on faculties.university_id = universities.id
    join public.departments departments on departments.faculty_id = faculties.id
    left join public.courses courses on courses.department_id = departments.id
    where universities.id = ${parsed.data.universityId}::uuid
      and faculties.id = ${parsed.data.facultyId}::uuid
      and departments.id = ${parsed.data.departmentId}::uuid
      and (${parsed.data.courseId ?? null}::uuid is null or courses.id = ${parsed.data.courseId ?? null}::uuid)
      and universities.deleted_at is null
      and faculties.deleted_at is null
      and departments.deleted_at is null
    limit 1
  `);
  if (!firstRow(selected)) {
    throw new AppError(400, "BAD_REQUEST", "The selected school details do not belong together.");
  }

  const conflict = await database(context.env).execute(sql`
    select id from public.profiles
    where user_id <> ${user.id}::uuid and deleted_at is null
      and (username = ${parsed.data.username}
        or (university_id = ${parsed.data.universityId}::uuid
          and matriculation_number = ${parsed.data.matriculationNumber}))
    limit 1
  `);
  if (firstRow(conflict)) {
    throw new AppError(409, "CONFLICT", "That username or matriculation number is already in use.");
  }

  await database(context.env).execute(sql`
    update public.profiles set
      first_name = ${parsed.data.firstName},
      last_name = ${parsed.data.lastName},
      display_name = ${`${parsed.data.firstName} ${parsed.data.lastName}`},
      username = ${parsed.data.username},
      university_id = ${parsed.data.universityId}::uuid,
      faculty_id = ${parsed.data.facultyId}::uuid,
      department_id = ${parsed.data.departmentId}::uuid,
      course_id = ${parsed.data.courseId ?? null}::uuid,
      current_level = ${parsed.data.currentLevel},
      matriculation_number = ${parsed.data.matriculationNumber},
      graduation_year = ${parsed.data.graduationYear},
      onboarding_step = 'COMPLETE',
      onboarding_completed_at = coalesce(onboarding_completed_at, now()),
      updated_at = now()
    where user_id = ${user.id}::uuid and deleted_at is null
  `);
  return context.json({ status: "complete" });
});

studentRoutes.get("/home", async (context) => {
  const user = currentUser(context);
  const universityId = requireUniversity(user);
  const now = new Date();
  const today = now.getUTCDay();

  const [profile, timetable, posts, gpa] = await Promise.all([
    database(context.env).execute(sql`
      select first_name, display_name, current_level, verification_status
      from public.profiles where user_id = ${user.id}::uuid and deleted_at is null limit 1
    `),
    database(context.env).execute(sql`
      select id, title, course_code, venue, lecturer, day_of_week,
        to_char(starts_at, 'HH24:MI') as starts_at,
        to_char(ends_at, 'HH24:MI') as ends_at,
        reminder_minutes, reminder_enabled
      from public.timetable_entries
      where user_id = ${user.id}::uuid and status = 'ACTIVE'
        and day_of_week = ${today}
      order by starts_at limit 6
    `),
    database(context.env).execute(sql`
      select posts.id, posts.category, posts.title, posts.summary, posts.image_url,
        posts.urgent, posts.sponsored, posts.published_at, sources.name as source_name,
        exists(select 1 from public.feed_bookmarks bookmarks
          where bookmarks.post_id = posts.id and bookmarks.user_id = ${user.id}::uuid) as bookmarked
      from public.feed_posts posts
      join public.content_sources sources on sources.id = posts.source_id
      where posts.university_id = ${universityId}::uuid
        and posts.status in ('PUBLISHED', 'CORRECTED')
        and posts.published_at <= now()
      order by posts.urgent desc, posts.published_at desc limit 5
    `),
    database(context.env).execute(sql`
      select round(sum(quality_points) / nullif(sum(earned_units), 0), 3) as cgpa,
        sum(earned_units) as total_units
      from public.gpa_terms where user_id = ${user.id}::uuid
    `),
  ]);

  return context.json({
    profile: firstRow(profile),
    today: timetable.rows,
    updates: posts.rows,
    academics: firstRow(gpa) ?? { cgpa: null, total_units: 0 },
    generatedAt: new Date().toISOString(),
  });
});

studentRoutes.get("/feed", async (context) => {
  const user = currentUser(context);
  const universityId = requireUniversity(user);
  const category = context.req.query("category")?.toUpperCase();
  const result = await database(context.env).execute(sql`
    select posts.id, posts.category, posts.title, posts.summary, posts.body,
      posts.image_url, posts.urgent, posts.sponsored, posts.published_at,
      posts.correction_note, sources.name as source_name, sources.verified as source_verified,
      exists(select 1 from public.feed_bookmarks bookmarks
        where bookmarks.post_id = posts.id and bookmarks.user_id = ${user.id}::uuid) as bookmarked
    from public.feed_posts posts
    join public.content_sources sources on sources.id = posts.source_id
    where posts.university_id = ${universityId}::uuid
      and posts.status in ('PUBLISHED', 'CORRECTED')
      and posts.published_at <= now()
      and (${category ?? null}::text is null or posts.category = ${category ?? null})
    order by posts.urgent desc, posts.published_at desc
    limit 100
  `);
  return context.json({ posts: result.rows });
});

studentRoutes.put("/feed/:id/bookmark", async (context) => {
  const user = currentUser(context);
  await database(context.env).execute(sql`
    insert into public.feed_bookmarks (user_id, post_id)
    select ${user.id}::uuid, posts.id from public.feed_posts posts
    where posts.id = ${context.req.param("id")}::uuid and posts.university_id = ${requireUniversity(user)}::uuid
    on conflict do nothing
  `);
  return context.json({ bookmarked: true });
});

studentRoutes.delete("/feed/:id/bookmark", async (context) => {
  const user = currentUser(context);
  await database(context.env).execute(sql`
    delete from public.feed_bookmarks
    where user_id = ${user.id}::uuid and post_id = ${context.req.param("id")}::uuid
  `);
  return context.json({ bookmarked: false });
});

studentRoutes.get("/campus/places", async (context) => {
  const user = currentUser(context);
  const query = context.req.query("q")?.trim();
  const category = context.req.query("category")?.toUpperCase();
  const search = query ? `%${query}%` : null;
  const result = await database(context.env).execute(sql`
    select id, name, category, description, latitude, longitude,
      accessibility_notes, image_url, verified_at
    from public.campus_places
    where university_id = ${requireUniversity(user)}::uuid and status = 'PUBLISHED'
      and (${category ?? null}::text is null or category = ${category ?? null})
      and (${search}::text is null or name ilike ${search} or description ilike ${search})
    order by name limit 100
  `);
  return context.json({ places: result.rows });
});

studentRoutes.get("/timetable", async (context) => {
  const user = currentUser(context);
  const result = await database(context.env).execute(sql`
    select id, course_id, title, course_code, venue, lecturer, day_of_week,
      to_char(starts_at, 'HH24:MI') as starts_at,
      to_char(ends_at, 'HH24:MI') as ends_at,
      reminder_minutes, reminder_enabled, status
    from public.timetable_entries
    where user_id = ${user.id}::uuid and status <> 'ARCHIVED'
    order by day_of_week, starts_at
  `);
  return context.json({ entries: result.rows });
});

studentRoutes.post("/timetable", async (context) => {
  const user = currentUser(context);
  const parsed = timetableEntrySchema.safeParse(await jsonBody(context));
  if (!parsed.success) {
    throw new AppError(400, "BAD_REQUEST", "Check the timetable entry and try again.", {
      fields: parsed.error.flatten().fieldErrors,
    });
  }
  if (parsed.data.endsAt <= parsed.data.startsAt) {
    throw new AppError(400, "BAD_REQUEST", "The class must end after it starts.");
  }
  const id = crypto.randomUUID();
  await database(context.env).execute(sql`
    insert into public.timetable_entries (
      id, university_id, user_id, title, course_code, venue, lecturer,
      day_of_week, starts_at, ends_at, reminder_minutes, reminder_enabled
    ) values (
      ${id}::uuid, ${requireUniversity(user)}::uuid, ${user.id}::uuid,
      ${parsed.data.title}, ${parsed.data.courseCode ?? null}, ${parsed.data.venue ?? null},
      ${parsed.data.lecturer ?? null}, ${parsed.data.dayOfWeek}, ${parsed.data.startsAt}::time,
      ${parsed.data.endsAt}::time, ${parsed.data.reminderMinutes}, ${parsed.data.reminderEnabled}
    )
  `);
  return context.json({ id }, 201);
});

studentRoutes.delete("/timetable/:id", async (context) => {
  const user = currentUser(context);
  const result = await database(context.env).execute(sql`
    update public.timetable_entries set status = 'ARCHIVED', updated_at = now()
    where id = ${context.req.param("id")}::uuid and user_id = ${user.id}::uuid
    returning id
  `);
  if (!firstRow(result)) throw new AppError(404, "NOT_FOUND", "That timetable entry does not exist.");
  return context.json({ status: "archived" });
});

studentRoutes.get("/gpa", async (context) => {
  const user = currentUser(context);
  const result = await database(context.env).execute(sql`
    select terms.id, terms.session_label, terms.semester, terms.level_code,
      terms.gpa, terms.earned_units, terms.quality_points,
      coalesce(json_agg(json_build_object(
        'id', results.id, 'courseCode', results.course_code, 'courseTitle', results.course_title,
        'units', results.units, 'grade', results.grade, 'gradePoint', results.grade_point
      ) order by results.course_code) filter (where results.id is not null), '[]'::json) as results
    from public.gpa_terms terms
    left join public.gpa_results results on results.term_id = terms.id
    where terms.user_id = ${user.id}::uuid
    group by terms.id
    order by terms.session_label desc, terms.semester desc
  `);
  const summary = await database(context.env).execute(sql`
    select round(sum(quality_points) / nullif(sum(earned_units), 0), 3) as cgpa,
      sum(earned_units) as total_units, sum(quality_points) as quality_points
    from public.gpa_terms where user_id = ${user.id}::uuid
  `);
  return context.json({ terms: result.rows, summary: firstRow(summary) });
});

studentRoutes.post("/gpa", async (context) => {
  const user = currentUser(context);
  const parsed = gpaTermSchema.safeParse(await jsonBody(context));
  if (!parsed.success) {
    throw new AppError(400, "BAD_REQUEST", "Check the semester results and try again.", {
      fields: parsed.error.flatten().fieldErrors,
    });
  }
  const termId = crypto.randomUUID();
  const units = parsed.data.results.reduce((sum, result) => sum + result.units, 0);
  const qualityPoints = parsed.data.results.reduce((sum, result) => sum + result.units * result.gradePoint, 0);
  const gpa = qualityPoints / units;
  const client = sqlClient(context.env);
  await client.transaction([
    client`
      insert into public.gpa_terms (
        id, university_id, user_id, session_label, semester, level_code,
        gpa, earned_units, quality_points
      ) values (
        ${termId}::uuid, ${requireUniversity(user)}::uuid, ${user.id}::uuid,
        ${parsed.data.sessionLabel}, ${parsed.data.semester}, ${parsed.data.levelCode},
        ${gpa}, ${units}, ${qualityPoints}
      )
      on conflict (user_id, session_label, semester) do update set
        level_code = excluded.level_code, gpa = excluded.gpa,
        earned_units = excluded.earned_units, quality_points = excluded.quality_points,
        updated_at = now()
      returning id
    `,
    ...parsed.data.results.map((result) => client`
      insert into public.gpa_results (
        id, term_id, course_code, course_title, units, grade, grade_point
      ) values (
        ${crypto.randomUUID()}::uuid,
        (select id from public.gpa_terms where user_id = ${user.id}::uuid
          and session_label = ${parsed.data.sessionLabel} and semester = ${parsed.data.semester}),
        ${result.courseCode}, ${result.courseTitle}, ${result.units}, ${result.grade}, ${result.gradePoint}
      )
      on conflict (term_id, course_code) do update set
        course_title = excluded.course_title, units = excluded.units,
        grade = excluded.grade, grade_point = excluded.grade_point
    `),
  ]);
  return context.json({ gpa: Number(gpa.toFixed(3)), earnedUnits: units });
});

studentRoutes.get("/tutorials", async (context) => {
  requireFeature(context.env, "MARKETPLACE_ENABLED", "Tutorial discovery is not enabled in this environment.");
  const user = currentUser(context);
  const query = context.req.query("q")?.trim();
  const search = query ? `%${query}%` : null;
  const result = await database(context.env).execute(sql`
    select listings.id, listings.course_id, listings.course_code, listings.title,
      listings.description, listings.format, listings.price_kobo, listings.capacity,
      profiles.display_name as tutor_name, profiles.biography as tutor_biography,
      coalesce((
        select json_agg(json_build_object(
          'id', windows.id,
          'starts_at', windows.starts_at,
          'ends_at', windows.ends_at,
          'capacity', least(windows.capacity, listings.capacity),
          'booked_spaces', (
            select count(*)::int from public.tutorial_bookings window_bookings
            where window_bookings.availability_window_id = windows.id and (
              window_bookings.status in ('CONFIRMED','COMPLETED') or
              (window_bookings.status = 'PENDING_PAYMENT' and window_bookings.payment_expires_at > now())
            )
          )
        ) order by windows.starts_at)
        from public.tutorial_availability_windows windows
        where windows.listing_id = listings.id and windows.status = 'OPEN'
          and windows.starts_at > now()
          and (select count(*) from public.tutorial_bookings window_bookings
            where window_bookings.availability_window_id = windows.id and (
              window_bookings.status in ('CONFIRMED','COMPLETED') or
              (window_bookings.status = 'PENDING_PAYMENT' and window_bookings.payment_expires_at > now())
            )) < least(windows.capacity, listings.capacity)
      ), '[]'::json) as availability
    from public.tutorial_listings listings
    join public.agent_profiles profiles on profiles.id = listings.tutor_profile_id and profiles.status = 'ACTIVE'
    where listings.university_id = ${requireUniversity(user)}::uuid and listings.status = 'PUBLISHED'
      and (${search}::text is null or listings.title ilike ${search}
        or listings.course_code ilike ${search} or profiles.display_name ilike ${search})
      and exists (
        select 1 from public.tutorial_availability_windows windows
        where windows.listing_id = listings.id and windows.status = 'OPEN' and windows.starts_at > now()
          and (select count(*) from public.tutorial_bookings window_bookings
            where window_bookings.availability_window_id = windows.id and (
              window_bookings.status in ('CONFIRMED','COMPLETED') or
              (window_bookings.status = 'PENDING_PAYMENT' and window_bookings.payment_expires_at > now())
            )) < least(windows.capacity, listings.capacity)
      )
    order by listings.updated_at desc limit 100
  `);
  return context.json({ listings: result.rows });
});

studentRoutes.post("/tutorial-bookings", async (context) => {
  requireFeature(context.env, "MARKETPLACE_ENABLED", "Tutorial bookings are not enabled in this environment.");
  const user = currentUser(context);
  const parsed = tutorialBookingSchema.safeParse(await jsonBody(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "The tutorial booking request is invalid.");
  const id = crypto.randomUUID();
  try {
    const result = await database(context.env).execute<{ id: string; amount_kobo: number }>(sql`
      select * from app_private.create_tutorial_booking(
        ${id}::uuid, ${requireUniversity(user)}::uuid, ${parsed.data.listingId}::uuid,
        ${parsed.data.availabilityWindowId}::uuid, ${user.id}::uuid
      )
    `);
    const booking = firstRow(result);
    return context.json({ id, status: "PENDING_PAYMENT", amountKobo: Number(booking?.amount_kobo ?? 0) }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("TUTORIAL_FULL")) throw new AppError(409, "CONFLICT", "That tutorial is full.");
    if (message.includes("TUTORIAL_ALREADY_BOOKED")) throw new AppError(409, "CONFLICT", "You already have an active booking for that session.");
    if (message.includes("TUTORIAL_WINDOW_UNAVAILABLE")) throw new AppError(409, "CONFLICT", "That tutorial time is no longer available.");
    if (message.includes("TUTORIAL_UNAVAILABLE")) throw new AppError(404, "NOT_FOUND", "That tutorial is unavailable.");
    throw error;
  }
});

studentRoutes.post("/tutorial-bookings/:id/confirm", async (context) => {
  const user = currentUser(context);
  const parsed = completionConfirmationSchema.safeParse(await jsonBody(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Completion confirmation is required.");
  const result = await database(context.env).execute<{ id: string; tutor_confirmed_at: string | null }>(sql`
    update public.tutorial_bookings set
      student_confirmed_at = coalesce(student_confirmed_at, now()),
      status = case when tutor_confirmed_at is not null then 'COMPLETED' else status end,
      completed_at = case when tutor_confirmed_at is not null then coalesce(completed_at, now()) else completed_at end,
      dispute_deadline = case when tutor_confirmed_at is not null then coalesce(dispute_deadline, now() + interval '48 hours') else dispute_deadline end,
      earnings_state = case when tutor_confirmed_at is not null then 'PENDING' else earnings_state end,
      updated_at = now()
    where id = ${context.req.param("id")}::uuid and student_user_id = ${user.id}::uuid
      and status = 'CONFIRMED'
    returning id, tutor_confirmed_at
  `);
  const booking = firstRow(result);
  if (!booking) throw new AppError(409, "CONFLICT", "That booking cannot be confirmed.");
  return context.json({ status: booking.tutor_confirmed_at ? "COMPLETED" : "AWAITING_TUTOR" });
});

studentRoutes.get("/store", async (context) => {
  requireFeature(context.env, "MARKETPLACE_ENABLED", "The campus store is not enabled in this environment.");
  const user = currentUser(context);
  const category = context.req.query("category")?.trim();
  const query = context.req.query("q")?.trim();
  const search = query ? `%${query}%` : null;
  const [products, zones] = await Promise.all([
    database(context.env).execute(sql`
      select products.id, products.vendor_profile_id, products.name, products.description,
        products.category, products.price_kobo, products.stock_quantity, products.image_url,
        profiles.display_name as vendor_name
      from public.vendor_products products
      join public.agent_profiles profiles on profiles.id = products.vendor_profile_id and profiles.status = 'ACTIVE'
      where products.university_id = ${requireUniversity(user)}::uuid and products.status = 'PUBLISHED'
        and products.stock_quantity > 0
        and (${category ?? null}::text is null or products.category = ${category ?? null})
        and (${search}::text is null or products.name ilike ${search} or products.description ilike ${search})
      order by products.updated_at desc limit 200
    `),
    database(context.env).execute(sql`
      select id, name, base_fee_kobo from public.delivery_zones
      where university_id = ${requireUniversity(user)}::uuid and active = true order by base_fee_kobo, name
    `),
  ]);
  return context.json({ products: products.rows, deliveryZones: zones.rows });
});

studentRoutes.post("/orders", async (context) => {
  requireFeature(context.env, "MARKETPLACE_ENABLED", "Store orders are not enabled in this environment.");
  const user = currentUser(context);
  const parsed = storeOrderSchema.safeParse(await jsonBody(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Check the order details and try again.");
  if (new Set(parsed.data.items.map((item) => item.productId)).size !== parsed.data.items.length) {
    throw new AppError(400, "BAD_REQUEST", "Each product may appear only once in an order.");
  }
  const universityId = requireUniversity(user);
  const orderId = crypto.randomUUID();
  const [pickup, delivery] = await Promise.all([
    deriveHandoffCode(context.env, orderId, "pickup"),
    deriveHandoffCode(context.env, orderId, "delivery"),
  ]);
  try {
    const result = await database(context.env).execute<{
      id: string; subtotal_kobo: number; delivery_fee_kobo: number; total_kobo: number;
    }>(sql`
      select * from app_private.create_store_order(
        ${orderId}::uuid, ${universityId}::uuid, ${user.id}::uuid,
        ${parsed.data.vendorProfileId}::uuid, ${parsed.data.deliveryZoneId}::uuid,
        ${parsed.data.deliveryNote ?? null}, ${JSON.stringify(parsed.data.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })))}::jsonb,
        ${pickup.hash}, ${delivery.hash}
      )
    `);
    const order = firstRow(result);
    return context.json({ id: orderId, status: "PENDING_PAYMENT",
      subtotalKobo: Number(order?.subtotal_kobo ?? 0), deliveryFeeKobo: Number(order?.delivery_fee_kobo ?? 0),
      totalKobo: Number(order?.total_kobo ?? 0) }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("PRODUCT_UNAVAILABLE_OR_STOCK_LOW")) throw new AppError(409, "CONFLICT", "A product is unavailable or there is not enough stock.");
    if (message.includes("DELIVERY_ZONE_UNAVAILABLE")) throw new AppError(400, "BAD_REQUEST", "Choose an active delivery zone.");
    throw error;
  }
});

studentRoutes.get("/purchases", async (context) => {
  const user = currentUser(context);
  const [bookings, orders] = await Promise.all([
    database(context.env).execute(sql`
      select bookings.id, bookings.status, bookings.amount_kobo, bookings.scheduled_for,
        bookings.created_at, listings.title, listings.course_code,
        profiles.display_name as tutor_name
      from public.tutorial_bookings bookings
      join public.tutorial_listings listings on listings.id = bookings.listing_id
      join public.agent_profiles profiles on profiles.id = listings.tutor_profile_id
      where bookings.student_user_id = ${user.id}::uuid order by bookings.created_at desc limit 100
    `),
    database(context.env).execute(sql`
      select orders.id, orders.status, orders.subtotal_kobo, orders.delivery_fee_kobo,
        orders.total_kobo, orders.created_at, profiles.display_name as vendor_name
      from public.orders orders join public.agent_profiles profiles on profiles.id = orders.vendor_profile_id
      where orders.buyer_user_id = ${user.id}::uuid order by orders.created_at desc limit 100
    `),
  ]);
  const ordersWithCodes = await Promise.all(orders.rows.map(async (order) => ({
    ...order,
    ...(["PAID", "ACCEPTED", "READY", "IN_DELIVERY"].includes(String(order.status))
      ? { delivery_code: (await deriveHandoffCode(context.env, String(order.id), "delivery")).code }
      : {}),
  })));
  return context.json({ tutorialBookings: bookings.rows, orders: ordersWithCodes });
});

studentRoutes.post("/disputes", async (context) => {
  const user = currentUser(context);
  const parsed = disputeSchema.safeParse(await jsonBody(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Check the dispute details and try again.");
  const isBooking = parsed.data.resourceType === "TUTORIAL_BOOKING";
  const resource = isBooking
    ? await database(context.env).execute<{ id: string; university_id: string }>(sql`
        select id, university_id from public.tutorial_bookings where id = ${parsed.data.resourceId}::uuid
          and student_user_id = ${user.id}::uuid and status in ('CONFIRMED','COMPLETED') limit 1
      `)
    : await database(context.env).execute<{ id: string; university_id: string }>(sql`
        select id, university_id from public.orders where id = ${parsed.data.resourceId}::uuid
          and buyer_user_id = ${user.id}::uuid and status in ('PAID','ACCEPTED','READY','IN_DELIVERY','DELIVERED') limit 1
      `);
  const item = firstRow(resource);
  if (!item) throw new AppError(404, "NOT_FOUND", "That purchase cannot be disputed.");
  const id = crypto.randomUUID();
  const client = sqlClient(context.env);
  await client.transaction([
    client`insert into public.disputes (id, university_id, opened_by_user_id, tutorial_booking_id, order_id, category, reason)
      values (${id}::uuid, ${item.university_id}::uuid, ${user.id}::uuid,
        ${isBooking ? item.id : null}::uuid, ${isBooking ? null : item.id}::uuid, ${parsed.data.category}, ${parsed.data.reason})`,
    ...(isBooking
      ? [client`update public.tutorial_bookings set status = 'DISPUTED', earnings_state = 'RESERVED', updated_at = now() where id = ${item.id}::uuid`]
      : [client`update public.orders set status = 'DISPUTED', earnings_state = 'RESERVED', updated_at = now() where id = ${item.id}::uuid`]),
  ]);
  return context.json({ id, status: "OPEN" }, 201);
});
