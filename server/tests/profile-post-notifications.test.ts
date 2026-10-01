import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, testDatabaseAdapter } from "./helpers/database";
import type { Bindings } from "../src/types";

let db: PGlite;
vi.mock("../src/lib/database", () => ({
  database: () => testDatabaseAdapter(db),
  firstRow: (result: { rows: unknown[] }) => result.rows[0],
}));

import { notifyProfilePostPublished } from "../src/services/profile-post-notifications";

const school = "25000000-0000-4000-8000-000000000001";
const otherSchool = "25000000-0000-4000-8000-000000000002";
const newsletter = "25000000-0000-4000-8000-000000000010";
const sameCampus = "25000000-0000-4000-8000-000000000011";
const otherCampus = "25000000-0000-4000-8000-000000000012";
const postId = "25000000-0000-4000-8000-000000000020";
const sourceId = "25000000-0000-4000-8000-000000000030";

const env: Bindings = {
  ENVIRONMENT: "local",
  ALLOWED_ORIGINS: "https://app.example.invalid",
  MINIMUM_APP_VERSION: "0.3.9",
  MAINTENANCE_MODE: "false",
  ACADEMIC_CORE_ENABLED: "true",
  SOCIAL_FEED_ENABLED: "true",
  MARKETPLACE_ENABLED: "false",
  PAYMENTS_ENABLED: "false",
  AI_ASSISTANT_ENABLED: "false",
  UNIFIED_SCHEMA_READY: "true",
};

