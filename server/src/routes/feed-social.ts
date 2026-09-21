import { sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { AppError } from "../lib/errors";
import { input } from "../lib/input";
import { sha256 } from "../lib/security";
import { currentUser, requireAuth } from "../middleware/auth";
import type { Bindings, Variables } from "../types";

type Env = { Bindings: Bindings; Variables: Variables };
type User = ReturnType<typeof currentUser>;
type Alias = "posts" | "original" | "quotes";
type PageRow = Record<string, unknown> & { id: string; cursor_at: string };
const uuid = z.string().uuid();
const categories = new Set(["UPDATE", "EVENT", "SPORTS", "OPPORTUNITY", "EMERGENCY"]);

export function interactionId(value: string): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "This post or comment link is not valid.");
  return parsed.data;
}

function campus(user: User): string {
  if (!user.universityId) throw new AppError(409, "CONFLICT", "Complete your student profile to use the feed.", { onboardingRequired: true });
  return user.universityId;
}

// Explicit public-student exception only. Campus editorial content stays scoped;
// explicitly private audiences are never exposed, even inside the same campus.
export function visiblePost(user: User, alias: Alias = "posts") {
  const a = sql.raw(alias); // Alias is a closed internal union, never request input.
  return sql`${a}.status in ('PUBLISHED', 'CORRECTED') and ${a}.published_at <= now()
    and (
      (${a}.audience->>'studentPost' = 'true' and coalesce(${a}.audience->>'visibility', 'PUBLIC') = 'PUBLIC')
      or (${a}.university_id = ${campus(user)}::uuid
        and coalesce(${a}.audience->>'visibility', 'CAMPUS') in ('PUBLIC', 'CAMPUS'))
    )`;
}

function statsColumns(user: User) {
  return sql`
    (select count(*)::int from public.feed_post_comments comments where comments.post_id = posts.id and comments.deleted_at is null) as comment_count,
    (select count(*)::int from public.feed_post_reposts reposts where reposts.post_id = posts.id) as repost_count,
    (select count(*)::int from public.feed_posts quotes where quotes.quoted_post_id = posts.id and ${visiblePost(user, "quotes")}) as quote_count,
    exists(select 1 from public.feed_post_reposts mine where mine.post_id = posts.id and mine.user_id = ${user.id}::uuid) as reposted`;
}

function postColumns(user: User) {
  return sql`
    posts.id, posts.category, posts.title, posts.summary, posts.body, posts.image_url,
    posts.urgent, posts.sponsored, posts.published_at, posts.correction_note,
    coalesce(posts.audience->>'studentPost' = 'true', false) as is_student_post,
    case when posts.audience->>'studentPost' = 'true'
      then coalesce(nullif(author.display_name, ''), 'KampusOne user') else sources.name end as source_name,
    case when posts.audience->>'studentPost' = 'true'
      then coalesce(author.verification_status::text = 'VERIFIED', false) else sources.verified end as source_verified,
    coalesce(posts.author_user_id = ${user.id}::uuid, false) as can_delete,
    exists(select 1 from public.feed_bookmarks bookmarks where bookmarks.post_id = posts.id and bookmarks.user_id = ${user.id}::uuid) as bookmarked,
    ${statsColumns(user)},
    posts.quoted_post_id,
    (posts.quoted_post_id is not null or coalesce(posts.audience->>'quotePost' = 'true', false)) as is_quote,
    (select jsonb_build_object(
      'id', original.id, 'title', original.title, 'body', original.body,
      'image_url', original.image_url,
      'source_name', case when original.audience->>'studentPost' = 'true'
        then coalesce(nullif(original_author.display_name, ''), 'KampusOne user') else original_source.name end,
      'source_verified', case when original.audience->>'studentPost' = 'true'
        then coalesce(original_author.verification_status::text = 'VERIFIED', false) else original_source.verified end
      ) from public.feed_posts original
      join public.content_sources original_source on original_source.id = original.source_id
      left join public.profiles original_author on original_author.user_id = original.author_user_id and original_author.deleted_at is null
      where original.id = posts.quoted_post_id and ${visiblePost(user, "original")}
    ) as quoted_post,
    (select coalesce(nullif(person.display_name, ''), 'KampusOne user') from public.feed_post_reposts activity
      left join public.profiles person on person.user_id = activity.user_id and person.deleted_at is null
      where activity.post_id = posts.id order by activity.created_at desc, activity.user_id desc limit 1) as reposted_by,
    greatest(posts.published_at, (select max(activity.created_at) from public.feed_post_reposts activity where activity.post_id = posts.id)) as activity_at`;
}

