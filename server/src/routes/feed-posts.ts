import { sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { AppError } from "../lib/errors";
import { input, id as recordId } from "../lib/input";
import { sha256 } from "../lib/security";
import { feedCursor, feedFields, nextFeedCursor, visiblePost } from "../lib/feed-data";
import { currentUser, requireAuth } from "../middleware/auth";
import type { Bindings, Variables } from "../types";

type FeedContext = Context<{ Bindings: Bindings; Variables: Variables }>;
export const feedPostRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const pageSize = 30;
const categorySchema = z.enum(["UPDATE", "EVENT", "SPORTS", "OPPORTUNITY", "EMERGENCY"]);
feedPostRoutes.use("*", requireAuth);
feedPostRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  await next();
});

function campus(c: FeedContext) {
  const value = currentUser(c).universityId;
  if (!value) throw new AppError(409, "CONFLICT", "Complete your student profile to use campus posts.", { onboardingRequired: true });
  return value;
}
function writable(c: FeedContext) {
  campus(c);
  if (c.env.UNIFIED_SCHEMA_READY !== "true") throw new AppError(503, "PROVIDER_UNAVAILABLE", "Posting is being connected. Try again shortly.");
}
function unavailable(): never {
  throw new AppError(404, "NOT_FOUND", "This post is unavailable or you do not have access to it.");
}
async function rateLimit(c: FeedContext, action: string, limit: number) {
  const row = firstRow(await database(c.env).execute<{ allowed: boolean }>(sql`
    select app_private.consume_request_rate_limit(${action}, ${await sha256(currentUser(c).id)}, ${limit}, 3600, 3600) as allowed
  `));
  if (!row?.allowed) throw new AppError(429, "RATE_LIMITED", "Please wait before trying this action again.");
}
async function readable(c: FeedContext, id: string) {
  campus(c);
  const result = await database(c.env).execute(sql`
    select ${feedFields(currentUser(c))}
    from public.feed_posts posts
    join public.content_sources sources on sources.id = posts.source_id
    left join public.profiles author on author.user_id = posts.author_user_id and author.deleted_at is null
    where posts.id = ${id}::uuid and ${visiblePost("posts", currentUser(c))} limit 1
  `);
  return firstRow(result) ?? unavailable();
}

// This module is mounted ahead of legacy student routes. It owns all feed paths.
feedPostRoutes.get("/", async (c) => {
  campus(c);
  const user = currentUser(c);
  const cursor = feedCursor(c.req.query("cursor"));
  const rawCategory = c.req.query("category")?.toUpperCase();
  const category = rawCategory ? categorySchema.safeParse(rawCategory) : null;
  if (category && !category.success) throw new AppError(400, "BAD_REQUEST", "Choose a valid post category.");
  const query = c.req.query("q")?.trim() ?? "";
  if (query.length > 160) throw new AppError(400, "BAD_REQUEST", "Use a shorter search.");
  const needle = query ? `%${query}%` : null;
  const activity = sql`greatest(posts.published_at, latest.created_at)`;
  const result = await database(c.env).execute(sql`
    select ${feedFields(user)}, ${activity} as activity_at, (${activity})::text as cursor_at,
      latest.display_name as reposted_by
    from public.feed_posts posts
    join public.content_sources sources on sources.id = posts.source_id
    left join public.profiles author on author.user_id = posts.author_user_id and author.deleted_at is null
    left join lateral (
      select r.created_at, coalesce(rp.display_name, 'A student') as display_name
      from public.feed_reposts r
      left join public.profiles rp on rp.user_id = r.user_id and rp.deleted_at is null
      where r.post_id = posts.id order by r.created_at desc, r.user_id desc limit 1
    ) latest on true
    where ${visiblePost("posts", user)}
      and (${category?.success ? category.data : null}::text is null or posts.category = ${category?.success ? category.data : null})
      and (${needle}::text is null or posts.body ilike ${needle} or posts.title ilike ${needle} or author.display_name ilike ${needle} or sources.name ilike ${needle})
      and (${cursor?.at ?? null}::timestamptz is null or (${activity}, posts.id) < (${cursor?.at ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    order by ${activity} desc, posts.id desc limit ${pageSize + 1}
  `);
  return c.json({ posts: result.rows.slice(0, pageSize), nextCursor: nextFeedCursor(result.rows, pageSize) });
});

feedPostRoutes.get("/:id", async (c) => c.json({ post: await readable(c, recordId(c.req.param("id"))) }));

