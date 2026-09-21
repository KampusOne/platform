import { sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { AppError } from "../lib/errors";
import { visiblePost } from "../lib/feed-social";
import { currentUser, requireAuth } from "../middleware/auth";
import type { Bindings, Variables } from "../types";

type Environment = { Bindings: Bindings; Variables: Variables };
export const feedCommentLikeRoutes = new Hono<Environment>();
const idSchema = z.string().uuid();
const idsSchema = z.array(idSchema).min(1).max(50);
const readinessCache = new WeakMap<object, number>();

function campusId(user: ReturnType<typeof currentUser>): string {
  if (!user.universityId) throw new AppError(409, "CONFLICT", "Complete your student profile before liking comments.", { onboardingRequired: true });
  return user.universityId;
}
async function requireCommentLikes(context: Context<Environment>) {
  const unavailable = () => new AppError(503, "PROVIDER_UNAVAILABLE", "Comment likes are being connected. Please try again shortly.");
  if (context.env.UNIFIED_SCHEMA_READY !== "true") throw unavailable();
  if ((readinessCache.get(context.env) ?? 0) > Date.now()) return;
  const result = await database(context.env).execute<{ ready: boolean }>(sql`
    select to_regclass('public.feed_comment_likes') is not null
      and to_regprocedure('app_private.set_feed_comment_like(uuid,uuid,uuid,boolean)') is not null as ready
  `);
  if (firstRow(result)?.ready !== true) throw unavailable();
  readinessCache.set(context.env, Date.now() + 60_000);
}

// Mount before the generic /:id post route. Counts are batched, not fetched once
// for every comment. Inaccessible or deleted comments are never returned.
feedCommentLikeRoutes.get("/comment-likes", requireAuth, async (context) => {
  context.header("Cache-Control", "private, no-store");
  const user = currentUser(context), campus = campusId(user);
  const parsed = idsSchema.safeParse(context.req.query("ids")?.split(","));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Choose between 1 and 50 valid comments.");
  const ids = [...new Set(parsed.data)];
  await requireCommentLikes(context);
  const result = await database(context.env).execute(sql`
    select comments.id,
      exists(select 1 from public.feed_comment_likes mine
        where mine.comment_id = comments.id and mine.user_id = ${user.id}::uuid) as liked,
      (select count(*)::integer from public.feed_comment_likes likes where likes.comment_id = comments.id) as like_count
    from public.feed_comments comments
    join public.feed_posts posts on posts.id = comments.post_id and posts.university_id = comments.institution_id
    where comments.id = any(string_to_array(${ids.join(",")}, ',')::uuid[])
      and comments.deleted_at is null and ${visiblePost(campus)}
  `);
  return context.json({ likes: result.rows });
});

async function setLike(context: Context<Environment>, liked: boolean) {
  context.header("Cache-Control", "private, no-store");
  const user = currentUser(context), campus = campusId(user);
  const parsed = idSchema.safeParse(context.req.param("commentId"));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "This comment link is not valid.");
  await requireCommentLikes(context);
  // The database derives and locks the real parent post. Neither actor nor
  // campus nor parent-post authorization comes from a client-supplied body.
  const result = await database(context.env).execute(sql`
    select * from app_private.set_feed_comment_like(
      ${parsed.data}::uuid, ${user.id}::uuid, ${campus}::uuid, ${liked}::boolean
    )
  `);
  const row = firstRow(result);
  if (!row) throw new AppError(404, "NOT_FOUND", "This comment is unavailable. It or its post may have been deleted or may be campus-restricted.");
  return context.json(row);
}
feedCommentLikeRoutes.put("/comments/:commentId/like", requireAuth, (context) => setLike(context, true));
feedCommentLikeRoutes.delete("/comments/:commentId/like", requireAuth, (context) => setLike(context, false));
