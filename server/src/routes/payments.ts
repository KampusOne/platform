import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { reconcilePayout } from '../lib/payouts';

import { paymentInitializationSchema } from "@kampusone/contracts";

import { recordAudit } from "../lib/audit";
import { database, firstRow, sqlClient } from "../lib/database";
import { AppError } from "../lib/errors";
import {
  phase2SchemaReady,
  phase3SchemaReady,
  requireFeature,
} from "../lib/features";
import { initializePaystack, validPaystackSignature } from "../lib/paystack";
import { reconcileRiderCommission } from "../lib/rider-finance";
import { reconcileKira } from "../lib/kira-billing";
import { reconcileMaterial } from "../lib/material-commerce";
import {
  pricedTutorialReady,
  reconcilePricedTutorial,
} from "../lib/tutorial-pricing";
import {
  inclusiveStoreReady,
  reconcilePricedStore,
} from "../lib/commerce-pricing";
import { currentUser, requireAuth } from "../middleware/auth";
import type { Bindings, Variables } from "../types";

export const paymentRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

paymentRoutes.get("/summary", requireAuth, async (context) => {
  const user = currentUser(context),
    resourceId = context.req.query("resourceId"),
    resourceType = context.req.query("resourceType");
  const parsed = paymentInitializationSchema
    .omit({ idempotencyKey: true })
    .safeParse({ resourceId, resourceType });
  if (!parsed.success)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Choose a valid purchase to view its payment.",
    );
  if (resourceType === "STORE_ORDER" && !phase3SchemaReady(context.env))
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "Store payments are unavailable yet.",
    );
  if (resourceType === "TUTORIAL_BOOKING" && !phase2SchemaReady(context.env))
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "Tutorial payments are unavailable yet.",
    );
  const inclusiveReady =
    resourceType === "STORE_ORDER" && (await inclusiveStoreReady(context.env));
  const tutorialReady =
    resourceType === "TUTORIAL_BOOKING" &&
    (await pricedTutorialReady(context.env));
  const summary = firstRow(
    await database(context.env).execute(
      inclusiveReady
        ? sql`
    select o.id,s.display_name as title,o.status,
      coalesce(p.listed_items_kobo,o.subtotal_kobo) as base_kobo,0::integer as buyer_fee_kobo,o.delivery_fee_kobo,
      coalesce(p.payable_kobo,o.total_kobo) as amount_kobo,coalesce(p.cash_due_kobo,0) as cash_due_kobo,
      coalesce(p.discount_kobo,0) as discount_kobo,o.total_kobo as total_kobo,
      (o.pricing_formula_version='INCLUSIVE_V1' and p.order_id is not null) as pricing_ready,
      q.fare->>'routeMetres' as distance_metres,q.fare is not null and q.fare<>'null'::jsonb as campus_zone_estimate
    from public.orders o join public.vendor_storefronts s on s.vendor_profile_id=o.vendor_profile_id
      left join app_private.order_price_snapshots p on p.order_id=o.id left join app_private.store_checkout_quotes q on q.id=p.quote_id
    where o.id=${parsed.data.resourceId}::uuid and o.buyer_user_id=${user.id}::uuid and o.university_id=${user.universityId}::uuid
  `
        : resourceType === "STORE_ORDER"
          ? sql`
    select o.id,s.display_name as title,o.status,o.subtotal_kobo as base_kobo,
      0::integer as buyer_fee_kobo,o.delivery_fee_kobo,o.total_kobo as amount_kobo,
      (o.pricing_formula_version<>'UNCONFIGURED') as pricing_ready
    from public.orders o join public.vendor_storefronts s on s.vendor_profile_id=o.vendor_profile_id
    where o.id=${parsed.data.resourceId}::uuid and o.buyer_user_id=${user.id}::uuid and o.university_id=${user.universityId}::uuid
  `
          : tutorialReady
            ? sql`
    select b.id,l.title,b.status,coalesce(p.listed_kobo,b.amount_kobo) as base_kobo,0::integer as buyer_fee_kobo,
      0::integer as delivery_fee_kobo,b.amount_kobo,coalesce(p.listed_kobo-p.payable_kobo,0) as discount_kobo,
      (b.amount_kobo=0 or p.booking_id is not null) as pricing_ready
    from public.tutorial_bookings b join public.tutorial_listings l on l.id=b.listing_id
      left join app_private.tutorial_booking_prices p on p.booking_id=b.id
    where b.id=${parsed.data.resourceId}::uuid and b.student_user_id=${user.id}::uuid and b.university_id=${user.universityId}::uuid
  `
            : sql`
    select b.id,l.title,b.status,b.amount_kobo as base_kobo,0::integer as buyer_fee_kobo,
      0::integer as delivery_fee_kobo,b.amount_kobo,true as pricing_ready
    from public.tutorial_bookings b join public.tutorial_listings l on l.id=b.listing_id
    where b.id=${parsed.data.resourceId}::uuid and b.student_user_id=${user.id}::uuid and b.university_id=${user.universityId}::uuid
  `,
    ),
  );
  if (!summary)
    throw new AppError(404, "NOT_FOUND", "That purchase could not be found.");
  return context.json({
    payment: summary,
    checkoutEnabled:
      context.env.PAYMENTS_ENABLED === "true" && summary.pricing_ready === true,
  });
});

