import {discountError} from "./discount-error";
import { sql } from "drizzle-orm";
import { z, tutorialBookingSchema } from "@kampusone/contracts";
import { database, firstRow } from "./database";
import { approvedCommercePolicy } from "./commerce-pricing";
import { checkoutPrice, listingPrice } from "./pricing";
import { verifyCollection as verifyPaystack } from "./collection-provider";
import { requireUnblocked } from "./profile-safety";
import { AppError } from "./errors";
import type { AuthenticatedUser, Bindings } from "../types";

export async function pricedTutorialReady(env: Bindings) {
  if (env.PHASE_2_SCHEMA_READY !== "true") return false;
  return (
    firstRow(
      await database(env).execute<{ ready: boolean }>(
        sql`select to_regprocedure('app_private.record_priced_tutorial_receipt(text,bigint,bigint,timestamp with time zone)') is not null as ready`,
      ),
    )?.ready === true
  );
}
export async function createPricedTutorial(
  env: Bindings,
  user: AuthenticatedUser,
  data: z.infer<typeof tutorialBookingSchema>,
) {
  if (!data.requestId || data.expectedPriceKobo === undefined)
    throw new AppError(
      409,
      "CONFLICT",
      "Refresh this tutorial before booking so its displayed price can be confirmed.",
    );
  const previous = firstRow(
    await database(env).execute<{
      id: string;
      amount_kobo: number;
      status: string;
      listing_id: string;
      availability_window_id: string;
      university_id: string;discount_code:string|null;
    }>(sql`
    select b.id,b.amount_kobo,b.status,p.listing_id,p.availability_window_id,p.university_id,(select d.code from app_private.discount_redemptions r join app_private.discount_codes d on d.id=r.discount_id where r.purchase_id=p.booking_id) as discount_code
    from app_private.tutorial_booking_prices p join public.tutorial_bookings b on b.id=p.booking_id
    where p.student_user_id=${user.id}::uuid and p.request_id=${data.requestId}::uuid
  `),
  );
  if (previous) {
    if (
      previous.university_id !== user.universityId ||
      previous.listing_id !== data.listingId ||
      previous.availability_window_id !== data.availabilityWindowId || (previous.discount_code??'')!==(data.discountCode??'')
    )
      throw new AppError(
        409,
        "CONFLICT",
        "This booking request belongs to a different session. Start a new booking.",
      );
    return previous;
  }
  const listing = firstRow(
    await database(env).execute<{
      price_kobo: number;
      tutor_user_id: string;
    }>(sql`
    select l.price_kobo,a.user_id as tutor_user_id from public.tutorial_listings l join public.agent_profiles a on a.id=l.tutor_profile_id
    where l.id=${data.listingId}::uuid and l.university_id=${user.universityId}::uuid and a.university_id=l.university_id
      and a.agent_type='TUTOR' and a.status='ACTIVE' and l.status='PUBLISHED' and l.review_status='APPROVED' and not l.is_demo and l.deleted_at is null
  `),
  );
  if (!listing)
    throw new AppError(404, "NOT_FOUND", "That tutorial is unavailable.");
  await requireUnblocked(env, user.id, listing.tutor_user_id);
  const policy = await approvedCommercePolicy(
    env,
    user.universityId,
    "TUTORIAL",
  );
  if (!policy)
    throw new AppError(
      409,
      "CONFLICT",
      "Paid tutorials are waiting for an approved pricing policy.",
    );
  let price: ReturnType<typeof checkoutPrice>;
  try {
    if (
      listingPrice(Number(listing.price_kobo), policy).customerPriceKobo !==
      data.expectedPriceKobo
    )
      throw new AppError(
        409,
        "CONFLICT",
        "The tutorial price changed. Refresh it before booking.",
      );
    price = checkoutPrice(
      [{ baseKobo: Number(listing.price_kobo), quantity: 1 }],
      policy,
      null,
    );
  } catch (e) {
    if (e instanceof RangeError)
      throw new AppError(
        409,
        "CONFLICT",
        "This tutorial cannot currently be priced. Choose another session.",
      );
    throw e;
  }
  return firstRow(
    await database(env).execute<{
      id: string;
      amount_kobo: number;
      status: string;
    }>(sql`
    select * from app_private.create_discounted_tutorial_booking(${crypto.randomUUID()}::uuid,${user.universityId}::uuid,${user.id}::uuid,
      ${data.listingId}::uuid,${data.availabilityWindowId}::uuid,${data.requestId}::uuid,${policy.id}::uuid,${Number(listing.price_kobo)},${JSON.stringify(price)}::jsonb,${data.discountCode??''})
  `).catch(discountError),
  )!;
}
export async function reconcilePricedTutorial(
  env: Bindings,
  reference: string,
  userId?: string,
) {
  if (!(await pricedTutorialReady(env))) return false;
  const attempt = firstRow(
    await database(env).execute<{ status: string }>(sql`
    select a.status from public.payment_attempts a join app_private.tutorial_booking_prices p on p.booking_id=a.resource_id and a.resource_type='TUTORIAL_BOOKING'
    where a.provider_reference=${reference} and (${userId ?? null}::uuid is null or a.user_id=${userId ?? null}::uuid)
  `),
  );
  if (!attempt) return false;
  if (attempt.status === "SUCCEEDED") return true;
  const rate = firstRow(
    await database(env).execute<{ allowed: boolean }>(
      sql`select app_private.consume_request_rate_limit('TUTORIAL_RECEIPT',${reference},60,3600,3600) as allowed`,
    ),
  );
  if (!rate?.allowed)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Please wait before checking this payment again.",
    );
  const receipt = await verifyPaystack(env, reference);
  if (receipt.status === "success")
    await database(env).execute(
      sql`select app_private.record_priced_tutorial_receipt(${reference},${receipt.amountKobo}::bigint,${receipt.feeKobo}::bigint,${receipt.paidAt}::timestamptz)`,
    );
  return true;
}
