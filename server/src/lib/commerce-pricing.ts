import {mappedDeliveryPoint,currentAgentPosition,campusDeliveryRoute} from './delivery-routing';
import {discountError} from "./discount-error";
import { sql } from "drizzle-orm";
import { storeOrderSchema, z } from "@kampusone/contracts";
import { database, firstRow } from "./database";
import { AppError } from "./errors";
import { requireUnblocked } from "./profile-safety";
import {
  listingPrice,
  checkoutPrice,
  campusFare,
  type CommerceFees,
} from "./pricing";
import { verifyPaystack } from "./paystack";
import { resolveProviderCollection } from "./payment-pricing";
import type { AuthenticatedUser, Bindings } from "../types";

export async function inclusiveStoreReady(env: Bindings) {
  if (env.PHASE_3_SCHEMA_READY !== "true") return false;
  return Boolean(
    firstRow(
      await database(env).execute<{ ready: boolean }>(
        sql`select to_regprocedure('app_private.create_priced_store_order(uuid,uuid,uuid,text,text)') is not null as ready`,
      ),
    )?.ready,
  );
}
export async function approvedCommercePolicy(
  env: Bindings,
  uni: string | null,
  kind: "STORE" | "TUTORIAL",
): Promise<CommerceFees | null> {
  if (!(await inclusiveStoreReady(env))) return null;
  const row = firstRow(
    await database(env).execute<{
      id: string;
      buyer_basis_points: number;
      buyer_flat_per_item_kobo: number;
      seller_commission_basis_points: number;
      collection: CommerceFees["collection"];
      checkout_savings: boolean;
      allow_processor_subsidy: boolean;
      policy_config?: Partial<CommerceFees>;
    }>(sql`
    select p.* from app_private.commerce_fee_policies p join app_private.active_commerce_fee_policies a on a.policy_id=p.id
    where a.university_id=${uni}::uuid and a.kind=${kind}
  `),
  );
  // New listings and quotes need a currently eligible provider context. Saved
  // quotes and verified receipts keep their original rules and amounts.
  if (row && env.ENVIRONMENT === "production") {
    const pinned = row.collection.providerProfileId ?? row.policy_config?.providerProfileId;
    await resolveProviderCollection(env, uni, pinned);
  }
  return row
    ? {
        id: row.id,
        buyerBasisPoints: row.buyer_basis_points,
        buyerFlatPerItemKobo: row.buyer_flat_per_item_kobo,
        sellerCommissionBasisPoints: row.seller_commission_basis_points,
        collection: row.collection,
        checkoutSavings: row.checkout_savings,
        allowProcessorSubsidy: row.allow_processor_subsidy,
        providerFeeMode: "CUSTOMER_PASSTHROUGH",
        ...Object.fromEntries(Object.entries(row.policy_config??{}).filter(([key])=>["feeBearer","customerFeeDisplay","feeSplit","providerProfileId","roundingMode","maxPricingAdjustmentKobo","minimumCommissionKobo","maximumCommissionKobo"].includes(key))),
      }
    : null;
}
export async function inclusiveListings<T extends { price_kobo?: unknown }>(
  env: Bindings,
  uni: string | null,
  kind: "STORE" | "TUTORIAL",
  rows: T[],
) {
  const policy = await approvedCommercePolicy(env, uni, kind);
  return {
    policy,
    items: rows.map((row) => {
      if (!policy) return { ...row, pricing_ready: false };
      try {
        return {
          ...row,
          price_kobo: listingPrice(Number(row.price_kobo), policy)
            .customerPriceKobo,
          pricing_ready: true,
        };
      } catch (e) {
        if (e instanceof RangeError) return { ...row, pricing_ready: false };
        throw e;
      }
    }),
  };
}
export const storeQuoteSchema = storeOrderSchema.and(
  z.object({ requestId: z.string().uuid(),discountCode:z.string().trim().toUpperCase().max(32).optional() }),
);
export function publicQuotePricing(p: unknown) {
  const v = p as ReturnType<typeof checkoutPrice>;
  return {
    listedItemsKobo: v.listedItemsKobo,
    discountKobo: v.discountKobo,
    fareKobo: v.fareKobo,
    payableKobo: v.payableKobo,
    cashDueKobo: v.cashDueKobo,
    totalKobo: v.totalKobo,
    visibleProcessingKobo: v.visibleProcessingKobo??0,
    pricingAdjustmentKobo: v.pricingAdjustmentKobo??0,
    pricingNotice: 'The displayed total estimates processing. Paystack receives the product subtotal and platform fee, then confirms its actual fee at checkout.',
  };
}
function responseQuote(q: {
  id: string;
  pricing: unknown;
  fare: unknown;
  expires_at: string;
}) {
  const f = q.fare as (ReturnType<typeof campusFare>&{route?:unknown;distanceBasis?:string;pickupLocationBasis?:string}) | null;
  return {
    id: q.id,
    pricing: publicQuotePricing(q.pricing),
    fare: f
      ? {
          fareKobo: f.fareKobo,
          routeMetres: f.routeMetres,
          distanceBasis: f.distanceBasis??'CAMPUS_ZONE',
          route:f.route??null,routeAccessNotice:(f.route as {notice?:string}|null)?.notice??null,pickupLocationBasis:f.pickupLocationBasis??null,
        }
      : null,
    expiresAt: q.expires_at,
  };
}
export async function prepareStoreQuote(
  env: Bindings,
  user: AuthenticatedUser,
  data: z.infer<typeof storeQuoteSchema>,
) {
  if (!user.universityId)
    throw new AppError(
      409,
      "CONFLICT",
      "Choose your campus before checking out.",
    );
  const policy = await approvedCommercePolicy(env, user.universityId, "STORE");
  if (!policy)
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "Store checkout is awaiting its approved pricing policy.",
    );
  const previous = firstRow(
    await database(env).execute<{
      id: string;
      request_payload: unknown;
      pricing: unknown;
      fare: unknown;
      expires_at: string;
    }>(sql`
    select id,request_payload,pricing,fare,expires_at from app_private.store_checkout_quotes where buyer_user_id=${user.id}::uuid and request_id=${data.requestId}::uuid
  `),
  );
  if (previous) {
    const same = firstRow(
      await database(env).execute<{ same: boolean }>(
        sql`select request_payload=${JSON.stringify(data)}::jsonb as same from app_private.store_checkout_quotes where id=${previous.id}::uuid`,
      ),
    )?.same;
    if (!same)
      throw new AppError(
        409,
        "CONFLICT",
        "These checkout details changed. Review a new quote.",
      );
    if (Date.parse(previous.expires_at) <= Date.now())
      throw new AppError(
        409,
        "CONFLICT",
        "This quote expired. Review a new quote.",
      );
    return responseQuote(previous);
  }
  if (new Set(data.items.map((i) => i.productId)).size !== data.items.length)
    throw new AppError(400, "BAD_REQUEST", "Choose each product only once.");
  const vendor = firstRow(
    await database(env).execute<{
      user_id: string;
      pickup_enabled: boolean;
      self_delivery_enabled: boolean;
      pickup_place_id:string|null;
    }>(sql`
    select a.user_id,s.pickup_enabled,s.self_delivery_enabled,s.pickup_place_id from public.agent_profiles a join public.vendor_storefronts s on s.vendor_profile_id=a.id
    where a.id=${data.vendorProfileId}::uuid and a.university_id=${user.universityId}::uuid and a.status='ACTIVE' and a.agent_type='VENDOR' and s.status='APPROVED'
  `),
  );
  if (!vendor)
    throw new AppError(409, "CONFLICT", "This store is not accepting orders.");
  await requireUnblocked(env, user.id, vendor.user_id);
  if (
    (data.fulfilmentMode === "PICKUP" && !vendor.pickup_enabled) ||
    (data.fulfilmentMode === "VENDOR_DELIVERY" && !vendor.self_delivery_enabled)
  )
    throw new AppError(
      409,
      "CONFLICT",
      "Choose a delivery option this store offers.",
    );
  if (data.fulfilmentMode !== "RIDER" && data.deliveryPaymentMethod === "CASH")
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Cash fare is available only for rider delivery.",
    );
  const products = await database(env).execute<{
    id: string;
    price_kobo: number;
    stock_quantity: number;
  }>(sql`
    select p.id,p.price_kobo,p.stock_quantity from public.vendor_products p join public.product_categories c on c.id=p.category_id and c.university_id=p.university_id
    where p.id in (select (value->>'productId')::uuid from jsonb_array_elements(${JSON.stringify(data.items)}::jsonb))
      and p.vendor_profile_id=${data.vendorProfileId}::uuid and p.university_id=${user.universityId}::uuid
      and p.status='PUBLISHED' and c.status='APPROVED'
  `);
  const items = data.items.map((item) => {
    const p = products.rows.find((p) => p.id === item.productId);
    if (!p || Number(p.stock_quantity) < item.quantity)
      throw new AppError(
        409,
        "CONFLICT",
        "A product is unavailable or its stock changed.",
      );
    let price;
    try {
      price = listingPrice(Number(p.price_kobo), policy);
    } catch (e) {
      if (e instanceof RangeError)
        throw new AppError(
          409,
          "CONFLICT",
          "This product is outside the supported checkout range.",
        );
      throw e;
    }
    if (
      item.expectedUnitPriceKobo !== undefined &&
      item.expectedUnitPriceKobo !== price.customerPriceKobo
    )
      throw new AppError(
        409,
        "CONFLICT",
        "A product price changed. Refresh the store before reviewing payment.",
      );
    return {
      product_id: p.id,
      quantity: item.quantity,
      base_kobo: Number(p.price_kobo),
      customer_unit_kobo: price.customerPriceKobo,
    };
  });
  let fare:(ReturnType<typeof campusFare>&{route:unknown;distanceBasis:string;pickupLocationBasis:string})|null=null;
  if (data.fulfilmentMode === "RIDER") {
    if (env.LOGISTICS_ENABLED !== "true")
      throw new AppError(
        503,
        "FEATURE_DISABLED",
        "Rider delivery is not available yet.",
      );
    const zone=firstRow(await database(env).execute<{id:string}>(sql`select id from public.delivery_zones where id=${data.deliveryZoneId??null}::uuid and university_id=${user.universityId}::uuid and active`));
    if(!zone)throw new AppError(409,'CONFLICT','Choose an active delivery coverage zone.');
    if(!vendor.pickup_place_id||!data.deliveryPlaceId)throw new AppError(422,'BAD_REQUEST','The store pickup and your delivery point must be selected on the campus map before a rider fare can be reviewed.');
    const pickup=await mappedDeliveryPoint(env,user.universityId!,vendor.pickup_place_id),destination=await mappedDeliveryPoint(env,user.universityId!,data.deliveryPlaceId);
    if(pickup.campus_id!==destination.campus_id)throw new AppError(422,'BAD_REQUEST','Cross-campus rider delivery is outside the mapped campus route coverage.');
    const position=await currentAgentPosition(env,data.vendorProfileId,user.universityId!);
    const origin:[number,number]=position?[position.longitude,position.latitude]:[pickup.longitude,pickup.latitude];
    const route=await campusDeliveryRoute(env,user.universityId!,pickup.campus_id,origin,[destination.longitude,destination.latitude]);
    fare={...campusFare(route.distanceMetres),route,distanceBasis:'OSM_BICYCLE_NETWORK',pickupLocationBasis:position?'CURRENT_VENDOR_POSITION':'APPROVED_STOREFRONT_PICKUP'};
  }
  let pricing;
  try {
    pricing = checkoutPrice(
      items.map((i) => ({ baseKobo: i.base_kobo, quantity: i.quantity })),
      policy,
      fare ? { ...fare, paymentMethod: data.deliveryPaymentMethod } : null,
    );
  } catch (e) {
    if (e instanceof RangeError)
      throw new AppError(
        409,
        "CONFLICT",
        "This cart is outside the approved checkout policy. Adjust its items or contact support.",
      );
    throw e;
  }
  if (pricing.payableKobo <= 0)
    throw new AppError(
      409,
      "CONFLICT",
      "This cart does not require a paid checkout.",
    );
  const saved = firstRow(
    await database(env).execute<{
      id: string;
      pricing: unknown;
      fare: unknown;
      expires_at: string;
    }>(sql`
    select * from app_private.create_discounted_store_quote(${crypto.randomUUID()}::uuid,${user.universityId}::uuid,${user.id}::uuid,${data.vendorProfileId}::uuid,${policy.id}::uuid,${data.requestId}::uuid,${JSON.stringify(data)}::jsonb,${JSON.stringify(items)}::jsonb,${JSON.stringify(pricing)}::jsonb,${JSON.stringify(fare)}::jsonb,${data.discountCode??''})
  `).catch(discountError),
  );
  if (!saved) return prepareStoreQuote(env, user, data);
  return responseQuote(saved);
}
export async function reconcilePricedStore(
  env: Bindings,
  reference: string,
  userId?: string,
) {
  if (!(await inclusiveStoreReady(env))) return false;
  const attempt = firstRow(
    await database(env).execute<{ id: string; status: string }>(sql`
    select a.id,a.status from public.payment_attempts a join public.orders o on o.id=a.resource_id and a.resource_type='STORE_ORDER'
    where a.provider_reference=${reference} and o.pricing_formula_version='INCLUSIVE_V1' and (${userId ?? null}::uuid is null or a.user_id=${userId ?? null}::uuid)
  `),
  );
  if (!attempt) return false;
  if (attempt.status === "SUCCEEDED") return true;
  const rate = firstRow(
    await database(env).execute<{ allowed: boolean }>(
      sql`select app_private.consume_request_rate_limit('STORE_RECEIPT',${reference},60,3600,3600) as allowed`,
    ),
  );
  if (!rate?.allowed)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Please wait before checking this payment again.",
    );
  const receipt = await verifyPaystack(env, reference);
  if (receipt.status !== "success") return true;
  await database(env).execute(
    sql`select app_private.record_priced_store_receipt(${reference},${receipt.amountKobo}::bigint,${receipt.feeKobo}::bigint,${receipt.paidAt}::timestamptz)`,
  );
  return true;
}