paymentRoutes.post("/initialize", requireAuth, async (context) => {
  requireFeature(
    context.env,
    "PAYMENTS_ENABLED",
    "Payments are not enabled in this environment.",
  );
  const parsed = paymentInitializationSchema.safeParse(
    await context.req.json().catch(() => null),
  );
  if (!parsed.success)
    throw new AppError(400, "BAD_REQUEST", "The payment request is invalid.");
  if (
    parsed.data.resourceType === "TUTORIAL_BOOKING" &&
    !phase2SchemaReady(context.env)
  ) {
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "Tutorial payments are temporarily unavailable.",
    );
  }
  if (
    parsed.data.resourceType === "STORE_ORDER" &&
    !phase3SchemaReady(context.env)
  ) {
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "Store payments are temporarily unavailable.",
    );
  }
  const user = currentUser(context);
  const inclusiveReady = await inclusiveStoreReady(context.env);
  const tutorialReady = await pricedTutorialReady(context.env);
  const resource =
    parsed.data.resourceType === "TUTORIAL_BOOKING"
      ? await database(context.env).execute<{
          id: string;
          amount_kobo: number;
          status: string;
          pricing_formula_version: string | null;
        }>(
          tutorialReady
            ? sql`
        select b.id,b.amount_kobo,b.status,b.pricing_formula_version from public.tutorial_bookings b
          join app_private.tutorial_booking_prices p on p.booking_id=b.id
        where b.id=${parsed.data.resourceId}::uuid and b.student_user_id=${user.id}::uuid
          and b.university_id=${user.universityId}::uuid and b.payment_expires_at>now()
      `
            : sql`
        select id, amount_kobo, status, null::text as pricing_formula_version from public.tutorial_bookings
        where id = ${parsed.data.resourceId}::uuid and student_user_id = ${user.id}::uuid
          and university_id=${user.universityId}::uuid
          and payment_expires_at > now() limit 1
      `,
        )
      : await database(context.env).execute<{
          id: string;
          amount_kobo: number;
          status: string;
          pricing_formula_version: string | null;
        }>(
          inclusiveReady
            ? sql`
        select o.id,p.payable_kobo as amount_kobo,o.status,o.pricing_formula_version
        from public.orders o join app_private.order_price_snapshots p on p.order_id=o.id
        where o.id=${parsed.data.resourceId}::uuid and o.buyer_user_id=${user.id}::uuid and o.university_id=${user.universityId}::uuid
          and exists(select 1 from public.inventory_reservations r where r.order_id=o.id and r.status='HELD' and r.expires_at>now())
      `
            : sql`
        select id, total_kobo as amount_kobo, status, pricing_formula_version from public.orders
        where id = ${parsed.data.resourceId}::uuid and buyer_user_id = ${user.id}::uuid
          and university_id=${user.universityId}::uuid
          and exists (
            select 1 from public.inventory_reservations reservations
            where reservations.order_id = orders.id and reservations.status = 'HELD'
              and reservations.expires_at > now()
          )
        limit 1
      `,
        );
  const item = firstRow(resource);
  if (!item)
    throw new AppError(404, "NOT_FOUND", "That payable item does not exist.");
  if (item.status !== "PENDING_PAYMENT")
    throw new AppError(
      409,
      "CONFLICT",
      "This item is not waiting for payment.",
    );
  if (
    parsed.data.resourceType === "STORE_ORDER" &&
    item.pricing_formula_version === "UNCONFIGURED"
  ) {
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "Store payments are waiting for an approved pricing and settlement policy.",
    );
  }
  if (Number(item.amount_kobo) <= 0)
    throw new AppError(
      409,
      "CONFLICT",
      "This tutorial is free and does not need a payment.",
    );

  const existingResult = await database(context.env).execute<{
    status: string;
    authorization_url: string | null;
    access_code: string | null;
    provider_reference: string;
  }>(sql`
    select status, authorization_url, access_code, provider_reference
    from public.payment_attempts
    where user_id = ${user.id}::uuid and resource_type = ${parsed.data.resourceType}
      and resource_id = ${item.id}::uuid and idempotency_key = ${parsed.data.idempotencyKey}
    limit 1
  `);
  const existing = firstRow(existingResult);
  if (
    existing?.status === "INITIALIZED" &&
    existing.authorization_url &&
    existing.access_code
  ) {
    return context.json({
      authorizationUrl: existing.authorization_url,
      accessCode: existing.access_code,
      reference: existing.provider_reference,
      reused: true,
    });
  }
  if (existing) {
    throw new AppError(
      409,
      "CONFLICT",
      "That payment attempt cannot be reused. Start a new attempt.",
    );
  }

  const reference = `K1-${parsed.data.resourceType === "TUTORIAL_BOOKING" ? "T" : "O"}-${crypto.randomUUID()}`;
  const attemptId = crypto.randomUUID();
  const inserted = await database(context.env).execute<{ id: string }>(sql`
    insert into public.payment_attempts (
      id, user_id, university_id, resource_type, resource_id, provider_reference,
      amount_kobo, idempotency_key, status
    ) values (
      ${attemptId}::uuid, ${user.id}::uuid, ${user.universityId ?? null}::uuid,
      ${parsed.data.resourceType}, ${item.id}::uuid, ${reference},
      ${Number(item.amount_kobo)}, ${parsed.data.idempotencyKey}, 'CREATED'
    ) on conflict do nothing
    returning id
  `);
  if (!firstRow(inserted)) {
    throw new AppError(
      409,
      "CONFLICT",
      "A checkout for this item is already active. Resume it from your purchases.",
    );
  }
  const callbackUrl = context.env.APP_ORIGIN
    ? `${context.env.APP_ORIGIN.replace(/\/$/, "")}/payment/return`
    : undefined;
  let initialized: { authorization_url?: string; access_code?: string };
  try {
    initialized = await initializePaystack(context.env, {
      email: user.email,
      amountKobo: Number(item.amount_kobo),
      reference,
      ...(callbackUrl ? { callbackUrl } : {}),
      metadata: {
        resourceType: parsed.data.resourceType,
        resourceId: item.id,
        userId: user.id,
      },
    });
  } catch (caught) {
    await database(context.env).execute(sql`
      update public.payment_attempts set status = 'FAILED', failure_code = 'INITIALIZATION_FAILED',
        updated_at = now() where id = ${attemptId}::uuid and status = 'CREATED'
    `);
    throw caught;
  }
  if (!initialized.authorization_url || !initialized.access_code) {
    await database(context.env).execute(sql`
      update public.payment_attempts set status = 'FAILED', failure_code = 'INCOMPLETE_PROVIDER_SESSION',
        updated_at = now() where id = ${attemptId}::uuid and status = 'CREATED'
    `);
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "The payment provider returned an incomplete checkout session.",
    );
  }
  await database(context.env).execute(sql`
    update public.payment_attempts set status = 'INITIALIZED',
      authorization_url = ${initialized.authorization_url}, access_code = ${initialized.access_code},
      initialized_at = now(), updated_at = now()
    where id = ${attemptId}::uuid and status = 'CREATED'
  `);
  const table =
    parsed.data.resourceType === "TUTORIAL_BOOKING"
      ? "tutorial_bookings"
      : "orders";
  if (table === "tutorial_bookings") {
    await database(context.env).execute(sql`
      update public.tutorial_bookings set provider_reference = coalesce(provider_reference, ${reference}), updated_at = now()
      where id = ${item.id}::uuid and student_user_id = ${user.id}::uuid and status = 'PENDING_PAYMENT'
    `);
  } else {
    await database(context.env).execute(sql`
      update public.orders set provider_reference = coalesce(provider_reference, ${reference}), updated_at = now()
      where id = ${item.id}::uuid and buyer_user_id = ${user.id}::uuid and status = 'PENDING_PAYMENT'
    `);
  }
  await recordAudit(context.env, {
    actorUserId: user.id,
    universityId: user.universityId,
    action: "payment.initialized",
    targetType: table,
    targetId: item.id,
    requestId: context.get("requestId"),
    metadata: { reference, amountKobo: item.amount_kobo },
  });
  return context.json({
    authorizationUrl: initialized.authorization_url,
    accessCode: initialized.access_code,
    reference,
  });
});

