import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono, type Context, type Next } from "hono";
import type { PGlite } from "@electric-sql/pglite";
import {
  createTestDatabase,
  testDatabaseAdapter,
  testSqlClient,
} from "./helpers/database";
import { agentRoutes } from "../src/routes/agents";
import { studentRoutes } from "../src/routes/student";
import { paymentRoutes } from "../src/routes/payments";
import { purchaseReviewRoutes } from "../src/routes/purchase-reviews";
import { queueDuePurchaseReviews } from "../src/services/purchase-reviews";
import { deriveHandoffCode } from "../src/lib/security";
import { AppError } from "../src/lib/errors";
import type { Bindings } from "../src/types";

let pg: PGlite;
vi.mock("../src/lib/database", () => ({
  database: () => testDatabaseAdapter(pg),
  sqlClient: () => testSqlClient(pg),
  firstRow: (r: { rows: unknown[] }) => r.rows[0],
}));
vi.mock("../src/middleware/auth", () => ({
  currentUser: (c: Context) => ({
    id: c.req.header("x-user"),
    universityId: c.req.header("x-campus"),
    roles: ["STUDENT"],
  }),
  requireAuth: async (c: Context, next: Next) =>
    c.req.header("x-user") ? next() : c.json({ error: "Unauthorized" }, 401),
}));
const campus = crypto.randomUUID(),
  otherCampus = crypto.randomUUID(),
  owner = crypto.randomUUID(),
  buyer = crypto.randomUUID(),
  vendor = crypto.randomUUID(),
  product = crypto.randomUUID(),
  category = crypto.randomUUID(),
  zone = crypto.randomUUID();
const riders = [
  { user: crypto.randomUUID(), profile: crypto.randomUUID() },
  { user: crypto.randomUUID(), profile: crypto.randomUUID() },
];
const env = {
  PHASE_3_SCHEMA_READY: "true",
  PHASE_2_SCHEMA_READY: "true",
  TUTORIALS_ENABLED: "false",
  UNIFIED_SCHEMA_READY: "true",
  STORE_ENABLED: "true",
  LOGISTICS_ENABLED: "true",
  PAYMENTS_ENABLED: "false",
  OTP_PEPPER: "synthetic-test-pepper-never-used-in-production",
} as Bindings;
const app = new Hono()
  .route("/agents", agentRoutes)
  .route("/student", studentRoutes)
  .route("/payments", paymentRoutes)
  .route("/reminders", purchaseReviewRoutes);
