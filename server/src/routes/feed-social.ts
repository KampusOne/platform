import { sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { AppError } from "../lib/errors";
import { input } from "../lib/input";
import { sha256 } from "../lib/security";
import { commentRepliesSchemaReady, nextFeedCursor, parseFeedCursor, socialSchemaReady, visiblePost } from "../lib/feed-social";
import { currentUser, requireAuth } from "../middleware/auth";
import type { Bindings, Variables } from "../types";

type Env = { Bindings: Bindings; Variables: Variables };
type User = ReturnType<typeof currentUser>;
const uuid = z.string().uuid();
const pageSize = 40;
export const feedSocialRoutes = new Hono<Env>();

function id(value: string) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "This post or comment link is not valid.");
  return parsed.data;
}
function campus(user: User) {
  if (!user.universityId) throw new AppError(409, "CONFLICT", "Complete your student profile to use the feed.", { onboardingRequired: true });
  return user.universityId;
}
async function requireSocial(c: Context<Env>) {
  if (!await socialSchemaReady(c.env)) throw new AppError(503, "PROVIDER_UNAVAILABLE", "Comments and reposts are being connected. Please try again shortly.");
}
async function requireReplies(c: Context<Env>) {
  await requireSocial(c);
  if (!await commentRepliesSchemaReady(c.env)) throw new AppError(503, "PROVIDER_UNAVAILABLE", "Comment replies are being connected. Please try again shortly.");
}
async function rateLimit(c: Context<Env>, kind: string, limit: number) {
  const result = await database(c.env).execute<{ allowed: boolean }>(sql`
    select app_private.consume_request_rate_limit(${kind}, ${await sha256(currentUser(c).id)}, ${limit}, 3600, 3600) as allowed
  `);
  if (!firstRow(result)?.allowed) throw new AppError(429, "RATE_LIMITED", "Please wait before trying that again.");
}

function projection(user: User) {
  return sql`posts.id, posts.category, posts.title, posts.summary, posts.body,
    posts.image_url, posts.urgent, posts.sponsored, posts.published_at, posts.correction_note,
    case when posts.audience->>'studentPost' = 'true'
      then coalesce(author.display_name, sources.name) else sources.name end as source_name,
    case when posts.audience->>'studentPost' = 'true'
      then coalesce(author.verification_status::text = 'VERIFIED', false) else sources.verified end as source_verified,
    coalesce(posts.author_user_id = ${user.id}::uuid, false) as can_delete,
    case when posts.audience->>'visibility' = 'PUBLIC' then 'PUBLIC' else 'CAMPUS' end as visibility,
    true as social_enabled,
    exists(select 1 from public.feed_bookmarks b where b.post_id = posts.id and b.user_id = ${user.id}::uuid) as bookmarked,
    (select count(*)::int from public.feed_comments comments where comments.post_id = posts.id and comments.deleted_at is null) as comment_count,
    (select count(*)::int from public.feed_reposts r where r.post_id = posts.id) as repost_count,
    exists(select 1 from public.feed_reposts r where r.post_id = posts.id and r.user_id = ${user.id}::uuid) as reposted,
    posts.quoted_post_id,
    case when quoted.id is null then null else jsonb_build_object(
      'id', quoted.id, 'title', quoted.title, 'summary', quoted.summary, 'body', quoted.body,
      'image_url', quoted.image_url, 'published_at', quoted.published_at,
      'source_name', case when quoted.audience->>'studentPost' = 'true' then coalesce(quoted_author.display_name, quoted_source.name) else quoted_source.name end,
      'source_verified', case when quoted.audience->>'studentPost' = 'true' then coalesce(quoted_author.verification_status::text = 'VERIFIED', false) else quoted_source.verified end
    ) end as quoted_post`;
}
function joins(user: User) {
  return sql`join public.content_sources sources on sources.id = posts.source_id
    left join public.profiles author on author.user_id = posts.author_user_id and author.deleted_at is null
    left join public.feed_posts quoted on quoted.id = posts.quoted_post_id
      and quoted.status in ('PUBLISHED', 'CORRECTED') and quoted.published_at <= now()
      and (quoted.university_id = ${campus(user)}::uuid or quoted.audience->>'visibility' = 'PUBLIC')
    left join public.content_sources quoted_source on quoted_source.id = quoted.source_id
    left join public.profiles quoted_author on quoted_author.user_id = quoted.author_user_id and quoted_author.deleted_at is null`;
}
async function readPost(c: Context<Env>, postId: string) {
  const user = currentUser(c);
  const result = await database(c.env).execute(sql`
    select ${projection(user)} from public.feed_posts posts ${joins(user)}
    where posts.id = ${postId}::uuid and ${visiblePost(campus(user))} limit 1
  `);
  const post = firstRow(result);
  if (!post) throw new AppError(404, "NOT_FOUND", "This post is unavailable. It may have been deleted or may be campus-restricted.");
  return post;
}