export async function readVisiblePost(context: Context<Env>, id: string) {
  const user = currentUser(context);
  const result = await database(context.env).execute(sql`
    select ${postColumns(user)} from public.feed_posts posts
    join public.content_sources sources on sources.id = posts.source_id
    left join public.profiles author on author.user_id = posts.author_user_id and author.deleted_at is null
    where posts.id = ${id}::uuid and ${visiblePost(user)} limit 1
  `);
  const post = firstRow(result);
  if (!post) throw new AppError(404, "NOT_FOUND", "This post is unavailable. It may have been deleted.");
  return post;
}

async function readStats(context: Context<Env>, id: string) {
  const user = currentUser(context);
  const result = await database(context.env).execute(sql`
    select ${statsColumns(user)} from public.feed_posts posts where posts.id = ${id}::uuid and ${visiblePost(user)}
  `);
  return firstRow(result) ?? null;
}

function pageInput(context: Context<Env>, defaultLimit = 50) {
  const rawLimit = context.req.query("limit");
  if (rawLimit !== undefined && !/^\d{1,3}$/.test(rawLimit)) throw new AppError(400, "BAD_REQUEST", "Choose a valid page size.");
  const limit = rawLimit === undefined ? defaultLimit : Number(rawLimit);
  if (limit < 1 || limit > 100) throw new AppError(400, "BAD_REQUEST", "Choose a page size from 1 to 100.");
  const raw = context.req.query("cursor");
  if (!raw) return { limit, at: null, id: null };
  const parts = raw.split("~");
  const stamp = parts[0] ?? "";
  const parsedAt = Date.parse(stamp);
  const validStamp = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z$/.test(stamp)
    && Number(stamp.slice(0, 4)) > 0 && Number.isFinite(parsedAt)
    && new Date(parsedAt).toISOString().slice(0, 19) === stamp.slice(0, 19);
  if (parts.length !== 2 || !validStamp || !uuid.safeParse(parts[1]).success)
    throw new AppError(400, "BAD_REQUEST", "This page link is not valid. Refresh the feed.");
  return { limit, at: parts[0]!, id: parts[1]! };
}

function pageResult<T extends PageRow>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? `${last.cursor_at}~${last.id}` : null };
}

async function rateLimit(context: Context<Env>, action: string, maximum: number) {
  const user = currentUser(context);
  campus(user);
  const result = await database(context.env).execute<{ allowed: boolean }>(sql`
    select app_private.consume_request_rate_limit(${action}, ${await sha256(user.id)}, ${maximum}, 3600, 3600) as allowed
  `);
  if (!firstRow(result)?.allowed) throw new AppError(429, "RATE_LIMITED", "You’re doing that too often. Please try again later.");
}

export const feedSocialRoutes = new Hono<Env>();
feedSocialRoutes.use("*", async (context, next) => {
  context.header("Cache-Control", "private, no-store");
  await next();
});

feedSocialRoutes.get("/", requireAuth, async (context) => {
  const user = currentUser(context);
  const page = pageInput(context);
  const category = context.req.query("category")?.toUpperCase() ?? null;
  if (category && !categories.has(category)) throw new AppError(400, "BAD_REQUEST", "Choose a valid post category.");
  const result = await database(context.env).execute<PageRow>(sql`
    with candidates as (
      select posts.id, greatest(posts.published_at,
        (select max(activity.created_at) from public.feed_post_reposts activity where activity.post_id = posts.id)) as activity_at
      from public.feed_posts posts
      where ${visiblePost(user)} and (${category}::text is null or posts.category = ${category})
    ), page as (
      select * from candidates
      where (${page.at}::timestamptz is null or (activity_at, id) < (${page.at}::timestamptz, ${page.id}::uuid))
      order by activity_at desc, id desc limit ${page.limit + 1}
    )
    select ${postColumns(user)}, to_char(page.activity_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at
    from page join public.feed_posts posts on posts.id = page.id
    join public.content_sources sources on sources.id = posts.source_id
    left join public.profiles author on author.user_id = posts.author_user_id and author.deleted_at is null
    order by page.activity_at desc, posts.id desc
  `);
  const pageData = pageResult(result.rows, page.limit);
  return context.json({ posts: pageData.items, nextCursor: pageData.nextCursor });
});

