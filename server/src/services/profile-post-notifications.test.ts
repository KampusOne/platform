import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Bindings } from "../types";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../lib/database", () => ({
  database: () => ({ execute: mocks.execute }),
  firstRow: (result: { rows: unknown[] }) => result.rows[0],
}));

import { notifyProfilePostPublished } from "./profile-post-notifications";

const dialect = new PgDialect();
const query = (index: number) => dialect.sqlToQuery(mocks.execute.mock.calls[index]![0]);
const env = { UNIFIED_SCHEMA_READY: "true" } as Bindings;
const postId = "33333333-3333-4333-8333-333333333333";
const authorId = "44444444-4444-4444-8444-444444444444";

beforeEach(() => mocks.execute.mockReset());

describe("profile post push enqueue", () => {
  it("queues one deduped push per eligible subscriber and excludes blocked relationships", async () => {
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ ready: true }] })
      .mockResolvedValueOnce({
        rows: [{
          id: postId,
          author_user_id: authorId,
          university_id: "22222222-2222-4222-8222-222222222222",
          author_name: "Poster",
          post_body: "New campus update",
          visibility: "PUBLIC",
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    await notifyProfilePostPublished(env, postId, authorId);

    expect(query(2).sql).toContain("profile_post_notification_subscriptions");
    expect(query(2).sql).toContain("public.user_blocks");
    expect(query(2).sql).toContain("public.in_app_notifications");
    expect(query(2).sql).toContain("app_private.notification_outbox");
    expect(query(2).sql).toContain("on conflict(dedupe_key) do nothing");
    expect(query(2).params).toContain(postId);
    expect(query(2).params).toContain(authorId);
  });
});