paymentRoutes.get("/status/:reference", requireAuth, async (context) => {
  const user = currentUser(context);
  const reference = context.req.param("reference");
  if (
    reference.startsWith("K1-AI-") &&
    (await reconcileKira(context.env, reference, user.id))
  ) {
    const payment = firstRow(
      await database(context.env)
        .execute(sql`select provider_reference,case when status='PAID' then 'SUCCEEDED' else status end as status,
      'KIRA_SUBSCRIPTION' as resource_type,id as resource_id from app_private.kira_checkouts where provider_reference=${reference} and user_id=${user.id}::uuid`),
    );
    return context.json({ payment });
  }
  if (
    reference.startsWith("K1-RC-") &&
    (await reconcileRiderCommission(context.env, reference, user.id))
  ) {
    const payment = firstRow(
      await database(context.env)
        .execute(sql`select provider_reference,case when status='PAID' then 'SUCCEEDED' else status end as status,
      'RIDER_COMMISSION' as resource_type,id as resource_id from app_private.rider_commission_checkouts where provider_reference=${reference} and user_id=${user.id}::uuid`),
    );
    return context.json({ payment });
  }
  await reconcilePricedStore(context.env, reference, user.id);
  await reconcilePricedTutorial(context.env, reference, user.id);
  await reconcileMaterial(context.env, reference, user.id);
  const result = await database(context.env).execute<{
    provider_reference: string;
    status: string;
    resource_type: string;
    resource_id: string;
  }>(sql`
    select provider_reference, status, resource_type, resource_id
    from public.payment_attempts
    where provider_reference = ${context.req.param("reference")} and user_id = ${user.id}::uuid
    limit 1
  `);
  const attempt = firstRow(result);
  if (!attempt)
    throw new AppError(
      404,
      "NOT_FOUND",
      "That payment attempt could not be found.",
    );
  if (
    attempt.resource_type === "TUTORIAL_BOOKING" &&
    !phase2SchemaReady(context.env)
  ) {
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "Tutorial payment status is temporarily unavailable.",
    );
  }
  if (
    attempt.resource_type === "STORE_ORDER" &&
    !phase3SchemaReady(context.env)
  ) {
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "Store payment status is temporarily unavailable.",
    );
  }
  return context.json({ payment: attempt });
});

