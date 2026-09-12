import { sql } from "drizzle-orm";
import { Hono } from "hono";

import {
  agentVerificationReviewSchema,
  campusPlaceSchema,
  contentSourceSchema,
  deliveryZoneSchema,
  disputeReviewSchema,
  feedPostSchema,
  paymentEventReviewSchema,
  payoutReviewSchema,
  productCategorySchema,
  productModerationSchema,
  reviewAgentApplicationSchema,
  tutorialDemoSeedSchema,
  tutorialModerationSchema,
} from "@kampusone/contracts";

import { recordAudit } from "../lib/audit";
import { database, firstRow, sqlClient } from "../lib/database";
import { AppError } from "../lib/errors";
import { featureEnabled, phase3SchemaReady, requireFeature } from "../lib/features";
import { equalHash, sha256 } from "../lib/security";
import { currentUser, requireAuth, requireOperator } from "../middleware/auth";
import type { AuthenticatedUser, Bindings, Variables } from "../types";

const ADMIN_ROLES = [
  "PLATFORM_ADMIN", "INSTITUTION_ADMIN", "CONTENT_EDITOR",
  "VERIFICATION_REVIEWER", "SUPPORT", "FINANCE_REVIEWER",
] as const;

export const adminRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

async function body(context: { req: { json(): Promise<unknown> } }) {
  return context.req.json().catch(() => null);
}

async function adminScope(env: Bindings, user: AuthenticatedUser, requested?: string) {
  if (user.operatorRoles.includes("PLATFORM_ADMIN")) return requested ?? null;
  const result = await database(env).execute<{ university_id: string }>(sql`
    select university_id from public.operator_roles
    where user_id = ${user.id}::uuid and university_id is not null
      and (expires_at is null or expires_at > now())
    order by created_at limit 1
  `);
  const universityId = firstRow(result)?.university_id;
  if (!universityId) throw new AppError(403, "FORBIDDEN", "No university scope is assigned to this account.");
  if (requested && requested !== universityId) {
    throw new AppError(403, "FORBIDDEN", "You cannot access another university's records.");
  }
  return universityId;
}

function requireTutorialEditor(user: AuthenticatedUser) {
  if (!user.operatorRoles.some((role) => ["PLATFORM_ADMIN", "INSTITUTION_ADMIN", "CONTENT_EDITOR"].includes(role))) {
    throw new AppError(403, "FORBIDDEN", "A content or institution administrator role is required.");
  }
}

adminRoutes.post("/bootstrap", requireAuth, async (context) => {
  const user = currentUser(context);
  const supplied = context.req.header("X-Admin-Bootstrap-Token");
  const initialAdminEmail = context.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const mailboxAuthorized = Boolean(initialAdminEmail && user.email.toLowerCase() === initialAdminEmail);
  const tokenAuthorized = Boolean(context.env.ADMIN_BOOTSTRAP_TOKEN && supplied)
    && equalHash(await sha256(supplied!), await sha256(context.env.ADMIN_BOOTSTRAP_TOKEN!));
  if (!mailboxAuthorized && !tokenAuthorized) {
    throw new AppError(403, "FORBIDDEN", "The bootstrap credential is invalid.");
  }
  try {
    await database(context.env).execute(sql`
      select app_private.bootstrap_platform_admin(${user.id}::uuid)
    `);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    if (message.includes("ADMIN_BOOTSTRAP_ALREADY_COMPLETED")) {
      throw new AppError(409, "CONFLICT", "Administrator bootstrap has already been completed.");
    }
    if (message.includes("ADMIN_BOOTSTRAP_USER_UNAVAILABLE")) {
      throw new AppError(403, "FORBIDDEN", "Only a verified active account can become the first administrator.");
    }
    throw caught;
  }
  await recordAudit(context.env, {
    actorUserId: user.id, action: "admin.bootstrap.completed", targetType: "user",
    targetId: user.id, requestId: context.get("requestId"),
    metadata: { method: mailboxAuthorized ? "verified_initial_email" : "one_time_token" },
  });
  return context.json({ status: "platform_admin_created" }, 201);
});

adminRoutes.use("/*", requireAuth, requireOperator(...ADMIN_ROLES));

adminRoutes.get("/dashboard", async (context) => {
  const user = currentUser(context);
  const scope = await adminScope(context.env, user, context.req.query("universityId"));
  const [users, applications, content, commerce, revenue, trend, queues] = await Promise.all([
    database(context.env).execute(sql`
      select count(*)::int as total,
        count(*) filter (where users.created_at >= now() - interval '30 days')::int as new_30d,
        count(*) filter (where users.email_verified_at is not null)::int as email_verified,
        count(*) filter (where profiles.onboarding_completed_at is not null)::int as onboarded
      from public.users users left join public.profiles profiles on profiles.user_id = users.id
      where users.deleted_at is null and (${scope}::uuid is null or profiles.university_id = ${scope}::uuid)
    `),
    database(context.env).execute(sql`
      select count(*) filter (where status in ('SUBMITTED','IN_REVIEW'))::int as pending,
        count(*) filter (where status = 'APPROVED')::int as approved,
        count(*) filter (where agent_type = 'TUTOR')::int as tutors,
        count(*) filter (where agent_type = 'VENDOR')::int as vendors,
        count(*) filter (where agent_type = 'RIDER')::int as riders
      from public.agent_applications where (${scope}::uuid is null or university_id = ${scope}::uuid)
    `),
    database(context.env).execute(sql`
      select count(*) filter (where status in ('PUBLISHED','CORRECTED'))::int as published_posts,
        count(*) filter (where status = 'DRAFT')::int as draft_posts,
        (select count(*)::int from public.campus_places
          where status = 'PUBLISHED' and (${scope}::uuid is null or university_id = ${scope}::uuid)) as published_places
      from public.feed_posts where (${scope}::uuid is null or university_id = ${scope}::uuid)
    `),
    database(context.env).execute(sql`
      select
        (select count(*)::int from public.tutorial_bookings
          where ${scope}::uuid is null or university_id = ${scope}::uuid) as tutorial_bookings,
        (select count(*)::int from public.orders
          where ${scope}::uuid is null or university_id = ${scope}::uuid) as orders,
        (select count(*)::int from public.delivery_jobs
          where (${scope}::uuid is null or university_id = ${scope}::uuid) and status in ('AVAILABLE','RESERVED','PICKED_UP')) as active_deliveries,
        (select count(*)::int from public.disputes
          where (${scope}::uuid is null or university_id = ${scope}::uuid) and status in ('OPEN','UNDER_REVIEW')) as open_disputes,
        (select count(*)::int from public.payment_provider_events events
          left join public.tutorial_bookings bookings
            on events.resource_type = 'TUTORIAL_BOOKING' and bookings.id = events.resource_id
          left join public.orders orders
            on events.resource_type = 'STORE_ORDER' and orders.id = events.resource_id
          where events.state = 'REQUIRES_REVIEW'
            and (${scope}::uuid is null or coalesce(bookings.university_id, orders.university_id) = ${scope}::uuid)) as payment_anomalies
    `),
    database(context.env).execute(sql`
      select
        coalesce((select sum(amount_kobo) from public.tutorial_bookings
          where (${scope}::uuid is null or university_id = ${scope}::uuid)
            and status in ('CONFIRMED','COMPLETED')), 0)::bigint as tutorial_gmv_kobo,
        coalesce((select sum(subtotal_kobo) from public.orders
          where (${scope}::uuid is null or university_id = ${scope}::uuid)
            and status in ('PAID','ACCEPTED','READY','IN_DELIVERY','DELIVERED')), 0)::bigint as store_gmv_kobo,
        coalesce((select sum(delivery_fee_kobo) from public.orders
          where (${scope}::uuid is null or university_id = ${scope}::uuid)
            and status in ('PAID','ACCEPTED','READY','IN_DELIVERY','DELIVERED')), 0)::bigint as delivery_gmv_kobo,
        coalesce((select sum(case lines.direction when 'CREDIT' then lines.amount_kobo else -lines.amount_kobo end)
          from public.ledger_lines lines
          join public.ledger_accounts accounts on accounts.id = lines.account_id
          join public.ledger_transactions transactions on transactions.id = lines.transaction_id
          where accounts.account_type = 'REVENUE'
            and (${scope}::uuid is null or transactions.university_id = ${scope}::uuid)), 0)::bigint as recognized_revenue_kobo
    `),
    database(context.env).execute(sql`
      with days as (select generate_series(current_date - 29, current_date, interval '1 day')::date as day),
      income as (
        select created_at::date as day, sum(amount_kobo)::bigint as amount
        from public.tutorial_bookings where status in ('CONFIRMED','COMPLETED')
          and (${scope}::uuid is null or university_id = ${scope}::uuid)
          and created_at >= current_date - 29 group by created_at::date
        union all
        select created_at::date as day, sum(total_kobo)::bigint as amount
        from public.orders where status in ('PAID','ACCEPTED','READY','IN_DELIVERY','DELIVERED')
          and (${scope}::uuid is null or university_id = ${scope}::uuid)
          and created_at >= current_date - 29 group by created_at::date
      )
      select days.day, coalesce(sum(income.amount), 0)::bigint as gmv_kobo
      from days left join income on income.day = days.day group by days.day order by days.day
    `),
    database(context.env).execute(sql`
      select id, agent_type, display_name, status, submitted_at
      from public.agent_applications
      where status in ('SUBMITTED','IN_REVIEW') and (${scope}::uuid is null or university_id = ${scope}::uuid)
      order by submitted_at limit 8
    `),
  ]);
  return context.json({
    scope: { universityId: scope },
    metrics: {
      users: firstRow(users), applications: firstRow(applications), content: firstRow(content),
      commerce: firstRow(commerce), revenue: firstRow(revenue),
    },
    revenueTrend: trend.rows,
    queues: { applications: queues.rows },
    generatedAt: new Date().toISOString(),
  });
});