app.onError((e, c) =>
  c.json({ error: e.message }, e instanceof AppError ? e.status : 500),
);
async function req(
  path: string,
  expected = 200,
  method = "GET",
  body?: unknown,
  user = buyer,
  institution = campus,
) {
  const response = await app.request(
    path,
    {
      method,
      headers: {
        "x-user": user,
        "x-campus": institution,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
  const data = await response.json();
  expect(response.status, JSON.stringify(data)).toBe(expected);
  return data;
}
async function create(mode = "PICKUP", quantity = 1) {
  return req("/student/orders", 201, "POST", {
    vendorProfileId: vendor,
    fulfilmentMode: mode,
    deliveryZoneId: mode === "RIDER" ? zone : null,
    recipientName: "Synthetic buyer",
    recipientPhoneE164: "+2348012345678",
    deliveryLocation:
      mode === "PICKUP" ? "FORGED PICKUP ADDRESS" : "Synthetic hostel gate",
    items: [{ productId: product, quantity }],
  });
}
async function ready(orderId: string) {
  await pg.query("update orders set status='PAID' where id=$1", [orderId]);
  await pg.query(
    "update inventory_reservations set status='CONVERTED' where order_id=$1",
    [orderId],
  );
  await pg.query(
    "update delivery_jobs set status='AVAILABLE' where order_id=$1",
    [orderId],
  );
  await req(
    `/agents/orders/${orderId}/status`,
    200,
    "PATCH",
    { status: "ACCEPTED" },
    owner,
  );
  await req(
    `/agents/orders/${orderId}/status`,
    200,
    "PATCH",
    { status: "READY" },
    owner,
  );
}
beforeAll(async () => {
  pg = await createTestDatabase();
  for (const file of [
    "20260912200000_phase_3_commerce_foundation.sql",
    "20260930220000_store_fulfilment_modes.sql",
    "20260930230000_optional_purchase_review_reminders.sql",
  ])
    await pg.exec(
      readFileSync(
        new URL("../../database/neon/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  for (const id of [campus, otherCampus])
    await pg.query(
      "insert into universities(id,name,slug,updated_at)values($1,'Synthetic campus '||$1::uuid::text,$1::uuid::text,now())",
      [id],
    );
  for (const id of [owner, buyer, ...riders.map((r) => r.user)]) {
    await pg.query(
      "insert into users(id,email,password_hash,updated_at)values($1,$1::uuid::text||'@example.invalid','synthetic',now())",
      [id],
    );
    await pg.query(
      "insert into profiles(id,user_id,university_id,username,display_name,updated_at)values($1,$1,$2,'synthetic_'||substring(replace($1::uuid::text,'-',''),1,20),'Synthetic student',now())",
      [id, campus],
    );
  }
  for (const agent of [
    { user: owner, profile: vendor, type: "VENDOR" },
    ...riders.map((r) => ({ ...r, type: "RIDER" })),
  ]) {
    const application = crypto.randomUUID();
    await pg.query(
      "insert into agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement)values($1,$2,$3,$4,'Synthetic agent','+2348012345678','Synthetic fixture only')",
      [application, agent.user, campus, agent.type],
    );
    await pg.query(
      "insert into agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,verified_at)values($1,$2,$3,$4,$5,'Synthetic agent',now())",
      [agent.profile, agent.user, campus, application, agent.type],
    );
  }
  await pg.query(
    "insert into vendor_storefronts(vendor_profile_id,university_id,display_name,description,status,submitted_at,reviewed_by_user_id,reviewed_at,moderated_revision,contact_phone_e164,pickup_location,opening_hours)values($1,$2,'Synthetic shop','A synthetic store description','APPROVED',now(),$3,now(),1,'+2348012345678','Approved campus pickup gate','{\"mon\":\"08:00-17:00\"}'::jsonb)",
    [vendor, campus, buyer],
  );
  await pg.query(
    "insert into product_categories(id,university_id,name,status)values($1,$2,'Books','APPROVED')",
    [category, campus],
  );
  await pg.query(
    "insert into vendor_products(id,university_id,vendor_profile_id,name,description,category,category_id,price_kobo,stock_quantity,status,reviewed_by_user_id,reviewed_at,moderated_revision,package_weight_grams,package_length_cm,package_width_cm,package_height_cm,bicycle_delivery_eligible)values($1,$2,$3,'Synthetic book','A synthetic product description','Books',$4,100000,20,'PUBLISHED',$5,now(),1,200,20,15,3,true)",
    [product, campus, vendor, category, buyer],
  );
  await pg.query(
    "insert into delivery_zones(id,university_id,name,base_fee_kobo,active)values($1,$2,'Campus route',30000,true)",
    [zone, campus],
  );
  for (const rider of riders)
    await pg.query(
      "insert into rider_presence(rider_profile_id,online,capacity_status,last_seen_at,updated_at)values($1,true,'AVAILABLE',now(),now())",
      [rider.profile],
    );
}, 60000);
afterAll(async () => {
  await pg?.close();
});

describe("store fulfilment and optional reviews", () => {
  it("keeps pickup free, snapshots the approved address, reserves stock, and requires a buyer handoff", async () => {
    const order = await create();
    expect(order).toMatchObject({
      subtotalKobo: 100000,
      deliveryFeeKobo: 0,
      totalKobo: 100000,
    });
    const detail = await req(`/student/orders/${order.id}`);
    expect(detail.order).toMatchObject({
      fulfilment_mode: "PICKUP",
      delivery_location: "Approved campus pickup gate",
      pickup_location: "Approved campus pickup gate",
    });
    expect(
      (
        await pg.query("select * from delivery_jobs where order_id=$1", [
          order.id,
        ])
      ).rows,
    ).toEqual([]);
    expect(
      (
        await pg.query<{ stock_quantity: number }>(
          "select stock_quantity from vendor_products where id=$1",
          [product],
        )
      ).rows[0]?.stock_quantity,
    ).toBe(19);
    await req(
      `/agents/orders/${order.id}/handoff`,
      409,
      "POST",
      { code: "000000" },
      owner,
    );
    await ready(order.id);
    await req("/student/product-reviews", 403, "POST", {
      orderId: order.id,
      productId: product,
      rating: 4,
    });
    const code = (await deriveHandoffCode(env, order.id, "delivery")).code;
    const wrong = code === "000000" ? "111111" : "000000";
    await req(
      `/agents/orders/${order.id}/handoff`,
      400,
      "POST",
      { code: wrong },
      owner,
    );
    await req(
      `/agents/orders/${order.id}/handoff`,
      409,
      "POST",
      { code },
      owner,
      otherCampus,
    );
    await req(
      `/agents/orders/${order.id}/handoff`,
      200,
      "POST",
      { code },
      owner,
    );
    await req(
      `/agents/orders/${order.id}/handoff`,
      409,
      "POST",
      { code },
      owner,
    );
    expect((await req(`/student/orders/${order.id}`)).order.status).toBe(
      "DELIVERED",
    );
    expect(
      (await req(`/student/orders/${order.id}`)).timeline.map(
        (e: { status: string }) => e.status,
      ),
    ).toEqual(["PENDING_PAYMENT", "PAID", "ACCEPTED", "READY", "DELIVERED"]);
    const reminders = await pg.query<{ due_at: Date }>(
      "select due_at from app_private.purchase_review_reminders where resource_id=$1",
      [order.id],
    );
    expect(
      new Date(reminders.rows[0]!.due_at).getTime() - Date.now(),
    ).toBeGreaterThan(2.99 * 3600000);
    expect((await req("/reminders")).reminders).toEqual([]);
    expect((await queueDuePurchaseReviews(env, buyer)).queued).toBe(0);
    await pg.query(
      "update app_private.purchase_review_reminders set due_at=now()-interval '1 minute' where resource_id=$1",
      [order.id],
    );
    const due = await req("/reminders");
    expect(due.reminders).toHaveLength(1);
    const reminder = due.reminders[0];
    expect(
      (
        await req(
          `/reminders/${reminder.id}/show`,
          200,
          "POST",
          undefined,
          owner,
        )
      ).claimed,
    ).toBe(false);
    expect(
      (await req(`/reminders/${reminder.id}/show`, 200, "POST")).claimed,
    ).toBe(true);
    expect(
      (await req(`/reminders/${reminder.id}/show`, 200, "POST")).claimed,
    ).toBe(false);
    await queueDuePurchaseReviews(env, buyer);
    expect(
      (
        await pg.query(
          "select * from in_app_notifications where dedupe_key=$1",
          ["purchase-review:STORE_ORDER:" + order.id],
        )
      ).rows,
    ).toHaveLength(1);
    await req(`/reminders/${reminder.id}/dismiss`, 200, "POST");
    expect((await req("/reminders")).reminders).toEqual([]);
    // Dismissing a reminder does not remove the student's ability to review later.
    await req(
      "/student/product-reviews",
      403,
      "POST",
      { orderId: order.id, productId: product, rating: 4 },
      owner,
    );
    await req("/student/product-reviews", 403, "POST", {
      orderId: order.id,
      productId: crypto.randomUUID(),
      rating: 4,
    });
    await req(
      "/student/product-reviews",
      403,
      "POST",
      { orderId: order.id, productId: product, rating: 4 },
      buyer,
      otherCampus,
    );
    await req("/student/product-reviews", 201, "POST", {
      orderId: order.id,
      productId: product,
      rating: 4,
    });
    await req("/student/product-reviews", 409, "POST", {
      orderId: order.id,
      productId: product,
      rating: 5,
    });
  });
  it("requires vendor opt-in and dispatch before self delivery can complete", async () => {
    await req("/student/orders", 409, "POST", {
      vendorProfileId: vendor,
      fulfilmentMode: "VENDOR_DELIVERY",
      recipientName: "Synthetic buyer",
      recipientPhoneE164: "+2348012345678",
      deliveryLocation: "Synthetic hostel gate",
      items: [{ productId: product, quantity: 1 }],
    });
    await req(
      "/agents/storefront/fulfilment",
      200,
      "PUT",
      { pickupEnabled: true, selfDeliveryEnabled: true },
      owner,
    );
    const order = await create("VENDOR_DELIVERY");
    await ready(order.id);
    const code = (await deriveHandoffCode(env, order.id, "delivery")).code;
    await req(
      `/agents/orders/${order.id}/handoff`,
      409,
      "POST",
      { code },
      owner,
    );
    await req(
      `/agents/orders/${order.id}/dispatch`,
      409,
      "POST",
      undefined,
      buyer,
    );
    await req(
      `/agents/orders/${order.id}/dispatch`,
      200,
      "POST",
      undefined,
      owner,
    );
    await req(
      `/agents/orders/${order.id}/handoff`,
      200,
      "POST",
      { code },
      owner,
    );
    expect((await req(`/student/orders/${order.id}`)).order.status).toBe(
      "DELIVERED",
    );
  });
  it("only exposes posted rider requests and accepts a single rider without disclosing buyer addresses to the other rider", async () => {
    const order = await create("RIDER");
    await ready(order.id);
    const job = (
      await pg.query<{ id: string }>(
        "select id from delivery_jobs where order_id=$1",
        [order.id],
      )
    ).rows[0]!.id;
    expect(
      (await req("/agents/deliveries", 200, "GET", undefined, riders[0]!.user))
        .jobs,
    ).toEqual([]);
    await req(
      `/agents/deliveries/${job}/reserve`,
      409,
      "POST",
      undefined,
      riders[0]!.user,
    );
    await req(
      `/agents/orders/${order.id}/rider-request`,
      409,
      "POST",
      undefined,
      buyer,
    );
    await req(
      `/agents/orders/${order.id}/rider-request`,
      200,
      "POST",
      undefined,
      owner,
    );
    const available = (
      await req("/agents/deliveries", 200, "GET", undefined, riders[1]!.user)
    ).jobs[0];
    expect(available.delivery_location).toBeNull();
    expect(available.vendor_phone).toBeNull();
    const attempts = await Promise.all(
      riders.map((r) =>
        app.request(
          `/agents/deliveries/${job}/reserve`,
          { method: "POST", headers: { "x-user": r.user, "x-campus": campus } },
          env,
        ),
      ),
    );
    expect(attempts.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = (
      await pg.query<{ rider_profile_id: string }>(
        "select rider_profile_id from delivery_jobs where id=$1",
        [job],
      )
    ).rows[0]!.rider_profile_id;
    const accepted = (
      await req(
        "/agents/deliveries",
        200,
        "GET",
        undefined,
        riders.find((r) => r.profile === winner)!.user,
      )
    ).jobs[0];
    expect(accepted.delivery_location).toBe("Synthetic hostel gate");
    expect(accepted.vendor_phone).toBe("+2348012345678");
  });
  it("returns the stored payable total only to its buyer and leaves checkout gated on settlement readiness", async () => {
    const order = await create();
    const path = `/payments/summary?resourceType=STORE_ORDER&resourceId=${order.id}`;
    expect(await req(path)).toMatchObject({
      payment: { amount_kobo: 100000, pricing_ready: false },
      checkoutEnabled: false,
    });
    await req(path, 404, "GET", undefined, owner);
    await req(path, 404, "GET", undefined, buyer, otherCampus);
  });
  it("schedules optional tutorial feedback only after completion, and allows a past customer to review with new sales paused", async () => {
    const application = crypto.randomUUID(),
      tutor = crypto.randomUUID(),
      listing = crypto.randomUUID(),
      booking = crypto.randomUUID();
    await pg.query(
      "insert into agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement)values($1,$2,$3,'TUTOR','Synthetic tutor','+2348012345678','Synthetic fixture only')",
      [application, owner, campus],
    );
    await pg.query(
      "insert into agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,verified_at)values($1,$2,$3,$4,'TUTOR','Synthetic tutor',now())",
      [tutor, owner, campus, application],
    );
    await pg.query(
      "insert into tutorial_listings(id,university_id,tutor_profile_id,course_code,title,description,format,price_kobo,capacity,status,review_status,reviewed_at,reviewed_by_user_id)values($1,$2,$3,'SYN101','Synthetic lesson','A synthetic lesson description','IN_PERSON',100000,10,'PUBLISHED','APPROVED',now(),$4)",
      [listing, campus, tutor, buyer],
    );
    await pg.query(
      "insert into tutorial_bookings(id,university_id,listing_id,student_user_id,status,amount_kobo)values($1,$2,$3,$4,'CONFIRMED',100000)",
      [booking, campus, listing, buyer],
    );
    await req("/student/tutorial-reviews", 403, "POST", {
      bookingId: booking,
      rating: 4,
    });
    expect(
      (
        await pg.query(
          "select * from app_private.purchase_review_reminders where resource_id=$1",
          [booking],
        )
      ).rows,
    ).toEqual([]);
    await pg.query(
      "update tutorial_bookings set status='COMPLETED',completed_at=now(),student_confirmed_at=now(),tutor_confirmed_at=now() where id=$1",
      [booking],
    );
    expect((await queueDuePurchaseReviews(env, buyer)).queued).toBe(0);
    await pg.query(
      "update app_private.purchase_review_reminders set due_at=now()-interval '1 minute' where resource_id=$1",
      [booking],
    );
    const prompt = (await req("/reminders")).reminders.find(
      (r: { resource_id: string }) => r.resource_id === booking,
    );
    expect(prompt).toMatchObject({
      resource_type: "TUTORIAL_BOOKING",
      path: "/purchases",
    });
    await req(
      "/student/tutorial-reviews",
      403,
      "POST",
      { bookingId: booking, rating: 4 },
      buyer,
      otherCampus,
    );
    await req(
      "/student/tutorial-reviews",
      403,
      "POST",
      { bookingId: booking, rating: 4 },
      owner,
    );
    await req("/student/tutorial-reviews", 201, "POST", {
      bookingId: booking,
      rating: 4,
    });
    expect(
      (
        await pg.query<{ state: string }>(
          "select state from app_private.purchase_review_reminders where resource_id=$1",
          [booking],
        )
      ).rows[0]?.state,
    ).toBe("REVIEWED");
    expect(
      (await req("/reminders")).reminders.some(
        (r: { resource_id: string }) => r.resource_id === booking,
      ),
    ).toBe(false);
  });
  it("locks a handoff after five incorrect attempts and never completes the order or prompts for a review", async () => {
    const order = await create();
    await ready(order.id);
    const code = (await deriveHandoffCode(env, order.id, "delivery")).code,
      wrong = code === "000000" ? "111111" : "000000";
    for (let attempt = 1; attempt <= 5; attempt++)
      await req(
        `/agents/orders/${order.id}/handoff`,
        attempt === 5 ? 429 : 400,
        "POST",
        { code: wrong },
        owner,
      );
    await req(
      `/agents/orders/${order.id}/handoff`,
      429,
      "POST",
      { code },
      owner,
    );
    expect((await req(`/student/orders/${order.id}`)).order.status).toBe(
      "READY",
    );
    expect(
      (
        await pg.query(
          "select * from app_private.purchase_review_reminders where resource_id=$1",
          [order.id],
        )
      ).rows,
    ).toEqual([]);
  });
});