feedSocialRoutes.get("/", requireAuth, async (c, next) => {
  if (!await socialSchemaReady(c.env)) return next();
  c.header("Cache-Control", "private, no-store");
  const user = currentUser(c);
  const university = campus(user);
  const cursor = parseFeedCursor(c.req.query("cursor"));
  const category = c.req.query("category")?.toUpperCase() || null;
  const search = c.req.query("q")?.trim().slice(0, 200) || null;
  const result = await database(c.env).execute(sql`
    select ${projection(user)}, greatest(posts.published_at, latest.created_at) as activity_at,
      to_char(greatest(posts.published_at, latest.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at,
      case when latest.user_id is null then null else jsonb_build_object('user_id', latest.user_id, 'name', latest.display_name) end as repost_by
    from public.feed_posts posts ${joins(user)}
    left join lateral (
      select r.created_at, r.user_id, p.display_name from public.feed_reposts r
      join public.profiles p on p.user_id = r.user_id and p.deleted_at is null
      where r.post_id = posts.id order by r.created_at desc, r.user_id desc limit 1
    ) latest on true
    where ${visiblePost(university)}
      and (${category}::text is null or posts.category = ${category})
      and (${search}::text is null or concat_ws(' ', posts.title, posts.summary, posts.body, author.display_name, sources.name) ilike ${search ? `%${search}%` : null})
      and (${cursor?.at ?? null}::timestamptz is null or
        (greatest(posts.published_at, latest.created_at), posts.id) < (${cursor?.at ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    order by activity_at desc, posts.id desc limit ${pageSize + 1}
  `);
  const posts = result.rows.slice(0, pageSize);
  return c.json({ posts, nextCursor: result.rows.length > pageSize ? nextFeedCursor(posts[posts.length - 1]!, "activity_at") : null });
});

feedSocialRoutes.get("/:id", requireAuth, async (c, next) => {
  if (!await socialSchemaReady(c.env)) return next();
  c.header("Cache-Control", "private, no-store");
  return c.json({ post: await readPost(c, id(c.req.param("id"))) });
});

