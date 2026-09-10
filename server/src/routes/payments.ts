import { sql } from "drizzle-orm";
import { Hono } from "hono";

import { paymentInitializationSchema } from "@kampusone/contracts";

import { recordAudit } from "../lib/audit";
import { database, firstRow, sqlClient } from "../lib/database";
import { AppError } from "../lib/errors";
import { requireFeature } from "../lib/features";
import { initializePaystack, validPaystackSignature } from "../lib/paystack";
import { currentUser, requireAuth } from "../middleware/auth";
import type { Bindings, Variables } from "../types";

export const paymentRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

paymentRoutes.post("/initialize", requireAuth, async (context) => {
  requireFeature(context.env, "PAYMENTS_ENABLED", "Payments are not enabled in this environment.");
  const parsed = paymentInitializationSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "The payment request is invalid.");
  const user = currentUser(context);
  const resource = parsed.data.resourceType === "TUTORIAL_BOOKING"
    ? await database(context.env).execute<{ id: string; amount_kobo: number; status: string }>(sql`
        select id, amount_kobo, status from public.tutorial_bookings
        where id = ${parsed.data.resourceId}::uuid and student_user_id = ${user.id}::uuid
          and payment_expires_at > now() limit 1
      `)
    : await database(context.env).execute<{ id: string; amount_kobo: number; status: string }>(sql`
        select id, total_kobo as amount_kobo, status from public.orders
        where id = ${parsed.data.resourceId}::uuid and buyer_user_id = ${user.id}::uuid
          and exists (
            select 1 from public.inventory_reservations reservations
            where reservations.order_id = orders.id and reservations.status = 'HELD'
              and reservations.expires_at > now()
          )
        limit 1
      `);
  const item = firstRow(resource);
  if (!item) throw new AppError(404, "NOT_FOUND", "That payable item does not exist.");
  if (item.status !== "PENDING_PAYMENT") throw new AppError(409, "CONFLICT", "This item is not waiting for payment.");

  const reference = `K1-${parsed.data.resourceType === "TUTORIAL_BOOKING" ? "T" : "O"}-${crypto.randomUUID()}`;
  const callbackUrl = context.env.APP_ORIGIN
    ? `${context.env.APP_ORIGIN.replace(/\/$/, "")}/payment/return`
    : undefined;
  const initialized = await initializePaystack(context.env, {
    email: user.email,
    amountKobo: Number(item.amount_kobo),
    reference,
    ...(callbackUrl ? { callbackUrl } : {}),
    metadata: { resourceType: parsed.data.resourceType, resourceId: item.id, userId: user.id },
  });
  const table = parsed.data.resourceType === "TUTORIAL_BOOKING" ? "tutorial_bookings" : "orders";
  if (table === "tutorial_bookings") {
    await database(context.env).execute(sql`
      update public.tutorial_bookings set provider_reference = ${reference}, updated_at = now()
      where id = ${item.id}::uuid and student_user_id = ${user.id}::uuid and status = 'PENDING_PAYMENT'
    `);
  } else {
    await database(context.env).execute(sql`
      update public.orders set provider_reference = ${reference}, updated_at = now()
      where id = ${item.id}::uuid and buyer_user_id = ${user.id}::uuid and status = 'PENDING_PAYMENT'
    `);
  }
  await recordAudit(context.env, {
    actorUserId: user.id, universityId: user.universityId,
    action: "payment.initialized", targetType: table, targetId: item.id,
    requestId: context.get("requestId"), metadata: { reference, amountKobo: item.amount_kobo },
  });
  return context.json({
    authorizationUrl: initialized.authorization_url,
    accessCode: initialized.access_code,
    reference,
  });
});