feedSocialRoutes.get("/:id/social", requireAuth, async (context) => {
  const id = interactionId(context.req.param("id"));
  const stats = await readStats(context, id);
  if (!stats) throw new AppError(404, "NOT_FOUND", "This post is unavailable.");
  return context.json({ stats });
});

feedSocialRoutes.get("/:id/comments", requireAuth, async (context) => {
  const user = currentUser(context);
  const id = interactionId(context.req.param("id"));
  const page = pageInput(context, 30);
  const result = await database(context.env).execute<{
    available: boolean; comments: PageRow[]; comment_count: number;
  }>(sql`
    with target as (select posts.id from public.feed_posts posts where posts.id = ${id}::uuid and ${visiblePost(user)}),
    page as (
      select comments.id, comments.body, comments.created_at,
        to_char(comments.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at,
        coalesce(nullif(author.display_name, ''), 'KampusOne user') as author_name,
        coalesce(author.verification_status::text = 'VERIFIED', false) as author_verified,
        comments.author_user_id = ${user.id}::uuid as can_delete
      from public.feed_post_comments comments join target on target.id = comments.post_id
      left join public.profiles author on author.user_id = comments.author_user_id and author.deleted_at is null
      where comments.deleted_at is null
        and (${page.at}::timestamptz is null or (comments.created_at, comments.id) < (${page.at}::timestamptz, ${page.id}::uuid))
      order by comments.created_at desc, comments.id desc limit ${page.limit + 1}
    )
    select exists(select 1 from target) as available,
      coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc, id desc) from page), '[]'::jsonb) as comments,
      (select count(*)::int from public.feed_post_comments comments join target on target.id = comments.post_id where comments.deleted_at is null) as comment_count
  `);
  const data = firstRow(result);
  if (!data?.available) throw new AppError(404, "NOT_FOUND", "This post is unavailable.");
  const pageData = pageResult(data.comments, page.limit);
  return context.json({ comments: pageData.items, nextCursor: pageData.nextCursor, comment_count: data.comment_count });
});

feedSocialRoutes.post("/:id/comments", requireAuth, async (context) => {
  const user = currentUser(context);
  const id = interactionId(context.req.param("id"));
  const data = await input(context, z.object({ body: z.string().trim().min(1).max(2000), requestId: z.string().uuid() }).strict());
  await rateLimit(context, "FEED_COMMENT", 120);
  const result = await database(context.env).execute(sql`
    with target as (
      select posts.id, posts.university_id from public.feed_posts posts
      where posts.id = ${id}::uuid and ${visiblePost(user)} for update
    ), saved as (
      insert into public.feed_post_comments (post_id, institution_id, author_user_id, client_request_id, body)
      select id, university_id, ${user.id}::uuid, ${data.requestId}::uuid, ${data.body} from target
      on conflict (author_user_id, client_request_id) do update set client_request_id = excluded.client_request_id
      where feed_post_comments.post_id = excluded.post_id and feed_post_comments.body = excluded.body and feed_post_comments.deleted_at is null
      returning id, body, created_at, author_user_id
    )
    select saved.id, saved.body, saved.created_at,
      coalesce(nullif(author.display_name, ''), 'KampusOne user') as author_name,
      coalesce(author.verification_status::text = 'VERIFIED', false) as author_verified, true as can_delete
    from saved left join public.profiles author on author.user_id = saved.author_user_id and author.deleted_at is null
  `);
  const comment = firstRow(result);
  if (!comment) throw new AppError(409, "CONFLICT", "The post is unavailable or this comment request was already removed or changed. Refresh and try again.");
  return context.json({ comment, stats: await readStats(context, id) }, 201);
});

feedSocialRoutes.delete("/:id/comments/:commentId", requireAuth, async (context) => {
  const user = currentUser(context);
  const id = interactionId(context.req.param("id"));
  const commentId = interactionId(context.req.param("commentId"));
  // Erase the text but retain an idempotency tombstone: a delayed POST retry
  // must not recreate a comment the author has deleted. The post author has no override.
  const result = await database(context.env).execute(sql`
    update public.feed_post_comments set body = null, deleted_at = coalesce(deleted_at, now())
    where id = ${commentId}::uuid and post_id = ${id}::uuid and author_user_id = ${user.id}::uuid returning id
  `);
  if (!firstRow(result)) throw new AppError(404, "NOT_FOUND", "This comment is unavailable or you cannot delete it.");
  return context.json({ id: commentId, deleted: true, stats: user.universityId ? await readStats(context, id) : null });
});