feedSocialRoutes.post("/", requireAuth, async (c) => {
  await requireSocial(c);
  const user = currentUser(c);
  const university = campus(user);
  const data = await input(c, z.object({ body: z.string().trim().min(4).max(5000).refine((value) => Array.from(value).length >= 4), requestId: uuid, mediaId: uuid.optional(), quotedPostId: uuid.optional() }));
  // Retry before quota consumption; a reused key may not change the payload.
  const retry = firstRow(await database(c.env).execute(sql`
    select id, body, image_url, quoted_post_id from public.feed_posts
    where author_user_id = ${user.id}::uuid and client_request_id = ${data.requestId}::uuid limit 1
  `));
  const imageUrl = data.mediaId ? `${(c.env.PUBLIC_API_ORIGIN ?? new URL(c.req.url).origin).replace(/\/$/, "")}/v1/media/${data.mediaId}` : null;
  if (retry) {
    if (retry.body !== data.body || (retry.quoted_post_id ?? null) !== (data.quotedPostId ?? null) || (retry.image_url ?? null) !== imageUrl)
      throw new AppError(409, "CONFLICT", "This draft changed. Submit it as a new post.");
    return c.json({ id: retry.id }, 200);
  }
  if (data.mediaId && !firstRow(await database(c.env).execute(sql`
    select id from public.media_objects where id = ${data.mediaId}::uuid and owner_user_id = ${user.id}::uuid and kind = 'post' and deleted_at is null
  `))) throw new AppError(400, "BAD_REQUEST", "Choose an image from your device.");
  await rateLimit(c, "STUDENT_POST", 10);
  // Quotes retain references, not copies; campus-only originals stay campus-only.
  const result = await database(c.env).execute(sql`
    with target as (
      select posts.id, posts.audience from public.feed_posts posts
      where posts.id = ${data.quotedPostId ?? null}::uuid and ${visiblePost(university)} for update
    ), source as (
      insert into public.content_sources(university_id, name, owner_user_id)
      values(${university}::uuid, ${"student:" + user.id}, ${user.id}::uuid)
      on conflict(university_id, name) do update set owner_user_id = excluded.owner_user_id returning id
    )
    insert into public.feed_posts(university_id, source_id, author_user_id, category, title, summary, body, image_url, audience, status, published_at, client_request_id, quoted_post_id)
    select ${university}::uuid, source.id, ${user.id}::uuid, 'UPDATE', ${Array.from(data.body).slice(0, 180).join("")}, ${Array.from(data.body).slice(0, 500).join("")}, ${data.body}, ${imageUrl},
      jsonb_build_object('studentPost', true, 'visibility', case when ${data.quotedPostId ?? null}::uuid is null or (select audience->>'visibility' from target) = 'PUBLIC' then 'PUBLIC' else 'CAMPUS' end),
      'PUBLISHED', now(), ${data.requestId}::uuid, ${data.quotedPostId ?? null}::uuid
    from source where ${data.quotedPostId ?? null}::uuid is null or exists(select 1 from target)
    on conflict(author_user_id, client_request_id) where client_request_id is not null
    do update set client_request_id = excluded.client_request_id
      where feed_posts.body = excluded.body and feed_posts.image_url is not distinct from excluded.image_url
        and feed_posts.quoted_post_id is not distinct from excluded.quoted_post_id
    returning id
  `);
  const post = firstRow(result);
  if (!post) throw new AppError(409, "CONFLICT", "The original post is unavailable or this request belongs to a different draft.");
  return c.json(post, 201);
});

feedSocialRoutes.delete("/:id", requireAuth, async (c, next) => {
  if (!await socialSchemaReady(c.env)) return next();
  c.header("Cache-Control", "private, no-store");
  const user = currentUser(c);
  const postId = id(c.req.param("id"));
  const result = await database(c.env).execute(sql`
    with removed as (
      update public.feed_posts set status = 'ARCHIVED',
        updated_at = case when status = 'ARCHIVED' then updated_at else now() end
      where id = ${postId}::uuid and author_user_id = ${user.id}::uuid
        and (university_id = ${campus(user)}::uuid or audience->>'visibility' = 'PUBLIC') returning id
    ), bookmarks as (delete from public.feed_bookmarks where post_id in (select id from removed)),
    reposts as (delete from public.feed_reposts where post_id in (select id from removed))
    select id from removed
  `);
  if (!firstRow(result)) throw new AppError(404, "NOT_FOUND", "This post is unavailable or you do not have permission to delete it.");
  return c.json({ id: postId, deleted: true });
});

