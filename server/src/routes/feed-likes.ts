import { sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { AppError } from "../lib/errors";
import { visiblePost } from "../lib/feed-social";
import { currentUser, requireAuth } from "../middleware/auth";
import type { Bindings, Variables } from "../types";

type Environment = { Bindings: Bindings; Variables: Variables };
export const feedLikeRoutes = new Hono<Environment>();
const idSchema = z.string().uuid();
const idsSchema = z.array(idSchema).min(1).max(50);

function campusId(user: ReturnType<typeof currentUser>): string {
  if (!user.universityId) throw new AppError(409, "CONFLICT", "Complete your student profile before liking posts.", { onboardingRequired: true });
  return user.universityId;
}

// Register this collection before the generic /:id post-detail route.
feedLikeRoutes.get("/likes", requireAuth, async (context) => {
  context.header("Cache-Control", "private, no-store");
  const user = currentUser(context), campus = campusId(user);
  const parsed = idsSchema.safeParse(context.req.query("ids")?.split(","));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Choose between 1 and 50 valid posts.");
  const ids = [...new Set(parsed.data)];
  const result = await database(context.env).execute(sql`
    select posts.id,
      exists(select 1 from public.feed_likes mine
        where mine.post_id = posts.id and mine.user_id = ${user.id}::uuid) as liked,
      (select count(*)::integer from public.feed_likes likes where likes.post_id = posts.id) as like_count
    from public.feed_posts posts
    where posts.id = any(string_to_array(${ids.join(",")}, ',')::uuid[])
      and ${visiblePost(campus)}
  `);
  return context.json({ likes: result.rows });
});

async function setLike(context: Context<Environment>, liked: boolean) {
  context.header("Cache-Control", "private, no-store");
  const user = currentUser(context), campus = campusId(user);
  const parsed = idSchema.safeParse(context.req.param("id"));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "This post link is not valid.");
  // Identity is always the authenticated session, never a client-supplied user ID.
  const result = await database(context.env).execute(sql`
    select * from app_private.set_feed_post_like(
      ${parsed.data}::uuid, ${user.id}::uuid, ${campus}::uuid, ${liked}::boolean
    )
  `);
  const row = firstRow(result);
  if (!row) throw new AppError(404, "NOT_FOUND", "This post is unavailable. It may have been deleted or may belong to another campus.");
  return context.json(row);
}

feedLikeRoutes.put("/:id/like", requireAuth, (context) => setLike(context, true));
feedLikeRoutes.delete("/:id/like", requireAuth, (context) => setLike(context, false));
