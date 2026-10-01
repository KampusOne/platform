import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { Hono, type Context, type Next } from "hono";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, testDatabaseAdapter } from "./helpers/database";
import { discoveryRoutes } from "../src/routes/discovery";
import { AppError } from "../src/lib/errors";
import type { Bindings } from "../src/types";
let db: PGlite;
vi.mock("../src/lib/database", () => ({
  database: () => testDatabaseAdapter(db),
  firstRow: (r: { rows: unknown[] }) => r.rows[0],
}));
vi.mock("../src/middleware/auth", () => ({
  currentUser: (c: Context) => ({
    id: c.req.header("x-user"),
    universityId: c.req.header("x-campus"),
    roles: ["STUDENT"],
  }),
  requireAuth: async (c: Context, n: Next) =>
    c.req.header("x-user") ? n() : c.json({ error: "Unauthorized" }, 401),
}));
const campus = crypto.randomUUID(),
  foreignCampus = crypto.randomUUID(),
  viewer = crypto.randomUUID(),
  author = crypto.randomUUID(),
  blocked = crypto.randomUUID(),
  outsider = crypto.randomUUID(),
  source = crypto.randomUUID(),
  foreignSource = crypto.randomUUID();
const ids = {
  primary: crypto.randomUUID(),
  media: crypto.randomUUID(),
  reply: crypto.randomUUID(),
  private: crypto.randomUUID(),
  public: crypto.randomUUID(),
  blocked: crypto.randomUUID(),
  archived: crypto.randomUUID(),
  future: crypto.randomUUID(),
};
const env = { UNIFIED_SCHEMA_READY: "true", ENVIRONMENT: "local" } as Bindings;
const app = new Hono().route("/discovery", discoveryRoutes);
app.onError((e, c) =>
  c.json({ error: e.message }, e instanceof AppError ? e.status : 500),
);
function request(parameters: Record<string, string>, actor = viewer) {
  return app.request(
    "/discovery/search?" + new URLSearchParams(parameters),
    { headers: { "x-user": actor, "x-campus": campus } },
    env,
  );
}
async function result(
  params: Record<string, string> = { q: "campusmath", tab: "LATEST" },
) {
  const response = await request(params),
    data = (await response.json()) as {
      results: Array<{
        id: string;
        kind: string;
        post?: { quoted_post?: unknown };
      }>;
      nextCursor: string | null;
      tab: string;
    };
  expect({
    status: response.status,
    ...(response.status === 200 ? {} : { data }),
  }).toEqual({ status: 200 });
  return data;
}
beforeAll(async () => {
  db = await createTestDatabase();
  await db.exec(
    readFileSync(
      new URL(
        "../../database/neon/migrations/20261001000000_discovery_search_indexes.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const id of [campus, foreignCampus])
    await db.query(
      "insert into universities(id,name,slug,updated_at)values($1,'Synthetic campus '||$1::uuid::text,$1::uuid::text,now())",
      [id],
    );
  for (const [user, name, username, uni] of [
    [viewer, "Viewer Student", "viewer_synthetic", campus],
    [author, "Synthetic Calculus Tutor", "tutor_synthetic", campus],
    [blocked, "Blocked Person", "blocked_synthetic", campus],
    [outsider, "Other Campus Author", "foreign_synthetic", foreignCampus],
  ]) {
    await db.query(
      "insert into users(id,email,password_hash,updated_at)values($1,$1::uuid::text||'@example.invalid','synthetic-only',now())",
      [user],
    );
    await db.query(
      "insert into profiles(id,user_id,display_name,username,university_id,updated_at)values($1,$1,$2,$3,$4,now())",
      [user, name, username, uni],
    );
  }
  for (const [id, uni] of [
    [source, campus],
    [foreignSource, foreignCampus],
  ])
    await db.query(
      "insert into content_sources(id,university_id,name)values($1,$2,$1::uuid::text)",
      [id, uni],
    );
  await db.query(
    "insert into user_blocks(blocker_id,blocked_id)values($1,$2)",
    [blocked, viewer],
  );
  for (const [key, uni, who, at, visibility, language, image, status] of [
    [
      "primary",
      campus,
      author,
      "2026-09-27T14:00:00Z",
      "CAMPUS",
      "en",
      null,
      "PUBLISHED",
    ],
    [
      "media",
      campus,
      author,
      "2026-09-28T14:00:00Z",
      "CAMPUS",
      "pcm",
      "https://example.invalid/synthetic.jpg",
      "PUBLISHED",
    ],
    [
      "private",
      foreignCampus,
      outsider,
      "2026-09-29T14:00:00Z",
      "CAMPUS",
      "en",
      null,
      "PUBLISHED",
    ],
    [
      "public",
      foreignCampus,
      outsider,
      "2026-09-29T13:00:00Z",
      "PUBLIC",
      "en",
      null,
      "PUBLISHED",
    ],
    [
      "blocked",
      campus,
      blocked,
      "2026-09-29T12:00:00Z",
      "PUBLIC",
      "en",
      null,
      "PUBLISHED",
    ],
    [
      "archived",
      campus,
      author,
      "2026-09-29T11:00:00Z",
      "CAMPUS",
      "en",
      null,
      "ARCHIVED",
    ],
    [
      "future",
      campus,
      author,
      "2099-09-29T11:00:00Z",
      "CAMPUS",
      "en",
      null,
      "PUBLISHED",
    ],
  ] as const)
    await db.query(
      "insert into feed_posts(id,university_id,source_id,author_user_id,category,title,summary,body,published_at,audience,image_url,status)values($1,$2,$3,$4,'UPDATE','Campusmath study','Campusmath study','Campusmath study guide', $5,jsonb_build_object('studentPost',true,'visibility',$6::text,'language',$7::text),$8,$9)",
      [
        ids[key],
        uni,
        uni === campus ? source : foreignSource,
        who,
        at,
        visibility,
        language,
        image,
        status,
      ],
    );
  await db.query(
    "insert into feed_comments(id,client_request_id,post_id,institution_id,author_user_id,body,created_at)values($1,$1,$2,$3,$4,'Campusmath answer and discussion','2026-09-29T14:00:00Z')",
    [ids.reply, ids.primary, campus, author],
  );
  await db.query(
    "insert into feed_likes(post_id,user_id,institution_id)values($1,$2,$3)",
    [ids.primary, viewer, campus],
  );
  await db.query(
    "insert into feed_comment_likes(comment_id,user_id,institution_id)values($1,$2,$3)",
    [ids.reply, viewer, campus],
  );
  await db.query(
    "insert into profile_follows(follower_id,followed_id)values($1,$2)",
    [viewer, author],
  );
  await db.query(
    "insert into feed_comments(client_request_id,post_id,institution_id,author_user_id,body,parent_comment_id)values(gen_random_uuid(),$1,$2,$3,'Synthetic response',$4)",
    [ids.primary, campus, viewer, ids.reply],
  );
  await db.query(
    "insert into feed_reposts(post_id,user_id,institution_id)values($1,$2,$3)",
    [ids.primary, viewer, campus],
  );
}, 30000);
afterAll(() => db?.close());
describe("visible feed discovery", () => {
  it("searches visible post text and replies while excluding blocked, private, archived and future records", async () => {
    const page = await result();
    expect(page.results.map((r) => r.id)).toEqual([
      ids.reply,
      ids.public,
      ids.media,
      ids.primary,
    ]);
    const excluded = await result({
      q: "campusmath",
      tab: "LATEST",
      excludeReplies: "true",
    });
    expect(excluded.results.map((r) => r.id)).toEqual([
      ids.public,
      ids.media,
      ids.primary,
    ]);
  });
  it("forces leading @ to people and supports name/username keywords without treating underscores as wildcards", async () => {
    const usernames = await result({ q: "@tutor_", tab: "TOP" });
    expect(usernames.tab).toBe("PEOPLE");
    expect(usernames.results.map((r) => r.id)).toEqual([author]);
    const names = await result({ q: "Calculus", tab: "PEOPLE" });
    expect(names.results.map((r) => r.id)).toEqual([author]);
    expect(
      (await result({ q: "@blocked_", tab: "PEOPLE" })).results,
    ).toHaveLength(0);
    expect(
      (await result({ q: "@tutor%s", tab: "PEOPLE" })).results,
    ).toHaveLength(0);
  });
  it("actually filters media, author, inclusive dates, declared language and combined constraints", async () => {
    expect(
      (await result({ q: "campusmath", tab: "MEDIA" })).results.map(
        (r) => r.id,
      ),
    ).toEqual([ids.media]);
    expect(
      (
        await result({
          q: "campusmath",
          tab: "LATEST",
          from: "@tutor_synthetic",
          since: "2026-09-28",
          until: "2026-09-28",
          language: "pcm",
        })
      ).results.map((r) => r.id),
    ).toEqual([ids.media]);
    expect(
      (
        await result({ q: "campusmath", tab: "LATEST", language: "und" })
      ).results.map((r) => r.id),
    ).toEqual([ids.reply]);
    expect(
      (await result({ q: "campusmath", tab: "LATEST", language: "yo" }))
        .results,
    ).toHaveLength(0);
    expect(
      (
        await request({
          q: "campusmath",
          since: "2026-09-30",
          until: "2026-09-20",
        })
      ).status,
    ).toBe(400);
  });
  it("applies each personal activity filter to the corresponding real relationship", async () => {
    expect(
      (
        await result({ q: "campusmath", tab: "LATEST", activity: "LIKED" })
      ).results.map((r) => r.id),
    ).toEqual([ids.reply, ids.primary]);
    expect(
      (
        await result({ q: "campusmath", tab: "LATEST", activity: "FOLLOWING" })
      ).results.map((r) => r.id),
    ).toEqual([ids.reply, ids.media, ids.primary]);
    expect(
      (
        await result({ q: "campusmath", tab: "LATEST", activity: "REPLIED" })
      ).results.map((r) => r.id),
    ).toEqual([ids.reply, ids.primary]);
    expect(
      (
        await result({ q: "campusmath", tab: "LATEST", activity: "REPOSTED" })
      ).results.map((r) => r.id),
    ).toEqual([ids.primary]);
  });
  it("paginates tied post results without duplicates and rejects cursors reused with changed filters", async () => {
    for (let i = 0; i < 35; i++)
      await db.query(
        "insert into feed_posts(university_id,source_id,author_user_id,category,title,summary,body,published_at,audience,status)values($1,$2,$3,'UPDATE','Paginateword','Paginateword','Paginateword','2026-09-24T12:00:00Z','{\"studentPost\":true}'::jsonb,'PUBLISHED')",
        [campus, source, author],
      );
    const first = await result({ q: "paginateword", tab: "TOP" });
    expect(first.results).toHaveLength(30);
    expect(first.nextCursor).toBeTruthy();
    const second = await result({
      q: "paginateword",
      tab: "TOP",
      cursor: first.nextCursor!,
    });
    expect(second.results).toHaveLength(5);
    expect(
      new Set([...first.results, ...second.results].map((r) => r.id)).size,
    ).toBe(35);
    expect(
      (
        await request({
          q: "paginateword",
          tab: "LATEST",
          cursor: first.nextCursor!,
        })
      ).status,
    ).toBe(400);
    expect(
      (await request({ q: "paginateword", cursor: "not-a-page" })).status,
    ).toBe(400);
  });
});