adminRoutes.get("/users", async (context) => {
  const user = currentUser(context);
  const scope = await adminScope(context.env, user, context.req.query("universityId"));
  const searchText = context.req.query("q")?.trim();
  const search = searchText ? `%${searchText}%` : null;
  const result = await database(context.env).execute(sql`
    select users.id, users.email, users.roles, users.status, users.email_verified_at,
      users.created_at, users.last_login_at, profiles.display_name, profiles.username,
      profiles.current_level, profiles.verification_status, profiles.onboarding_completed_at,
      universities.name as university_name
    from public.users users
    left join public.profiles profiles on profiles.user_id = users.id and profiles.deleted_at is null
    left join public.universities universities on universities.id = profiles.university_id
    where users.deleted_at is null and (${scope}::uuid is null or profiles.university_id = ${scope}::uuid)
      and (${search}::text is null or users.email ilike ${search} or profiles.display_name ilike ${search})
    order by users.created_at desc limit 200
  `);
  return context.json({ users: result.rows });
});

adminRoutes.get("/applications", async (context) => {
  const user = currentUser(context);
  const scope = await adminScope(context.env, user, context.req.query("universityId"));
  const result = await database(context.env).execute(sql`
      select applications.id, applications.agent_type, applications.display_name,
      applications.phone_e164, applications.statement, applications.evidence,
      applications.legal_name, applications.address_text, applications.emergency_contact_name,
      applications.emergency_contact_phone, applications.phone_verified_at,
      applications.terms_version, applications.terms_accepted_at,
      applications.kyc_status, applications.kyc_provider, applications.kyc_reference,
      applications.bank_status, applications.bank_account_name, applications.bank_account_last4,
      applications.status, applications.review_note, applications.submitted_at,
      applications.reviewed_at, users.email, profiles.username
    from public.agent_applications applications
    join public.users users on users.id = applications.user_id
    left join public.profiles profiles on profiles.user_id = applications.user_id
    where ${scope}::uuid is null or applications.university_id = ${scope}::uuid
    order by case applications.status when 'SUBMITTED' then 0 when 'IN_REVIEW' then 1 else 2 end,
      applications.submitted_at desc limit 200
  `);
  return context.json({ applications: result.rows });
});

adminRoutes.post("/applications/:id/verification", async (context) => {
  const user = currentUser(context);
  if (!user.operatorRoles.some((role) => ["PLATFORM_ADMIN", "VERIFICATION_REVIEWER"].includes(role))) {
    throw new AppError(403, "FORBIDDEN", "A verification reviewer role is required.");
  }
  const parsed = agentVerificationReviewSchema.safeParse(await body(context));
  if (!parsed.success || (parsed.data.bankStatus === "VERIFIED"
    && (!parsed.data.bankAccountName || !parsed.data.bankAccountLast4))) {
    throw new AppError(400, "BAD_REQUEST", "A documented verification decision and resolved bank account are required.");
  }
  const applicationResult = await database(context.env).execute<{ id: string; university_id: string }>(sql`
    select id, university_id from public.agent_applications where id = ${context.req.param("id")}::uuid limit 1
  `);
  const application = firstRow(applicationResult);
  if (!application) throw new AppError(404, "NOT_FOUND", "That application does not exist.");
  await adminScope(context.env, user, application.university_id);
  await database(context.env).execute(sql`
    update public.agent_applications set
      kyc_status = ${parsed.data.identityStatus},
      kyc_provider = 'MANUAL_PILOT_REVIEW',
      kyc_reference = ${parsed.data.providerReference ?? null},
      phone_verified_at = ${parsed.data.phoneVerified ? new Date().toISOString() : null}::timestamptz,
      bank_status = ${parsed.data.bankStatus},
      bank_provider = case when ${parsed.data.bankStatus} = 'VERIFIED' then 'MANUAL_PILOT_REVIEW' else bank_provider end,
      bank_account_name = ${parsed.data.bankAccountName ?? null},
      bank_account_last4 = ${parsed.data.bankAccountLast4 ?? null},
      review_note = ${parsed.data.note}, status = case when status = 'SUBMITTED' then 'IN_REVIEW' else status end,
      updated_at = now()
    where id = ${application.id}::uuid
  `);
  await recordAudit(context.env, { actorUserId: user.id, universityId: application.university_id,
    action: "agent.verification.reviewed", targetType: "agent_application", targetId: application.id,
    requestId: context.get("requestId"), metadata: { identityStatus: parsed.data.identityStatus,
      phoneVerified: parsed.data.phoneVerified, bankStatus: parsed.data.bankStatus, note: parsed.data.note } });
  return context.json({ status: "VERIFICATION_RECORDED" });
});