feedSocialRoutes.get("/:id/comments", requireAuth, async (c) => {
  c.header("Cache-Control", "private, no-store");
  await requireReplies(c);
  const user = currentUser(c);
  const postId = id(c.req.param("id"));
  await readPost(c, postId);
  const parentParam = c.req.query("parentCommentId");
  const parentId = parentParam === undefined ? null : id(parentParam);
  const parent = parentId ? firstRow(await database(c.env).execute(sql`
    select deleted_at is not null as is_deleted from public.feed_comments
    where id = ${parentId}::uuid and post_id = ${postId}::uuid limit 1
  `)) : null;
  if (parentId && !parent) throw new AppError(404, "NOT_FOUND", "This comment is unavailable.");
  const cursor = parseFeedCursor(c.req.query("cursor"));
  const result = await database(c.env).execute(sql`
    select comments.id, case when comments.deleted_at is null then comments.body else '' end as body,
      comments.created_at, comments.parent_comment_id, comments.deleted_at is not null as is_deleted,
      to_char(comments.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at,
      case when comments.deleted_at is null then coalesce(author.display_name, 'KampusOne user') else 'Comment deleted' end as author_name,
      author.profile_image_url as author_image_url, author.username as author_username,
      coalesce(author.verification_status::text = 'VERIFIED', false) as author_verified,
      comments.deleted_at is null and comments.author_user_id = ${user.id}::uuid as can_delete,
      (select count(*)::int from public.feed_comments replies where replies.post_id = comments.post_id and replies.parent_comment_id = comments.id
        and (replies.deleted_at is null or exists(select 1 from public.feed_comments child where child.post_id = replies.post_id and child.parent_comment_id = replies.id))) as reply_count
    from public.feed_comments comments
    join public.feed_posts posts on posts.id = comments.post_id
    left join public.profiles author on author.user_id = comments.author_user_id and author.deleted_at is null and comments.deleted_at is null
    where comments.post_id = ${postId}::uuid and comments.parent_comment_id is not distinct from ${parentId}::uuid
      and (comments.deleted_at is null or exists(select 1 from public.feed_comments child where child.post_id = comments.post_id and child.parent_comment_id = comments.id))
      and ${visiblePost(campus(user))}
      and (${cursor?.at ?? null}::timestamptz is null or (comments.created_at, comments.id) > (${cursor?.at ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    order by comments.created_at, comments.id limit ${pageSize + 1}
  `);
  const comments = result.rows.slice(0, pageSize);
  return c.json({ comments, parentDeleted: parent?.is_deleted === true, nextCursor: result.rows.length > pageSize ? nextFeedCursor(comments[comments.length - 1]!, "created_at") : null });
});

feedSocialRoutes.post("/:id/comments", requireAuth, async (c) => {
  c.header("Cache-Control", "private, no-store");
  await requireReplies(c);
  const user = currentUser(c);
  const university = campus(user);
  const postId = id(c.req.param("id"));
  const data = await input(c, z.object({ body: z.string().trim().min(1).max(2000), requestId: uuid, parentCommentId: uuid.optional() }));
  const parentId = data.parentCommentId ?? null;
  const retry = firstRow(await database(c.env).execute(sql`
    select id, post_id, body, parent_comment_id, deleted_at from public.feed_comments
    where author_user_id = ${user.id}::uuid and client_request_id = ${data.requestId}::uuid limit 1
  `));
  if (retry && (retry.post_id !== postId || retry.body !== data.body || (retry.parent_comment_id ?? null) !== parentId || retry.deleted_at))
    throw new AppError(409, "CONFLICT", "This draft or reply target changed. Send it as a new message.");
  if (!retry) await rateLimit(c, "FEED_COMMENT", 60);
  const result = await database(c.env).execute(sql`
    with target as (
      select posts.id, posts.university_id from public.feed_posts posts
      where posts.id = ${postId}::uuid and ${visiblePost(university)} for update
    ), parent as (
      select parents.id from public.feed_comments parents
      join target on target.id = parents.post_id and target.university_id = parents.institution_id
      where parents.id = ${parentId}::uuid and (parents.deleted_at is null or ${retry?.id ?? null}::uuid is not null)
      for update of parents
    ), saved as (
      insert into public.feed_comments(post_id, institution_id, author_user_id, body, client_request_id, parent_comment_id)
      select id, university_id, ${user.id}::uuid, ${data.body}, ${data.requestId}::uuid, ${parentId}::uuid from target
      where ${parentId}::uuid is null or exists(select 1 from parent)
      on conflict(author_user_id, client_request_id) do update set client_request_id = excluded.client_request_id
        where feed_comments.post_id = excluded.post_id and feed_comments.body = excluded.body and feed_comments.deleted_at is null
          and feed_comments.parent_comment_id is not distinct from excluded.parent_comment_id
      returning id, body, created_at, author_user_id, parent_comment_id
    )
    select saved.id, saved.body, saved.created_at, saved.parent_comment_id, false as is_deleted, true as can_delete,
      coalesce(author.display_name, 'KampusOne user') as author_name,
      author.profile_image_url as author_image_url, author.username as author_username,
      coalesce(author.verification_status::text = 'VERIFIED', false) as author_verified,
      (select count(*)::int from public.feed_comments replies where replies.post_id = ${postId}::uuid and replies.parent_comment_id = saved.id
        and (replies.deleted_at is null or exists(select 1 from public.feed_comments child where child.post_id = replies.post_id and child.parent_comment_id = replies.id))) as reply_count
    from saved left join public.profiles author on author.user_id = saved.author_user_id and author.deleted_at is null
  `);
  const comment = firstRow(result);
  if (!comment) throw new AppError(409, "CONFLICT", "The post or comment is unavailable, or this message request has already changed. Your draft has not been cleared.");
  return c.json({ comment }, retry ? 200 : 201);
});

