import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { AppError } from "../lib/errors";
import { currentUser, requireAuth } from "../middleware/auth";
import { feedSocialRoutes } from "./feed-social";
import { feedLikeRoutes } from "./feed-likes";
import { feedCommentLikeRoutes } from "./feed-comment-likes";
import type { Bindings, Variables } from "../types";

export const feedPostRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();
// Literal like collections must precede both social and legacy /:id detail routes.
feedPostRoutes.route("/", feedCommentLikeRoutes);
feedPostRoutes.route("/", feedLikeRoutes);
// Social routes run first; legacy reads remain available during additive rollout.
feedPostRoutes.route("/", feedSocialRoutes);
const postIdSchema = z.string().uuid();

function postId(value: string) {
  const parsed = postIdSchema.safeParse(value);
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "This post link is not valid.");
  return parsed.data;
}

function universityId(user: ReturnType<typeof currentUser>) {
  if (!user.universityId) {
    throw new AppError(409, "CONFLICT", "Complete your student profile to view campus posts.", { onboardingRequired: true });
  }
  return user.universityId;
}

feedPostRoutes.get("/:id", requireAuth, async (context) => {
  context.header("Cache-Control", "private, no-store");
  const user = currentUser(context);
  const id = postId(context.req.param("id"));
  const campus = universityId(user);
  const result = await database(context.env).execute(sql`
    select posts.id, posts.category, posts.title, posts.summary, posts.body,
      posts.image_url, posts.urgent, posts.sponsored, posts.published_at,
      posts.correction_note,
      case when posts.audience->>'studentPost' = 'true'
        then coalesce(author.display_name, sources.name) else sources.name end as source_name,
      case when posts.audience->>'studentPost' = 'true'
        then coalesce(author.verification_status::text = 'VERIFIED', false)
        else sources.verified end as source_verified,
      coalesce(posts.author_user_id = ${user.id}::uuid, false) as can_delete,
      exists(select 1 from public.feed_bookmarks bookmarks
        where bookmarks.post_id = posts.id and bookmarks.user_id = ${user.id}::uuid) as bookmarked
    from public.feed_posts posts
    join public.content_sources sources on sources.id = posts.source_id
    left join public.profiles author on author.user_id = posts.author_user_id and author.deleted_at is null
    where posts.id = ${id}::uuid and posts.university_id = ${campus}::uuid
      and posts.status in ('PUBLISHED', 'CORRECTED') and posts.published_at <= now()
    limit 1
  `);
  const post = firstRow(result);
  if (!post) throw new AppError(404, "NOT_FOUND", "This post is unavailable. It may have been deleted or may belong to another campus.");
  return context.json({ post });
});

feedPostRoutes.delete("/:id", requireAuth, async (context) => {
  context.header("Cache-Control", "private, no-store");
  const user = currentUser(context);
  const id = postId(context.req.param("id"));
  const campus = universityId(user);
  // The authenticated author AND tenant are part of the atomic mutation.
  // Repeating a successful deletion is safe. Retain the row for moderation history.
  const result = await database(context.env).execute(sql`
    with removed as (
      update public.feed_posts
      set updated_at = case when status = 'ARCHIVED' then updated_at else now() end,
          status = 'ARCHIVED'
      where id = ${id}::uuid and author_user_id = ${user.id}::uuid
        and university_id = ${campus}::uuid
      returning id
    ), removed_bookmarks as (
      delete from public.feed_bookmarks where post_id in (select id from removed)
    )
    select id from removed
  `);
  if (!firstRow(result)) throw new AppError(404, "NOT_FOUND", "This post is unavailable or you do not have permission to delete it.");
  return context.json({ id, deleted: true });
});