adminRoutes.post("/applications/:id/review", async (context) => {
  const user = currentUser(context);
  if (!user.operatorRoles.some((role) => ["PLATFORM_ADMIN", "VERIFICATION_REVIEWER"].includes(role))) {
    throw new AppError(403, "FORBIDDEN", "A verification reviewer role is required.");
  }
  const parsed = reviewAgentApplicationSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "A decision and reviewer note are required.");
  const applicationResult = await database(context.env).execute<{
    id: string; user_id: string; university_id: string; agent_type: string; display_name: string;
    kyc_status: string; phone_verified_at: string | null; terms_accepted_at: string | null;
  }>(sql`
    select id, user_id, university_id, agent_type, display_name,
      kyc_status, phone_verified_at, terms_accepted_at
    from public.agent_applications where id = ${context.req.param("id")}::uuid limit 1
  `);
  const application = firstRow(applicationResult);
  if (!application) throw new AppError(404, "NOT_FOUND", "That application does not exist.");
  await adminScope(context.env, user, application.university_id);
  if (parsed.data.decision === "APPROVED" && (
    !["VERIFIED", "MANUALLY_VERIFIED"].includes(application.kyc_status)
    || !application.phone_verified_at || !application.terms_accepted_at
  )) {
    throw new AppError(409, "CONFLICT", "Identity, phone, and agent terms must be verified before approval.");
  }

  const client = sqlClient(context.env);
  const statements = [client`
    update public.agent_applications set status = ${parsed.data.decision},
      reviewer_user_id = ${user.id}::uuid, review_note = ${parsed.data.note},
      reviewed_at = now(), updated_at = now()
    where id = ${application.id}::uuid
  `];
  if (parsed.data.decision === "APPROVED") {
    statements.push(client`
      insert into public.agent_profiles (
        university_id, user_id, application_id, agent_type, display_name, verified_at
      ) values (
        ${application.university_id}::uuid, ${application.user_id}::uuid,
        ${application.id}::uuid, ${application.agent_type}, ${application.display_name}, now()
      ) on conflict (university_id, user_id, agent_type) do update set
        application_id = excluded.application_id, display_name = excluded.display_name,
        verified_at = now(), status = 'ACTIVE', updated_at = now()
    `);
    statements.push(client`
      update public.users set roles = array(
        select distinct role from unnest(roles || array['AGENT'::"UserRole"]) as role
      ), updated_at = now() where id = ${application.user_id}::uuid
    `);
  }
  await client.transaction(statements);
  await recordAudit(context.env, {
    actorUserId: user.id, universityId: application.university_id,
    action: "agent.application.reviewed", targetType: "agent_application",
    targetId: application.id, requestId: context.get("requestId"),
    metadata: { decision: parsed.data.decision, agentType: application.agent_type },
  });
  return context.json({ status: parsed.data.decision });
});

adminRoutes.get("/tutorials", async (context) => {
  requireFeature(context.env, "TUTORIALS_ENABLED", "Tutorial operations are not enabled in this environment.");
  const user = currentUser(context);
  requireTutorialEditor(user);
  const scope = await adminScope(context.env, user, context.req.query("universityId"));
  const [listings, resources] = await Promise.all([
    database(context.env).execute(sql`
      select listings.id, listings.university_id, listings.course_code, listings.title,
        listings.format, listings.price_kobo, listings.capacity, listings.status,
        listings.review_status, listings.review_note, listings.submitted_at,
        listings.reviewed_at, listings.is_demo, listings.updated_at,
        coalesce(profiles.display_name, listings.publisher_name, 'KampusOne tutor') as tutor_name,
        universities.name as university_name,
        (select count(*)::int from public.tutorial_bookings bookings
          where bookings.listing_id = listings.id) as booking_count
      from public.tutorial_listings listings
      join public.universities universities on universities.id = listings.university_id
      left join public.agent_profiles profiles on profiles.id = listings.tutor_profile_id
      where listings.deleted_at is null
        and (${scope}::uuid is null or listings.university_id = ${scope}::uuid)
      order by case listings.review_status when 'PENDING' then 0 else 1 end,
        listings.is_demo desc, listings.updated_at desc
      limit 300
    `),
    database(context.env).execute(sql`
      select resources.id, resources.university_id, resources.course_code,
        resources.title, resources.resource_type, resources.access_model,
        resources.price_kobo, resources.publisher_name, resources.status,
        resources.review_note, resources.submitted_at, resources.reviewed_at,
        resources.is_demo, resources.updated_at, universities.name as university_name
      from public.tutorial_resources resources
      join public.universities universities on universities.id = resources.university_id
      where resources.deleted_at is null
        and (${scope}::uuid is null or resources.university_id = ${scope}::uuid)
      order by case resources.status when 'SUBMITTED' then 0 else 1 end,
        resources.is_demo desc, resources.updated_at desc
      limit 400
    `),
  ]);
  return context.json({
    listings: listings.rows,
    resources: resources.rows,
    summary: {
      listings: listings.rows.length,
      resources: resources.rows.length,
      pending: listings.rows.filter((item) => String(item.review_status) === "PENDING").length
        + resources.rows.filter((item) => String(item.status) === "SUBMITTED").length,
      demo: listings.rows.filter((item) => Boolean(item.is_demo)).length
        + resources.rows.filter((item) => Boolean(item.is_demo)).length,
    },
  });
});

adminRoutes.post("/tutorials/demo", async (context) => {
  requireFeature(context.env, "TUTORIALS_ENABLED", "Tutorial operations are not enabled in this environment.");
  const user = currentUser(context);
  requireTutorialEditor(user);
  const parsed = tutorialDemoSeedSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Choose the university that should receive demo tutorials.");
  await adminScope(context.env, user, parsed.data.universityId);
  const result = await database(context.env).execute<{ seeded: { listings: number; resources: number } }>(sql`
    select app_private.seed_tutorial_demo(
      ${parsed.data.universityId}::uuid, ${user.id}::uuid
    ) as seeded
  `);
  const seeded = firstRow(result)?.seeded ?? { listings: 0, resources: 0 };
  await recordAudit(context.env, {
    actorUserId: user.id, universityId: parsed.data.universityId,
    action: "tutorial.demo.seeded", targetType: "tutorial_demo", targetId: parsed.data.universityId,
    requestId: context.get("requestId"), metadata: seeded,
  });
  return context.json({ status: "READY", ...seeded }, 201);
});

adminRoutes.delete("/tutorials/demo", async (context) => {
  requireFeature(context.env, "TUTORIALS_ENABLED", "Tutorial operations are not enabled in this environment.");
  const user = currentUser(context);
  requireTutorialEditor(user);
  const universityId = context.req.query("universityId");
  const parsed = tutorialDemoSeedSchema.safeParse({ universityId });
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Choose the university whose demo catalogue should be removed.");
  await adminScope(context.env, user, parsed.data.universityId);
  const result = await database(context.env).execute<{
    removed: { listings: number; resources: number; cancelledBookings: number };
  }>(sql`
    select app_private.remove_tutorial_demo(
      ${parsed.data.universityId}::uuid, ${user.id}::uuid
    ) as removed
  `);
  const removed = firstRow(result)?.removed ?? { listings: 0, resources: 0, cancelledBookings: 0 };
  await recordAudit(context.env, {
    actorUserId: user.id, universityId: parsed.data.universityId,
    action: "tutorial.demo.removed", targetType: "tutorial_demo", targetId: parsed.data.universityId,
    requestId: context.get("requestId"), metadata: removed,
  });
  return context.json({ status: "REMOVED", ...removed });
});

