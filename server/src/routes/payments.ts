import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { reconcilePayout } from '../lib/payouts';

import { paymentInitializationSchema } from "@kampusone/contracts";

import { recordAudit } from "../lib/audit";
import { database, firstRow } from "../lib/database";
import { AppError } from "../lib/errors";
import {
  phase2SchemaReady,
  phase3SchemaReady,
  requireFeature,
} from "../lib/features";
import { collectionReference, isBachsReference } from "../lib/collection-provider";
import { validBachsDelivery } from "../lib/bachs";
import { validPaystackSignature } from "../lib/paystack";
import { claimBachsWebhook, finishBachsWebhook, claimPaystackWebhook, finishPaystackWebhook, initializePaystackOnce } from "../lib/payment-idempotency";
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
      false as pricing_ready
    from public.orders o join public.vendor_storefronts s on s.vendor_profile_id=o.vendor_profile_id
    where o.id=${parsed.data.resourceId}::uuid and o.buyer_user_id=${user.id}::uuid and o.university_id=${user.universityId}::uuid
  `
          : tutorialReady
            ? sql`
    select b.id,l.title,b.status,coalesce(p.listed_kobo,b.amount_kobo) as base_kobo,0::integer as buyer_fee_kobo,
      0::integer as delivery_fee_kobo,b.amount_kobo,coalesce(p.listed_kobo-p.payable_kobo,0) as discount_kobo,
      (b.amount_kobo=0 or (p.booking_id is not null and b.pricing_formula_version='INCLUSIVE_V1')) as pricing_ready
    from public.tutorial_bookings b join public.tutorial_listings l on l.id=b.listing_id
      left join app_private.tutorial_booking_prices p on p.booking_id=b.id
    where b.id=${parsed.data.resourceId}::uuid and b.student_user_id=${user.id}::uuid and b.university_id=${user.universityId}::uuid
  `
            : sql`
    select b.id,l.title,b.status,b.amount_kobo as base_kobo,0::integer as buyer_fee_kobo,
      0::integer as delivery_fee_kobo,b.amount_kobo,false as pricing_ready
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
  if (
    (parsed.data.resourceType === "STORE_ORDER" && !inclusiveReady) ||
    (parsed.data.resourceType === "TUTORIAL_BOOKING" && !tutorialReady)
  )
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "Your saved purchase needs verified pricing before payment can begin. Refresh checkout or contact support for a price review.",
    );
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
        select b.id,b.amount_kobo,b.status,
          case when p.booking_id is not null then b.pricing_formula_version else null end as pricing_formula_version
        from public.tutorial_bookings b left join app_private.tutorial_booking_prices p on p.booking_id=b.id
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
        select o.id,coalesce(p.payable_kobo,o.total_kobo) as amount_kobo,o.status,
          case when p.order_id is not null then o.pricing_formula_version else null end as pricing_formula_version
        from public.orders o left join app_private.order_price_snapshots p on p.order_id=o.id
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
    item.pricing_formula_version !== "INCLUSIVE_V1"
  ) {
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "Your saved purchase needs a current price review. Refresh checkout or contact support before paying.",
    );
  }
  if (Number(item.amount_kobo) <= 0)
    throw new AppError(
      409,
      "CONFLICT",
      "This tutorial is free and does not need a payment.",
    );

  const existingResult = await database(context.env).execute<{
    id: string;
    amount_kobo: number;
    status: string;
    authorization_url: string | null;
    access_code: string | null;
    provider_reference: string;
  }>(sql`
    select id, amount_kobo, status, authorization_url, access_code, provider_reference
    from public.payment_attempts
    where user_id = ${user.id}::uuid and resource_type = ${parsed.data.resourceType}
      and resource_id = ${item.id}::uuid and idempotency_key = ${parsed.data.idempotencyKey}
    limit 1
  `);
  let existing = firstRow(existingResult);
  if (!existing) {
    // A lost mobile screen, new tab, or a second Idempotency-Key is NOT
    // permission to open another Paystack session for one still-live order.
    // Reuse the one active attempt only for the owner and the same resource.
    existing = firstRow(await database(context.env).execute<{
      id: string; amount_kobo: number; status: string;
      authorization_url: string | null; access_code: string | null;
      provider_reference: string;
    }>(sql`
      select id,amount_kobo,status,authorization_url,access_code,provider_reference
      from public.payment_attempts
      where user_id=${user.id}::uuid
        and university_id=${user.universityId}::uuid
        and resource_type=${parsed.data.resourceType}
        and resource_id=${item.id}::uuid
        and status in ('CREATED','INITIALIZED')
      order by created_at desc limit 1
    `));
  }
  if (existing && Number(existing.amount_kobo) !== Number(item.amount_kobo))
    throw new AppError(409, "CONFLICT", "This payment attempt belongs to a previous price. Review the updated total before proceeding.");
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
  if (existing && existing.status !== "CREATED")
    throw new AppError(
      409, "CONFLICT",
      "The saved payment has finished or needs review. Check its reference instead of retrying.",
      { reference: existing.provider_reference, status: existing.status },
    );

  let reference = existing?.provider_reference ??
    collectionReference(context.env, parsed.data.resourceType === "TUTORIAL_BOOKING" ? "T" : "O");
  let attemptId = existing?.id ?? crypto.randomUUID();
  if (!existing) {
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
      // A simultaneous request may already have inserted this exact key.
      // Adopt its durable reference; NEVER create a new provider reference.
      const saved = firstRow(await database(context.env).execute<{
        id: string; provider_reference: string; amount_kobo: number; status: string;
        authorization_url: string | null; access_code: string | null;
      }>(sql`
        select id,provider_reference,amount_kobo,status,authorization_url,access_code
        from public.payment_attempts
        where user_id=${user.id}::uuid and resource_type=${parsed.data.resourceType}
          and resource_id=${item.id}::uuid and idempotency_key=${parsed.data.idempotencyKey}
        limit 1
      `));
      if (!saved || Number(saved.amount_kobo) !== Number(item.amount_kobo))
        throw new AppError(409, "CONFLICT", "Another checkout is active for this purchase. Check its payment status.");
      if (saved.status === "INITIALIZED" && saved.authorization_url && saved.access_code)
        return context.json({
          authorizationUrl: saved.authorization_url,accessCode: saved.access_code,
          reference: saved.provider_reference,reused: true,
        });
      if (saved.status !== "CREATED")
        throw new AppError(409, "CONFLICT", "This checkout already finished or needs review.", { reference: saved.provider_reference,status: saved.status });
      reference = saved.provider_reference;
      attemptId = saved.id;
    }
  }
  const callbackUrl = context.env.APP_ORIGIN
    ? `${context.env.APP_ORIGIN.replace(/\/$/, "")}/payment/return`
    : undefined;
  let initialized: { authorization_url?: string; access_code?: string };
  try {
    initialized = await initializePaystackOnce(context.env, {
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
      update public.payment_attempts set failure_code = 'INITIALIZATION_UNCERTAIN',
        updated_at = now() where id = ${attemptId}::uuid and status = 'CREATED'
    `);
    throw caught;
  }
  if (!initialized.authorization_url || !initialized.access_code) {
    await database(context.env).execute(sql`
      update public.payment_attempts set failure_code = 'INCOMPLETE_PROVIDER_SESSION',
        updated_at = now() where id = ${attemptId}::uuid and status = 'CREATED'
    `);
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "The payment provider returned an incomplete checkout session.",
    );
  }
  await database(context.env).execute(sql`
    update public.payment_attempts set status = 'INITIALIZED', failure_code = null,
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
    /^K1-(?:B-)?AI-/.test(reference) &&
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
    /^K1-(?:B-)?RC-/.test(reference) &&
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
  if (!(await validPaystackSignature(
    context.env, raw, context.req.header("X-Paystack-Signature"),
  ))) {
    throw new AppError(401, "UNAUTHENTICATED", "The payment event signature is invalid.");
  }
  let event: {
    event?: string;
    data?: { reference?: string; amount?: number; status?: string };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    throw new AppError(400, "BAD_REQUEST", "The payment event is not valid JSON.");
  }

  const eventType = event.event;
  const reference = event.data?.reference;
  const isTransfer = eventType === "transfer.success" ||
    eventType === "transfer.failed" || eventType === "transfer.reversed";
  const isCharge = eventType === "charge.success" && event.data?.status === "success";
  if (!reference || !/^[A-Za-z0-9_.-]{1,100}$/.test(reference) ||
      (!isCharge && !isTransfer) ||
      (isTransfer && !reference.startsWith("k1-po-"))) {
    return context.json({ status: "ignored" });
  }

  // Claims are durable and atomic. A concurrent duplicate must retry later,
  // while a previously processed identical signed event gets a safe 200.
  const claim = await claimPaystackWebhook(context.env, eventType!, reference, raw);
  if (claim.state === "DUPLICATE")
    return context.json({ status: "already_processed" });
  if (claim.state === "REQUIRES_REVIEW")
    return context.json({ status: "requires_review" });
  if (claim.state === "BUSY")
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "Payment verification is still in progress.");

  let outcome: "PROCESSED" | "REQUIRES_REVIEW" | "RETRYABLE" = "RETRYABLE";
  try {
    if (isTransfer) {
      // Transfer initiation and settlement share the same unique provider
      // reference. The verified ledger function handles replay atomically.
      outcome = await reconcilePayout(context.env, reference)
        ? "PROCESSED"
        : "REQUIRES_REVIEW";
    } else {
      let recognized = false;
      let status: string | undefined;
      if (/^K1-(?:B-)?AI-/.test(reference)) {
        recognized = await reconcileKira(context.env, reference);
        if (recognized)
          status = firstRow(await database(context.env).execute<{ status: string }>(sql`
            select status from app_private.kira_checkouts where provider_reference=${reference}
          `))?.status;
      } else if (/^K1-(?:B-)?RC-/.test(reference)) {
        recognized = await reconcileRiderCommission(context.env, reference);
        if (recognized)
          status = firstRow(await database(context.env).execute<{ status: string }>(sql`
            select status from app_private.rider_commission_checkouts where provider_reference=${reference}
          `))?.status;
      } else {
        recognized = await reconcilePricedStore(context.env, reference) ||
          await reconcilePricedTutorial(context.env, reference) ||
          await reconcileMaterial(context.env, reference);
        if (recognized)
          status = firstRow(await database(context.env).execute<{ status: string }>(sql`
            select status from public.payment_attempts where provider_reference=${reference}
          `))?.status;
      }
      if (recognized) {
        outcome = status === "PAID" || status === "SUCCEEDED"
          ? "PROCESSED"
          : status === "REQUIRES_REVIEW"
            ? "REQUIRES_REVIEW"
            : "RETRYABLE";
      } else {
        // Signed delivery alone is not a verified payment. Legacy references
        // without sealed receipts go to finance review, never to fulfilment.
        await database(context.env).execute(sql`
          insert into public.payment_provider_events (
            provider,provider_reference,event_type,amount_kobo
          ) values ('PAYSTACK',${reference},'charge.success',${event.data?.amount ?? null})
          on conflict (provider,provider_reference) do update set updated_at=now()
        `);
        await database(context.env).execute(sql`
          with reviewed_attempt as (
            update public.payment_attempts set status='REQUIRES_REVIEW',
              failure_code='LEGACY_VERIFIED_SNAPSHOT_REQUIRED',updated_at=now()
            where provider_reference=${reference} and
              status in('CREATED','INITIALIZED','REQUIRES_REVIEW')
            returning resource_type,resource_id
          )
          update public.payment_provider_events set state='REQUIRES_REVIEW',
            resource_type=(select resource_type from public.payment_attempts where provider_reference=${reference} limit 1),
            resource_id=(select resource_id from public.payment_attempts where provider_reference=${reference} limit 1),
            review_reason='LEGACY_VERIFIED_SNAPSHOT_REQUIRED',updated_at=now()
          where provider='PAYSTACK' and provider_reference=${reference}
        `);
        outcome = "REQUIRES_REVIEW";
      }
    }

    await finishPaystackWebhook(
      context.env,eventType!,reference,claim,outcome,
      outcome === "REQUIRES_REVIEW" ? "FINANCIAL_REVIEW_REQUIRED" : undefined,
    );
  } catch (error) {
    // Returning a non-2xx status asks Paystack to redeliver. The finance
    // journal and receipt constraints protect against an already-committed
    // settlement when the acknowledgement itself was lost.
    try {
      await finishPaystackWebhook(
        context.env,eventType!,reference,claim,"RETRYABLE","RECONCILIATION_FAILED",
      );
    } catch {
      console.error(JSON.stringify({ level: "error", event: "payment.webhook_retry_guard_failed" }));
    }
    throw error;
  }

  if (outcome === "RETRYABLE")
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "The signed payment notification is awaiting verified settlement.");
  return context.json({ status: outcome === "PROCESSED" ? "reconciled" : "requires_review" });
});


