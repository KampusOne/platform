import {discountError} from "./discount-error";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "./database";
import { approvedCommercePolicy } from "./commerce-pricing";
import { checkoutPrice, listingPrice } from "./pricing";
import { verifyCollection as verifyPaystack } from "./collection-provider";
import { initializePaystackOnce } from "./payment-idempotency";
import { requireUnblocked } from "./profile-safety";
import { AppError } from "./errors";
import type { AuthenticatedUser, Bindings } from "../types";
export async function materialCommerceReady(env: Bindings) {
  if (
    env.UNIFIED_SCHEMA_READY !== "true" ||
    env.PHASE_3_SCHEMA_READY !== "true"
  )
    return false;
  return (
    firstRow(
      await database(env).execute<{ ready: boolean }>(
        sql`select to_regprocedure('app_private.record_material_receipt(text,bigint,bigint,timestamp with time zone)') is not null as ready`,
      ),
    )?.ready === true
  );
}
export const materialQuoteSchema = z
  .object({
    resourceId: z.string().uuid(),
    requestId: z.string().uuid(),
    expectedPriceKobo: z.number().int().positive().max(2_000_000_000),
    discountCode:z.string().trim().toUpperCase().max(32).optional(),
  })
  .strict();
type Quote = {
  id: string;
  university_id: string;
  resource_id: string;
  title: string;
  pricing: ReturnType<typeof checkoutPrice>;
  expires_at: string;
};
function publicQuote(q: Quote) {
  return {
    id: q.id,
    title: q.title,
    priceKobo: q.pricing.listedItemsKobo,
    amountKobo: q.pricing.payableKobo,
    discountKobo: q.pricing.discountKobo,
    visibleProcessingKobo: q.pricing.visibleProcessingKobo??0,
    pricingAdjustmentKobo: q.pricing.pricingAdjustmentKobo??0,
    expiresAt: q.expires_at,
  };
}
export async function materialQuote(
  env: Bindings,
  user: AuthenticatedUser,
  data: z.infer<typeof materialQuoteSchema>,
) {
  const find = async () =>
    firstRow(
      await database(env).execute<Quote>(
        sql`select id,university_id,resource_id,title,pricing,expires_at from app_private.material_checkout_quotes where student_user_id=${user.id}::uuid and request_id=${data.requestId}::uuid`,
      ),
    );
  const restore = (q: Quote) => {
    if (
      q.university_id !== user.universityId ||
      q.resource_id !== data.resourceId ||
      Number(q.pricing.listedItemsKobo) !== data.expectedPriceKobo || ((q.pricing as {couponCode?:string}).couponCode??'')!==(data.discountCode??'')
    )
      throw new AppError(
        409,
        "CONFLICT",
        "This price request belongs to another resource. Refresh its price.",
      );
    if (Date.parse(q.expires_at) <= Date.now())
      throw new AppError(
        409,
        "CONFLICT",
        "This quote expired. Refresh the resource price.",
      );
    return publicQuote(q);
  };
  const existing = await find();
  if (existing) return restore(existing);
  const resource = firstRow(
    await database(env).execute<{
      title: string;
      price_kobo: number;
      tutor_user_id: string;
      media_object_id: string;
    }>(sql`
    select r.title,r.price_kobo,a.user_id as tutor_user_id,r.media_object_id from public.tutorial_resources r
    join public.agent_profiles a on a.id=r.tutor_profile_id and a.university_id=r.university_id and a.agent_type='TUTOR' and a.status='ACTIVE'
    join public.media_objects m on m.id=r.media_object_id and m.institution_id=r.university_id and m.owner_user_id=a.user_id and m.kind='resource' and m.deleted_at is null
    where r.id=${data.resourceId}::uuid and r.university_id=${user.universityId}::uuid and r.access_model='PAID' and r.status='PUBLISHED' and not r.is_demo and r.deleted_at is null
  `),
  );
  if (!resource)
    throw new AppError(
      404,
      "NOT_FOUND",
      "That paid learning material is unavailable.",
    );
  await requireUnblocked(env, user.id, resource.tutor_user_id);
  const policy = await approvedCommercePolicy(
    env,
    user.universityId,
    "TUTORIAL",
  );
  if (!policy)
    throw new AppError(
      409,
      "CONFLICT",
      "Paid learning materials are waiting for an approved pricing policy.",
    );
  let pricing: ReturnType<typeof checkoutPrice>;
  try {
    if (
      listingPrice(Number(resource.price_kobo), policy).customerPriceKobo !==
      data.expectedPriceKobo
    )
      throw new AppError(
        409,
        "CONFLICT",
        "The material price changed. Refresh it before buying.",
      );
    pricing = checkoutPrice(
      [{ baseKobo: Number(resource.price_kobo), quantity: 1 }],
      policy,
      null,
    );
    if (pricing.payableKobo <= 0) throw new RangeError("No payable total.");
  } catch (e) {
    if (e instanceof RangeError)
      throw new AppError(
        409,
        "CONFLICT",
        "This material cannot currently be priced. Choose another resource.",
      );
    throw e;
  }
  const rate = firstRow(
    await database(env).execute<{ allowed: boolean }>(
      sql`select app_private.consume_request_rate_limit('MATERIAL_QUOTE',${user.id},30,3600,3600) as allowed`,
    ),
  );
  if (!rate?.allowed)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Please wait before checking another material price.",
    );
  const saved = firstRow(
    await database(env)
      .execute<Quote>(sql`select * from app_private.create_discounted_material_quote(${crypto.randomUUID()}::uuid,${user.universityId}::uuid,${user.id}::uuid,${data.resourceId}::uuid,${resource.tutor_user_id}::uuid,${resource.media_object_id}::uuid,${policy.id}::uuid,${data.requestId}::uuid,${resource.title},${Number(resource.price_kobo)},${JSON.stringify(pricing)}::jsonb,${data.discountCode??''})`).catch(discountError),
  );
  const q = saved ?? (await find());
  if (!q)
    throw new AppError(
      409,
      "CONFLICT",
      "The price could not be saved. Refresh and try again.",
    );
  return restore(q);
}
export async function initializeMaterialPayment(
  env: Bindings,
  user: AuthenticatedUser,
  id: string,
  requestId: string,
) {
  const purchase = firstRow(
    await database(env).execute<{ amount_kobo: number; tutor_user_id: string }>(
      sql`select amount_kobo,tutor_user_id from app_private.tutorial_material_purchases where id=${id}::uuid and student_user_id=${user.id}::uuid and university_id=${user.universityId}::uuid and status='PENDING_PAYMENT' and payment_expires_at>now()`,
    ),
  );
  if (!purchase)
    throw new AppError(
      409,
      "CONFLICT",
      "This material purchase is not waiting for payment. Refresh its status.",
    );
  await requireUnblocked(env, user.id, purchase.tutor_user_id);
  type Attempt = {
    id: string;
    provider_reference: string;
    status: string;
    authorization_url: string | null;
    access_code: string | null;
  };
  const attempt = firstRow(
    await database(env).execute<Attempt>(
      sql`select * from app_private.prepare_material_payment(${crypto.randomUUID()}::uuid,${id}::uuid,${user.id}::uuid,${user.universityId}::uuid,${requestId},${'K1-L-'+crypto.randomUUID()})`,
    ),
  );
  if (!attempt)
    throw new AppError(
      409,
      "CONFLICT",
      "This payment could not be prepared. Refresh its status.",
    );
  if (attempt.status === "INITIALIZED" && attempt.authorization_url)
    return {
      authorizationUrl: attempt.authorization_url,
      reference: attempt.provider_reference,
      amountKobo: Number(purchase.amount_kobo),
    };
  if (attempt.status !== "CREATED")
    throw new AppError(
      409,
      "CONFLICT",
      "This payment has finished or needs review. Check its status.",
    );
  const rate = firstRow(
    await database(env).execute<{ allowed: boolean }>(
      sql`select app_private.consume_request_rate_limit('MATERIAL_CHECKOUT',${user.id},20,3600,3600) as allowed`,
    ),
  );
  if (!rate?.allowed)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Please wait before opening another checkout.",
    );
  const result = await initializePaystackOnce(env, {
    email: user.email,
    amountKobo: Number(purchase.amount_kobo),
    reference: attempt.provider_reference,
    ...(env.APP_ORIGIN
      ? { callbackUrl: env.APP_ORIGIN.replace(/\/$/, "") + "/payment/return" }
      : {}),
    metadata: {
      resourceType: "TUTORIAL_PURCHASE",
      resourceId: id,
      userId: user.id,
    },
  });
  await database(env).execute(
    sql`update public.payment_attempts set status='INITIALIZED',authorization_url=${result.authorization_url!},access_code=${result.access_code ?? null},initialized_at=now(),updated_at=now() where id=${attempt.id}::uuid and status='CREATED'`,
  );
  return {
    authorizationUrl: result.authorization_url!,
    reference: attempt.provider_reference,
    amountKobo: Number(purchase.amount_kobo),
  };
}
export async function reconcileMaterial(
  env: Bindings,
  reference: string,
  userId?: string,
) {
  if (!(await materialCommerceReady(env))) return false;
  const attempt = firstRow(
    await database(env).execute<{
      status: string;
    }>(sql`select a.status from public.payment_attempts a join app_private.tutorial_material_purchases p on p.id=a.resource_id and a.resource_type='TUTORIAL_PURCHASE'
    where a.provider_reference=${reference} and (${userId ?? null}::uuid is null or a.user_id=${userId ?? null}::uuid)`),
  );
  if (!attempt) return false;
  if (attempt.status === "SUCCEEDED") return true;
  const rate = firstRow(
    await database(env).execute<{ allowed: boolean }>(
      sql`select app_private.consume_request_rate_limit('MATERIAL_RECEIPT',${reference},60,3600,3600) as allowed`,
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
      sql`select app_private.record_material_receipt(${reference},${receipt.amountKobo}::bigint,${receipt.feeKobo}::bigint,${receipt.paidAt}::timestamptz)`,
    );
  return true;
}
export async function purchasedMaterialAccess(
  env: Bindings,
  user: AuthenticatedUser,
  mediaId: string,
) {
  if (!(await materialCommerceReady(env))) return false;
  return Boolean(
    firstRow(
      await database(env)
        .execute(sql`select p.id from app_private.tutorial_material_purchases p join public.tutorial_resources r on r.id=p.resource_id
    where p.media_object_id=${mediaId}::uuid and p.student_user_id=${user.id}::uuid and p.university_id=${user.universityId}::uuid and p.status='PAID'
      and r.status='PUBLISHED' and r.deleted_at is null and not exists(select 1 from public.user_blocks b where
        (b.blocker_id=${user.id}::uuid and b.blocked_id=p.tutor_user_id)or(b.blocker_id=p.tutor_user_id and b.blocked_id=${user.id}::uuid)) limit 1`),
    ),
  );
}