adminRoutes.post("/tutorials/listings/:id/review", async (context) => {
  requireFeature(context.env, "TUTORIALS_ENABLED", "Tutorial operations are not enabled in this environment.");
  const user = currentUser(context);
  requireTutorialEditor(user);
  const parsed = tutorialModerationSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Record a valid tutorial decision and reviewer note.");
  const found = await database(context.env).execute<{
    id: string; university_id: string; status: string; price_kobo: number;
  }>(sql`
    select id, university_id, status, price_kobo from public.tutorial_listings
    where id = ${context.req.param("id")}::uuid and deleted_at is null limit 1
  `);
  const listing = firstRow(found);
  if (!listing) throw new AppError(404, "NOT_FOUND", "That tutorial listing does not exist.");
  await adminScope(context.env, user, listing.university_id);
  if (parsed.data.decision === "APPROVED" && Number(listing.price_kobo) > 0
    && !featureEnabled(context.env, "PAYMENTS_ENABLED")) {
    throw new AppError(409, "CONFLICT", "Paid tutorials cannot be approved while payments are disabled.");
  }
  const nextStatus = parsed.data.decision === "APPROVED" ? "PUBLISHED"
    : parsed.data.decision === "REJECTED" ? "REJECTED" : "DRAFT";
  await database(context.env).execute(sql`
    update public.tutorial_listings set status = ${nextStatus},
      review_status = ${parsed.data.decision}, review_note = ${parsed.data.note},
      reviewed_at = now(), reviewed_by_user_id = ${user.id}::uuid, updated_at = now()
    where id = ${listing.id}::uuid
  `);
  await recordAudit(context.env, {
    actorUserId: user.id, universityId: listing.university_id,
    action: "tutorial.listing.reviewed", targetType: "tutorial_listing", targetId: listing.id,
    requestId: context.get("requestId"), metadata: { decision: parsed.data.decision, note: parsed.data.note },
  });
  return context.json({ status: nextStatus, reviewStatus: parsed.data.decision });
});

adminRoutes.post("/tutorials/resources/:id/review", async (context) => {
  requireFeature(context.env, "TUTORIALS_ENABLED", "Tutorial operations are not enabled in this environment.");
  const user = currentUser(context);
  requireTutorialEditor(user);
  const parsed = tutorialModerationSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Record a valid resource decision and reviewer note.");
  const found = await database(context.env).execute<{
    id: string; university_id: string; access_model: string;
  }>(sql`
    select id, university_id, access_model from public.tutorial_resources
    where id = ${context.req.param("id")}::uuid and deleted_at is null limit 1
  `);
  const resource = firstRow(found);
  if (!resource) throw new AppError(404, "NOT_FOUND", "That learning resource does not exist.");
  await adminScope(context.env, user, resource.university_id);
  if (parsed.data.decision === "APPROVED" && resource.access_model === "PAID"
    && !featureEnabled(context.env, "PAYMENTS_ENABLED")) {
    throw new AppError(409, "CONFLICT", "Paid resources cannot be approved while payments are disabled.");
  }
  const nextStatus = parsed.data.decision === "APPROVED" ? "PUBLISHED"
    : parsed.data.decision === "REJECTED" ? "REJECTED" : "DRAFT";
  await database(context.env).execute(sql`
    update public.tutorial_resources set status = ${nextStatus},
      review_note = ${parsed.data.note}, reviewed_at = now(),
      reviewed_by_user_id = ${user.id}::uuid, updated_at = now()
    where id = ${resource.id}::uuid
  `);
  await recordAudit(context.env, {
    actorUserId: user.id, universityId: resource.university_id,
    action: "tutorial.resource.reviewed", targetType: "tutorial_resource", targetId: resource.id,
    requestId: context.get("requestId"), metadata: { decision: parsed.data.decision, note: parsed.data.note },
  });
  return context.json({ status: nextStatus });
});

adminRoutes.delete("/tutorials/listings/:id", async (context) => {
  requireFeature(context.env, "TUTORIALS_ENABLED", "Tutorial operations are not enabled in this environment.");
  const user = currentUser(context);
  requireTutorialEditor(user);
  const found = await database(context.env).execute<{
    id: string; university_id: string; paid_active_bookings: number;
  }>(sql`
    select listings.id, listings.university_id,
      count(bookings.id) filter (where bookings.amount_kobo > 0
        and bookings.status in ('CONFIRMED','DISPUTED'))::int as paid_active_bookings
    from public.tutorial_listings listings
    left join public.tutorial_bookings bookings on bookings.listing_id = listings.id
    where listings.id = ${context.req.param("id")}::uuid and listings.deleted_at is null
    group by listings.id limit 1
  `);
  const listing = firstRow(found);
  if (!listing) throw new AppError(404, "NOT_FOUND", "That tutorial listing does not exist.");
  await adminScope(context.env, user, listing.university_id);
  if (Number(listing.paid_active_bookings) > 0) {
    throw new AppError(409, "CONFLICT", "Resolve active paid bookings before removing this tutorial.");
  }
  const client = sqlClient(context.env);
  await client.transaction([
    client`update public.tutorial_bookings set status = 'CANCELLED',
      cancellation_reason = 'Tutorial removed by an administrator.', cancelled_at = now(),
      cancelled_by_user_id = ${user.id}::uuid, earnings_state = 'NOT_EARNED', updated_at = now()
      where listing_id = ${listing.id}::uuid and status in ('PENDING_PAYMENT','CONFIRMED')`,
    client`update public.tutorial_availability_windows set status = 'CANCELLED', updated_at = now()
      where listing_id = ${listing.id}::uuid and status = 'OPEN'`,
    client`update public.tutorial_listings set status = 'ARCHIVED',
      deleted_at = now(), updated_at = now() where id = ${listing.id}::uuid`,
  ]);
  await recordAudit(context.env, {
    actorUserId: user.id, universityId: listing.university_id,
    action: "tutorial.listing.removed", targetType: "tutorial_listing", targetId: listing.id,
    requestId: context.get("requestId"),
  });
  return context.json({ status: "DELETED" });
});

adminRoutes.delete("/tutorials/resources/:id", async (context) => {
  requireFeature(context.env, "TUTORIALS_ENABLED", "Tutorial operations are not enabled in this environment.");
  const user = currentUser(context);
  requireTutorialEditor(user);
  const found = await database(context.env).execute<{ id: string; university_id: string }>(sql`
    select id, university_id from public.tutorial_resources
    where id = ${context.req.param("id")}::uuid and deleted_at is null limit 1
  `);
  const resource = firstRow(found);
  if (!resource) throw new AppError(404, "NOT_FOUND", "That learning resource does not exist.");
  await adminScope(context.env, user, resource.university_id);
  await database(context.env).execute(sql`
    update public.tutorial_resources set status = 'ARCHIVED', deleted_at = now(), updated_at = now()
    where id = ${resource.id}::uuid
  `);
  await recordAudit(context.env, {
    actorUserId: user.id, universityId: resource.university_id,
    action: "tutorial.resource.removed", targetType: "tutorial_resource", targetId: resource.id,
    requestId: context.get("requestId"),
  });
  return context.json({ status: "DELETED" });
});

adminRoutes.get("/content/context", async (context) => {
  const user = currentUser(context);
  const scope = await adminScope(context.env, user, context.req.query("universityId"));
  const [universities, sources] = await Promise.all([
    database(context.env).execute(sql`
      select id, name, slug from public.universities
      where deleted_at is null and (${scope}::uuid is null or id = ${scope}::uuid)
      order by name
    `),
    database(context.env).execute(sql`
      select id, university_id, name, source_url, verified, review_due_at, created_at
      from public.content_sources
      where ${scope}::uuid is null or university_id = ${scope}::uuid
      order by verified desc, name
    `),
  ]);
  return context.json({ universities: universities.rows, sources: sources.rows });
});

