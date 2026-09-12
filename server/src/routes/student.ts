import { sql } from "drizzle-orm";
import { Hono } from "hono";

import {
  completionConfirmationSchema,
  disputeSchema,
  gpaTermSchema,
  onboardingProfileSchema,
  productReviewSchema,
  storeOrderSchema,
  timetableEntrySchema,
  tutorialBookingSchema,
  tutorialCancellationSchema,
  tutorialReviewSchema,
} from "@kampusone/contracts";

import { database, firstRow, sqlClient } from "../lib/database";
import { AppError } from "../lib/errors";
import { featureEnabled, phase2SchemaReady, phase3SchemaReady, requireFeature } from "../lib/features";
import { deriveHandoffCode } from "../lib/security";
import { currentUser, requireAuth } from "../middleware/auth";
import type { Bindings, Variables } from "../types";

export const studentRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const defaultCampusTimeZone = "Africa/Lagos";
const weekdayNumber: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function campusClock(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: defaultCampusTimeZone,
    weekday: "short",
    year: "numeric",
  }).formatToParts(at).reduce<Record<string, string>>((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    timeZone: defaultCampusTimeZone,
    weekday: weekdayNumber[parts.weekday ?? ""] ?? at.getUTCDay(),
  };
}

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
  const currentCampusClock = campusClock();
  const today = currentCampusClock.weekday;

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
    campusClock: currentCampusClock,
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
  requireFeature(context.env, "TUTORIALS_ENABLED", "Tutorial discovery is not enabled in this environment.");
  const user = currentUser(context);
  const universityId = requireUniversity(user);
  const paidAccessEnabled = featureEnabled(context.env, "PAYMENTS_ENABLED");
  const query = context.req.query("q")?.trim();
  const search = query ? `%${query}%` : null;
  const resourceType = context.req.query("resourceType")?.trim().toUpperCase();
  const allowedResourceTypes = new Set(["PAST_QUESTION", "NOTE", "PDF", "AUDIOBOOK"]);
  if (resourceType && !allowedResourceTypes.has(resourceType)) {
    throw new AppError(400, "BAD_REQUEST", "Choose a valid learning-resource type.");
  }
  const [listings, resources] = await Promise.all([
    database(context.env).execute(sql`
      select listings.id, listings.course_id, listings.tutor_profile_id, listings.course_code, listings.title,
        listings.description, listings.format, listings.price_kobo, listings.capacity,
        listings.location_text, listings.cancellation_cutoff_hours, listings.is_demo,
        coalesce(profiles.display_name, listings.publisher_name, 'KampusOne tutor') as tutor_name,
        profiles.biography as tutor_biography,
        (profiles.verified_at is not null and not listings.is_demo) as tutor_verified,
        coalesce((select round(avg(reviews.rating)::numeric, 1) from public.tutorial_reviews reviews
          where reviews.listing_id = listings.id and reviews.status = 'PUBLISHED'), 0) as rating,
        (select count(*)::int from public.tutorial_reviews reviews
          where reviews.listing_id = listings.id and reviews.status = 'PUBLISHED') as review_count,
        (select count(*)::int from public.tutorial_bookings completed
          where completed.listing_id = listings.id and completed.status = 'COMPLETED') as completed_sessions,
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
      left join public.agent_profiles profiles on profiles.id = listings.tutor_profile_id
      where listings.university_id = ${universityId}::uuid
        and listings.status = 'PUBLISHED' and listings.review_status = 'APPROVED'
        and listings.deleted_at is null
        and (${paidAccessEnabled} or listings.price_kobo = 0)
        and (listings.is_demo or profiles.status = 'ACTIVE')
        and (${search}::text is null or listings.title ilike ${search}
          or listings.course_code ilike ${search}
          or coalesce(profiles.display_name, listings.publisher_name, '') ilike ${search})
        and exists (
          select 1 from public.tutorial_availability_windows windows
          where windows.listing_id = listings.id and windows.status = 'OPEN' and windows.starts_at > now()
            and (select count(*) from public.tutorial_bookings window_bookings
              where window_bookings.availability_window_id = windows.id and (
                window_bookings.status in ('CONFIRMED','COMPLETED') or
                (window_bookings.status = 'PENDING_PAYMENT' and window_bookings.payment_expires_at > now())
              )) < least(windows.capacity, listings.capacity)
        )
      order by listings.is_demo desc, listings.updated_at desc limit 100
    `),
    database(context.env).execute(sql`
      select resources.id, resources.listing_id, resources.course_code, resources.title,
        resources.description, resources.resource_type, resources.access_model,
        resources.price_kobo, resources.level_code, resources.batch_label,
        resources.publisher_name, resources.publisher_verified, resources.preview_text,
        resources.page_count, resources.duration_seconds, resources.download_count,
        resources.is_demo,
        case when resources.access_model = 'FREE' then resources.file_url else null end as file_url
      from public.tutorial_resources resources
      where resources.university_id = ${universityId}::uuid
        and resources.status = 'PUBLISHED' and resources.deleted_at is null
        and (${paidAccessEnabled} or resources.access_model <> 'PAID')
        and (${resourceType ?? null}::text is null or resources.resource_type = ${resourceType ?? null})
        and (${search}::text is null or resources.title ilike ${search}
          or resources.description ilike ${search} or resources.course_code ilike ${search}
          or resources.publisher_name ilike ${search})
      order by resources.is_demo desc, resources.updated_at desc limit 150
    `),
  ]);
  return context.json({ listings: listings.rows, resources: resources.rows });
});