feedSocialRoutes.delete("/:id/comments/:commentId", requireAuth, async (c) => {
  c.header("Cache-Control", "private, no-store");
  await requireReplies(c);
  const user = currentUser(c);
  campus(user);
  const postId = id(c.req.param("id"));
  const commentId = id(c.req.param("commentId"));
  // Parent-post ownership does not authorize deleting somebody else's comment.
  // Soft deletion never cascades to other people's replies.
  const result = await database(c.env).execute(sql`
    update public.feed_comments set deleted_at = coalesce(deleted_at, now())
    where id = ${commentId}::uuid and post_id = ${postId}::uuid and author_user_id = ${user.id}::uuid returning id
  `);
  if (!firstRow(result)) throw new AppError(404, "NOT_FOUND", "This comment is unavailable or you do not have permission to delete it.");
  // A fresh snapshot sees replies that committed while the delete waited for the parent lock.
  const thread = firstRow(await database(c.env).execute<{ retained: boolean; reply_count: number }>(sql`
    select exists(select 1 from public.feed_comments where post_id = ${postId}::uuid and parent_comment_id = ${commentId}::uuid) as retained,
      (select count(*)::int from public.feed_comments replies where replies.post_id = ${postId}::uuid and replies.parent_comment_id = ${commentId}::uuid
        and (replies.deleted_at is null or exists(select 1 from public.feed_comments child where child.post_id = replies.post_id and child.parent_comment_id = replies.id))) as reply_count
  `));
  return c.json({ id: commentId, deleted: true, retained: thread?.retained ?? false, reply_count: thread?.reply_count ?? 0 });
});

feedSocialRoutes.put("/:id/repost", requireAuth, async (c) => {
  await requireSocial(c);
  const user = currentUser(c);
  const postId = id(c.req.param("id"));
  await rateLimit(c, "FEED_REPOST", 60);
  const result = await database(c.env).execute(sql`
    with target as (
      select posts.id, posts.university_id from public.feed_posts posts
      where posts.id = ${postId}::uuid and ${visiblePost(campus(user))} for update
    ), saved as (
      insert into public.feed_reposts(post_id, institution_id, user_id)
      select id, university_id, ${user.id}::uuid from target on conflict(post_id, user_id) do nothing
    ) select id from target
  `);
  if (!firstRow(result)) throw new AppError(404, "NOT_FOUND", "This post is no longer available to repost.");
  return c.json({ reposted: true, post: await readPost(c, postId) });
});

feedSocialRoutes.delete("/:id/repost", requireAuth, async (c) => {
  await requireSocial(c);
  const user = currentUser(c);
  campus(user);
  const postId = id(c.req.param("id"));
  await database(c.env).execute(sql`delete from public.feed_reposts where post_id = ${postId}::uuid and user_id = ${user.id}::uuid`);
  return c.json({ reposted: false });
});

feedSocialRoutes.put("/:id/bookmark", requireAuth, async (c, next) => {
  if (!await socialSchemaReady(c.env)) return next();
  const user = currentUser(c);
  const postId = id(c.req.param("id"));
  const result = await database(c.env).execute(sql`
    with target as (select posts.id from public.feed_posts posts where posts.id = ${postId}::uuid and ${visiblePost(campus(user))} for update),
    saved as (insert into public.feed_bookmarks(user_id, post_id) select ${user.id}::uuid, id from target on conflict do nothing)
    select id from target
  `);
  if (!firstRow(result)) throw new AppError(404, "NOT_FOUND", "This post is unavailable.");
  return c.json({ bookmarked: true });
});