adminRoutes.post("/content/sources", async (context) => {
  const user = currentUser(context);
  if (!user.operatorRoles.some((role) => ["PLATFORM_ADMIN", "INSTITUTION_ADMIN", "CONTENT_EDITOR"].includes(role))) {
    throw new AppError(403, "FORBIDDEN", "A content editor role is required.");
  }
  const parsed = contentSourceSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Check the source details and try again.");
  await adminScope(context.env, user, parsed.data.universityId);
  const id = crypto.randomUUID();
  const result = await database(context.env).execute<{ id: string }>(sql`
    insert into public.content_sources (
      id, university_id, name, source_url, owner_user_id, review_due_at
    ) values (
      ${id}::uuid, ${parsed.data.universityId}::uuid, ${parsed.data.name},
      ${parsed.data.sourceUrl ?? null}, ${user.id}::uuid, now() + interval '90 days'
    )
    on conflict (university_id, name) do update set
      source_url = excluded.source_url, owner_user_id = excluded.owner_user_id,
      review_due_at = now() + interval '90 days'
    returning id
  `);
  const source = firstRow(result);
  await recordAudit(context.env, {
    actorUserId: user.id, universityId: parsed.data.universityId,
    action: "content.source.saved", targetType: "content_source",
    targetId: source?.id ?? id, requestId: context.get("requestId"),
  });
  return context.json({ id: source?.id ?? id, status: "PENDING_VERIFICATION" }, 201);
});

adminRoutes.post("/content/sources/:id/verify", async (context) => {
  const user = currentUser(context);
  if (!user.operatorRoles.some((role) => ["PLATFORM_ADMIN", "INSTITUTION_ADMIN"].includes(role))) {
    throw new AppError(403, "FORBIDDEN", "An institution administrator role is required.");
  }
  const result = await database(context.env).execute<{ id: string; university_id: string }>(sql`
    select id, university_id from public.content_sources
    where id = ${context.req.param("id")}::uuid limit 1
  `);
  const source = firstRow(result);
  if (!source) throw new AppError(404, "NOT_FOUND", "That content source does not exist.");
  await adminScope(context.env, user, source.university_id);
  await database(context.env).execute(sql`
    update public.content_sources set verified = true, review_due_at = now() + interval '90 days'
    where id = ${source.id}::uuid
  `);
  await recordAudit(context.env, { actorUserId: user.id, universityId: source.university_id,
    action: "content.source.verified", targetType: "content_source", targetId: source.id,
    requestId: context.get("requestId") });
  return context.json({ status: "VERIFIED" });
});

adminRoutes.post("/content/posts", async (context) => {
  const user = currentUser(context);
  if (!user.operatorRoles.some((role) => ["PLATFORM_ADMIN", "INSTITUTION_ADMIN", "CONTENT_EDITOR"].includes(role))) {
    throw new AppError(403, "FORBIDDEN", "A content editor role is required.");
  }
  const parsed = feedPostSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Check the post details and try again.");
  await adminScope(context.env, user, parsed.data.universityId);
  const sourceResult = await database(context.env).execute<{ id: string; verified: boolean }>(sql`
    select id, verified from public.content_sources
    where id = ${parsed.data.sourceId}::uuid and university_id = ${parsed.data.universityId}::uuid limit 1
  `);
  const source = firstRow(sourceResult);
  if (!source) throw new AppError(400, "BAD_REQUEST", "Choose a source belonging to this university.");
  if (parsed.data.publishNow && !source.verified) {
    throw new AppError(409, "CONFLICT", "Verify the content source before publishing this post.");
  }
  const id = crypto.randomUUID();
  await database(context.env).execute(sql`
    insert into public.feed_posts (
      id, university_id, source_id, author_user_id, category, title,
      summary, body, image_url, urgent, sponsored, status, published_at
    ) values (
      ${id}::uuid, ${parsed.data.universityId}::uuid, ${parsed.data.sourceId}::uuid,
      ${user.id}::uuid, ${parsed.data.category}, ${parsed.data.title}, ${parsed.data.summary},
      ${parsed.data.body}, ${parsed.data.imageUrl ?? null}, ${parsed.data.urgent},
      ${parsed.data.sponsored}, ${parsed.data.publishNow ? "PUBLISHED" : "DRAFT"},
      ${parsed.data.publishNow ? new Date().toISOString() : null}::timestamptz
    )
  `);
  await recordAudit(context.env, {
    actorUserId: user.id, universityId: parsed.data.universityId,
    action: parsed.data.publishNow ? "content.post.published" : "content.post.created",
    targetType: "feed_post", targetId: id, requestId: context.get("requestId"),
  });
  return context.json({ id, status: parsed.data.publishNow ? "PUBLISHED" : "DRAFT" }, 201);
});

adminRoutes.post("/content/places", async (context) => {
  const user = currentUser(context);
  if (!user.operatorRoles.some((role) => ["PLATFORM_ADMIN", "INSTITUTION_ADMIN", "CONTENT_EDITOR"].includes(role))) {
    throw new AppError(403, "FORBIDDEN", "A content editor role is required.");
  }
  const parsed = campusPlaceSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Check the campus place details and try again.");
  await adminScope(context.env, user, parsed.data.universityId);
  const id = crypto.randomUUID();
  await database(context.env).execute(sql`
    insert into public.campus_places (
      id, university_id, name, category, description, latitude, longitude,
      accessibility_notes, image_url, status, verified_at
    ) values (
      ${id}::uuid, ${parsed.data.universityId}::uuid, ${parsed.data.name},
      ${parsed.data.category}, ${parsed.data.description ?? null}, ${parsed.data.latitude ?? null},
      ${parsed.data.longitude ?? null}, ${parsed.data.accessibilityNotes ?? null},
      ${parsed.data.imageUrl ?? null}, ${parsed.data.publishNow ? "PUBLISHED" : "DRAFT"},
      ${parsed.data.publishNow ? new Date().toISOString() : null}::timestamptz
    )
  `);
  await recordAudit(context.env, {
    actorUserId: user.id, universityId: parsed.data.universityId,
    action: "campus.place.created", targetType: "campus_place", targetId: id,
    requestId: context.get("requestId"), metadata: { published: parsed.data.publishNow },
  });
  return context.json({ id, status: parsed.data.publishNow ? "PUBLISHED" : "DRAFT" }, 201);
});

adminRoutes.get("/audit", async (context) => {
  const user = currentUser(context);
  const scope = await adminScope(context.env, user, context.req.query("universityId"));
  const result = await database(context.env).execute(sql`
    select id, occurred_at, actor_user_id, university_id, action, target_type,
      target_id, request_id, outcome, metadata
    from app_private.audit_events
    where ${scope}::uuid is null or university_id = ${scope}::uuid
    order by occurred_at desc limit 250
  `);
  return context.json({ events: result.rows });
});