paymentRoutes.post("/paystack/webhook", async (context) => {
  const raw = await context.req.text();
  if (!await validPaystackSignature(context.env, raw, context.req.header("X-Paystack-Signature"))) {
    throw new AppError(401, "UNAUTHENTICATED", "The payment event signature is invalid.");
  }
  const event = JSON.parse(raw) as {
    event?: string;
    data?: { reference?: string; amount?: number; status?: string };
  };
  if (event.event !== "charge.success" || event.data?.status !== "success" || !event.data.reference) {
    return context.json({ status: "ignored" });
  }
  const reference = event.data.reference;
  await database(context.env).execute(sql`
    insert into public.payment_provider_events (
      provider, provider_reference, event_type, amount_kobo
    ) values ('PAYSTACK', ${reference}, 'charge.success', ${event.data.amount ?? null})
    on conflict (provider, provider_reference) do update set
      updated_at = now()
  `);

  const bookingResult = await database(context.env).execute<{
    id: string; university_id: string; amount_kobo: number; tutor_user_id: string;
  }>(sql`
    select bookings.id, bookings.university_id, bookings.amount_kobo,
      profiles.user_id as tutor_user_id
    from public.tutorial_bookings bookings
    join public.tutorial_listings listings on listings.id = bookings.listing_id
    join public.agent_profiles profiles on profiles.id = listings.tutor_profile_id
    where bookings.provider_reference = ${reference} and bookings.status = 'PENDING_PAYMENT'
      and bookings.payment_expires_at > now()
    limit 1
  `);
  const booking = firstRow(bookingResult);
  if (booking) {
    if (Number(event.data.amount) !== Number(booking.amount_kobo)) {
      await database(context.env).execute(sql`
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
      client`update public.payment_provider_events set state = 'PROCESSED', resource_type = 'TUTORIAL_BOOKING', resource_id = ${booking.id}::uuid, processed_at = now(), updated_at = now() where provider = 'PAYSTACK' and provider_reference = ${reference}`,
    ]);
    return context.json({ status: "processed" });
  }

  const orderResult = await database(context.env).execute<{
    id: string; university_id: string; total_kobo: number; subtotal_kobo: number;
    delivery_fee_kobo: number; vendor_user_id: string;
  }>(sql`
    select orders.id, orders.university_id, orders.total_kobo, orders.subtotal_kobo,
      orders.delivery_fee_kobo, profiles.user_id as vendor_user_id
    from public.orders orders
    join public.agent_profiles profiles on profiles.id = orders.vendor_profile_id
    where orders.provider_reference = ${reference} and orders.status = 'PENDING_PAYMENT'
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
      resource_type: string; resource_id: string; status: string;
    }>(sql`
      select 'TUTORIAL_BOOKING'::text as resource_type, id as resource_id, status
      from public.tutorial_bookings where provider_reference = ${reference}
      union all
      select 'STORE_ORDER'::text as resource_type, id as resource_id, status
      from public.orders where provider_reference = ${reference}
      limit 1
    `);
    const existing = firstRow(existingResult);
    const alreadyProcessed = Boolean(existing && !["PENDING_PAYMENT", "CANCELLED"].includes(existing.status));
    await database(context.env).execute(sql`
      update public.payment_provider_events set
        state = ${alreadyProcessed ? "PROCESSED" : "REQUIRES_REVIEW"},
        resource_type = ${existing?.resource_type ?? null},
        resource_id = ${existing?.resource_id ?? null}::uuid,
        review_reason = ${alreadyProcessed ? null : existing ? "PAYMENT_AFTER_EXPIRY_OR_CANCELLATION" : "UNKNOWN_REFERENCE"},
        processed_at = ${alreadyProcessed ? new Date().toISOString() : null}::timestamptz,
        updated_at = now()
      where provider = 'PAYSTACK' and provider_reference = ${reference}
    `);
    return context.json({ status: alreadyProcessed ? "already_processed" : "requires_review" });
  }
  if (Number(event.data.amount) !== Number(order.total_kobo)) {
    await database(context.env).execute(sql`
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
    ...(Number(order.delivery_fee_kobo) > 0 ? [client`insert into public.ledger_lines (transaction_id, account_id, direction, amount_kobo) select transactions.id, accounts.id, 'CREDIT', ${order.delivery_fee_kobo} from public.ledger_transactions transactions join public.ledger_accounts accounts on accounts.university_id = ${order.university_id}::uuid and accounts.account_code = 'DELIVERY_REVENUE' and accounts.owner_user_id is null where transactions.idempotency_key = ${`paystack:${reference}`} and (select count(*) from public.ledger_lines lines where lines.transaction_id = transactions.id) = 2`] : []),
    client`update public.payment_provider_events set state = 'PROCESSED', resource_type = 'STORE_ORDER', resource_id = ${order.id}::uuid, processed_at = now(), updated_at = now() where provider = 'PAYSTACK' and provider_reference = ${reference}`,
  ]);
  return context.json({ status: "processed" });
});
