import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { Hono, type Context, type Next } from "hono";
import type { PGlite } from "@electric-sql/pglite";
import { calendarRoutes } from "../src/routes/calendar";
import { AppError } from "../src/lib/errors";
import {
  createTestDatabase,
  testDatabaseAdapter,
  testSqlClient,
} from "./helpers/database";

let db: PGlite;
const owner = crypto.randomUUID();
const other = crypto.randomUUID();
const campus = crypto.randomUUID();

vi.mock("../src/lib/database", () => ({
  database: () => testDatabaseAdapter(db),
  sqlClient: () => testSqlClient(db),
  firstRow: (result: { rows: unknown[] }) => result.rows[0],
}));
vi.mock("../src/middleware/auth", () => ({
  requireAuth: async (_c: Context, next: Next) => next(),
  currentUser: (c: Context) => ({
    id: c.req.header("x-user"),
    universityId: campus,
    roles: ["STUDENT"],
  }),
}));

const app = new Hono().route("/calendar", calendarRoutes);
app.onError((error, c) =>
  c.json(
    { error: error.message },
    error instanceof AppError ? error.status : 500,
  ),
);
const request = (
  path: string,
  method = "GET",
  body?: unknown,
  user = owner,
) =>
  app.request("/calendar" + path, {
    method,
    headers: { "x-user": user, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    "insert into universities(id,name,slug,updated_at) values($1::uuid,'Calendar campus',$1::uuid::text,now())",
    [campus],
  );
  for (const userId of [owner, other])
    await db.query(
      "insert into users(id,email,password_hash,updated_at) values($1::uuid,$1::uuid::text||'@example.invalid','test-only',now())",
      [userId],
    );
}, 60000);

afterAll(async () => db?.close());

describe("private calendar imports", () => {
  it("saves date ranges once across concurrent retries and keeps hourly classes empty", async () => {
    const data = {
      requestId: crypto.randomUUID(),
      events: [
        {
          title: "First-semester lectures",
          startsOn: "2026-01-19",
          endsOn: "2026-03-13",
          semester: "First semester",
        },
        {
          title: "Second-semester lectures",
          startsOn: "2026-07-06",
          endsOn: "2026-08-21",
          semester: "Second semester",
        },
      ],
    };
    const responses = await Promise.all([
      request("/import", "POST", data),
      request("/import", "POST", data),
    ]);
    for (const response of responses)
      expect([200, 201]).toContain(response.status);

    const saved = await (await request("")).json();
    expect(saved.events).toHaveLength(2);
    expect((await db.query("select id from timetable_entries")).rows).toHaveLength(
      0,
    );
    expect(
      (await (await request("", "GET", undefined, other)).json()).events,
    ).toEqual([]);

    expect(
      (
        await request("/import", "POST", {
          ...data,
          events: [{ ...data.events[0], title: "Changed" }],
        })
      ).status,
    ).toBe(409);

    await request("/" + saved.events[0].id, "DELETE", undefined, other);
    expect((await (await request("")).json()).events).toHaveLength(2);
  });

  it("lets the owner add, edit and remove a personal date", async () => {
    const requestId = crypto.randomUUID();
    const event = {
      title: "Project defence",
      startsOn: "2026-10-12",
      endsOn: "2026-10-12",
      semester: "Personal",
    };

    const created = await request("", "POST", { requestId, event });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.event.title).toBe("Project defence");

    const retry = await request("", "POST", { requestId, event });
    expect(retry.status).toBe(200);
    expect((await retry.json()).event.id).toBe(createdBody.event.id);

    const changedRetry = await request("", "POST", {
      requestId,
      event: { ...event, title: "Different request body" },
    });
    expect(changedRetry.status).toBe(409);

    const otherEdit = await request(
      "/" + createdBody.event.id,
      "PATCH",
      {
        event: {
          ...event,
          title: "Someone else's edit",
        },
      },
      other,
    );
    expect(otherEdit.status).toBe(404);

    const edited = await request("/" + createdBody.event.id, "PATCH", {
      event: {
        ...event,
        title: "Final project defence",
        semester: "Second semester",
      },
    });
    expect(edited.status).toBe(200);
    expect((await edited.json()).event.title).toBe("Final project defence");

    await request("/" + createdBody.event.id, "DELETE", undefined, other);
    const afterOtherDelete = await (await request("")).json();
    expect(
      afterOtherDelete.events.some(
        (row: { id: string }) => row.id === createdBody.event.id,
      ),
    ).toBe(true);

    await request("/" + createdBody.event.id, "DELETE");
    const afterOwnerDelete = await (await request("")).json();
    expect(
      afterOwnerDelete.events.some(
        (row: { id: string }) => row.id === createdBody.event.id,
      ),
    ).toBe(false);
  });

  it("rejects invalid dates before database writes", async () => {
    expect(
      (
        await request("/import", "POST", {
          requestId: crypto.randomUUID(),
          events: [
            {
              title: "Exam",
              startsOn: "2026-02-30",
              endsOn: "2026-03-01",
              semester: "",
            },
          ],
        })
      ).status,
    ).toBe(400);

    expect(
      (
        await request("", "POST", {
          requestId: crypto.randomUUID(),
          event: {
            title: "Bad date",
            startsOn: "2026-04-31",
            endsOn: "2026-05-01",
            semester: "",
          },
        })
      ).status,
    ).toBe(400);
  });
});