adminRoutes.get("/operations", async (context) => {
  const user = currentUser(context);
  const scope = await adminScope(context.env, user, context.req.query("universityId"));
  const [categories, products, zones, disputes, payouts, paymentEvents] = await Promise.all([
    database(context.env).execute(sql`
      select id, university_id, name, status, listing_rules, reviewed_at, updated_at
      from public.product_categories where ${scope}::uuid is null or university_id = ${scope}::uuid
      order by status, name
    `),
    phase3SchemaReady(context.env)
      ? database(context.env).execute(sql`
          select products.id, products.university_id, products.name, products.description,
            products.category, products.price_kobo, products.stock_quantity, products.image_url,
            products.status, products.submitted_at, products.moderation_note,
            products.preparation_minutes, products.package_weight_grams,
            products.package_length_cm, products.package_width_cm, products.package_height_cm,
            products.bicycle_delivery_eligible, products.listing_revision,
            profiles.display_name as vendor_name
          from public.vendor_products products
          join public.agent_profiles profiles on profiles.id = products.vendor_profile_id
          where (${scope}::uuid is null or products.university_id = ${scope}::uuid)
            and products.status in ('SUBMITTED', 'NEEDS_CORRECTION', 'REJECTED', 'PUBLISHED', 'PAUSED')
          order by case products.status when 'SUBMITTED' then 0 else 1 end,
            products.submitted_at desc nulls last, products.updated_at desc
          limit 250
        `)
      : Promise.resolve({ rows: [] }),
    phase3SchemaReady(context.env)
      ? database(context.env).execute(sql`
          select id, university_id, name, base_fee_kobo, active, operating_hours,
            max_package_weight_grams, max_package_dimension_cm, rider_earning_kobo,
            earning_formula_version, reservation_timeout_minutes, created_at, updated_at
          from public.delivery_zones
          where ${scope}::uuid is null or university_id = ${scope}::uuid
          order by active desc, name
        `)
      : database(context.env).execute(sql`
          select id, university_id, name, base_fee_kobo, active, created_at
          from public.delivery_zones
          where ${scope}::uuid is null or university_id = ${scope}::uuid
          order by active desc, name
        `),
    database(context.env).execute(sql`
      select disputes.id, disputes.category, disputes.reason, disputes.status,
        disputes.tutorial_booking_id, disputes.order_id, disputes.resolution_code,
        disputes.resolution_note, disputes.created_at, users.email as opened_by_email
      from public.disputes disputes join public.users users on users.id = disputes.opened_by_user_id
      where ${scope}::uuid is null or disputes.university_id = ${scope}::uuid
      order by case disputes.status when 'OPEN' then 0 when 'UNDER_REVIEW' then 1 else 2 end,
        disputes.created_at desc limit 200
    `),
    database(context.env).execute(sql`
      select requests.id, requests.amount_kobo, requests.status, requests.provider_reference,
        requests.review_note, requests.requested_at, requests.reviewed_at, requests.paid_at,
        profiles.display_name, profiles.agent_type, users.email
      from public.payout_requests requests
      join public.agent_profiles profiles on profiles.id = requests.agent_profile_id
      join public.users users on users.id = requests.requested_by_user_id
      where ${scope}::uuid is null or requests.university_id = ${scope}::uuid
      order by case requests.status when 'REQUESTED' then 0 when 'IN_REVIEW' then 1 else 2 end,
        requests.requested_at desc limit 200
    `),
    database(context.env).execute(sql`
      select events.id, events.provider, events.provider_reference, events.event_type,
        events.amount_kobo, events.state, events.resource_type, events.resource_id,
        events.review_reason, events.resolution_code, events.resolution_note,
        events.received_at, events.resolved_at,
        coalesce(bookings.university_id, orders.university_id) as university_id
      from public.payment_provider_events events
      left join public.tutorial_bookings bookings
        on events.resource_type = 'TUTORIAL_BOOKING' and bookings.id = events.resource_id
      left join public.orders orders
        on events.resource_type = 'STORE_ORDER' and orders.id = events.resource_id
      where ${scope}::uuid is null
        or coalesce(bookings.university_id, orders.university_id) = ${scope}::uuid
      order by case events.state when 'REQUIRES_REVIEW' then 0 when 'RECEIVED' then 1 else 2 end,
        events.received_at desc limit 200
    `),
  ]);
  return context.json({ categories: categories.rows, products: products.rows, zones: zones.rows,
    disputes: disputes.rows, payoutRequests: payouts.rows, paymentEvents: paymentEvents.rows });
});

adminRoutes.post("/operations/payment-events/:id/review", async (context) => {
  const user = currentUser(context);
  if (!user.operatorRoles.some((role) => ["PLATFORM_ADMIN", "FINANCE_REVIEWER"].includes(role))) {
    throw new AppError(403, "FORBIDDEN", "A finance reviewer role is required.");
  }
  const parsed = paymentEventReviewSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Document a valid payment resolution.");
  const result = await database(context.env).execute<{
    id: string; state: string; resource_type: string | null; resource_id: string | null; university_id: string | null;
  }>(sql`
    select events.id, events.state, events.resource_type, events.resource_id,
      coalesce(bookings.university_id, orders.university_id) as university_id
    from public.payment_provider_events events
    left join public.tutorial_bookings bookings
      on events.resource_type = 'TUTORIAL_BOOKING' and bookings.id = events.resource_id
    left join public.orders orders
      on events.resource_type = 'STORE_ORDER' and orders.id = events.resource_id
    where events.id = ${context.req.param("id")}::uuid limit 1
  `);
  const paymentEvent = firstRow(result);
  if (!paymentEvent) throw new AppError(404, "NOT_FOUND", "That payment event does not exist.");
  if (paymentEvent.state !== "REQUIRES_REVIEW") {
    throw new AppError(409, "CONFLICT", "Only payment events awaiting review can be resolved.");
  }
  if (!paymentEvent.university_id && !user.operatorRoles.includes("PLATFORM_ADMIN")) {
    throw new AppError(403, "FORBIDDEN", "Only a platform administrator can resolve an unmatched payment event.");
  }
  await adminScope(context.env, user, paymentEvent.university_id ?? undefined);
  const updated = await database(context.env).execute<{ id: string }>(sql`
    update public.payment_provider_events set state = 'RESOLVED',
      resolution_code = ${parsed.data.resolutionCode}, resolution_note = ${parsed.data.note},
      reviewer_user_id = ${user.id}::uuid, resolved_at = now(), updated_at = now()
    where id = ${paymentEvent.id}::uuid and state = 'REQUIRES_REVIEW'
    returning id
  `);
  if (!firstRow(updated)) {
    throw new AppError(409, "CONFLICT", "This payment event was resolved by another reviewer.");
  }
  await recordAudit(context.env, { actorUserId: user.id, universityId: paymentEvent.university_id,
    action: "payment.event.resolved", targetType: "payment_provider_event", targetId: paymentEvent.id,
    requestId: context.get("requestId"), metadata: { resolutionCode: parsed.data.resolutionCode,
      resourceType: paymentEvent.resource_type, resourceId: paymentEvent.resource_id, note: parsed.data.note } });
  return context.json({ status: "RESOLVED" });
});

adminRoutes.post("/operations/categories", async (context) => {
  const user = currentUser(context);
  if (!user.operatorRoles.some((role) => ["PLATFORM_ADMIN", "INSTITUTION_ADMIN"].includes(role))) {
    throw new AppError(403, "FORBIDDEN", "An institution administrator role is required.");
  }
  const parsed = productCategorySchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Check the product category details.");
  await adminScope(context.env, user, parsed.data.universityId);
  const id = crypto.randomUUID();
  const result = await database(context.env).execute<{ id: string }>(sql`
    insert into public.product_categories (
      id, university_id, name, status, listing_rules, created_by_user_id,
      reviewed_by_user_id, reviewed_at
    ) values (
      ${id}::uuid, ${parsed.data.universityId}::uuid, ${parsed.data.name}, ${parsed.data.status},
      ${parsed.data.listingRules ?? null}, ${user.id}::uuid,
      ${parsed.data.status === "PENDING" ? null : user.id}::uuid,
      ${parsed.data.status === "PENDING" ? null : new Date().toISOString()}::timestamptz
    )
    on conflict (university_id, name) do update set status = excluded.status,
      listing_rules = excluded.listing_rules, reviewed_by_user_id = excluded.reviewed_by_user_id,
      reviewed_at = excluded.reviewed_at, updated_at = now()
    returning id
  `);
  const categoryId = firstRow(result)?.id ?? id;
  await recordAudit(context.env, { actorUserId: user.id, universityId: parsed.data.universityId,
    action: "marketplace.category.saved", targetType: "product_category", targetId: categoryId,
    requestId: context.get("requestId"), metadata: { status: parsed.data.status } });
  return context.json({ id: categoryId, status: parsed.data.status }, 201);
});