studentRoutes.get("/tutorial-resources/:id", async (context) => {
  requireFeature(context.env, "TUTORIALS_ENABLED", "Learning resources are not enabled in this environment.");
  const user = currentUser(context);
  const result = await database(context.env).execute(sql`
    select resources.id, resources.listing_id, resources.course_code, resources.title,
      resources.description, resources.resource_type, resources.access_model,
      resources.price_kobo, resources.level_code, resources.batch_label,
      resources.publisher_name, resources.publisher_verified, resources.preview_text,
      resources.page_count, resources.duration_seconds, resources.download_count,
      resources.is_demo,
      case when resources.access_model = 'FREE' or exists (
        select 1 from public.tutorial_bookings bookings
        join public.tutorial_listings listings on listings.id = bookings.listing_id
        where bookings.student_user_id = ${user.id}::uuid
          and bookings.status in ('CONFIRMED','COMPLETED')
          and (bookings.listing_id = resources.listing_id
            or (resources.listing_id is null and upper(listings.course_code) = upper(resources.course_code)))
      ) then resources.file_url else null end as file_url,
      (resources.access_model = 'FREE' or exists (
        select 1 from public.tutorial_bookings bookings
        join public.tutorial_listings listings on listings.id = bookings.listing_id
        where bookings.student_user_id = ${user.id}::uuid
          and bookings.status in ('CONFIRMED','COMPLETED')
          and (bookings.listing_id = resources.listing_id
            or (resources.listing_id is null and upper(listings.course_code) = upper(resources.course_code)))
      )) as can_access
    from public.tutorial_resources resources
    where resources.id = ${context.req.param("id")}::uuid
      and resources.university_id = ${requireUniversity(user)}::uuid
      and resources.status = 'PUBLISHED' and resources.deleted_at is null
    limit 1
  `);
  const resource = firstRow(result);
  if (!resource) throw new AppError(404, "NOT_FOUND", "That learning resource is unavailable.");
  return context.json({ resource });
});