beforeAll(async () => {
  db = await createTestDatabase();
  await db.exec(
    readFileSync(
      new URL(
        "../../database/neon/migrations/20261001020000_admin_workspace_extensions.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.query(
    "insert into public.universities(id,name,slug,updated_at) values($1,'Newsletter School','newsletter-school',now()),($2,'Other School','other-school',now())",
    [school, otherSchool],
  );
  for (const [id, email, username, name, university] of [
    [
      newsletter,
      "newsletter@example.invalid",
      "kampusonenewsletter",
      "KampusOne Newsletter",
      school,
    ],
    [sameCampus, "same@example.invalid", "same", "Same Campus", school],
    [
      otherCampus,
      "other@example.invalid",
      "other",
      "Other Campus",
      otherSchool,
    ],
  ] as const) {
    await db.query(
      "insert into public.users(id,email,password_hash,updated_at) values($1,$2,'test-only',now())",
      [id, email],
    );
    await db.query(
      "insert into public.profiles(id,user_id,username,display_name,university_id,updated_at) values(gen_random_uuid(),$1,$2,$3,$4,now())",
      [id, username, name, university],
    );
  }
  await db.query(
    "insert into public.content_sources(id,university_id,name,owner_user_id,verified) values($1,$2,'student:newsletter',$3,true)",
    [sourceId, school, newsletter],
  );
});

afterAll(async () => {
  await db?.close();
});

describe("profile post notification fan-out", () => {
  it("never grants notify-all authority through an editable display name or username", async () => {
    const ordinary = crypto.randomUUID();
    await db.query(
      `insert into public.feed_posts(id,university_id,source_id,author_user_id,category,title,summary,body,audience,status,published_at)values($1,$2,$3,$4,'UPDATE','Unassigned update','Unassigned update','Ordinary post','{"studentPost":true,"visibility":"PUBLIC"}','PUBLISHED',now())`,
      [ordinary, school, sourceId, newsletter],
    );
    await notifyProfilePostPublished(env, ordinary);
    expect(
      (
        await db.query(
          "select id from public.in_app_notifications where path=$1",
          [`/post?id=${ordinary}`],
        )
      ).rows,
    ).toHaveLength(0);
    await db.query(
      "insert into app_private.managed_publishers(user_id,institution_id,all_universities,reviewed_by,reason,daily_limit)values($1,$2,true,$1,'Reviewed platform newsletter',1)",
      [newsletter, school],
    );
    await notifyProfilePostPublished(env, ordinary);
    expect(
      (
        await db.query(
          "select id from public.in_app_notifications where path=$1",
          [`/post?id=${ordinary}`],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("notifies every eligible account once for a reviewed platform publisher", async () => {
    await db.query(
      `insert into public.feed_posts(
        id,university_id,source_id,author_user_id,category,title,summary,body,audience,status,published_at
      ) values(
        $1,$2,$3,$4,'UPDATE','A new KampusOne update','A new KampusOne update',
        'Here is the latest from KampusOne.',
        '{"studentPost":true,"visibility":"PUBLIC"}'::jsonb,'PUBLISHED',now()
      )`,
      [postId, school, sourceId, newsletter],
    );

    await notifyProfilePostPublished(env, postId);
    await notifyProfilePostPublished(env, postId);

    const inbox = await db.query<{
      user_id: string;
      title: string;
      path: string;
      actor_user_id: string;
      dedupe_key: string;
    }>(
      "select user_id,title,path,actor_user_id,dedupe_key from public.in_app_notifications where dedupe_key like $1 order by user_id",
      [`managed-profile-post:${postId}:%`],
    );
    expect(inbox.rows.map((row) => row.user_id)).toEqual(
      [sameCampus, otherCampus].sort(),
    );
    expect(
      inbox.rows.every((row) => row.title === "KampusOne Newsletter posted"),
    ).toBe(true);
    expect(inbox.rows.every((row) => row.path === `/post?id=${postId}`)).toBe(
      true,
    );
    expect(inbox.rows.every((row) => row.actor_user_id === newsletter)).toBe(
      true,
    );

    const push = await db.query<{ user_id: string; dedupe_key: string }>(
      "select user_id,dedupe_key from app_private.notification_outbox where channel='PUSH' and dedupe_key like $1 order by user_id",
      [`managed-profile-post:${postId}:%`],
    );
    expect(push.rows.map((row) => row.user_id)).toEqual(
      [sameCampus, otherCampus].sort(),
    );
    expect(new Set(push.rows.map((row) => row.dedupe_key)).size).toBe(2);
  });
  it("enforces the daily limit without charging retries twice", async () => {
    const next = crypto.randomUUID();
    await db.query(
      `insert into public.feed_posts(id,university_id,source_id,author_user_id,category,title,summary,body,audience,status,published_at)values($1,$2,$3,$4,'UPDATE','Over limit','Over limit','Over limit','{"studentPost":true,"visibility":"PUBLIC"}','PUBLISHED',now())`,
      [next, school, sourceId, newsletter],
    );
    await notifyProfilePostPublished(env, next);
    expect(
      (
        await db.query(
          "select post_id from app_private.managed_publisher_posts where user_id=$1",
          [newsletter],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "select id from public.in_app_notifications where path=$1",
          [`/post?id=${next}`],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("restricts a campus publisher to campus recipients and respects blocks", async () => {
    await db.query(
      "update app_private.managed_publishers set all_universities=false,daily_limit=3,updated_at=now()where user_id=$1",
      [newsletter],
    );
    const next = crypto.randomUUID();
    await db.query(
      `insert into public.feed_posts(id,university_id,source_id,author_user_id,category,title,summary,body,audience,status,published_at)values($1,$2,$3,$4,'UPDATE','Campus update','Campus update','Campus only','{"studentPost":true,"visibility":"PUBLIC"}','PUBLISHED',now())`,
      [next, school, sourceId, newsletter],
    );
    await db.query(
      "insert into public.user_blocks(blocker_id,blocked_id,reason)values($1,$2,'Muted publisher')",
      [sameCampus, newsletter],
    );
    await notifyProfilePostPublished(env, next);
    expect(
      (
        await db.query(
          "select id from public.in_app_notifications where path=$1",
          [`/post?id=${next}`],
        )
      ).rows,
    ).toHaveLength(0);
    await db.query(
      "delete from public.user_blocks where blocker_id=$1 and blocked_id=$2",
      [sameCampus, newsletter],
    );
    await notifyProfilePostPublished(env, next);
    expect(
      (
        await db.query<{ user_id: string }>(
          "select user_id from public.in_app_notifications where path=$1",
          [`/post?id=${next}`],
        )
      ).rows.map((r) => r.user_id),
    ).toEqual([sameCampus]);
  });
});