paymentRoutes.post("/paystack/webhook", async (context) => {
  const raw = await context.req.text();
  if (
    !(await validPaystackSignature(
      context.env,
      raw,
      context.req.header("X-Paystack-Signature"),
    ))
  ) {
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "The payment event signature is invalid.",
    );
  }
  let event: {
    event?: string;
    data?: { reference?: string; amount?: number; status?: string };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "The payment event is not valid JSON.",
    );
  }
  if(event.event?.startsWith('transfer.') && event.data?.reference?.startsWith('k1-po-')){
    if(!['transfer.success','transfer.failed','transfer.reversed'].includes(event.event))return context.json({status:'ignored'});
    const reconciled=await reconcilePayout(context.env,event.data.reference);
    return context.json({status:reconciled?'reconciled':'unknown_reference'});
  }
  if (
    event.event !== "charge.success" ||
    event.data?.status !== "success" ||
    !event.data.reference
  ) {
    return context.json({ status: "ignored" });
  }
  const reference = event.data.reference;
  if (
    reference.startsWith("K1-AI-") &&
    (await reconcileKira(context.env, reference))
  )
    return context.json({ status: "reconciled" });
  if (
    reference.startsWith("K1-RC-") &&
    (await reconcileRiderCommission(context.env, reference))
  )
    return context.json({ status: "reconciled" });
  if (await reconcilePricedStore(context.env, reference))
    return context.json({ status: "reconciled" });
  if (await reconcilePricedTutorial(context.env, reference))
    return context.json({ status: "reconciled" });
  if (await reconcileMaterial(context.env, reference))
    return context.json({ status: "reconciled" });
  await database(context.env).execute(sql`
    insert into public.payment_provider_events (
      provider, provider_reference, event_type, amount_kobo
    ) values ('PAYSTACK', ${reference}, 'charge.success', ${event.data.amount ?? null})
    on conflict (provider, provider_reference) do update set
      updated_at = now()
  `);

  const bookingResult = phase2SchemaReady(context.env)
    ? await database(context.env).execute<{
        id: string;
        university_id: string;
        amount_kobo: number;
        tutor_user_id: string;
      }>(sql`
        select bookings.id, bookings.university_id, bookings.amount_kobo,
          profiles.user_id as tutor_user_id
        from public.payment_attempts attempts
        join public.tutorial_bookings bookings
          on attempts.resource_type = 'TUTORIAL_BOOKING' and bookings.id = attempts.resource_id
        join public.tutorial_listings listings on listings.id = bookings.listing_id
        join public.agent_profiles profiles on profiles.id = listings.tutor_profile_id
        where attempts.provider_reference = ${reference}
          and attempts.status in ('CREATED','INITIALIZED') and bookings.status = 'PENDING_PAYMENT'
          and bookings.payment_expires_at > now()
        limit 1
      `)
    : { rows: [] };
  const booking = firstRow(bookingResult);
  if (booking) {
    if (Number(event.data.amount) !== Number(booking.amount_kobo)) {
      await database(context.env).execute(sql`
        with reviewed_attempt as (
          update public.payment_attempts set status = 'REQUIRES_REVIEW',
            failure_code = 'AMOUNT_MISMATCH', updated_at = now()
          where provider_reference = ${reference}
        )
        update public.payment_provider_events set state = 'REQUIRES_REVIEW',
          resource_type = 'TUTORIAL_BOOKING', resource_id = ${booking.id}::uuid,
          review_reason = 'AMOUNT_MISMATCH', updated_at = now()
        where provider = 'PAYSTACK' and provider_reference = ${reference}
      `);
      return context.json({ status: "requires_review" });
    }
    const client = sqlClient(context.env);
    await client.transaction([
      client`update public.tutorial_bookings set status = 'CONFIRMED', updated_at = now() where id = ${booking.id}::uuid and status = 'PENDING_PAYMENT'`,
      client`insert into public.ledger_accounts (university_id, account_code, account_type) values (${booking.university_id}::uuid, 'PAYSTACK_CLEARING', 'ASSET') on conflict do nothing`,
      client`insert into public.ledger_accounts (university_id, owner_user_id, account_code, account_type) values (${booking.university_id}::uuid, ${booking.tutor_user_id}::uuid, 'TUTOR_PAYABLE', 'LIABILITY') on conflict do nothing`,
      client`insert into public.ledger_transactions (university_id, reference_type, reference_id, idempotency_key, description) values (${booking.university_id}::uuid, 'TUTORIAL_BOOKING', ${booking.id}, ${`paystack:${reference}`}, 'Tutorial booking payment') on conflict do nothing`,
      client`insert into public.ledger_lines (transaction_id, account_id, direction, amount_kobo) select transactions.id, accounts.id, 'DEBIT', ${booking.amount_kobo} from public.ledger_transactions transactions join public.ledger_accounts accounts on accounts.university_id = ${booking.university_id}::uuid and accounts.account_code = 'PAYSTACK_CLEARING' and accounts.owner_user_id is null where transactions.idempotency_key = ${`paystack:${reference}`} and not exists (select 1 from public.ledger_lines lines where lines.transaction_id = transactions.id)`,
      client`insert into public.ledger_lines (transaction_id, account_id, direction, amount_kobo) select transactions.id, accounts.id, 'CREDIT', ${booking.amount_kobo} from public.ledger_transactions transactions join public.ledger_accounts accounts on accounts.university_id = ${booking.university_id}::uuid and accounts.account_code = 'TUTOR_PAYABLE' and accounts.owner_user_id = ${booking.tutor_user_id}::uuid where transactions.idempotency_key = ${`paystack:${reference}`} and (select count(*) from public.ledger_lines lines where lines.transaction_id = transactions.id) = 1`,
      client`update public.payment_attempts set status = 'SUCCEEDED', completed_at = now(), updated_at = now() where provider_reference = ${reference} and status in ('CREATED','INITIALIZED')`,
      client`update public.payment_provider_events set state = 'PROCESSED', resource_type = 'TUTORIAL_BOOKING', resource_id = ${booking.id}::uuid, processed_at = now(), updated_at = now() where provider = 'PAYSTACK' and provider_reference = ${reference}`,
    ]);
    return context.json({ status: "processed" });
  }

  if (!phase3SchemaReady(context.env)) {
    return context.json({ status: "schema_not_ready" }, 202);
  }

  const orderResult = await database(context.env).execute<{
    id: string;
    university_id: string;
    total_kobo: number;
    subtotal_kobo: number;
    delivery_fee_kobo: number;
    vendor_user_id: string;
  }>(sql`
    select orders.id, orders.university_id, orders.total_kobo, orders.subtotal_kobo,
      orders.delivery_fee_kobo, profiles.user_id as vendor_user_id
    from public.payment_attempts attempts
    join public.orders orders
      on attempts.resource_type = 'STORE_ORDER' and orders.id = attempts.resource_id
    join public.agent_profiles profiles on profiles.id = orders.vendor_profile_id
    where attempts.provider_reference = ${reference}
      and attempts.status in ('CREATED','INITIALIZED') and orders.status = 'PENDING_PAYMENT'
      and orders.pricing_formula_version <> 'UNCONFIGURED'
      and exists (
        select 1 from public.inventory_reservations reservations
        where reservations.order_id = orders.id and reservations.status = 'HELD'
          and reservations.expires_at > now()
      )
    limit 1
  `);
  const order = firstRow(orderResult);
  if (!order) {
    const existingResult = await database(context.env).execute<{
      resource_type: string;
      resource_id: string;
      status: string;
    }>(sql`
      select attempts.resource_type, attempts.resource_id,
        coalesce(bookings.status, orders.status, attempts.status) as status
      from public.payment_attempts attempts
      left join public.tutorial_bookings bookings
        on attempts.resource_type = 'TUTORIAL_BOOKING' and bookings.id = attempts.resource_id
      left join public.orders orders
        on attempts.resource_type = 'STORE_ORDER' and orders.id = attempts.resource_id
      where attempts.provider_reference = ${reference}
      limit 1
    `);
    const existing = firstRow(existingResult);
    const alreadyProcessed = Boolean(
      existing && !["PENDING_PAYMENT", "CANCELLED"].includes(existing.status),
    );
    await database(context.env).execute(sql`
      with reviewed_attempt as (
        update public.payment_attempts set
          status = ${alreadyProcessed ? "SUCCEEDED" : "REQUIRES_REVIEW"},
          failure_code = ${alreadyProcessed ? null : existing ? "PAYMENT_AFTER_EXPIRY_OR_CANCELLATION" : "UNKNOWN_REFERENCE"},
          completed_at = ${alreadyProcessed ? new Date().toISOString() : null}::timestamptz,
          updated_at = now()
        where provider_reference = ${reference}
      )
      update public.payment_provider_events set
        state = ${alreadyProcessed ? "PROCESSED" : "REQUIRES_REVIEW"},
        resource_type = ${existing?.resource_type ?? null},
        resource_id = ${existing?.resource_id ?? null}::uuid,
        review_reason = ${alreadyProcessed ? null : existing ? "PAYMENT_AFTER_EXPIRY_OR_CANCELLATION" : "UNKNOWN_REFERENCE"},
        processed_at = ${alreadyProcessed ? new Date().toISOString() : null}::timestamptz,
        updated_at = now()
      where provider = 'PAYSTACK' and provider_reference = ${reference}
    `);
    return context.json({
      status: alreadyProcessed ? "already_processed" : "requires_review",
    });
  }
  if (Number(event.data.amount) !== Number(order.total_kobo)) {
    await database(context.env).execute(sql`
      with reviewed_attempt as (
        update public.payment_attempts set status = 'REQUIRES_REVIEW',
          failure_code = 'AMOUNT_MISMATCH', updated_at = now()
        where provider_reference = ${reference}
      )
      update public.payment_provider_events set state = 'REQUIRES_REVIEW',
        resource_type = 'STORE_ORDER', resource_id = ${order.id}::uuid,
        review_reason = 'AMOUNT_MISMATCH', updated_at = now()
      where provider = 'PAYSTACK' and provider_reference = ${reference}
    `);
    return context.json({ status: "requires_review" });
  }
  const client = sqlClient(context.env);
  await client.transaction([
    client`update public.orders set status = 'PAID', updated_at = now() where id = ${order.id}::uuid and status = 'PENDING_PAYMENT'`,
    client`update public.delivery_jobs set status = 'AVAILABLE', updated_at = now() where order_id = ${order.id}::uuid and status = 'PAYMENT_PENDING'`,
    client`update public.inventory_reservations set status = 'CONVERTED' where order_id = ${order.id}::uuid and status = 'HELD'`,
    client`insert into public.ledger_accounts (university_id, account_code, account_type) values (${order.university_id}::uuid, 'PAYSTACK_CLEARING', 'ASSET') on conflict do nothing`,
    client`insert into public.ledger_accounts (university_id, owner_user_id, account_code, account_type) values (${order.university_id}::uuid, ${order.vendor_user_id}::uuid, 'VENDOR_PAYABLE', 'LIABILITY') on conflict do nothing`,
    client`insert into public.ledger_accounts (university_id, account_code, account_type) values (${order.university_id}::uuid, 'DELIVERY_REVENUE', 'REVENUE') on conflict do nothing`,
    client`insert into public.ledger_transactions (university_id, reference_type, reference_id, idempotency_key, description) values (${order.university_id}::uuid, 'STORE_ORDER', ${order.id}, ${`paystack:${reference}`}, 'Store order payment') on conflict do nothing`,
    client`insert into public.ledger_lines (transaction_id, account_id, direction, amount_kobo) select transactions.id, accounts.id, 'DEBIT', ${order.total_kobo} from public.ledger_transactions transactions join public.ledger_accounts accounts on accounts.university_id = ${order.university_id}::uuid and accounts.account_code = 'PAYSTACK_CLEARING' and accounts.owner_user_id is null where transactions.idempotency_key = ${`paystack:${reference}`} and not exists (select 1 from public.ledger_lines lines where lines.transaction_id = transactions.id)`,
    client`insert into public.ledger_lines (transaction_id, account_id, direction, amount_kobo) select transactions.id, accounts.id, 'CREDIT', ${order.subtotal_kobo} from public.ledger_transactions transactions join public.ledger_accounts accounts on accounts.university_id = ${order.university_id}::uuid and accounts.account_code = 'VENDOR_PAYABLE' and accounts.owner_user_id = ${order.vendor_user_id}::uuid where transactions.idempotency_key = ${`paystack:${reference}`} and (select count(*) from public.ledger_lines lines where lines.transaction_id = transactions.id) = 1`,
    ...(Number(order.delivery_fee_kobo) > 0
      ? [
          client`insert into public.ledger_lines (transaction_id, account_id, direction, amount_kobo) select transactions.id, accounts.id, 'CREDIT', ${order.delivery_fee_kobo} from public.ledger_transactions transactions join public.ledger_accounts accounts on accounts.university_id = ${order.university_id}::uuid and accounts.account_code = 'DELIVERY_REVENUE' and accounts.owner_user_id is null where transactions.idempotency_key = ${`paystack:${reference}`} and (select count(*) from public.ledger_lines lines where lines.transaction_id = transactions.id) = 2`,
        ]
      : []),
    client`update public.payment_attempts set status = 'SUCCEEDED', completed_at = now(), updated_at = now() where provider_reference = ${reference} and status in ('CREATED','INITIALIZED')`,
    client`update public.payment_provider_events set state = 'PROCESSED', resource_type = 'STORE_ORDER', resource_id = ${order.id}::uuid, processed_at = now(), updated_at = now() where provider = 'PAYSTACK' and provider_reference = ${reference}`,
  ]);
  return context.json({ status: "processed" });
});