studentRoutes.post("/tutorial-bookings", async (context) => {
  requireFeature(context.env, "TUTORIALS_ENABLED", "Tutorial bookings are not enabled in this environment.");
  const user = currentUser(context);
  const parsed = tutorialBookingSchema.safeParse(await jsonBody(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "The tutorial booking request is invalid.");
  if (!featureEnabled(context.env, "PAYMENTS_ENABLED")) {
    const listing = await database(context.env).execute<{ price_kobo: number }>(sql`
      select price_kobo from public.tutorial_listings
      where id = ${parsed.data.listingId}::uuid
        and university_id = ${requireUniversity(user)}::uuid
        and deleted_at is null limit 1
    `);
    if (Number(firstRow(listing)?.price_kobo ?? 0) > 0) {
      throw new AppError(409, "CONFLICT", "Paid tutorials are not available during the free pilot.");
    }
  }
  const id = crypto.randomUUID();
  try {
    const result = await database(context.env).execute<{ id: string; amount_kobo: number }>(sql`
      select * from app_private.create_tutorial_booking(
        ${id}::uuid, ${requireUniversity(user)}::uuid, ${parsed.data.listingId}::uuid,
        ${parsed.data.availabilityWindowId}::uuid, ${user.id}::uuid
      )
    `);
    const booking = firstRow(result);
    const amountKobo = Number(booking?.amount_kobo ?? 0);
    return context.json({ id, status: amountKobo === 0 ? "CONFIRMED" : "PENDING_PAYMENT", amountKobo }, 201);
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
  requireFeature(context.env, "TUTORIALS_ENABLED", "Tutorial bookings are not enabled in this environment.");
  const user = currentUser(context);
  const parsed = completionConfirmationSchema.safeParse(await jsonBody(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Completion confirmation is required.");
  const result = await database(context.env).execute<{ id: string; tutor_confirmed_at: string | null }>(sql`
    update public.tutorial_bookings bookings set
      student_confirmed_at = coalesce(student_confirmed_at, now()),
      status = case when tutor_confirmed_at is not null then 'COMPLETED' else status end,
      completed_at = case when tutor_confirmed_at is not null then coalesce(completed_at, now()) else completed_at end,
      dispute_deadline = case when tutor_confirmed_at is not null then coalesce(dispute_deadline, now() + interval '48 hours') else dispute_deadline end,
      earnings_state = case when tutor_confirmed_at is not null then 'PENDING' else earnings_state end,
      updated_at = now()
    where bookings.id = ${context.req.param("id")}::uuid and bookings.student_user_id = ${user.id}::uuid
      and bookings.status = 'CONFIRMED'
      and exists (
        select 1 from public.tutorial_availability_windows windows
        where windows.id = bookings.availability_window_id
          and windows.listing_id = bookings.listing_id
          and windows.ends_at <= now()
      )
    returning id, tutor_confirmed_at
  `);
  const booking = firstRow(result);
  if (!booking) throw new AppError(409, "CONFLICT", "That booking cannot be confirmed.");
  return context.json({ status: booking.tutor_confirmed_at ? "COMPLETED" : "AWAITING_TUTOR" });
});

studentRoutes.post("/tutorial-bookings/:id/cancel", async (context) => {
  requireFeature(context.env, "TUTORIALS_ENABLED", "Tutorial bookings are not enabled in this environment.");
  const user = currentUser(context);
  const parsed = tutorialCancellationSchema.safeParse(await jsonBody(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Add a short reason for cancelling the tutorial.");
  const found = await database(context.env).execute<{
    id: string; university_id: string; amount_kobo: number; status: string;
    scheduled_for: string | null; cancellation_cutoff_hours: number;
  }>(sql`
    select bookings.id, bookings.university_id, bookings.amount_kobo, bookings.status,
      bookings.scheduled_for::text, listings.cancellation_cutoff_hours
    from public.tutorial_bookings bookings
    join public.tutorial_listings listings on listings.id = bookings.listing_id
    where bookings.id = ${context.req.param("id")}::uuid
      and bookings.student_user_id = ${user.id}::uuid
      and bookings.status in ('PENDING_PAYMENT','CONFIRMED')
    limit 1
  `);
  const booking = firstRow(found);
  if (!booking) throw new AppError(409, "CONFLICT", "That booking can no longer be cancelled.");
  const cutoff = booking.scheduled_for
    ? new Date(booking.scheduled_for).getTime() - Number(booking.cancellation_cutoff_hours) * 60 * 60 * 1000
    : Number.POSITIVE_INFINITY;
  if (Date.now() >= cutoff) {
    throw new AppError(409, "CONFLICT", "The cancellation window has closed. Report a problem so support can review it.");
  }

  if (Number(booking.amount_kobo) === 0 || booking.status === "PENDING_PAYMENT") {
    const updated = await database(context.env).execute<{ id: string }>(sql`
      update public.tutorial_bookings set status = 'CANCELLED',
        cancellation_reason = ${parsed.data.reason}, cancelled_at = now(),
        cancelled_by_user_id = ${user.id}::uuid, earnings_state = 'NOT_EARNED', updated_at = now()
      where id = ${booking.id}::uuid and student_user_id = ${user.id}::uuid
        and status = ${booking.status}
      returning id
    `);
    if (!firstRow(updated)) throw new AppError(409, "CONFLICT", "This booking changed while it was being cancelled.");
    return context.json({ status: "CANCELLED", refundReviewRequired: false });
  }

  const disputeId = crypto.randomUUID();
  const disputed = await database(context.env).execute<{ id: string }>(sql`
    with changed as (
      update public.tutorial_bookings set status = 'DISPUTED',
      cancellation_reason = ${parsed.data.reason}, cancelled_at = now(),
      cancelled_by_user_id = ${user.id}::uuid, earnings_state = 'RESERVED', updated_at = now()
      where id = ${booking.id}::uuid and status = 'CONFIRMED'
      returning id
    ), opened as (
      insert into public.disputes (
        id, university_id, opened_by_user_id, tutorial_booking_id, category, reason
      ) select
        ${disputeId}::uuid, ${booking.university_id}::uuid, ${user.id}::uuid,
        changed.id, 'OTHER', ${`Cancellation request: ${parsed.data.reason}`}
      from changed returning id
    ) select id from opened
  `);
  if (!firstRow(disputed)) throw new AppError(409, "CONFLICT", "This booking changed while it was being cancelled.");
  return context.json({ status: "DISPUTED", refundReviewRequired: true });
});

studentRoutes.post("/tutorial-reviews", async (context) => {
  requireFeature(context.env, "TUTORIALS_ENABLED", "Tutorial reviews are not enabled in this environment.");
  const user = currentUser(context);
  const parsed = tutorialReviewSchema.safeParse(await jsonBody(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Choose a rating and add a useful review.");
  const bookingResult = await database(context.env).execute<{
    id: string; university_id: string; listing_id: string;
  }>(sql`
    select id, university_id, listing_id from public.tutorial_bookings
    where id = ${parsed.data.bookingId}::uuid and student_user_id = ${user.id}::uuid
      and status = 'COMPLETED' limit 1
  `);
  const booking = firstRow(bookingResult);
  if (!booking) throw new AppError(403, "FORBIDDEN", "Only a student who completed this tutorial can review it.");
  const id = crypto.randomUUID();
  const inserted = await database(context.env).execute<{ id: string }>(sql`
    insert into public.tutorial_reviews (
      id, university_id, booking_id, listing_id, student_user_id, rating, body
    ) values (
      ${id}::uuid, ${booking.university_id}::uuid, ${booking.id}::uuid,
      ${booking.listing_id}::uuid, ${user.id}::uuid, ${parsed.data.rating}, ${parsed.data.body ?? null}
    ) on conflict (booking_id) do nothing returning id
  `);
  if (!firstRow(inserted)) throw new AppError(409, "CONFLICT", "You already reviewed this tutorial.");
  return context.json({ id, status: "PUBLISHED" }, 201);
});

studentRoutes.get("/store", async (context) => {
  requireFeature(context.env, "STORE_ENABLED", "The campus store is not enabled in this environment.");
  const user = currentUser(context);
  const category = context.req.query("category")?.trim();
  const query = context.req.query("q")?.trim();
  const search = query ? `%${query}%` : null;
  const [products, zones] = await Promise.all([
    database(context.env).execute(sql`
      select products.id, products.vendor_profile_id, products.name, products.description,
        products.category, products.price_kobo, products.stock_quantity, products.image_url,
        products.preparation_minutes, storefronts.display_name as vendor_name,
        coalesce(reviews.rating, 0) as rating, coalesce(reviews.review_count, 0)::int as review_count
      from public.vendor_products products
      join public.agent_profiles profiles
        on profiles.id = products.vendor_profile_id
        and profiles.agent_type = 'VENDOR'
        and profiles.status = 'ACTIVE'
      join public.vendor_storefronts storefronts
        on storefronts.vendor_profile_id = products.vendor_profile_id
        and storefronts.university_id = products.university_id
        and storefronts.status = 'APPROVED'
      join public.product_categories categories
        on categories.id = products.category_id
        and categories.university_id = products.university_id
        and categories.status = 'APPROVED'
      left join lateral (
        select avg(product_reviews.rating)::numeric(3,2) as rating, count(*)::int as review_count
        from public.product_reviews product_reviews
        where product_reviews.product_id = products.id and product_reviews.status = 'PUBLISHED'
      ) reviews on true
      where products.university_id = ${requireUniversity(user)}::uuid and products.status = 'PUBLISHED'
        and products.stock_quantity > 0
        and (${category ?? null}::text is null or products.category = ${category ?? null})
        and (${search}::text is null or products.name ilike ${search} or products.description ilike ${search})
      order by products.updated_at desc limit 200
    `),
    database(context.env).execute(sql`
      select id, name, base_fee_kobo, operating_hours, max_package_weight_grams,
        max_package_dimension_cm, earning_formula_version
      from public.delivery_zones
      where university_id = ${requireUniversity(user)}::uuid and active = true order by base_fee_kobo, name
    `),
  ]);
  return context.json({ products: products.rows, deliveryZones: zones.rows });
});

studentRoutes.post("/orders", async (context) => {
  requireFeature(context.env, "STORE_ENABLED", "Store orders are not enabled in this environment.");
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
      select * from app_private.create_store_order_v2(
        ${orderId}::uuid, ${universityId}::uuid, ${user.id}::uuid,
        ${parsed.data.vendorProfileId}::uuid, ${parsed.data.deliveryZoneId}::uuid,
        ${parsed.data.recipientName}, ${parsed.data.recipientPhoneE164},
        ${parsed.data.deliveryLocation}, ${parsed.data.deliveryLandmark ?? null},
        ${parsed.data.deliveryLatitude ?? null}, ${parsed.data.deliveryLongitude ?? null},
        ${parsed.data.deliveryNote ?? null},
        ${JSON.stringify(parsed.data.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })))}::jsonb,
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
    if (message.includes("BUYER_TENANT_MISMATCH")) {
      throw new AppError(403, "FORBIDDEN", "Your student profile does not belong to this order's university.");
    }
    if (message.includes("VENDOR_STOREFRONT_UNAVAILABLE")) {
      throw new AppError(409, "CONFLICT", "This vendor is not currently approved to receive store orders.");
    }
    throw error;
  }
});

studentRoutes.get("/orders/:id", async (context) => {
  if (!phase3SchemaReady(context.env)) {
    throw new AppError(503, "FEATURE_DISABLED", "Order details are waiting for the reviewed Phase 3 schema migration.");
  }
  const user = currentUser(context);
  const result = await database(context.env).execute<{
    id: string; status: string; university_id: string;
  }>(sql`
    select orders.id, orders.status, orders.university_id,
      orders.subtotal_kobo, orders.delivery_fee_kobo, orders.total_kobo,
      orders.delivery_note, orders.pricing_formula_version,
      orders.created_at, orders.updated_at, profiles.display_name as vendor_name,
      zones.name as zone_name,
      snapshots.recipient_name, snapshots.recipient_phone_e164,
      snapshots.delivery_location, snapshots.delivery_landmark,
      snapshots.latitude, snapshots.longitude
    from public.orders orders
    join public.agent_profiles profiles on profiles.id = orders.vendor_profile_id
    left join public.delivery_zones zones on zones.id = orders.delivery_zone_id
    left join public.order_delivery_snapshots snapshots on snapshots.order_id = orders.id
    where orders.id = ${context.req.param("id")}::uuid
      and orders.buyer_user_id = ${user.id}::uuid
    limit 1
  `);
  const order = firstRow(result);
  if (!order) throw new AppError(404, "NOT_FOUND", "That store order does not exist.");
  const [items, timeline, reviews] = await Promise.all([
    database(context.env).execute(sql`
      select items.product_id, items.quantity, items.unit_price_kobo,
        products.name, products.image_url
      from public.order_items items
      join public.vendor_products products on products.id = items.product_id
      where items.order_id = ${order.id}::uuid order by items.created_at, items.id
    `),
    database(context.env).execute(sql`
      select previous_status, status, source, note, metadata, occurred_at
      from public.order_status_events
      where order_id = ${order.id}::uuid order by occurred_at, id
    `),
    database(context.env).execute(sql`
      select id, product_id, rating, body, status, created_at
      from public.product_reviews
      where order_id = ${order.id}::uuid and buyer_user_id = ${user.id}::uuid
      order by created_at, id
    `),
  ]);
  const deliveryCode = ["PAID", "ACCEPTED", "READY", "IN_DELIVERY"].includes(order.status)
    ? (await deriveHandoffCode(context.env, order.id, "delivery")).code
    : undefined;
  return context.json({
    order: { ...order, ...(deliveryCode ? { delivery_code: deliveryCode } : {}) },
    items: items.rows,
    timeline: timeline.rows,
    reviews: reviews.rows,
  });
});

studentRoutes.post("/product-reviews", async (context) => {
  if (!phase3SchemaReady(context.env)) {
    throw new AppError(503, "FEATURE_DISABLED", "Product reviews are waiting for the reviewed Phase 3 schema migration.");
  }
  const user = currentUser(context);
  const parsed = productReviewSchema.safeParse(await jsonBody(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Choose a rating and add a useful review.");
  const id = crypto.randomUUID();
  try {
    await database(context.env).execute(sql`
      select * from app_private.create_product_review(
        ${id}::uuid, ${parsed.data.orderId}::uuid, ${parsed.data.productId}::uuid,
        ${user.id}::uuid, ${parsed.data.rating}::smallint, ${parsed.data.body ?? null}
      )
    `);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("VERIFIED_PURCHASE_REQUIRED")) {
      throw new AppError(403, "FORBIDDEN", "Only the buyer of a delivered product can review it.");
    }
    if (message.includes("PRODUCT_ALREADY_REVIEWED")) {
      throw new AppError(409, "CONFLICT", "You already reviewed this product.");
    }
    throw error;
  }
  return context.json({ id, status: "PUBLISHED" }, 201);
});

studentRoutes.get("/purchases", async (context) => {
  const user = currentUser(context);
  const bookingRecords = phase2SchemaReady(context.env)
    ? database(context.env).execute(sql`
        select bookings.id, bookings.status, bookings.amount_kobo, bookings.scheduled_for,
          windows.ends_at as completion_available_at,
          bookings.created_at, listings.title, listings.course_code,
          coalesce(profiles.display_name, listings.publisher_name, 'KampusOne tutor') as tutor_name,
          reviews.id as review_id, reviews.rating as review_rating
        from public.tutorial_bookings bookings
        join public.tutorial_listings listings on listings.id = bookings.listing_id
        left join public.agent_profiles profiles on profiles.id = listings.tutor_profile_id
        left join public.tutorial_reviews reviews on reviews.booking_id = bookings.id
        left join public.tutorial_availability_windows windows
          on windows.id = bookings.availability_window_id and windows.listing_id = bookings.listing_id
        where bookings.student_user_id = ${user.id}::uuid order by bookings.created_at desc limit 100
      `)
    : database(context.env).execute(sql`
        select bookings.id, bookings.status, bookings.amount_kobo, bookings.scheduled_for,
          windows.ends_at as completion_available_at,
          bookings.created_at, listings.title, listings.course_code,
          profiles.display_name as tutor_name,
          null::uuid as review_id, null::smallint as review_rating
        from public.tutorial_bookings bookings
        join public.tutorial_listings listings on listings.id = bookings.listing_id
        join public.agent_profiles profiles on profiles.id = listings.tutor_profile_id
        left join public.tutorial_availability_windows windows
          on windows.id = bookings.availability_window_id and windows.listing_id = bookings.listing_id
        where bookings.student_user_id = ${user.id}::uuid order by bookings.created_at desc limit 100
      `);
  const [bookings, orders] = await Promise.all([
    bookingRecords,
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
