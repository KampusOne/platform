import { z } from "@kampusone/contracts";
import { input, id } from "../lib/input";
import { readPublicBusiness } from "../lib/public-business";
import { fulfilmentSchemaReady, requireFulfilmentSchema } from "../lib/fulfilment";
import { sql } from "drizzle-orm";
import { Hono, type Context } from "hono";

import {
  agentApplicationSchema,
  completionConfirmationSchema,
  handoffCodeSchema,
  orderStateSchema,
  payoutRequestSchema,
  riderPresenceSchema,
  tutorialAvailabilitySchema,
  tutorialListingSchema,
  tutorialListingStateSchema,
  tutorialNoShowSchema,
  tutorialResourceSchema,
  tutorialResourceStateSchema,
  vendorProductSchema,
  vendorProductStockSchema,
  vendorProductStateSchema,
  vendorProductUpdateSchema,
  vendorStorefrontSchema,
  vendorStorefrontStateSchema,
  storeFulfilmentSchema,
} from "@kampusone/contracts";

import { recordAudit } from "../lib/audit";
import { database, firstRow, sqlClient } from "../lib/database";
import { AppError } from "../lib/errors";
import {
  featureEnabled,
  phase3SchemaReady,
  requireFeature,
} from "../lib/features";
import { deriveHandoffCode, hashOtp } from "../lib/security";
import { requireFullKyc } from "../lib/kyc";
import { riderFinanceReady,riderFinanceSummary,reconcileRiderCommission } from '../lib/rider-finance';
import { initializePaystack } from '../lib/paystack';
import { inclusiveStoreReady } from '../lib/commerce-pricing';
import { pricedTutorialReady } from '../lib/tutorial-pricing';
import { currentUser, requireAuth } from "../middleware/auth";
import type { Bindings, Variables } from "../types";

export const agentRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();
agentRoutes.use("/*", requireAuth);

async function body(context: { req: { json(): Promise<unknown> } }) {
  return context.req.json().catch(() => null);
}

async function approvedProfile(
  env: Bindings,
  userId: string,
  type: "TUTOR" | "VENDOR" | "RIDER",
  universityId?: string | null,
) {
  const result = await database(env).execute<{
    id: string;
    university_id: string;
  }>(sql`
    select id, university_id from public.agent_profiles
    where user_id = ${userId}::uuid and agent_type = ${type} and status = 'ACTIVE'
      and (${universityId === undefined} or university_id=${universityId ?? null}::uuid)
    limit 1
  `);
  const profile = firstRow(result);
  if (!profile) {
    throw new AppError(
      403,
      "FORBIDDEN",
      `Your ${type.toLowerCase()} application must be approved first.`,
    );
  }
  return profile;
}

async function operationalVendorProfile(env: Bindings, userId: string) {
  const result = await database(env).execute<{
    id: string;
    university_id: string;
    storefront_status: string | null;
  }>(sql`
    select profiles.id, profiles.university_id, storefronts.status as storefront_status
    from public.agent_profiles profiles
    left join public.vendor_storefronts storefronts
      on storefronts.vendor_profile_id = profiles.id
    where profiles.user_id = ${userId}::uuid
      and profiles.agent_type = 'VENDOR'
      and profiles.status = 'ACTIVE'
    limit 1
  `);
  const profile = firstRow(result);
  if (!profile) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Your vendor application must be approved first.",
    );
  }
  if (profile.storefront_status === "SUSPENDED") {
    throw new AppError(
      403,
      "FORBIDDEN",
      "This storefront is suspended. Resolve the administrator review before changing store records.",
    );
  }
  return profile;
}


// Public business presentation is independent of commerce activation.
const publicBusinessSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  biography: z.string().trim().max(2000),
  categories: z.array(z.string().trim().min(2).max(50)).max(8),
  phone: z.string().trim().regex(/^\+234[789][0-9]{9}$/).nullable(),
  whatsapp: z.string().trim().regex(/^\+234[789][0-9]{9}$/).nullable(),
  pickupLocation: z.string().trim().max(500).nullable(),
  avatarMediaId: z.string().uuid().nullable().optional(),
  coverMediaId: z.string().uuid().nullable().optional(),
}).strict();

async function ownBusiness(context: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const user = currentUser(context);
  const row = firstRow(await database(context.env).execute<{ id: string; university_id: string; public_details: Record<string, unknown> }>(sql`
    select a.id,a.university_id,coalesce(to_jsonb(a)->'public_details','{}'::jsonb) as public_details
    from public.agent_profiles a where a.id=${id(context.req.param("id") ?? "")}::uuid
      and a.user_id=${user.id}::uuid and a.university_id=${user.universityId}::uuid and a.status='ACTIVE'
  `));
  if (!row) throw new AppError(404,"NOT_FOUND","This approved business profile is not available.");
  return row;
}

async function businessProfilesWritable(env: Bindings) {
  return !!firstRow(await database(env).execute<{ ready: boolean }>(sql`
    select exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='agent_profiles' and column_name='public_details') as ready
  `))?.ready;
}

agentRoutes.get("/public-profile/:id", async context => {
  const owned = await ownBusiness(context);
  const result = await readPublicBusiness(context.env,currentUser(context),owned.id);
  const s = result.service;
  return context.json({
    profile: {
      agentType:s.agent_type,
      displayName:s.display_name,biography:s.biography ?? "",categories:s.categories,
      phone:s.contact_phone_e164,whatsapp:s.whatsapp_e164,pickupLocation:s.pickup_location,
      profileImageUrl:s.profile_image_url,coverImageUrl:s.cover_image_url,
      avatarMediaId:owned.public_details.avatarMediaId ?? null,
      coverMediaId:owned.public_details.coverMediaId ?? null,
    },
    editable:await businessProfilesWritable(context.env),
  });
});

agentRoutes.put("/public-profile/:id", async context => {
  const owned = await ownBusiness(context);
  if (!await businessProfilesWritable(context.env))
    throw new AppError(503,"PROVIDER_UNAVAILABLE","Business profile editing is awaiting the scheduled database update.");
  const data = await input(context,publicBusinessSchema);
  const details: Record<string,unknown> = { ...owned.public_details,...data,categories:[...new Set(data.categories)] };
  for (const [field,urlField] of [["avatarMediaId","profileImageUrl"],["coverMediaId","coverImageUrl"]] as const) {
    const mediaId = data[field];
    if (mediaId === undefined) continue;
    if (!mediaId) { details[urlField]=null; continue; }
    const media = firstRow(await database(context.env).execute(sql`
      select id from public.media_objects where id=${mediaId}::uuid
        and owner_user_id=${currentUser(context).id}::uuid and institution_id=${owned.university_id}::uuid
        and kind='product' and content_type like 'image/%' and deleted_at is null
    `));
    if (!media) throw new AppError(400,"BAD_REQUEST","Choose a business photo uploaded by your own account.");
    const origin = (context.env.PUBLIC_API_ORIGIN ?? new URL(context.req.url).origin).replace(/\/$/,"");
    details[urlField]=origin+"/v1/media/"+mediaId;
  }
  const saved = firstRow(await database(context.env).execute(sql`
    update public.agent_profiles set display_name=${data.displayName},biography=${data.biography},
      public_details=${JSON.stringify(details)}::jsonb,updated_at=now()
    where id=${owned.id}::uuid and user_id=${currentUser(context).id}::uuid
      and university_id=${owned.university_id}::uuid and status='ACTIVE' returning id
  `));
  if (!saved) throw new AppError(409,"CONFLICT","This business is no longer available for editing.");
  await recordAudit(context.env,{actorUserId:currentUser(context).id,universityId:owned.university_id,
    action:"business.profile.updated",targetType:"agent_profile",targetId:owned.id,requestId:context.get("requestId")});
  return context.json({ saved:true,id:owned.id });
});