adminRoutes.post("/operations/products/:id/review", async (context) => {
  if (!phase3SchemaReady(context.env)) {
    throw new AppError(503, "FEATURE_DISABLED", "Product moderation is waiting for the reviewed Phase 3 schema migration.");
  }
  const user = currentUser(context);
  if (!user.operatorRoles.some((role) => ["PLATFORM_ADMIN", "INSTITUTION_ADMIN"].includes(role))) {
    throw new AppError(403, "FORBIDDEN", "An institution administrator role is required.");
  }
  const parsed = productModerationSchema.safeParse(await body(context));
  if (!parsed.success) {
    throw new AppError(400, "BAD_REQUEST", "Document a valid product-review decision.");
  }
  const existingResult = await database(context.env).execute<{
    id: string; university_id: string; status: string;
  }>(sql`
    select id, university_id, status from public.vendor_products
    where id = ${context.req.param("id")}::uuid limit 1
  `);
  const existing = firstRow(existingResult);
  if (!existing) throw new AppError(404, "NOT_FOUND", "That product does not exist.");
  await adminScope(context.env, user, existing.university_id);

  const updated = await database(context.env).execute<{ id: string; university_id: string }>(sql`
    update public.vendor_products products set
      status = ${parsed.data.status},
      moderation_note = ${parsed.data.note},
      reviewed_by_user_id = ${user.id}::uuid,
      reviewed_at = now(),
      moderated_revision = case
        when ${parsed.data.status} = 'PUBLISHED' then products.listing_revision
        else null
      end,
      updated_at = now()
    from public.agent_profiles profiles, public.product_categories categories
    where products.id = ${existing.id}::uuid
      and products.status = 'SUBMITTED'
      and profiles.id = products.vendor_profile_id
      and profiles.agent_type = 'VENDOR'
      and profiles.status = 'ACTIVE'
      and categories.id = products.category_id
      and categories.status = 'APPROVED'
      and (
        ${parsed.data.status} <> 'PUBLISHED'
        or (
          products.package_weight_grams is not null
          and products.package_length_cm is not null
          and products.package_width_cm is not null
          and products.package_height_cm is not null
          and products.bicycle_delivery_eligible = true
        )
      )
    returning products.id, products.university_id
  `);
  const product = firstRow(updated);
  if (!product) {
    throw new AppError(
      409,
      "CONFLICT",
      "Only a submitted product from an active vendor in an approved category can be reviewed.",
    );
  }
  await recordAudit(context.env, {
    actorUserId: user.id,
    universityId: product.university_id,
    action: "product.reviewed",
    targetType: "vendor_product",
    targetId: product.id,
    requestId: context.get("requestId"),
    metadata: { decision: parsed.data.status, note: parsed.data.note },
  });
  return context.json({ id: product.id, status: parsed.data.status });
});

adminRoutes.post("/operations/zones", async (context) => {
  if (!phase3SchemaReady(context.env)) {
    throw new AppError(503, "FEATURE_DISABLED", "Delivery-zone policy is waiting for the reviewed Phase 3 schema migration.");
  }
  const user = currentUser(context);
  if (!user.operatorRoles.some((role) => ["PLATFORM_ADMIN", "INSTITUTION_ADMIN"].includes(role))) {
    throw new AppError(403, "FORBIDDEN", "An institution administrator role is required.");
  }
  const parsed = deliveryZoneSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Check the delivery zone details.");
  await adminScope(context.env, user, parsed.data.universityId);
  const id = crypto.randomUUID();
  const result = await database(context.env).execute<{ id: string }>(sql`
    insert into public.delivery_zones (
      id, university_id, name, base_fee_kobo, active, operating_hours,
      max_package_weight_grams, max_package_dimension_cm, rider_earning_kobo,
      earning_formula_version, reservation_timeout_minutes
    )
    values (${id}::uuid, ${parsed.data.universityId}::uuid, ${parsed.data.name},
      ${parsed.data.baseFeeKobo}, ${parsed.data.active},
      coalesce(${parsed.data.operatingHours === undefined ? null : JSON.stringify(parsed.data.operatingHours)}::jsonb, '{}'::jsonb),
      ${parsed.data.maxPackageWeightGrams ?? null}, ${parsed.data.maxPackageDimensionCm ?? null},
      ${parsed.data.riderEarningKobo ?? null}, ${parsed.data.earningFormulaVersion ?? "UNCONFIGURED"},
      ${parsed.data.reservationTimeoutMinutes ?? 10})
    on conflict (university_id, name) do update set base_fee_kobo = excluded.base_fee_kobo,
      active = excluded.active,
      operating_hours = case when ${parsed.data.operatingHours !== undefined}
        then excluded.operating_hours else delivery_zones.operating_hours end,
      max_package_weight_grams = case when ${parsed.data.maxPackageWeightGrams !== undefined}
        then excluded.max_package_weight_grams else delivery_zones.max_package_weight_grams end,
      max_package_dimension_cm = case when ${parsed.data.maxPackageDimensionCm !== undefined}
        then excluded.max_package_dimension_cm else delivery_zones.max_package_dimension_cm end,
      rider_earning_kobo = case when ${parsed.data.riderEarningKobo !== undefined}
        then excluded.rider_earning_kobo else delivery_zones.rider_earning_kobo end,
      earning_formula_version = case when ${parsed.data.earningFormulaVersion !== undefined}
        then excluded.earning_formula_version else delivery_zones.earning_formula_version end,
      reservation_timeout_minutes = case when ${parsed.data.reservationTimeoutMinutes !== undefined}
        then excluded.reservation_timeout_minutes else delivery_zones.reservation_timeout_minutes end,
      updated_at = now() returning id
  `);
  const zoneId = firstRow(result)?.id ?? id;
  await recordAudit(context.env, { actorUserId: user.id, universityId: parsed.data.universityId,
    action: "delivery.zone.saved", targetType: "delivery_zone", targetId: zoneId,
    requestId: context.get("requestId"), metadata: {
      baseFeeKobo: parsed.data.baseFeeKobo,
      active: parsed.data.active,
      ...(parsed.data.earningFormulaVersion
        ? { earningFormulaVersion: parsed.data.earningFormulaVersion }
        : {}),
    } });
  return context.json({ id: zoneId, active: parsed.data.active }, 201);
});