feedSocialRoutes.put("/:id/repost", requireAuth, async (context) => {
  const user = currentUser(context);
  const id = interactionId(context.req.param("id"));
  await rateLimit(context, "FEED_REPOST", 120);
  const result = await database(context.env).execute(sql`
    with target as (
      select posts.id, posts.university_id from public.feed_posts posts
      where posts.id = ${id}::uuid and ${visiblePost(user)} for update
    ), saved as (
      insert into public.feed_post_reposts (post_id, institution_id, user_id)
      select id, university_id, ${user.id}::uuid from target on conflict (post_id, user_id) do nothing
    ) select id from target
  `);
  if (!firstRow(result)) throw new AppError(404, "NOT_FOUND", "This post is unavailable.");
  return context.json({ reposted: true, stats: await readStats(context, id) });
});

feedSocialRoutes.delete("/:id/repost", requireAuth, async (context) => {
  const user = currentUser(context);
  const id = interactionId(context.req.param("id"));
  // This only removes the caller's reference, never the original post.
  await database(context.env).execute(sql`
    delete from public.feed_post_reposts where post_id = ${id}::uuid and user_id = ${user.id}::uuid
  `);
  return context.json({ reposted: false, stats: user.universityId ? await readStats(context, id) : null });
});

feedSocialRoutes.post("/:id/quote", requireAuth, async (context) => {
  const user = currentUser(context);
  const id = interactionId(context.req.param("id"));
  // The accompanying migration allows short student quotes, including emoji.
  const data = await input(context, z.object({ body: z.string().trim().min(1).max(5000), requestId: z.string().uuid() }).strict());
  await rateLimit(context, "STUDENT_POST", 10);
  const result = await database(context.env).execute(sql`
    with target as (
      select posts.id from public.feed_posts posts where posts.id = ${id}::uuid and ${visiblePost(user)} for update
    ), source as (
      insert into public.content_sources (university_id, name, owner_user_id)
      select ${campus(user)}::uuid, ${"student:" + user.id}, ${user.id}::uuid from target
      on conflict (university_id, name) do update set owner_user_id = excluded.owner_user_id returning id
    )
    insert into public.feed_posts (university_id, source_id, author_user_id, category, title, summary, body, audience, status, published_at, client_request_id, quoted_post_id)
    select ${campus(user)}::uuid, source.id, ${user.id}::uuid, 'UPDATE', ${Array.from(data.body).slice(0, 180).join("")}, ${Array.from(data.body).slice(0, 500).join("")}, ${data.body},
      '{"studentPost":true,"quotePost":true,"visibility":"PUBLIC"}'::jsonb, 'PUBLISHED', now(), ${data.requestId}::uuid, target.id
    from source cross join target
    on conflict (author_user_id, client_request_id) where client_request_id is not null
    do update set client_request_id = excluded.client_request_id
    where feed_posts.quoted_post_id = excluded.quoted_post_id and feed_posts.body = excluded.body and feed_posts.status in ('PUBLISHED', 'CORRECTED')
    returning id
  `);
  const quote = firstRow(result);
  if (!quote) throw new AppError(409, "CONFLICT", "The original post is unavailable or this quote request was already changed or removed. Refresh and try again.");
  return context.json({ ...quote, stats: await readStats(context, id) }, 201);
});

// Public student posts must also be bookmarkable by readers from other campuses.
feedSocialRoutes.put("/:id/bookmark", requireAuth, async (context) => {
  const user = currentUser(context);
  const id = interactionId(context.req.param("id"));
  const result = await database(context.env).execute(sql`
    with target as (
      select posts.id from public.feed_posts posts where posts.id = ${id}::uuid and ${visiblePost(user)} for update
    ), saved as (
      insert into public.feed_bookmarks (user_id, post_id) select ${user.id}::uuid, id from target on conflict do nothing
    ) select id from target
  `);
  if (!firstRow(result)) throw new AppError(404, "NOT_FOUND", "This post is unavailable.");
  return context.json({ bookmarked: true });
});