agentRoutes.get("/dashboard", async (context) => {
  const user = currentUser(context);
  const [
    applications,
    profiles,
    tutorialStats,
    vendorStats,
    deliveryStats,
    recentBookings,
    recentOrders,
  ] = await Promise.all([
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
  if (context.env.UNIFIED_SCHEMA_READY === "true")
    throw new AppError(
      409,
      "APPLICATION_UPDATED",
      "Use the current application form to include your verification documents.",
    );
  const user = currentUser(context);
  const parsed = agentApplicationSchema.safeParse(await body(context));
  if (!parsed.success) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Check the application details and try again.",
      {
        fields: parsed.error.flatten().fieldErrors,
      },
    );
  }
  if (user.universityId && user.universityId !== parsed.data.universityId) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Apply through the university attached to your student profile.",
    );
  }
  const id = crypto.randomUUID();
  const result = await database(context.env).execute<{
    id: string;
    status: string;
  }>(sql`
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
    throw new AppError(
      409,
      "CONFLICT",
      "This application is already under review or approved.",
    );
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
  requireFeature(
    context.env,
    "TUTORIALS_ENABLED",
    "Tutorial operations are not enabled in this environment.",
  );
  const user = currentUser(context);
  const [listings, bookings, resources] = await Promise.all([
    database(context.env).execute(sql`
      select listings.id, listings.course_code, listings.title, listings.description,
        listings.format, listings.price_kobo, listings.capacity, listings.status,
        listings.location_text, listings.cancellation_cutoff_hours,
        listings.review_status, listings.review_note, listings.submitted_at,
        listings.reviewed_at, listings.created_at, listings.updated_at
      from public.tutorial_listings listings
      join public.agent_profiles profiles on profiles.id = listings.tutor_profile_id
      where profiles.user_id = ${user.id}::uuid and listings.deleted_at is null
      order by listings.updated_at desc
    `),
    database(context.env).execute(sql`
      select bookings.id, bookings.listing_id, bookings.status, bookings.amount_kobo, bookings.scheduled_for,
        windows.ends_at as completion_available_at,
        (windows.ends_at <= now()) as completion_available,
        bookings.student_confirmed_at, bookings.tutor_confirmed_at, bookings.created_at,
        listings.course_code, listings.title,
        coalesce(student_profiles.display_name, student_users.email) as student_name
      from public.tutorial_bookings bookings
      join public.tutorial_listings listings on listings.id = bookings.listing_id
      join public.agent_profiles tutor_profiles on tutor_profiles.id = listings.tutor_profile_id
      join public.tutorial_availability_windows windows on windows.id = bookings.availability_window_id
      join public.users student_users on student_users.id = bookings.student_user_id
      left join public.profiles student_profiles on student_profiles.user_id = student_users.id
      where tutor_profiles.user_id = ${user.id}::uuid
      order by bookings.created_at desc limit 200
    `),
    database(context.env).execute(sql`
      select resources.id, resources.listing_id, resources.course_code, resources.title,
        resources.description, resources.resource_type, resources.access_model,
        resources.price_kobo, resources.level_code, resources.batch_label,
        resources.preview_text, resources.file_url, resources.page_count,
        resources.duration_seconds, resources.status, resources.review_note,
        resources.submitted_at, resources.reviewed_at, resources.created_at,
        resources.updated_at
      from public.tutorial_resources resources
      join public.agent_profiles profiles on profiles.id = resources.tutor_profile_id
      where profiles.user_id = ${user.id}::uuid and resources.deleted_at is null
      order by resources.updated_at desc
    `),
  ]);
  return context.json({
    listings: listings.rows,
    bookings: bookings.rows,
    resources: resources.rows,
  });
});

agentRoutes.post("/tutorials", async (context) => {
  requireFeature(
    context.env,
    "TUTORIALS_ENABLED",
    "Tutorial operations are not enabled in this environment.",
  );
  const user = currentUser(context);
  const parsed = tutorialListingSchema.safeParse(await body(context));
  if (!parsed.success)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Check the tutorial details and try again.",
    );
  if (
    parsed.data.priceKobo > 0 &&
    !featureEnabled(context.env, "PAYMENTS_ENABLED")
  ) {
    throw new AppError(
      409,
      "CONFLICT",
      "Payments are not connected yet. Free tutorials are available.",
    );
  }
  const profile = await approvedProfile(context.env, user.id, "TUTOR");
  const id = crypto.randomUUID();
  await database(context.env).execute(sql`
    insert into public.tutorial_listings (
      id, university_id, tutor_profile_id, course_id, course_code,
      title, description, format, price_kobo, capacity, publisher_name,
      location_text, cancellation_cutoff_hours
    ) values (
      ${id}::uuid, ${profile.university_id}::uuid, ${profile.id}::uuid,
      ${parsed.data.courseId ?? null}::uuid, ${parsed.data.courseCode}, ${parsed.data.title},
      ${parsed.data.description}, ${parsed.data.format}, ${parsed.data.priceKobo}, ${parsed.data.capacity},
      (select display_name from public.agent_profiles where id = ${profile.id}::uuid),
      ${parsed.data.locationText ?? null}, ${parsed.data.cancellationCutoffHours}
    )
  `);
  return context.json({ id, status: "DRAFT" }, 201);
});

agentRoutes.patch("/tutorials/:id/status", async (context) => {
  requireFeature(
    context.env,
    "TUTORIALS_ENABLED",
    "Tutorial operations are not enabled in this environment.",
  );
  const user = currentUser(context);
  const parsed = tutorialListingStateSchema.safeParse(await body(context));
  if (!parsed.success)
    throw new AppError(400, "BAD_REQUEST", "Choose a valid listing status.");
  const result = await database(context.env).execute<{ id: string }>(sql`
    update public.tutorial_listings listings set
      status = ${parsed.data.status},
      review_status = case when ${parsed.data.status} = 'SUBMITTED' then 'PENDING' else review_status end,
      submitted_at = case when ${parsed.data.status} = 'SUBMITTED' then now() else submitted_at end,
      review_note = case when ${parsed.data.status} = 'SUBMITTED' then null else review_note end,
      updated_at = now()
    from public.agent_profiles profiles
    where listings.id = ${context.req.param("id")}::uuid
      and listings.tutor_profile_id = profiles.id and profiles.user_id = ${user.id}::uuid
      and profiles.agent_type = 'TUTOR' and profiles.status = 'ACTIVE'
      and listings.deleted_at is null
      and (listings.status = ${parsed.data.status}
        or (listings.status in ('DRAFT','REJECTED') and ${parsed.data.status} in ('SUBMITTED','ARCHIVED'))
        or (listings.status = 'PUBLISHED' and ${parsed.data.status} in ('PAUSED','ARCHIVED'))
        or (listings.status = 'PAUSED' and ${parsed.data.status} in ('SUBMITTED','ARCHIVED')))
    returning listings.id
  `);
  if (!firstRow(result))
    throw new AppError(
      409,
      "CONFLICT",
      "That tutorial status change is not allowed.",
    );
  return context.json({ status: parsed.data.status });
});

agentRoutes.post("/tutorial-resources", async (context) => {
  requireFeature(
    context.env,
    "TUTORIALS_ENABLED",
    "Learning-resource operations are not enabled in this environment.",
  );
  const user = currentUser(context);
  const parsed = tutorialResourceSchema.safeParse(await body(context));
  if (!parsed.success) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Check the learning-resource details and try again.",
      {
        fields: parsed.error.flatten().fieldErrors,
      },
    );
  }
  if (
    parsed.data.accessModel === "PAID" &&
    !featureEnabled(context.env, "PAYMENTS_ENABLED")
  ) {
    throw new AppError(
      409,
      "CONFLICT",
      "Payments are not connected yet. Free resources are available.",
    );
  }
  let fileUrl = parsed.data.fileUrl ?? null;
  if (context.env.UNIFIED_SCHEMA_READY === "true") {
    if (!parsed.data.mediaId)
      throw new AppError(
        400,
        "BAD_REQUEST",
        "Upload the resource from your device.",
      );
    const owned = firstRow(
      await database(context.env).execute(
        sql`select id from public.media_objects where id=${parsed.data.mediaId}::uuid and owner_user_id=${user.id}::uuid and kind='resource' and deleted_at is null`,
      ),
    );
    if (!owned)
      throw new AppError(403, "FORBIDDEN", "Choose a resource you uploaded.");
    fileUrl =
      (
        context.env.PUBLIC_API_ORIGIN ?? new URL(context.req.url).origin
      ).replace(/\/$/, "") +
      "/v1/media/" +
      parsed.data.mediaId;
  }
  const profile = await approvedProfile(context.env, user.id, "TUTOR");
  if (parsed.data.listingId) {
    const listing = await database(context.env).execute<{ id: string }>(sql`
      select id from public.tutorial_listings
      where id = ${parsed.data.listingId}::uuid and tutor_profile_id = ${profile.id}::uuid
        and deleted_at is null limit 1
    `);
    if (!firstRow(listing))
      throw new AppError(
        400,
        "BAD_REQUEST",
        "Choose one of your active tutorial listings.",
      );
  }
  const id = crypto.randomUUID();
  await database(context.env).execute(sql`
    insert into public.tutorial_resources (
      id, university_id, tutor_profile_id, listing_id, course_id, course_code,
      title, description, resource_type, access_model, price_kobo, level_code,
      batch_label, publisher_name, publisher_verified, preview_text, file_url,
      page_count, duration_seconds${context.env.UNIFIED_SCHEMA_READY === "true" ? sql`,media_object_id` : sql``}
    ) values (
      ${id}::uuid, ${profile.university_id}::uuid, ${profile.id}::uuid,
      ${parsed.data.listingId ?? null}::uuid, ${parsed.data.courseId ?? null}::uuid,
      ${parsed.data.courseCode}, ${parsed.data.title}, ${parsed.data.description},
      ${parsed.data.resourceType}, ${parsed.data.accessModel}, ${parsed.data.priceKobo},
      ${parsed.data.levelCode ?? null}, ${parsed.data.batchLabel ?? null},
      (select display_name from public.agent_profiles where id = ${profile.id}::uuid),
      true, ${parsed.data.previewText ?? null}, ${fileUrl},
      ${parsed.data.pageCount ?? null}, ${parsed.data.durationSeconds ?? null}${context.env.UNIFIED_SCHEMA_READY === "true" ? sql`,${parsed.data.mediaId}::uuid` : sql``}
    )
  `);
  return context.json({ id, status: "DRAFT" }, 201);
});

agentRoutes.patch("/tutorial-resources/:id/status", async (context) => {
  requireFeature(
    context.env,
    "TUTORIALS_ENABLED",
    "Learning-resource operations are not enabled in this environment.",
  );
  const user = currentUser(context);
  const parsed = tutorialResourceStateSchema.safeParse(await body(context));
  if (!parsed.success)
    throw new AppError(400, "BAD_REQUEST", "Choose a valid resource status.");
  const result = await database(context.env).execute<{ id: string }>(sql`
    update public.tutorial_resources resources set
      status = ${parsed.data.status},
      submitted_at = case when ${parsed.data.status} = 'SUBMITTED' then now() else submitted_at end,
      review_note = case when ${parsed.data.status} = 'SUBMITTED' then null else review_note end,
      updated_at = now()
    from public.agent_profiles profiles
    where resources.id = ${context.req.param("id")}::uuid
      and resources.tutor_profile_id = profiles.id and profiles.user_id = ${user.id}::uuid
      and profiles.agent_type = 'TUTOR' and profiles.status = 'ACTIVE'
      and resources.deleted_at is null
      and (resources.status = ${parsed.data.status}
        or (resources.status in ('DRAFT','REJECTED') and ${parsed.data.status} in ('SUBMITTED','ARCHIVED'))
        or (resources.status = 'PUBLISHED' and ${parsed.data.status} = 'ARCHIVED'))
    returning resources.id
  `);
  if (!firstRow(result))
    throw new AppError(
      409,
      "CONFLICT",
      "That resource status change is not allowed.",
    );
  return context.json({ status: parsed.data.status });
});

agentRoutes.delete("/tutorial-resources/:id", async (context) => {
  requireFeature(
    context.env,
    "TUTORIALS_ENABLED",
    "Learning-resource operations are not enabled in this environment.",
  );
  const user = currentUser(context);
  const result = await database(context.env).execute<{ id: string }>(sql`
    update public.tutorial_resources resources set status = 'ARCHIVED',
      deleted_at = coalesce(deleted_at, now()), updated_at = now()
    from public.agent_profiles profiles
    where resources.id = ${context.req.param("id")}::uuid
      and resources.tutor_profile_id = profiles.id and profiles.user_id = ${user.id}::uuid
      and resources.deleted_at is null returning resources.id
  `);
  if (!firstRow(result))
    throw new AppError(
      404,
      "NOT_FOUND",
      "That learning resource does not exist.",
    );
  return context.json({ status: "DELETED" });
});

agentRoutes.get("/tutorial-availability", async (context) => {
  requireFeature(
    context.env,
    "TUTORIALS_ENABLED",
    "Tutorial operations are not enabled in this environment.",
  );
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
  requireFeature(
    context.env,
    "TUTORIALS_ENABLED",
    "Tutorial operations are not enabled in this environment.",
  );
  const user = currentUser(context);
  const parsed = tutorialAvailabilitySchema.safeParse(await body(context));
  if (
    !parsed.success ||
    new Date(parsed.data.startsAt) <= new Date() ||
    new Date(parsed.data.endsAt) <= new Date(parsed.data.startsAt)
  ) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Choose a valid future availability window.",
    );
  }
  const listing = await database(context.env).execute<{ id: string }>(sql`
    select listings.id from public.tutorial_listings listings
    join public.agent_profiles profiles on profiles.id = listings.tutor_profile_id
    where listings.id = ${parsed.data.listingId}::uuid and profiles.user_id = ${user.id}::uuid
      and profiles.status = 'ACTIVE' and listings.deleted_at is null
      and listings.status = 'PUBLISHED' and listings.review_status = 'APPROVED' limit 1
  `);
  if (!firstRow(listing))
    throw new AppError(
      404,
      "NOT_FOUND",
      "That tutorial listing does not exist.",
    );
  const id = crypto.randomUUID();
  await database(context.env).execute(sql`
    insert into public.tutorial_availability_windows (id, listing_id, starts_at, ends_at, capacity)
    values (${id}::uuid, ${parsed.data.listingId}::uuid, ${parsed.data.startsAt}::timestamptz,
      ${parsed.data.endsAt}::timestamptz, ${parsed.data.capacity})
  `);
  return context.json({ id, status: "OPEN" }, 201);
});

agentRoutes.post("/tutorial-bookings/:id/confirm", async (context) => {
  requireFeature(
    context.env,
    "TUTORIALS_ENABLED",
    "Tutorial operations are not enabled in this environment.",
  );
  const user = currentUser(context);
  const parsed = completionConfirmationSchema.safeParse(await body(context));
  if (!parsed.success)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Completion confirmation is required.",
    );
  const result = await database(context.env).execute<{
    id: string;
    student_confirmed_at: string | null;
  }>(sql`
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
      and exists (
        select 1 from public.tutorial_availability_windows windows
        where windows.id = bookings.availability_window_id
          and windows.listing_id = bookings.listing_id
          and windows.ends_at <= now()
      )
    returning bookings.id, bookings.student_confirmed_at
  `);
  if (!firstRow(result))
    throw new AppError(409, "CONFLICT", "That booking cannot be confirmed.");
  return context.json({
    status: firstRow(result)?.student_confirmed_at
      ? "COMPLETED"
      : "AWAITING_STUDENT",
  });
});

agentRoutes.post("/tutorial-bookings/:id/no-show", async (context) => {
  requireFeature(
    context.env,
    "TUTORIALS_ENABLED",
    "Tutorial operations are not enabled in this environment.",
  );
  const user = currentUser(context);
  const parsed = tutorialNoShowSchema.safeParse(await body(context));
  if (!parsed.success)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Describe the no-show so support can review it.",
    );
  const disputeId = crypto.randomUUID();
  const reported = await database(context.env).execute<{ id: string }>(sql`
    with changed as (
      update public.tutorial_bookings bookings set status = 'DISPUTED',
        no_show_reported_at = now(), no_show_reported_by_user_id = ${user.id}::uuid,
        earnings_state = 'RESERVED', updated_at = now()
      from public.tutorial_listings listings
      join public.agent_profiles profiles on profiles.id = listings.tutor_profile_id
      join public.tutorial_availability_windows windows on windows.listing_id = listings.id
      where bookings.id = ${context.req.param("id")}::uuid
        and bookings.listing_id = listings.id
        and bookings.availability_window_id = windows.id
        and profiles.user_id = ${user.id}::uuid
        and bookings.status = 'CONFIRMED' and windows.ends_at <= now()
      returning bookings.id, bookings.university_id
    ), opened as (
      insert into public.disputes (
        id, university_id, opened_by_user_id, tutorial_booking_id, category, reason
      ) select ${disputeId}::uuid, changed.university_id, ${user.id}::uuid,
        changed.id, 'NO_SHOW', ${parsed.data.reason} from changed
      returning id
    ) select id from opened
  `);
  if (!firstRow(reported))
    throw new AppError(
      409,
      "CONFLICT",
      "A no-show can be reported only once, after a confirmed session ends.",
    );
  return context.json({ id: disputeId, status: "OPEN" }, 201);
});

agentRoutes.get("/storefront", async (context) => {
  requireFeature(
    context.env,
    "STORE_ENABLED",
    "Store operations are not enabled in this environment.",
  );
  const user = currentUser(context);
  const profile = await approvedProfile(context.env, user.id, "VENDOR");
  const result = await database(context.env).execute(sql`
    select storefronts.vendor_profile_id, storefronts.university_id,
      storefronts.display_name, storefronts.description,
      storefronts.contact_phone_e164, storefronts.pickup_location,
      storefronts.pickup_instructions, storefronts.opening_hours,
      storefronts.default_preparation_minutes, storefronts.status,
      storefronts.submitted_at, storefronts.listing_revision,
      storefronts.moderated_revision, storefronts.reviewed_at,
      storefronts.review_note, storefronts.created_at, storefronts.updated_at
      ,coalesce((to_jsonb(storefronts)->>'pickup_enabled')::boolean,false) as pickup_enabled,
      coalesce((to_jsonb(storefronts)->>'self_delivery_enabled')::boolean,false) as self_delivery_enabled
    from public.vendor_storefronts storefronts
    where storefronts.vendor_profile_id = ${profile.id}::uuid
      and storefronts.university_id = ${profile.university_id}::uuid
    limit 1
  `);
  return context.json({ storefront: firstRow(result) ?? null, fulfilmentReady:await fulfilmentSchemaReady(context.env) });
});

agentRoutes.put("/storefront/fulfilment", async context => {
  requireFeature(context.env,"STORE_ENABLED","Store operations are not enabled yet.");
  await requireFulfilmentSchema(context.env);
  const user=currentUser(context),data=await input(context,storeFulfilmentSchema);
  const updated=firstRow(await database(context.env).execute<{vendor_profile_id:string}>(sql`
    update public.vendor_storefronts s set pickup_enabled=${data.pickupEnabled},
      self_delivery_enabled=${data.selfDeliveryEnabled},updated_at=now()
    from public.agent_profiles a where a.id=s.vendor_profile_id and a.user_id=${user.id}::uuid
      and a.university_id=${user.universityId}::uuid and s.university_id=a.university_id
      and a.agent_type='VENDOR' and a.status='ACTIVE' and s.status<>'SUSPENDED'
    returning s.vendor_profile_id
  `));
  if(!updated)throw new AppError(404,"NOT_FOUND","Save an active storefront before choosing delivery options.");
  await recordAudit(context.env,{actorUserId:user.id,universityId:user.universityId,action:"storefront.fulfilment_updated",targetType:"agent_profile",targetId:updated.vendor_profile_id,requestId:context.get("requestId"),metadata:data});
  return context.json({saved:true});
});

agentRoutes.put("/storefront", async (context) => {
  requireFeature(
    context.env,
    "STORE_ENABLED",
    "Store operations are not enabled in this environment.",
  );
  const user = currentUser(context);
  const parsed = vendorStorefrontSchema.safeParse(await body(context));
  if (!parsed.success) {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Check the storefront trust details and try again.",
    );
  }
  const profile = await operationalVendorProfile(context.env, user.id);
  const result = await database(context.env).execute<{
    vendor_profile_id: string;
    status: string;
    listing_revision: number;
  }>(sql`
    insert into public.vendor_storefronts (
      vendor_profile_id, university_id, display_name, description,
      contact_phone_e164, pickup_location, pickup_instructions,
      opening_hours, default_preparation_minutes
    ) values (
      ${profile.id}::uuid, ${profile.university_id}::uuid,
      ${parsed.data.displayName}, ${parsed.data.description},
      ${parsed.data.contactPhoneE164}, ${parsed.data.pickupLocation},
      ${parsed.data.pickupInstructions ?? null},
      ${JSON.stringify(parsed.data.openingHours)}::jsonb,
      ${parsed.data.defaultPreparationMinutes}
    )
    on conflict (vendor_profile_id) do update set
      display_name = excluded.display_name,
      description = excluded.description,
      contact_phone_e164 = excluded.contact_phone_e164,
      pickup_location = excluded.pickup_location,
      pickup_instructions = excluded.pickup_instructions,
      opening_hours = excluded.opening_hours,
      default_preparation_minutes = excluded.default_preparation_minutes,
      updated_at = now()
    where vendor_storefronts.university_id = excluded.university_id
      and vendor_storefronts.status <> 'SUSPENDED'
    returning vendor_profile_id, status, listing_revision
  `);
  const storefront = firstRow(result);
  if (!storefront) {
    throw new AppError(
      409,
      "CONFLICT",
      "That storefront cannot be changed in its current state.",
    );
  }
  await recordAudit(context.env, {
    actorUserId: user.id,
    universityId: profile.university_id,
    action: "storefront.saved",
    targetType: "vendor_storefront",
    targetId: profile.id,
    requestId: context.get("requestId"),
    metadata: {
      status: storefront.status,
      listingRevision: storefront.listing_revision,
    },
  });
  return context.json(storefront);
});

agentRoutes.patch("/storefront/status", async (context) => {
  requireFeature(
    context.env,
    "STORE_ENABLED",
    "Store operations are not enabled in this environment.",
  );
  const user = currentUser(context);
  const parsed = vendorStorefrontStateSchema.safeParse(await body(context));
  if (!parsed.success) {
    throw new AppError(400, "BAD_REQUEST", "Choose a valid storefront action.");
  }
  const profile = await operationalVendorProfile(context.env, user.id);
  const result = await database(context.env).execute<{
    vendor_profile_id: string;
    university_id: string;
  }>(sql`
    update public.vendor_storefronts set
      status = 'SUBMITTED', submitted_at = now(), review_note = null,
      reviewed_by_user_id = null, reviewed_at = null, moderated_revision = null,
      updated_at = now()
    where vendor_profile_id = ${profile.id}::uuid
      and university_id = ${profile.university_id}::uuid
      and status in ('DRAFT', 'NEEDS_CORRECTION')
      and contact_phone_e164 is not null
      and pickup_location is not null
      and description is not null
      and opening_hours <> '{}'::jsonb
    returning vendor_profile_id, university_id
  `);
  const storefront = firstRow(result);
  if (!storefront) {
    throw new AppError(
      409,
      "CONFLICT",
      "Save complete contact, pickup, description and opening-hour details before submitting the storefront.",
    );
  }
  await recordAudit(context.env, {
    actorUserId: user.id,
    universityId: storefront.university_id,
    action: "storefront.submitted",
    targetType: "vendor_storefront",
    targetId: storefront.vendor_profile_id,
    requestId: context.get("requestId"),
  });
  return context.json({ status: parsed.data.status });
});

agentRoutes.get("/product-categories", async (context) => {
  const user = currentUser(context);
  const universityIds = await database(context.env).execute<{
    university_id: string;
  }>(sql`
    select distinct university_id from public.agent_profiles where user_id = ${user.id}::uuid
    union select university_id from public.agent_applications where user_id = ${user.id}::uuid
  `);
  const ids = universityIds.rows.map((item) => item.university_id);
  const result = ids.length
    ? await database(context.env).execute(sql`
    select id, university_id, name, listing_rules from public.product_categories
    where university_id = any(${sql.param(ids)}::uuid[]) and status = 'APPROVED' order by name
  `)
    : { rows: [] };
  return context.json({ categories: result.rows });
});

agentRoutes.get("/products", async (context) => {
  requireFeature(
    context.env,
    "STORE_ENABLED",
    "Store operations are not enabled in this environment.",
  );
  const user = currentUser(context);
  const result = await database(context.env).execute(sql`
    select products.id, products.name, products.description, products.category,
      products.category_id, products.price_kobo, products.stock_quantity, products.image_url,
      products.status, products.submitted_at, products.moderation_note,
      products.preparation_minutes, products.package_weight_grams,
      products.package_length_cm, products.package_width_cm, products.package_height_cm,
      products.bicycle_delivery_eligible, products.listing_revision,
      products.moderated_revision, products.reviewed_at,
      categories.listing_rules, products.created_at, products.updated_at
    from public.vendor_products products
    join public.agent_profiles profiles on profiles.id = products.vendor_profile_id
    left join public.product_categories categories on categories.id = products.category_id
    where profiles.user_id = ${user.id}::uuid order by products.updated_at desc
  `);
  return context.json({ products: result.rows });
});

agentRoutes.post("/products", async (context) => {
  requireFeature(
    context.env,
    "STORE_ENABLED",
    "Store operations are not enabled in this environment.",
  );
  const user = currentUser(context);
  const parsed = vendorProductSchema.safeParse(await body(context));
  if (!parsed.success)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Check the product details and try again.",
    );
  const profile = await operationalVendorProfile(context.env, user.id);
  const categoryResult = await database(context.env).execute<{
    id: string;
    name: string;
  }>(sql`
    select id, name from public.product_categories
    where id = ${parsed.data.categoryId}::uuid and university_id = ${profile.university_id}::uuid
      and status = 'APPROVED' limit 1
  `);
  const category = firstRow(categoryResult);
  if (!category)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Choose an approved product category.",
    );
  const id = crypto.randomUUID();
  const result = await database(context.env).execute<{ id: string }>(sql`
    insert into public.vendor_products (
      id, university_id, vendor_profile_id, name, description,
      category, category_id, price_kobo, stock_quantity, image_url,
      preparation_minutes, package_weight_grams, package_length_cm,
      package_width_cm, package_height_cm, bicycle_delivery_eligible
    ) select
      ${id}::uuid, ${profile.university_id}::uuid, ${profile.id}::uuid,
      ${parsed.data.name}, ${parsed.data.description}, ${category.name}, ${category.id}::uuid,
      ${parsed.data.priceKobo}, ${parsed.data.stockQuantity}, ${parsed.data.imageUrl ?? null},
      ${parsed.data.preparationMinutes}, ${parsed.data.packageWeightGrams ?? null},
      ${parsed.data.packageLengthCm ?? null}, ${parsed.data.packageWidthCm ?? null},
      ${parsed.data.packageHeightCm ?? null}, ${parsed.data.bicycleDeliveryEligible}
    where not exists (
      select 1 from public.vendor_storefronts storefronts
      where storefronts.vendor_profile_id = ${profile.id}::uuid
        and storefronts.status = 'SUSPENDED'
    )
    returning id
  `);
  if (!firstRow(result)) {
    throw new AppError(
      409,
      "CONFLICT",
      "This storefront was suspended before the product could be created.",
    );
  }
  await recordAudit(context.env, {
    actorUserId: user.id,
    universityId: profile.university_id,
    action: "product.created",
    targetType: "vendor_product",
    targetId: id,
    requestId: context.get("requestId"),
    metadata: { status: "DRAFT" },
  });
  return context.json({ id, status: "DRAFT" }, 201);
});

agentRoutes.put("/products/:id", async (context) => {
  requireFeature(
    context.env,
    "STORE_ENABLED",
    "Store operations are not enabled in this environment.",
  );
  const user = currentUser(context);
  const parsed = vendorProductUpdateSchema.safeParse(await body(context));
  if (!parsed.success)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Check the product details and try again.",
    );
  const profile = await operationalVendorProfile(context.env, user.id);
  const categoryResult = await database(context.env).execute<{
    id: string;
    name: string;
  }>(sql`
    select id, name from public.product_categories
    where id = ${parsed.data.categoryId}::uuid
      and university_id = ${profile.university_id}::uuid
      and status = 'APPROVED'
    limit 1
  `);
  const category = firstRow(categoryResult);
  if (!category)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Choose an approved product category.",
    );
  const result = await database(context.env).execute<{
    id: string;
    university_id: string;
    status: string;
    listing_revision: number;
  }>(sql`
    update public.vendor_products set
      name = ${parsed.data.name}, description = ${parsed.data.description},
      category = ${category.name}, category_id = ${category.id}::uuid,
      price_kobo = ${parsed.data.priceKobo},
      image_url = ${parsed.data.imageUrl ?? null},
      preparation_minutes = ${parsed.data.preparationMinutes},
      package_weight_grams = ${parsed.data.packageWeightGrams ?? null},
      package_length_cm = ${parsed.data.packageLengthCm ?? null},
      package_width_cm = ${parsed.data.packageWidthCm ?? null},
      package_height_cm = ${parsed.data.packageHeightCm ?? null},
      bicycle_delivery_eligible = ${parsed.data.bicycleDeliveryEligible},
      updated_at = now()
    where id = ${context.req.param("id")}::uuid
      and vendor_profile_id = ${profile.id}::uuid
      and university_id = ${profile.university_id}::uuid
      and status <> 'ARCHIVED'
      and not exists (
        select 1 from public.vendor_storefronts storefronts
        where storefronts.vendor_profile_id = ${profile.id}::uuid
          and storefronts.status = 'SUSPENDED'
      )
    returning id, university_id, status, listing_revision
  `);
  const product = firstRow(result);
  if (!product)
    throw new AppError(
      404,
      "NOT_FOUND",
      "That editable product does not exist.",
    );
  await recordAudit(context.env, {
    actorUserId: user.id,
    universityId: product.university_id,
    action: "product.saved",
    targetType: "vendor_product",
    targetId: product.id,
    requestId: context.get("requestId"),
    metadata: {
      status: product.status,
      listingRevision: product.listing_revision,
    },
  });
  return context.json(product);
});

agentRoutes.patch("/products/:id/stock", async (context) => {
  requireFeature(
    context.env,
    "STORE_ENABLED",
    "Store operations are not enabled in this environment.",
  );
  const user = currentUser(context);
  const parsed = vendorProductStockSchema.safeParse(await body(context));
  if (!parsed.success)
    throw new AppError(400, "BAD_REQUEST", "Enter a valid stock quantity.");
  const profile = await operationalVendorProfile(context.env, user.id);
  const existingResult = await database(context.env).execute<{
    id: string;
    university_id: string;
    stock_quantity: number;
  }>(sql`
    select id, university_id, stock_quantity from public.vendor_products
    where id = ${context.req.param("id")}::uuid
      and vendor_profile_id = ${profile.id}::uuid
      and university_id = ${profile.university_id}::uuid
      and status <> 'ARCHIVED'
    limit 1
  `);
  const existing = firstRow(existingResult);
  if (!existing)
    throw new AppError(
      404,
      "NOT_FOUND",
      "That editable product does not exist.",
    );
  const result = await database(context.env).execute<{
    id: string;
    status: string;
    stock_quantity: number;
    listing_revision: number;
  }>(sql`
    update public.vendor_products set stock_quantity = ${parsed.data.stockQuantity}, updated_at = now()
    where id = ${existing.id}::uuid
      and vendor_profile_id = ${profile.id}::uuid
      and university_id = ${profile.university_id}::uuid
      and stock_quantity = ${existing.stock_quantity}
      and status <> 'ARCHIVED'
      and not exists (
        select 1 from public.vendor_storefronts storefronts
        where storefronts.vendor_profile_id = ${profile.id}::uuid
          and storefronts.status = 'SUSPENDED'
      )
    returning id, status, stock_quantity, listing_revision
  `);
  const product = firstRow(result);
  if (!product)
    throw new AppError(
      409,
      "CONFLICT",
      "That stock record changed before it could be saved.",
    );
  await recordAudit(context.env, {
    actorUserId: user.id,
    universityId: existing.university_id,
    action: "product.stock.updated",
    targetType: "vendor_product",
    targetId: product.id,
    requestId: context.get("requestId"),
    metadata: {
      previousQuantity: existing.stock_quantity,
      stockQuantity: product.stock_quantity,
    },
  });
  return context.json(product);
});

agentRoutes.patch("/products/:id/status", async (context) => {
  requireFeature(
    context.env,
    "STORE_ENABLED",
    "Store operations are not enabled in this environment.",
  );
  const user = currentUser(context);
  const parsed = vendorProductStateSchema.safeParse(await body(context));
  if (!parsed.success)
    throw new AppError(400, "BAD_REQUEST", "Choose a valid product status.");
  await operationalVendorProfile(context.env, user.id);
  const result = await database(context.env).execute<{
    id: string;
    university_id: string;
  }>(sql`
    update public.vendor_products products set
      status = ${parsed.data.status},
      submitted_at = case when ${parsed.data.status} = 'SUBMITTED' then now() else products.submitted_at end,
      moderation_note = case when ${parsed.data.status} = 'SUBMITTED' then null else products.moderation_note end,
      reviewed_by_user_id = case when ${parsed.data.status} = 'SUBMITTED' then null else products.reviewed_by_user_id end,
      reviewed_at = case when ${parsed.data.status} = 'SUBMITTED' then null else products.reviewed_at end,
      moderated_revision = case when ${parsed.data.status} = 'SUBMITTED' then null else products.moderated_revision end,
      updated_at = now()
    from public.agent_profiles profiles, public.product_categories categories
    where products.id = ${context.req.param("id")}::uuid and products.vendor_profile_id = profiles.id
      and profiles.user_id = ${user.id}::uuid and profiles.agent_type = 'VENDOR'
      and profiles.status = 'ACTIVE' and categories.id = products.category_id
      and categories.status = 'APPROVED'
      and not exists (
        select 1 from public.vendor_storefronts blocked_storefront
        where blocked_storefront.vendor_profile_id = profiles.id
          and blocked_storefront.status = 'SUSPENDED'
      )
      and (products.status = ${parsed.data.status}
        or (products.status in ('DRAFT','NEEDS_CORRECTION') and ${parsed.data.status} = 'SUBMITTED'
          and exists (
            select 1 from public.vendor_storefronts approved_storefront
            where approved_storefront.vendor_profile_id = profiles.id
              and approved_storefront.university_id = products.university_id
              and approved_storefront.status = 'APPROVED'
          )
          and products.package_weight_grams is not null
          and products.package_length_cm is not null
          and products.package_width_cm is not null
          and products.package_height_cm is not null
          and products.bicycle_delivery_eligible = true)
        or (products.status in ('DRAFT','NEEDS_CORRECTION','SUBMITTED','REJECTED') and ${parsed.data.status} = 'ARCHIVED')
        or (products.status = 'PUBLISHED' and ${parsed.data.status} in ('PAUSED','ARCHIVED'))
        or (products.status = 'PAUSED' and ${parsed.data.status} in ('PUBLISHED','ARCHIVED')
          and products.reviewed_at is not null
          and products.moderated_revision = products.listing_revision))
    returning products.id, products.university_id
  `);
  const product = firstRow(result);
  if (!product) {
    throw new AppError(
      409,
      "CONFLICT",
      parsed.data.status === "SUBMITTED"
        ? "Approve the storefront and add complete bicycle-package details before submitting this product for review."
        : "That product status change is not allowed.",
    );
  }
  await recordAudit(context.env, {
    actorUserId: user.id,
    universityId: product.university_id,
    action: `product.${parsed.data.status.toLowerCase()}`,
    targetType: "vendor_product",
    targetId: product.id,
    requestId: context.get("requestId"),
  });
  return context.json({ status: parsed.data.status });
});

agentRoutes.get("/orders", async (context) => {
  if (!phase3SchemaReady(context.env)) throw new AppError(503,"FEATURE_DISABLED","Store orders are awaiting the scheduled database update.");
  const user = currentUser(context);
  const result = await database(context.env).execute(sql`
    select orders.id, orders.status, orders.subtotal_kobo, orders.delivery_fee_kobo,
      orders.total_kobo, orders.created_at, orders.updated_at,
      coalesce(to_jsonb(orders)->>'fulfilment_mode','RIDER') as fulfilment_mode,
      zones.name as zone_name, count(items.id)::int as item_count
    from public.orders orders
    join public.agent_profiles profiles on profiles.id = orders.vendor_profile_id
    left join public.delivery_zones zones on zones.id = orders.delivery_zone_id
    left join public.order_items items on items.order_id = orders.id
    where profiles.user_id = ${user.id}::uuid and profiles.agent_type='VENDOR'
      and orders.university_id=${user.universityId}::uuid
    group by orders.id, zones.name order by orders.created_at desc limit 200
  `);
  return context.json({ orders: result.rows });
});

agentRoutes.get("/orders/:id", async (context) => {
  if (!phase3SchemaReady(context.env)) {
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "Order details are temporarily unavailable. Please try again shortly.",
    );
  }
  const user = currentUser(context);
  const result = await database(context.env).execute<{
    id: string;
    status: string;
  }>(sql`
    select orders.id, orders.status, orders.university_id,
      orders.subtotal_kobo, orders.delivery_fee_kobo, orders.total_kobo,
      coalesce(to_jsonb(orders)->>'fulfilment_mode','RIDER') as fulfilment_mode,
      case when orders.status in (
        'PAID', 'ACCEPTED', 'READY', 'IN_DELIVERY', 'DELIVERED', 'REFUNDED', 'DISPUTED'
      ) then orders.delivery_note else null end as delivery_note,
      orders.pricing_formula_version,
      orders.created_at, orders.updated_at, zones.name as zone_name,
      snapshots.recipient_name, snapshots.recipient_phone_e164,
      snapshots.delivery_location, snapshots.delivery_landmark,
      snapshots.latitude, snapshots.longitude
    from public.orders orders
    join public.agent_profiles profiles on profiles.id = orders.vendor_profile_id
    left join public.delivery_zones zones on zones.id = orders.delivery_zone_id
    left join public.order_delivery_snapshots snapshots
      on snapshots.order_id = orders.id
      and orders.status in (
        'PAID', 'ACCEPTED', 'READY', 'IN_DELIVERY', 'DELIVERED', 'REFUNDED', 'DISPUTED'
      )
    where orders.id = ${id(context.req.param("id"))}::uuid
      and profiles.user_id = ${user.id}::uuid
      and profiles.agent_type = 'VENDOR'
      and orders.university_id=${user.universityId}::uuid
    limit 1
  `);
  const order = firstRow(result);
  if (!order)
    throw new AppError(404, "NOT_FOUND", "That vendor order does not exist.");
  const [items, timeline, delivery] = await Promise.all([
    database(context.env).execute(sql`
      select items.product_id, items.quantity, items.unit_price_kobo,
        products.name, products.image_url
      from public.order_items items
      join public.vendor_products products on products.id = items.product_id
      where items.order_id = ${order.id}::uuid
      order by items.created_at, items.id
    `),
    database(context.env).execute(sql`
      select previous_status, status, source, note, occurred_at
      from public.order_status_events
      where order_id = ${order.id}::uuid
      order by occurred_at, id
    `),
    database(context.env).execute(sql`
      select j.status, to_jsonb(j)->>'request_posted_at' as request_posted_at,
        a.user_id as rider_user_id,a.display_name as rider_name,
        to_jsonb(a)->'public_details'->>'phone' as rider_phone
      from public.delivery_jobs j left join public.agent_profiles a on a.id=j.rider_profile_id
      where j.order_id=${order.id}::uuid and j.university_id=${user.universityId}::uuid
    `),
  ]);
  return context.json({
    order,
    items: items.rows,
    timeline: timeline.rows,
    delivery:firstRow(delivery) ?? null,
    fulfilmentReady:await fulfilmentSchemaReady(context.env),
    actionDueAt: null,
    actionPolicyStatus: "UNCONFIGURED",
    serverTime: new Date().toISOString(),
  });
});

agentRoutes.post("/orders/:id/rider-request",async context=>{
  requireFeature(context.env,"LOGISTICS_ENABLED","Rider delivery is not enabled yet.");
  await requireFulfilmentSchema(context.env);
  const user=currentUser(context),orderId=id(context.req.param("id"));
  let job;
  try {
    job=firstRow(await database(context.env).execute<{id:string}>(sql`select app_private.post_vendor_rider_request(${orderId}::uuid,${user.id}::uuid,${user.universityId}::uuid) as id`));
  } catch (e) {
    if(e instanceof Error && /ORDER_NOT_READY_FOR_RIDER|DELIVERY_UNAVAILABLE/.test(e.message))throw new AppError(409,"CONFLICT","A rider request can be posted for your ready order. Refresh to see its current state.");
    throw e;
  }
  await recordAudit(context.env,{actorUserId:user.id,universityId:user.universityId,action:"delivery.request_posted",targetType:"order",targetId:orderId,requestId:context.get("requestId")});
  return context.json({jobId:job?.id,status:"AVAILABLE"});
});

agentRoutes.post("/orders/:id/dispatch",async context=>{
  await requireFulfilmentSchema(context.env);
  const user=currentUser(context),orderId=id(context.req.param("id"));
  const result=firstRow(await database(context.env).execute(sql`
    update public.orders o set status='IN_DELIVERY',updated_at=now()
    from public.agent_profiles a,public.vendor_storefronts s
    where o.id=${orderId}::uuid and o.university_id=${user.universityId}::uuid
      and o.vendor_profile_id=a.id and a.user_id=${user.id}::uuid and a.status='ACTIVE' and a.agent_type='VENDOR'
      and s.vendor_profile_id=a.id and s.university_id=o.university_id and s.status='APPROVED'
      and o.fulfilment_mode='VENDOR_DELIVERY' and o.status='READY' returning o.id
  `));
  if(!result)throw new AppError(409,"CONFLICT","Only your ready vendor delivery can be dispatched.");
  await recordAudit(context.env,{actorUserId:user.id,universityId:user.universityId,action:"order.vendor_dispatched",targetType:"order",targetId:orderId,requestId:context.get("requestId")});
  return context.json({status:"IN_DELIVERY"});
});

agentRoutes.post("/orders/:id/handoff",async context=>{
  await requireFulfilmentSchema(context.env);
  const user=currentUser(context),orderId=id(context.req.param("id")),data=await input(context,handoffCodeSchema);
  const result=firstRow(await database(context.env).execute<{result:string}>(sql`
    select app_private.confirm_vendor_order_handoff(${orderId}::uuid,${user.id}::uuid,${user.universityId}::uuid,${await hashOtp(context.env,data.code)}) as result
  `))?.result;
  if(result==='LOCKED')throw new AppError(429,"RATE_LIMITED","This handoff code is locked or expired. Contact support.");
  if(result==='INCORRECT')throw new AppError(400,"BAD_REQUEST","That handoff code is not correct.");
  if(result!=='DELIVERED')throw new AppError(409,"CONFLICT","This order is not ready for a buyer handoff.");
  await recordAudit(context.env,{actorUserId:user.id,universityId:user.universityId,action:"order.buyer_handoff_verified",targetType:"order",targetId:orderId,requestId:context.get("requestId")});
  return context.json({status:"DELIVERED"});
});

agentRoutes.patch("/orders/:id/status", async (context) => {
  const user = currentUser(context);
  if (!phase3SchemaReady(context.env)) throw new AppError(503,"FEATURE_DISABLED","Store orders are awaiting the scheduled database update.");
  const owned = firstRow(await database(context.env).execute(sql`
    select o.id from public.orders o join public.agent_profiles a on a.id=o.vendor_profile_id
    join public.vendor_storefronts s on s.vendor_profile_id=a.id
    where o.id=${id(context.req.param("id"))}::uuid and o.university_id=${user.universityId}::uuid
      and a.user_id=${user.id}::uuid and a.agent_type='VENDOR' and a.status='ACTIVE' and s.status='APPROVED'
  `));
  if (!owned) throw new AppError(404,"NOT_FOUND","This active store order is not available.");
  const parsed = orderStateSchema.safeParse(await body(context));
  if (!parsed.success)
    throw new AppError(400, "BAD_REQUEST", "Choose a valid order action.");
  const result =
    parsed.data.status === "CANCELLED"
      ? await database(context.env)
          .execute<{ order_id: string; university_id: string }>(
            sql`
        select * from app_private.cancel_vendor_order(
          ${context.req.param("id")}::uuid, ${user.id}::uuid
        )
      `,
          )
          .then(({ rows }) => ({
            rows: rows.map((row) => ({
              id: row.order_id,
              university_id: row.university_id,
            })),
          }))
      : await database(context.env).execute<{
          id: string;
          university_id: string;
        }>(sql`
        update public.orders orders set status = ${parsed.data.status}, updated_at = now()
        from public.agent_profiles profiles
        where orders.id = ${context.req.param("id")}::uuid and orders.vendor_profile_id = profiles.id
          and profiles.user_id = ${user.id}::uuid and profiles.status = 'ACTIVE'
          and orders.university_id=${user.universityId}::uuid and profiles.agent_type='VENDOR'
          and exists (select 1 from public.vendor_storefronts storefront
            where storefront.vendor_profile_id=profiles.id
              and storefront.university_id=orders.university_id and storefront.status='APPROVED')
          and orders.status = ${parsed.data.status === "ACCEPTED" ? "PAID" : "ACCEPTED"}
        returning orders.id, orders.university_id
      `);
  const order = firstRow(result);
  if (!order)
    throw new AppError(
      409,
      "CONFLICT",
      "That order action is not allowed from its current state.",
    );
  await recordAudit(context.env, {
    actorUserId: user.id,
    universityId: order.university_id,
    action: `order.${parsed.data.status.toLowerCase()}`,
    targetType: "order",
    targetId: order.id,
    requestId: context.get("requestId"),
    ...(parsed.data.note ? { metadata: { note: parsed.data.note } } : {}),
  });
  return context.json({ status: parsed.data.status });
});

agentRoutes.get("/orders/:id/pickup-code", async (context) => {
  const user = currentUser(context);
  const result = await database(context.env).execute<{ id: string }>(sql`
    select orders.id from public.orders orders
    join public.agent_profiles profiles on profiles.id = orders.vendor_profile_id
    join public.delivery_jobs jobs on jobs.order_id = orders.id
    where orders.id = ${id(context.req.param("id"))}::uuid and profiles.user_id = ${user.id}::uuid
      and orders.university_id=${user.universityId}::uuid
      and orders.status in ('READY','IN_DELIVERY') and jobs.status in ('AVAILABLE','RESERVED') limit 1
  `);
  const order = firstRow(result);
  if (!order)
    throw new AppError(
      409,
      "CONFLICT",
      "The pickup code is available only for a ready order.",
    );
  const code = await deriveHandoffCode(context.env, order.id, "pickup");
  return context.json({ code: code.code });
});

agentRoutes.get("/deliveries", async (context) => {
  requireFeature(
    context.env,
    "LOGISTICS_ENABLED",
    "Delivery operations are not enabled in this environment.",
  );
  const user = currentUser(context);
  const profile = await approvedProfile(context.env, user.id, "RIDER",user.universityId);
  const [result, presence] = await Promise.all([
    database(context.env).execute(sql`
    select jobs.id, jobs.order_id, zones.name as zone_name, jobs.status,
      jobs.rider_earning_kobo, jobs.earning_formula_version,
      (to_jsonb(jobs)->>'fare_kobo')::integer as fare_kobo,
      to_jsonb(jobs)->>'fare_payment_method' as fare_payment_method,
      case when to_jsonb(jobs)->>'financial_version'='CAMPUS_FARE_V1' then (to_jsonb(jobs)->>'fare_kobo')::integer/10 end as commission_kobo,
      jobs.reserved_at, jobs.picked_up_at, jobs.delivered_at, jobs.created_at
      ,vendors.user_id as vendor_user_id,storefronts.display_name as vendor_name,
      storefronts.pickup_location,
      case when jobs.rider_profile_id=${profile.id}::uuid then storefronts.contact_phone_e164 end as vendor_phone,
      case when jobs.rider_profile_id=${profile.id}::uuid then to_jsonb(vendors)->'public_details'->>'whatsapp' end as vendor_whatsapp,
      case when jobs.rider_profile_id=${profile.id}::uuid then snapshots.delivery_location end as delivery_location,
      case when jobs.rider_profile_id=${profile.id}::uuid then orders.delivery_note end as delivery_note
    from public.delivery_jobs jobs
    join public.delivery_zones zones on zones.id = jobs.zone_id
    join public.orders orders on orders.id=jobs.order_id
    join public.agent_profiles vendors on vendors.id=orders.vendor_profile_id
    left join public.vendor_storefronts storefronts on storefronts.vendor_profile_id=vendors.id
    left join public.order_delivery_snapshots snapshots on snapshots.order_id=orders.id
    where jobs.university_id = ${profile.university_id}::uuid
      and ((jobs.status = 'AVAILABLE' and orders.status in ('PAID','ACCEPTED','READY') and (not ${await fulfilmentSchemaReady(context.env)} or to_jsonb(jobs)->>'request_posted_at' is not null)) or jobs.rider_profile_id = ${profile.id}::uuid)
    order by case when jobs.status = 'AVAILABLE' then 0 else 1 end, jobs.created_at
    limit 100
  `),
    database(context.env).execute(sql`
    select online, capacity_status, last_seen_at from public.rider_presence
    where rider_profile_id = ${profile.id}::uuid limit 1
  `),
  ]);
  return context.json({
    jobs: result.rows,
    finance:await riderFinanceSummary(context.env,user.id,user.universityId),
    presence: firstRow(presence) ?? {
      online: false,
      capacity_status: "AVAILABLE",
    },
  });
});

agentRoutes.put("/rider-presence", async (context) => {
  const user = currentUser(context);
  const parsed = riderPresenceSchema.safeParse(await body(context));
  if (!parsed.success)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Choose a valid rider availability state.",
    );
  const profile = await approvedProfile(context.env, user.id, "RIDER",user.universityId);
  if(parsed.data.online && (await riderFinanceSummary(context.env,user.id,user.universityId))?.rides_suspended)
    throw new AppError(409,'CONFLICT','Pay your four unpaid ride commissions from Earnings before going online.');
  await database(context.env).execute(sql`
    insert into public.rider_presence (rider_profile_id, online, capacity_status, last_seen_at, updated_at)
    values (${profile.id}::uuid, ${parsed.data.online}, ${parsed.data.capacityStatus}, now(), now())
    on conflict (rider_profile_id) do update set online = excluded.online,
      capacity_status = excluded.capacity_status, last_seen_at = now(), updated_at = now()
  `);
  return context.json({
    online: parsed.data.online,
    capacityStatus: parsed.data.capacityStatus,
  });
});

agentRoutes.post("/deliveries/:id/reserve", async (context) => {
  requireFeature(
    context.env,
    "LOGISTICS_ENABLED",
    "Delivery operations are not enabled in this environment.",
  );
  const user = currentUser(context);
  const profile = await approvedProfile(context.env, user.id, "RIDER",user.universityId);
  let result;
  try {
    result = await database(context.env).execute<{ id: string }>(sql`
      select * from app_private.reserve_delivery_job(
        ${id(context.req.param("id"))}::uuid, ${profile.id}::uuid
      )
    `);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    if(message.includes('RIDER_COMMISSION_LIMIT'))throw new AppError(409,'CONFLICT','Four ride commissions are unpaid. Pay your commission from Earnings to accept another ride.');
    if (
      message.includes("RIDER_NOT_AVAILABLE") ||
      message.includes("RIDER_AT_CAPACITY")
    ) {
      throw new AppError(
        409,
        "CONFLICT",
        "Go online with available capacity before reserving one delivery.",
      );
    }
    if (message.includes("DELIVERY_UNAVAILABLE")) {
      throw new AppError(
        409,
        "CONFLICT",
        "That delivery is no longer available.",
      );
    }
    throw caught;
  }
  if (!firstRow(result))
    throw new AppError(
      409,
      "CONFLICT",
      "That delivery is no longer available.",
    );
  await recordAudit(context.env, {
    actorUserId: user.id,
    universityId: profile.university_id,
    action: "delivery.reserved",
    targetType: "delivery_job",
    targetId: context.req.param("id"),
    requestId: context.get("requestId"),
  });
  return context.json({ status: "RESERVED" });
});

agentRoutes.post("/deliveries/:id/pickup", async (context) => {
  const user = currentUser(context);
  const profile = await approvedProfile(context.env, user.id, "RIDER",user.universityId);
  const parsed = handoffCodeSchema.safeParse(await body(context));
  if (!parsed.success)
    throw new AppError(400, "BAD_REQUEST", "Enter the six-digit pickup code.");
  const result = await database(context.env).execute<{ result: string }>(sql`
    select app_private.confirm_delivery_pickup(
      ${id(context.req.param("id"))}::uuid, ${profile.id}::uuid, ${user.id}::uuid,
      ${await hashOtp(context.env, parsed.data.code)}
    ) as result
  `);
  const outcome = firstRow(result)?.result ?? "INVALID_STATE";
  if (outcome === "LOCKED")
    throw new AppError(
      429,
      "RATE_LIMITED",
      "The pickup code is locked or expired. Contact support.",
    );
  if (outcome === "INCORRECT")
    throw new AppError(400, "BAD_REQUEST", "That pickup code is not correct.");
  if (outcome === "ORDER_NOT_READY")
    throw new AppError(
      409,
      "CONFLICT",
      "The vendor has not marked this order ready for pickup.",
    );
  if (outcome !== "PICKED_UP")
    throw new AppError(
      409,
      "CONFLICT",
      "That delivery is not waiting for pickup.",
    );
  await recordAudit(context.env, {
    actorUserId: user.id,
    universityId: profile.university_id,
    action: "delivery.picked_up",
    targetType: "delivery_job",
    targetId: context.req.param("id"),
    requestId: context.get("requestId"),
  });
  return context.json({ status: "PICKED_UP" });
});

agentRoutes.post("/deliveries/:id/complete", async (context) => {
  const user = currentUser(context);
  const profile = await approvedProfile(context.env, user.id, "RIDER",user.universityId);
  const parsed = handoffCodeSchema.safeParse(await body(context));
  if (!parsed.success)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Enter the six-digit delivery code.",
    );
  const result = await database(context.env).execute<{ result: string }>(sql`
    select app_private.confirm_delivery_completion(
      ${id(context.req.param("id"))}::uuid, ${profile.id}::uuid, ${user.id}::uuid,
      ${await hashOtp(context.env, parsed.data.code)}
    ) as result
  `);
  const outcome = firstRow(result)?.result ?? "INVALID_STATE";
  if (outcome === "LOCKED")
    throw new AppError(
      429,
      "RATE_LIMITED",
      "The delivery code is locked or expired. Contact support.",
    );
  if (outcome === "INCORRECT")
    throw new AppError(
      400,
      "BAD_REQUEST",
      "That delivery code is not correct.",
    );
  if (outcome !== "DELIVERED")
    throw new AppError(
      409,
      "CONFLICT",
      "That delivery is not ready for completion.",
    );
  await recordAudit(context.env, {
    actorUserId: user.id,
    universityId: profile.university_id,
    action: "delivery.completed",
    targetType: "delivery_job",
    targetId: context.req.param("id"),
    requestId: context.get("requestId"),
  });
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
  const riderFinance=await riderFinanceSummary(context.env,user.id,user.universityId);
  const storeFinance=await inclusiveStoreReady(context.env)?firstRow(await database(context.env).execute(sql`
    select app_private.finance_balance(${user.universityId}::uuid,${user.id}::uuid,'VENDOR_PENDING') as pending_kobo,
      app_private.finance_balance(${user.universityId}::uuid,${user.id}::uuid,'VENDOR_AVAILABLE') as available_kobo,
      0::bigint as reserved_kobo,0::bigint as withdrawn_kobo
  `)):null;
  const riderCheckout=riderFinance?firstRow(await database(context.env).execute(sql`select provider_reference as reference,amount_kobo,status
    from app_private.rider_commission_checkouts where user_id=${user.id}::uuid and university_id=${user.universityId}::uuid
      and status in ('CREATED','INITIALIZED') order by created_at desc limit 1`)):null;
  const riderDebts=riderFinance?(await database(context.env).execute(sql`select c.rider_profile_id,c.university_id,u.name as university_name,
    sum(d.outstanding_kobo)::bigint as amount_kobo from app_private.rider_unpaid_commissions(${user.id}::uuid) d
      join app_private.rider_cash_commissions c on c.job_id=d.job_id join public.universities u on u.id=c.university_id
    group by c.rider_profile_id,c.university_id,u.name order by u.name`)).rows:[];
  return context.json({
    withdrawalsEnabled:false,
    commissionPaymentsEnabled:Boolean(riderFinance && context.env.PAYMENTS_ENABLED==='true'),
    riderCommissionCheckout:riderCheckout,
    riderCommissionDebts:riderDebts,
    tutorials: await pricedTutorialReady(context.env)?firstRow(await database(context.env).execute(sql`
      select app_private.finance_balance(${user.universityId}::uuid,${user.id}::uuid,'TUTOR_PENDING') as pending_kobo,
        app_private.finance_balance(${user.universityId}::uuid,${user.id}::uuid,'TUTOR_AVAILABLE') as available_kobo,
        0::bigint as reserved_kobo,0::bigint as withdrawn_kobo
    `)):firstRow(tutorials),
    store: storeFinance??firstRow(store),
    legacyRecordedStore:storeFinance?firstRow(store):null,
    deliveries: riderFinance??firstRow(deliveries),
    payoutRequests: payouts.rows,
  });
});

agentRoutes.post('/rider-commission-checkout',async context=>{
  requireFeature(context.env,'PAYMENTS_ENABLED','Commission payments are not enabled yet.');
  if(!await riderFinanceReady(context.env))throw new AppError(503,'FEATURE_DISABLED','Commission payments are awaiting the scheduled database update.');
  const user=currentUser(context),data=await input(context,z.object({agentProfileId:z.string().uuid(),requestId:z.string().uuid()}));
  const own=firstRow(await database(context.env).execute<{university_id:string}>(sql`select id,university_id from public.agent_profiles where
    id=${data.agentProfileId}::uuid and user_id=${user.id}::uuid and agent_type='RIDER' and status='ACTIVE'`));
  if(!own)throw new AppError(404,'NOT_FOUND','That rider account is not available.');
  let intent;
  try{intent=firstRow(await database(context.env).execute<{id:string;provider_reference:string;amount_kobo:number;authorization_url:string|null;access_code:string|null;status:string}>(sql`
    select * from app_private.create_rider_commission_checkout(${crypto.randomUUID()}::uuid,${data.agentProfileId}::uuid,
      ${user.id}::uuid,${data.requestId}::uuid,${`K1-RC-${crypto.randomUUID()}`})
  `));}catch(e){if(e instanceof Error && e.message.includes('RIDER_NO_COMMISSION_DUE'))throw new AppError(409,'CONFLICT','Your ride commissions are already paid.');throw e;}
  if(!intent)throw new AppError(409,'CONFLICT','The commission checkout could not be prepared.');
  if(intent.status==='PAID')return context.json({status:'PAID',reference:intent.provider_reference});
  if(intent.status==='REQUIRES_REVIEW')return context.json({status:'REQUIRES_REVIEW',reference:intent.provider_reference});
  if(intent.status==='FAILED')throw new AppError(409,'CONFLICT','That checkout expired. Refresh your balance and start again.');
  if(intent.authorization_url && intent.access_code)return context.json({authorizationUrl:intent.authorization_url,reference:intent.provider_reference,amountKobo:Number(intent.amount_kobo)});
  // Stable reference survives a timeout; a receipt can still reconcile a late payment.
  const initialized=await initializePaystack(context.env,{email:user.email,amountKobo:Number(intent.amount_kobo),reference:intent.provider_reference,
    ...(context.env.APP_ORIGIN?{callbackUrl:`${context.env.APP_ORIGIN.replace(/\/$/,'')}/payment/return`}:{}),metadata:{resourceType:'RIDER_COMMISSION',resourceId:intent.id}});
  if(!initialized.access_code)throw new AppError(503,'PROVIDER_UNAVAILABLE','The provider returned an incomplete checkout. Try again.');
  await database(context.env).execute(sql`update app_private.rider_commission_checkouts set status='INITIALIZED',authorization_url=${initialized.authorization_url!},access_code=${initialized.access_code}
    where id=${intent.id}::uuid and status='CREATED'`);
  await recordAudit(context.env,{actorUserId:user.id,universityId:own.university_id,action:'rider.commission_checkout',targetType:'rider_commission',targetId:intent.id,requestId:context.get('requestId'),metadata:{amountKobo:Number(intent.amount_kobo)}});
  return context.json({authorizationUrl:initialized.authorization_url,reference:intent.provider_reference,amountKobo:Number(intent.amount_kobo)});
});

agentRoutes.get('/rider-commission-checkout/:reference',async context=>{
  const user=currentUser(context);
  requireFeature(context.env,'PAYMENTS_ENABLED','Commission payments are not enabled yet.');
  if(!await reconcileRiderCommission(context.env,context.req.param('reference'),user.id))throw new AppError(404,'NOT_FOUND','That commission payment could not be found.');
  const intent=firstRow(await database(context.env).execute(sql`select status,amount_kobo from app_private.rider_commission_checkouts
    where provider_reference=${context.req.param('reference')} and user_id=${user.id}::uuid`));
  return context.json({payment:intent});
});

agentRoutes.post("/payouts", async (context) => {
  requireFeature(
    context.env,
    "PAYMENTS_ENABLED",
    "Withdrawals are not connected yet. Your earnings remain in your account.",
  );
  if(await riderFinanceReady(context.env))throw new AppError(503,'FEATURE_DISABLED','Withdrawals are awaiting verified transfer settlement. Your earnings and commission payments remain available.');
  const user = currentUser(context);
  const parsed = payoutRequestSchema.safeParse(await body(context));
  if (!parsed.success)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Check the payout amount and account.",
    );
  const profileResult = await database(context.env).execute<{
    id: string;
    university_id: string;
    agent_type: string;
  }>(sql`
    select id, university_id, agent_type from public.agent_profiles
    where id = ${parsed.data.agentProfileId}::uuid and user_id = ${user.id}::uuid and status = 'ACTIVE' limit 1
  `);
  const profile = firstRow(profileResult);
  if (!profile)
    throw new AppError(404, "NOT_FOUND", "That agent profile does not exist.");
  const application = await database(context.env).execute<{
    id: string;
    bank_status: string;
  }>(sql`
    select id,bank_status from public.agent_applications where user_id = ${user.id}::uuid
      and university_id = ${profile.university_id}::uuid and agent_type = ${profile.agent_type} limit 1
  `);
  if (firstRow(application)?.bank_status !== "VERIFIED") {
    throw new AppError(
      409,
      "CONFLICT",
      "A verified payout account is required before requesting a withdrawal.",
    );
  }
  if (context.env.UNIFIED_SCHEMA_READY === "true")
    await requireFullKyc(context.env, firstRow(application)!.id);
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
      throw new AppError(
        409,
        "CONFLICT",
        "The requested amount is more than the available balance.",
      );
    }
    if (message.includes("PAYOUT_ACCOUNT_UNVERIFIED")) {
      throw new AppError(
        409,
        "CONFLICT",
        "A verified payout account is required before requesting a withdrawal.",
      );
    }
    if (message.includes("PAYOUT_PROFILE_UNAVAILABLE")) {
      throw new AppError(
        404,
        "NOT_FOUND",
        "That agent profile is no longer available.",
      );
    }
    throw caught;
  }
  await recordAudit(context.env, {
    actorUserId: user.id,
    universityId: profile.university_id,
    action: "payout.requested",
    targetType: "payout_request",
    targetId: id,
    requestId: context.get("requestId"),
    metadata: { amountKobo: parsed.data.amountKobo },
  });
  return context.json({ id, status: "REQUESTED" }, 201);
});