adminRoutes.post("/operations/disputes/:id/review", async (context) => {
  const user = currentUser(context);
  if (!user.operatorRoles.some((role) => ["PLATFORM_ADMIN", "SUPPORT", "FINANCE_REVIEWER"].includes(role))) {
    throw new AppError(403, "FORBIDDEN", "A support or finance reviewer role is required.");
  }
  const parsed = disputeReviewSchema.safeParse(await body(context));
  if (!parsed.success || (parsed.data.status === "RESOLVED" && !parsed.data.resolutionCode)) {
    throw new AppError(400, "BAD_REQUEST", "A documented resolution is required.");
  }
  const result = await database(context.env).execute<{
    id: string; university_id: string; tutorial_booking_id: string | null; order_id: string | null;
  }>(sql`select id, university_id, tutorial_booking_id, order_id from public.disputes
    where id = ${context.req.param("id")}::uuid limit 1`);
  const dispute = firstRow(result);
  if (!dispute) throw new AppError(404, "NOT_FOUND", "That dispute does not exist.");
  await adminScope(context.env, user, dispute.university_id);
  const release = parsed.data.status === "RESOLVED"
    && ["RELEASE_EARNINGS", "NO_ACTION"].includes(parsed.data.resolutionCode ?? "");
  const client = sqlClient(context.env);
  await client.transaction([
    client`update public.disputes set status = ${parsed.data.status}, resolution_code = ${parsed.data.resolutionCode ?? null},
      resolution_note = ${parsed.data.note}, assigned_to_user_id = ${user.id}::uuid,
      resolved_at = ${parsed.data.status === "RESOLVED" ? new Date().toISOString() : null}::timestamptz,
      updated_at = now() where id = ${dispute.id}::uuid`,
    ...(release && dispute.tutorial_booking_id ? [client`update public.tutorial_bookings set status = 'COMPLETED',
      earnings_state = 'AVAILABLE', updated_at = now() where id = ${dispute.tutorial_booking_id}::uuid`] : []),
    ...(release && dispute.order_id ? [client`update public.orders set status = 'DELIVERED',
      earnings_state = 'AVAILABLE', updated_at = now() where id = ${dispute.order_id}::uuid`] : []),
  ]);
  await recordAudit(context.env, { actorUserId: user.id, universityId: dispute.university_id,
    action: "dispute.reviewed", targetType: "dispute", targetId: dispute.id,
    requestId: context.get("requestId"), metadata: { status: parsed.data.status,
      resolutionCode: parsed.data.resolutionCode, note: parsed.data.note } });
  return context.json({ status: parsed.data.status });
});

adminRoutes.post("/operations/payouts/:id/review", async (context) => {
  const user = currentUser(context);
  if (!user.operatorRoles.some((role) => ["PLATFORM_ADMIN", "FINANCE_REVIEWER"].includes(role))) {
    throw new AppError(403, "FORBIDDEN", "A finance reviewer role is required.");
  }
  const parsed = payoutReviewSchema.safeParse(await body(context));
  if (!parsed.success || (parsed.data.status === "PAID" && !parsed.data.providerReference)) {
    throw new AppError(400, "BAD_REQUEST", "A valid payout decision and provider reference are required.");
  }
  const result = await database(context.env).execute<{
    id: string; university_id: string; status: string;
  }>(sql`select id, university_id, status from public.payout_requests
    where id = ${context.req.param("id")}::uuid limit 1`);
  const payout = firstRow(result);
  if (!payout) throw new AppError(404, "NOT_FOUND", "That payout request does not exist.");
  await adminScope(context.env, user, payout.university_id);
  const transitions: Record<string, string[]> = {
    REQUESTED: ["IN_REVIEW", "REJECTED"], IN_REVIEW: ["APPROVED", "REJECTED"],
    APPROVED: ["PROCESSING", "REJECTED"], PROCESSING: ["PAID", "FAILED"], FAILED: ["PROCESSING", "REJECTED"],
  };
  if (!(transitions[payout.status] ?? []).includes(parsed.data.status)) {
    throw new AppError(409, "CONFLICT", "That payout status change is not allowed.");
  }
  const updated = await database(context.env).execute<{ id: string }>(sql`
    update public.payout_requests set status = ${parsed.data.status}, reviewer_user_id = ${user.id}::uuid,
      review_note = ${parsed.data.note}, provider_reference = coalesce(${parsed.data.providerReference ?? null}, provider_reference),
      reviewed_at = now(), paid_at = ${parsed.data.status === "PAID" ? new Date().toISOString() : null}::timestamptz,
      updated_at = now() where id = ${payout.id}::uuid and status = ${payout.status}
    returning id
  `);
  if (!firstRow(updated)) {
    throw new AppError(409, "CONFLICT", "This payout was changed by another finance reviewer.");
  }
  await recordAudit(context.env, { actorUserId: user.id, universityId: payout.university_id,
    action: "payout.reviewed", targetType: "payout_request", targetId: payout.id,
    requestId: context.get("requestId"), metadata: { from: payout.status, to: parsed.data.status, note: parsed.data.note } });
  return context.json({ status: parsed.data.status });
});

adminRoutes.post("/operations/release-eligible-earnings", async (context) => {
  const user = currentUser(context);
  if (!user.operatorRoles.some((role) => ["PLATFORM_ADMIN", "FINANCE_REVIEWER"].includes(role))) {
    throw new AppError(403, "FORBIDDEN", "A finance reviewer role is required.");
  }
  const scope = await adminScope(context.env, user, context.req.query("universityId"));
  const [bookings, orders, deliveries] = await Promise.all([
    database(context.env).execute<{ id: string }>(sql`
      update public.tutorial_bookings bookings set earnings_state = 'AVAILABLE', updated_at = now()
      where bookings.status = 'COMPLETED' and bookings.earnings_state = 'PENDING'
        and bookings.dispute_deadline <= now() and (${scope}::uuid is null or bookings.university_id = ${scope}::uuid)
        and not exists (select 1 from public.disputes disputes where disputes.tutorial_booking_id = bookings.id
          and disputes.status in ('OPEN','UNDER_REVIEW')) returning bookings.id
    `),
    database(context.env).execute<{ id: string }>(sql`
      update public.orders orders set earnings_state = 'AVAILABLE', updated_at = now()
      where orders.status = 'DELIVERED' and orders.earnings_state = 'PENDING'
        and orders.completed_at <= now() - interval '48 hours'
        and (${scope}::uuid is null or orders.university_id = ${scope}::uuid)
        and not exists (select 1 from public.disputes disputes where disputes.order_id = orders.id
          and disputes.status in ('OPEN','UNDER_REVIEW')) returning orders.id
    `),
    database(context.env).execute<{ id: string }>(sql`
      update public.delivery_jobs jobs set earnings_state = 'AVAILABLE', updated_at = now()
      where jobs.status = 'DELIVERED' and jobs.earnings_state = 'PENDING'
        and jobs.delivered_at <= now() - interval '48 hours'
        and (${scope}::uuid is null or jobs.university_id = ${scope}::uuid)
        and not exists (select 1 from public.disputes disputes join public.orders orders on orders.id = disputes.order_id
          where orders.id = jobs.order_id and disputes.status in ('OPEN','UNDER_REVIEW')) returning jobs.id
    `),
  ]);
  await recordAudit(context.env, { actorUserId: user.id, universityId: scope,
    action: "earnings.eligible_released", targetType: "finance_batch", targetId: crypto.randomUUID(),
    requestId: context.get("requestId"), metadata: { bookings: bookings.rows.length,
      orders: orders.rows.length, deliveries: deliveries.rows.length } });
  return context.json({ released: { bookings: bookings.rows.length, orders: orders.rows.length,
    deliveries: deliveries.rows.length } });
});

adminRoutes.get("/release-phases", async (context) => {
  const user = currentUser(context);
  if (!user.operatorRoles.includes("PLATFORM_ADMIN")) {
    throw new AppError(403, "FORBIDDEN", "A platform administrator role is required.");
  }
  const result = await database(context.env).execute(sql`
    select phase_key, title, status, summary, requirements, updated_at
    from public.release_phases order by phase_key
  `);
  return context.json({ phases: result.rows });
});
