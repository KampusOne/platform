import { feedExperienceReady } from "../lib/feed-experience";
export { feedExperienceReady } from "../lib/feed-experience";
import { sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { AppError } from "../lib/errors";
import { input } from "../lib/input";
import { sha256 } from "../lib/security";
import { commentRepliesSchemaReady, socialSchemaReady, visiblePost } from "../lib/feed-social";
import { currentUser, requireAuth } from "../middleware/auth";
import type { Bindings, Variables } from "../types";

type Env = { Bindings: Bindings; Variables: Variables };
const uuid = z.string().uuid();
export const feedExperienceRoutes = new Hono<Env>();
function identifier(value: string): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "This post or reply link is invalid.");
  return parsed.data;
}
function campus(c: Context<Env>): string {
  const universityId = currentUser(c).universityId;
  if (!universityId) throw new AppError(409, "CONFLICT", "Complete your student profile to use the feed.", { onboardingRequired: true });
  return universityId;
}
function origin(c: Context<Env>): string { return (c.env.PUBLIC_API_ORIGIN ?? new URL(c.req.url).origin).replace(/\/$/, ""); }
async function quota(c: Context<Env>, kind: string, limit: number) {
  const result = firstRow(await database(c.env).execute<{ allowed: boolean }>(sql`
    select app_private.consume_request_rate_limit(${kind}, ${await sha256(currentUser(c).id)}, ${limit}, 3600, 3600) as allowed
  `));
  if (!result?.allowed) throw new AppError(429, "RATE_LIMITED", "Please wait before trying again.");
}
function replaceJson(c: Context<Env>, payload: unknown) {
  const headers = new Headers(c.res.headers);
  headers.delete("Content-Length"); headers.set("Cache-Control", "private, no-store");
  c.res = new Response(JSON.stringify(payload), { status: c.res.status, headers });
}
// Add presentation data only AFTER the original authenticated, visibility-filtered read.
// Unavailable migrations keep the legacy text feed working during rolling deployment.
async function enrichPosts(c: Context<Env>, next: () => Promise<void>) {
  await next();
  if (!c.res.ok || c.env.UNIFIED_SCHEMA_READY !== "true") return;
  const payload = await c.res.clone().json() as { posts?: Record<string, unknown>[]; post?: Record<string, unknown> };
  const posts = Array.isArray(payload.posts) ? payload.posts : payload.post ? [payload.post] : [];
  // Current endpoints project avatars, counts and viewer state in the original read.
  if (posts.every((post) => "source_image_url" in post && "view_count" in post)) return;
  const ids = posts.map((post) => String(post.id)).filter((id) => uuid.safeParse(id).success);
  if (!ids.length) return;
  const ready = await feedExperienceReady(c.env);
  const views = ready ? sql`(select count(*)::int from public.feed_post_views v where v.post_id=posts.id)` : sql`null::integer`;
  const extra = await database(c.env).execute<{ id: string; source_image_url: string | null; view_count: number | null }>(sql`
    select posts.id, case when posts.audience->>'studentPost'='true' then author.profile_image_url else null end as source_image_url, ${views} as view_count
    from public.feed_posts posts left join public.profiles author on author.user_id=posts.author_user_id and author.deleted_at is null
    where posts.id=any(${sql.param(ids)}::uuid[]) and ${visiblePost(campus(c))}
  `);
  const byId = new Map(extra.rows.map((row) => [row.id, row]));
  for (const post of posts) { const row = byId.get(String(post.id)); if (row) Object.assign(post, { source_image_url: row.source_image_url, view_count: row.view_count }); }
  replaceJson(c, payload);
}
feedExperienceRoutes.get("/", requireAuth, enrichPosts);
feedExperienceRoutes.get("/:id", requireAuth, enrichPosts);
feedExperienceRoutes.get("/:id/comments", requireAuth, async (c, next) => {
  await next();
  if (!c.res.ok || !await feedExperienceReady(c.env)) return;
  const payload = await c.res.clone().json() as { comments?: Record<string, unknown>[] };
  const comments = payload.comments ?? [];
  const ids = comments.filter((comment) => !comment.is_deleted).map((comment) => String(comment.id)).filter((id) => uuid.safeParse(id).success);
  if (!ids.length) return;
  const media = await database(c.env).execute<{ id: string; media_object_id: string }>(sql`
    select comments.id, comments.media_object_id from public.feed_comments comments
    join public.media_objects media on media.id=comments.media_object_id and media.owner_user_id=comments.author_user_id and media.deleted_at is null and media.kind='post'
    join public.feed_posts posts on posts.id=comments.post_id
    where comments.id=any(${sql.param(ids)}::uuid[]) and comments.post_id=${identifier(c.req.param("id"))}::uuid and comments.deleted_at is null and ${visiblePost(campus(c))}
  `);
  const byId = new Map(media.rows.map((row) => [row.id, `${origin(c)}/v1/media/${row.media_object_id}`]));
  for (const comment of comments) comment.image_url = comment.is_deleted ? null : byId.get(String(comment.id)) ?? null;
  replaceJson(c, payload);
});
feedExperienceRoutes.put("/:id/view", requireAuth, async (c) => {
  c.header("Cache-Control", "private, no-store");
  const university = campus(c), user = currentUser(c), postId = identifier(c.req.param("id"));
  if (!await feedExperienceReady(c.env)) throw new AppError(503, "PROVIDER_UNAVAILABLE", "View tracking is not available yet.");
  await quota(c, "FEED_VIEW", 1800);
  await database(c.env).execute(sql`
    insert into public.feed_post_views(post_id,institution_id,user_id)
    select posts.id,posts.university_id,${user.id}::uuid from public.feed_posts posts where posts.id=${postId}::uuid and ${visiblePost(university)}
    on conflict(post_id,user_id) do nothing
  `);
  const result = firstRow(await database(c.env).execute<{ view_count: number }>(sql`
    select (select count(*)::int from public.feed_post_views v where v.post_id=posts.id) as view_count
    from public.feed_posts posts where posts.id=${postId}::uuid and ${visiblePost(university)}
  `));
  if (!result) throw new AppError(404, "NOT_FOUND", "This post is unavailable.");
  return c.json(result);
});
feedExperienceRoutes.post("/:id/comments", requireAuth, async (c, next) => {
  if (!await feedExperienceReady(c.env)) {
    const raw = await c.req.json().catch(() => null) as { mediaId?: unknown } | null;
    if (raw?.mediaId) throw new AppError(503, "PROVIDER_UNAVAILABLE", "Photo replies are being connected. Your draft is still here.");
    return next();
  }
  c.header("Cache-Control", "private, no-store");
  if (!await socialSchemaReady(c.env) || !await commentRepliesSchemaReady(c.env)) throw new AppError(503, "PROVIDER_UNAVAILABLE", "Replies are being connected. Please try again shortly.");
  const user = currentUser(c), university = campus(c), postId = identifier(c.req.param("id"));
  const data = await input(c, z.object({ body: z.string().trim().max(2000), requestId: uuid, parentCommentId: uuid.optional(), mediaId: uuid.optional() }).refine((value) => Boolean(value.body || value.mediaId), { message: "Write a reply or choose an image." }));
  const parentId = data.parentCommentId ?? null, mediaId = data.mediaId ?? null;
  const retry = firstRow(await database(c.env).execute(sql`
    select id,post_id,body,parent_comment_id,media_object_id,deleted_at from public.feed_comments
    where author_user_id=${user.id}::uuid and client_request_id=${data.requestId}::uuid limit 1
  `));
  if (retry && (retry.post_id !== postId || retry.body !== data.body || (retry.parent_comment_id ?? null) !== parentId || (retry.media_object_id ?? null) !== mediaId || retry.deleted_at))
    throw new AppError(409, "CONFLICT", "This draft or reply target changed. Send it as a new message.");
  if (!retry) {
    if (mediaId && !firstRow(await database(c.env).execute(sql`
      select id from public.media_objects where id=${mediaId}::uuid and owner_user_id=${user.id}::uuid and kind='post' and deleted_at is null
    `))) throw new AppError(400, "BAD_REQUEST", "Choose an image uploaded from your own device.");
    await quota(c, "FEED_COMMENT", 60);
  }
  const saved = firstRow(await database(c.env).execute(sql`
    with target as (
      select posts.id,posts.university_id from public.feed_posts posts where posts.id=${postId}::uuid and ${visiblePost(university)} for update
    ), parent as (
      select parents.id from public.feed_comments parents join target on target.id=parents.post_id and target.university_id=parents.institution_id
      where parents.id=${parentId}::uuid and (parents.deleted_at is null or ${retry?.id ?? null}::uuid is not null) for update of parents
    ), saved as (
      insert into public.feed_comments(post_id,institution_id,author_user_id,body,client_request_id,parent_comment_id,media_object_id)
      select id,university_id,${user.id}::uuid,${data.body},${data.requestId}::uuid,${parentId}::uuid,${mediaId}::uuid from target
      where ${parentId}::uuid is null or exists(select 1 from parent)
      on conflict(author_user_id,client_request_id) do update set client_request_id=excluded.client_request_id
      where feed_comments.post_id=excluded.post_id and feed_comments.body=excluded.body and feed_comments.deleted_at is null
        and feed_comments.parent_comment_id is not distinct from excluded.parent_comment_id
        and feed_comments.media_object_id is not distinct from excluded.media_object_id
      returning id,body,created_at,author_user_id,parent_comment_id,media_object_id
    )
    select saved.id,saved.body,saved.created_at,saved.parent_comment_id,false as is_deleted,true as can_delete,
      coalesce(author.display_name,'KampusOne user') as author_name,author.profile_image_url as author_image_url,
      coalesce((to_jsonb(author)->>'public_badge_verified')::boolean, author.verification_status::text='VERIFIED', false) as author_verified,
      case when media.id is null then null else ${origin(c) + "/v1/media/"} || media.id::text end as image_url,
      (select count(*)::int from public.feed_comments replies where replies.post_id=${postId}::uuid and replies.parent_comment_id=saved.id and replies.deleted_at is null) as reply_count
    from saved left join public.profiles author on author.user_id=saved.author_user_id and author.deleted_at is null
    left join public.media_objects media on media.id=saved.media_object_id and media.owner_user_id=saved.author_user_id and media.deleted_at is null
  `));
  if (!saved) throw new AppError(409, "CONFLICT", "The post or reply is unavailable, or this draft has already changed. Your draft has not been cleared.");
  return c.json({ comment: saved }, retry ? 200 : 201);
});
