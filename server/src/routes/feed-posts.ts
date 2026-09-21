import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { AppError } from "../lib/errors";
import { currentUser, requireAuth } from "../middleware/auth";
import { feedSocialRoutes, readVisiblePost } from "./feed-social";
import type { Bindings, Variables } from "../types";

export const feedPostRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();
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

// Each exact route authenticates once; legacy student POST remains independent.
feedPostRoutes.route("/", feedSocialRoutes);

feedPostRoutes.get("/:id", requireAuth, async (context) => {
  context.header("Cache-Control", "private, no-store");
  const id = postId(context.req.param("id"));
  const post = await readVisiblePost(context, id);
  return context.json({ post });
});

feedPostRoutes.delete("/:id", requireAuth, async (context) => {
  context.header("Cache-Control", "private, no-store");
  const user = currentUser(context);
  const id = postId(context.req.param("id"));
  const campus = universityId(user);
  // Only the authenticated author can delete. A transfer between universities
  // must not stop that author deleting their own public student post or quote.
  // Archive the original; reposts and quote embeds disappear through visibility
  // checks. A quote's own text remains owned by its author, not the original author.
  const result = await database(context.env).execute(sql`
    with removed as (
      update public.feed_posts
      set updated_at = case when status = 'ARCHIVED' then updated_at else now() end,
          status = 'ARCHIVED'
      where id = ${id}::uuid and author_user_id = ${user.id}::uuid
        and (university_id = ${campus}::uuid
          or (audience->>'studentPost' = 'true' and coalesce(audience->>'visibility', 'PUBLIC') = 'PUBLIC'))
      returning id
    ), removed_bookmarks as (
      delete from public.feed_bookmarks where post_id in (select id from removed)
    )
    select id from removed
  `);
  if (!firstRow(result)) throw new AppError(404, "NOT_FOUND", "This post is unavailable or you do not have permission to delete it.");
  return context.json({ id, deleted: true });
});