feedPostRoutes.post("/", async (c) => {
  writable(c);
  const user = currentUser(c);
  const universityId = campus(c);
  const data = await input(c, z.object({
    body: z.string().trim().min(1).max(5000), mediaId: z.string().uuid().optional(),
    requestId: z.string().uuid(), quotePostId: z.string().uuid().optional(),
  }).strict());
  const imageUrl = data.mediaId ? `${(c.env.PUBLIC_API_ORIGIN ?? new URL(c.req.url).origin).replace(/\/$/, "")}/v1/media/${data.mediaId}` : null;
  const previous = firstRow(await database(c.env).execute(sql`
    select id, body, image_url, quoted_post_id, status from public.feed_posts
    where author_user_id = ${user.id}::uuid and client_request_id = ${data.requestId}::uuid limit 1
  `));
  if (previous) {
    if (previous.body !== data.body || previous.image_url !== imageUrl || previous.quoted_post_id !== (data.quotePostId ?? null) || !["PUBLISHED", "CORRECTED"].includes(String(previous.status))) {
      throw new AppError(409, "CONFLICT", "This posting request was already used. Start a new post.");
    }
    return c.json({ id: previous.id }, 200);
  }
  await rateLimit(c, "STUDENT_POST", 10);
  if (data.mediaId && !firstRow(await database(c.env).execute(sql`
    select id from public.media_objects where id = ${data.mediaId}::uuid and owner_user_id = ${user.id}::uuid and kind = 'post' and deleted_at is null
  `))) throw new AppError(400, "BAD_REQUEST", "Choose an image from your device.");
  // A code-point slice plus padding preserves legacy 4-character title checks,
  // while allowing a student's actual body to be a single word or emoji.
  const title = Array.from(data.body).slice(0, 180).join("").padEnd(4, " ");
  const summary = Array.from(data.body).slice(0, 500).join("").padEnd(4, " ");
  const result = await database(c.env).execute(sql`
    with target as materialized (
      select posts.id, posts.audience from public.feed_posts posts
      where posts.id = ${data.quotePostId ?? null}::uuid and ${visiblePost("posts", user)} for share
    ), source as (
      insert into public.content_sources(university_id, name, owner_user_id)
      values (${universityId}::uuid, ${"student:" + user.id}, ${user.id}::uuid)
      on conflict(university_id, name) do update set owner_user_id = excluded.owner_user_id returning id
    )
    insert into public.feed_posts(university_id, source_id, author_user_id, category, title, summary, body, image_url, audience, status, published_at, client_request_id, quoted_post_id)
    select ${universityId}::uuid, source.id, ${user.id}::uuid, 'UPDATE', ${title}, ${summary}, ${data.body}, ${imageUrl},
      jsonb_build_object('studentPost', true, 'quote', ${Boolean(data.quotePostId)}::boolean,
        'visibility', case when ${data.quotePostId ?? null}::uuid is null or exists(select 1 from target where audience->>'studentPost' = 'true' and audience->>'visibility' = 'GLOBAL') then 'GLOBAL' else 'CAMPUS' end),
      'PUBLISHED', now(), ${data.requestId}::uuid, ${data.quotePostId ?? null}::uuid
    from source where ${data.quotePostId ?? null}::uuid is null or exists(select 1 from target)
    on conflict(author_user_id, client_request_id) where client_request_id is not null
    do update set client_request_id = excluded.client_request_id
      where feed_posts.body = excluded.body and feed_posts.image_url is not distinct from excluded.image_url
        and feed_posts.quoted_post_id is not distinct from excluded.quoted_post_id and feed_posts.status in ('PUBLISHED', 'CORRECTED')
    returning id
  `);
  const post = firstRow(result);
  if (!post) unavailable();
  return c.json({ id: post.id }, 201);
});

feedPostRoutes.delete("/:id", async (c) => {
  const user = currentUser(c);
  const id = recordId(c.req.param("id"));
  // Ownership is sufficient even when the author has since changed universities.
  const result = await database(c.env).execute(sql`
    with removed as (
      update public.feed_posts set updated_at = case when status = 'ARCHIVED' then updated_at else now() end, status = 'ARCHIVED'
      where id = ${id}::uuid and author_user_id = ${user.id}::uuid returning id
    ), removed_bookmarks as (
      delete from public.feed_bookmarks where post_id in (select id from removed)
    ), removed_reposts as (
      delete from public.feed_reposts where post_id in (select id from removed)
    ) select id from removed
  `);
  if (!firstRow(result)) unavailable();
  return c.json({ id, deleted: true });
});

feedPostRoutes.put("/:id/bookmark", async (c) => {
  const id = recordId(c.req.param("id"));
  const user = currentUser(c);
  campus(c);
  const result = await database(c.env).execute(sql`
    with parent as materialized (select posts.id from public.feed_posts posts where posts.id = ${id}::uuid and ${visiblePost("posts", user)} for share)
    insert into public.feed_bookmarks(user_id, post_id) select ${user.id}::uuid, id from parent
    on conflict(user_id, post_id) do update set user_id = excluded.user_id returning post_id
  `);
  if (!firstRow(result)) unavailable();
  return c.json({ bookmarked: true });
});
feedPostRoutes.delete("/:id/bookmark", async (c) => {
  await database(c.env).execute(sql`delete from public.feed_bookmarks where user_id = ${currentUser(c).id}::uuid and post_id = ${recordId(c.req.param("id"))}::uuid`);
  return c.json({ bookmarked: false });
});

