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
  order = crypto.randomUUID(),
  product = crypto.randomUUID();
const env = { PHASE_3_SCHEMA_READY: "true", STORE_ENABLED: "true" } as Bindings;
const app = new Hono().route("/agents", agentRoutes);
app.onError((e, c) =>
  c.json({ error: e.message }, e instanceof AppError ? e.status : 500),
);
async function request(
  path: string,
  expected = 200,
  method = "GET",
  body?: unknown,
  user = owner,
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
beforeAll(async () => {
  pg = await createTestDatabase();
  await pg.exec(
    readFileSync(
      new URL(
        "../../database/neon/migrations/20260912200000_phase_3_commerce_foundation.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const id of [campus, otherCampus])
    await pg.query(
      "insert into universities(id,name,slug,updated_at)values($1,'Synthetic campus '||$1::uuid::text,$1::uuid::text,now())",
      [id],
    );
  for (const id of [owner, buyer])
    await pg.query(
      "insert into users(id,email,password_hash,updated_at)values($1,$1::uuid::text||'@example.invalid','synthetic',now())",
      [id],
    );
  const application = crypto.randomUUID();
  await pg.query(
    "insert into agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement)values($1,$2,$3,'VENDOR','Synthetic shop','+2348012345678','Synthetic fixture only')",
    [application, owner, campus],
  );
  await pg.query(
    "insert into agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,verified_at)values($1,$2,$3,$4,'VENDOR','Synthetic shop',now())",
    [vendor, owner, campus, application],
  );
  await pg.query(
    "insert into vendor_storefronts(vendor_profile_id,university_id,display_name,description,status,submitted_at,reviewed_by_user_id,reviewed_at,moderated_revision,contact_phone_e164,pickup_location,opening_hours)values($1,$2,'Synthetic shop','A synthetic store description','APPROVED',now(),$3,now(),1,'+2348012345678','Campus gate','{\"mon\":{\"opens\":\"08:00\",\"closes\":\"17:00\"}}'::jsonb)",
    [vendor, campus, buyer],
  );
  await pg.query(
    "insert into vendor_products(id,university_id,vendor_profile_id,name,description,category,price_kobo,stock_quantity)values($1,$2,$3,'Book','A synthetic product description','Books',100000,3)",
    [product, campus, vendor],
  );
  await pg.query(
    "insert into orders(id,university_id,buyer_user_id,vendor_profile_id,status,subtotal_kobo)values($1,$2,$3,$4,'PAID',100000)",
    [order, campus, buyer, vendor],
  );
  await pg.query(
    "insert into order_items(order_id,product_id,quantity,unit_price_kobo)values($1,$2,1,100000)",
    [order, product],
  );
}, 60000);
afterAll(async () => {
  await pg?.close();
});
describe("seller order workspace", () => {
  it("lists and reads only the owner's current-campus orders", async () => {
    expect(
      (await request("/agents/orders")).orders.map(
        (item: { id: string }) => item.id,
      ),
    ).toEqual([order]);
    expect(
      (
        await request(
          "/agents/orders",
          200,
          "GET",
          undefined,
          owner,
          otherCampus,
        )
      ).orders,
    ).toEqual([]);
    await request(`/agents/orders/${order}`, 404, "GET", undefined, buyer);
    await request(
      `/agents/orders/${order}`,
      404,
      "GET",
      undefined,
      owner,
      otherCampus,
    );
    expect((await request(`/agents/orders/${order}`)).items).toMatchObject([
      { name: "Book", quantity: 1, unit_price_kobo: 100000 },
    ]);
    await request("/agents/orders/not-an-id", 400);
  });
  it("enforces staged state transitions and rechecks approval for mutations", async () => {
    await request(`/agents/orders/${order}/status`, 409, "PATCH", {
      status: "READY",
    });
    await request(
      `/agents/orders/${order}/status`,
      404,
      "PATCH",
      { status: "ACCEPTED" },
      owner,
      otherCampus,
    );
    await request(
      `/agents/orders/${order}/status`,
      404,
      "PATCH",
      { status: "ACCEPTED" },
      buyer,
    );
    await request(`/agents/orders/${order}/status`, 200, "PATCH", {
      status: "ACCEPTED",
    });
    await pg.query(
      "update vendor_storefronts set status='SUSPENDED',review_note='Synthetic review hold' where vendor_profile_id=$1",
      [vendor],
    );
    await request(`/agents/orders/${order}/status`, 404, "PATCH", {
      status: "READY",
    });
    await request(`/agents/orders/${order}`);
    await pg.query(
      "update vendor_storefronts set status='APPROVED' where vendor_profile_id=$1",
      [vendor],
    );
    await request(`/agents/orders/${order}/status`, 200, "PATCH", {
      status: "READY",
    });
    await request(`/agents/orders/${order}/status`, 409, "PATCH", {
      status: "READY",
    });
    expect(
      (await request(`/agents/orders/${order}`)).timeline.map(
        (event: { status: string }) => event.status,
      ),
    ).toEqual(["PAID", "ACCEPTED", "READY"]);
  });
});