paymentRoutes.post('/bachs/webhook', async context => {
  const raw = await context.req.text();
  if (new TextEncoder().encode(raw).byteLength > 65536) throw new AppError(413, 'BAD_REQUEST', 'The payment event is too large.');
  if (!await validBachsDelivery(context.env, raw, context.req.header('X-Bachs-Timestamp'), context.req.header('X-Bachs-Signature'), context.req.header('X-Bachs-Signature-V2')))
    throw new AppError(401, 'UNAUTHENTICATED', 'The payment event signature is invalid.');
  let event: { id?: string; type?: string; data?: { checkout_id?: string; reference?: string } };
  try { event = JSON.parse(raw); } catch { throw new AppError(400, 'BAD_REQUEST', 'The payment event is not valid JSON.'); }
  if (!event || !['checkout.completed', 'collection.succeeded'].includes(event.type ?? '')) return context.json({ status: 'ignored' });
  if (typeof event.id !== 'string' || !/^evt_[A-Za-z0-9_-]{6,90}$/.test(event.id)) throw new AppError(400, 'BAD_REQUEST', 'The payment event ID is invalid.');
  // A signed notification provides an identifier, never authoritative paid amounts.
  const saved = firstRow(await database(context.env).execute<{ reference: string; resourceType: string }>(sql`
    select q.provider_reference as reference,q.resource_type as "resourceType" from app_private.bachs_checkout_quotes q
    join app_private.bachs_priced_sessions s on s.quote_id=q.id
    where (${event.data?.checkout_id ?? null}::text is not null and s.checkout_id=${event.data?.checkout_id ?? null})
       or (${event.data?.checkout_id ?? null}::text is null and q.provider_reference=${event.data?.reference ?? null})
  `));
  if (!saved || !isBachsReference(saved.reference)) return context.json({ status: 'ignored' });
  const claim = await claimBachsWebhook(context.env, event.type!, event.id, raw);
  if (claim.state === 'DUPLICATE') return context.json({ status: 'already_processed' });
  if (claim.state === 'REQUIRES_REVIEW') return context.json({ status: 'requires_review' });
  if (claim.state === 'BUSY') throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'Payment verification is still in progress.');
  try {
    if (saved.resourceType === 'KIRA_SUBSCRIPTION') await reconcileKira(context.env, saved.reference);
    else if (saved.resourceType === 'STORE_ORDER') await reconcilePricedStore(context.env, saved.reference);
    else if (saved.resourceType === 'TUTORIAL_BOOKING') await reconcilePricedTutorial(context.env, saved.reference);
    else if (saved.resourceType === 'TUTORIAL_PURCHASE') await reconcileMaterial(context.env, saved.reference);
    const status = firstRow(await database(context.env).execute<{ status: string }>(sql`
      select status from app_private.kira_checkouts where provider_reference=${saved.reference}
      union all select status from public.payment_attempts where provider_reference=${saved.reference}
    `))?.status;
    const outcome = status === 'PAID' || status === 'SUCCEEDED' ? 'PROCESSED' : status === 'REQUIRES_REVIEW' ? 'REQUIRES_REVIEW' : 'RETRYABLE';
    await finishBachsWebhook(context.env, event.type!, event.id, claim, outcome);
    if (outcome === 'RETRYABLE') throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'This payment is awaiting verified settlement.');
    return context.json({ status: outcome === 'PROCESSED' ? 'reconciled' : 'requires_review' });
  } catch (error) {
    try { await finishBachsWebhook(context.env, event.type!, event.id, claim, 'RETRYABLE', 'RECONCILIATION_FAILED'); } catch { /* The expired claim is recoverable on redelivery. */ }
    throw error;
  }
});