feedPostRoutes.get("/:id/comments", async (c) => {
  const id = recordId(c.req.param("id"));
  const post = await readable(c, id);
  const cursor = feedCursor(c.req.query("cursor"));
  const result = await database(c.env).execute(sql`
    select comments.id, comments.body, comments.created_at, comments.created_at::text as cursor_at,
      coalesce(author.display_name, 'Student') as author_name,
      coalesce(author.verification_status::text = 'VERIFIED', false) as author_verified,
      comments.author_user_id = ${currentUser(c).id}::uuid as can_delete
    from public.feed_comments comments
    join public.feed_posts posts on posts.id = comments.post_id
    left join public.profiles author on author.user_id = comments.author_user_id and author.deleted_at is null
    where comments.post_id = ${id}::uuid and comments.deleted_at is null and ${visiblePost("posts", currentUser(c))}
      and (${cursor?.at ?? null}::timestamptz is null or (comments.created_at, comments.id) < (${cursor?.at ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    order by comments.created_at desc, comments.id desc limit ${pageSize + 1}
  `);
  return c.json({ comments: result.rows.slice(0, pageSize), total: post.comment_count, nextCursor: nextFeedCursor(result.rows, pageSize) });
});

feedPostRoutes.post("/:id/comments", async (c) => {
  const id = recordId(c.req.param("id"));
  writable(c);
  const user = currentUser(c);
  const data = await input(c, z.object({ body: z.string().trim().min(1).max(2000), requestId: z.string().uuid() }).strict());
  const previous = firstRow(await database(c.env).execute(sql`
    select id, post_id, body, deleted_at from public.feed_comments where author_user_id = ${user.id}::uuid and client_request_id = ${data.requestId}::uuid limit 1
  `));
  if (previous && (previous.post_id !== id || previous.body !== data.body || previous.deleted_at !== null)) throw new AppError(409, "CONFLICT", "This comment request was already used. Write a new comment.");
  if (!previous) await rateLimit(c, "FEED_COMMENT", 40);
  const result = await database(c.env).execute(sql`
    with parent as materialized (
      select posts.id, posts.university_id from public.feed_posts posts where posts.id = ${id}::uuid and ${visiblePost("posts", user)} for share
    ), written as (
      insert into public.feed_comments(university_id, post_id, author_user_id, body, client_request_id)
      select university_id, id, ${user.id}::uuid, ${data.body}, ${data.requestId}::uuid from parent
      on conflict(author_user_id, client_request_id) do update set client_request_id = excluded.client_request_id
        where feed_comments.post_id = excluded.post_id and feed_comments.body = excluded.body and feed_comments.deleted_at is null
      returning id, body, created_at, author_user_id
    )
    select written.id, written.body, written.created_at, coalesce(author.display_name, 'Student') as author_name,
      coalesce(author.verification_status::text = 'VERIFIED', false) as author_verified, true as can_delete
    from written left join public.profiles author on author.user_id = written.author_user_id and author.deleted_at is null
  `);
  const comment = firstRow(result);
  if (!comment) unavailable();
  return c.json({ comment }, previous ? 200 : 201);
});

feedPostRoutes.delete("/:id/comments/:commentId", async (c) => {
  const id = recordId(c.req.param("id"));
  const commentId = recordId(c.req.param("commentId"));
  const result = await database(c.env).execute(sql`
    update public.feed_comments set deleted_at = coalesce(deleted_at, now())
    where id = ${commentId}::uuid and post_id = ${id}::uuid and author_user_id = ${currentUser(c).id}::uuid returning id
  `);
  if (!firstRow(result)) throw new AppError(404, "NOT_FOUND", "This comment is unavailable or you do not own it.");
  return c.json({ id: commentId, deleted: true });
});

feedPostRoutes.put("/:id/repost", async (c) => {
  const id = recordId(c.req.param("id"));
  writable(c);
  const user = currentUser(c);
  await rateLimit(c, "FEED_REPOST", 60);
  const result = await database(c.env).execute(sql`
    with parent as materialized (
      select posts.id, posts.university_id from public.feed_posts posts where posts.id = ${id}::uuid and ${visiblePost("posts", user)} for share
    )
    insert into public.feed_reposts(post_id, user_id, university_id) select id, ${user.id}::uuid, university_id from parent
    on conflict(post_id, user_id) do update set user_id = excluded.user_id returning post_id
  `);
  if (!firstRow(result)) unavailable();
  return c.json({ reposted: true, post: await readable(c, id) });
});
feedPostRoutes.delete("/:id/repost", async (c) => {
  const id = recordId(c.req.param("id"));
  await database(c.env).execute(sql`delete from public.feed_reposts where post_id = ${id}::uuid and user_id = ${currentUser(c).id}::uuid`);
  return c.json({ reposted: false });
});
