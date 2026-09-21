import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { AppError } from "./errors";
import type { currentUser } from "../middleware/auth";

export type FeedViewer = Pick<ReturnType<typeof currentUser>, "id" | "universityId">;

// Only explicit new GLOBAL student publications cross campus boundaries.
// Missing visibility, official notices, and historical student posts stay scoped.
export function visiblePost(alias: "posts" | "original" | "quotes", user: FeedViewer) {
  const table = sql.raw(alias);
  return sql`${table}.status in ('PUBLISHED', 'CORRECTED')
    and ${table}.published_at <= now()
    and (${table}.university_id = ${user.universityId}::uuid
      or (${table}.audience->>'studentPost' = 'true' and ${table}.audience->>'visibility' = 'GLOBAL'))`;
}

export function feedFields(user: FeedViewer) {
  return sql`posts.id, posts.category, posts.title, posts.summary, posts.body,
    posts.image_url, posts.urgent, posts.sponsored, posts.published_at, posts.correction_note,
    case when posts.audience->>'studentPost' = 'true' then coalesce(author.display_name, 'Student') else sources.name end as source_name,
    case when posts.audience->>'studentPost' = 'true' then coalesce(author.verification_status::text = 'VERIFIED', false) else sources.verified end as source_verified,
    coalesce(posts.author_user_id = ${user.id}::uuid, false) as can_delete,
    coalesce(posts.audience->>'studentPost' = 'true' and posts.audience->>'visibility' = 'GLOBAL', false) as is_global,
    exists(select 1 from public.feed_bookmarks b where b.post_id = posts.id and b.user_id = ${user.id}::uuid) as bookmarked,
    (select count(*)::int from public.feed_comments c where c.post_id = posts.id and c.deleted_at is null) as comment_count,
    (select count(*)::int from public.feed_reposts r where r.post_id = posts.id) as repost_count,
    exists(select 1 from public.feed_reposts r where r.post_id = posts.id and r.user_id = ${user.id}::uuid) as reposted,
    (select count(*)::int from public.feed_posts quotes where quotes.quoted_post_id = posts.id and ${visiblePost("quotes", user)}) as quote_count,
    posts.quoted_post_id,
    coalesce(posts.audience->>'quote' = 'true', posts.quoted_post_id is not null) as is_quote,
    (select jsonb_build_object('id', original.id, 'body', original.body, 'title', original.title,
        'image_url', original.image_url, 'published_at', original.published_at,
        'source_name', case when original.audience->>'studentPost' = 'true' then coalesce(oa.display_name, 'Student') else os.name end,
        'source_verified', case when original.audience->>'studentPost' = 'true' then coalesce(oa.verification_status::text = 'VERIFIED', false) else os.verified end,
        'is_global', coalesce(original.audience->>'studentPost' = 'true' and original.audience->>'visibility' = 'GLOBAL', false))
      from public.feed_posts original
      join public.content_sources os on os.id = original.source_id
      left join public.profiles oa on oa.user_id = original.author_user_id and oa.deleted_at is null
      where original.id = posts.quoted_post_id and ${visiblePost("original", user)} limit 1) as quoted_post`;
}

const cursorSchema = z.object({
  at: z.string().min(1).max(80).refine((value) => Number.isFinite(Date.parse(value))),
  id: z.string().uuid(),
}).strict();

export function feedCursor(value: string | undefined): { at: string; id: string } | null {
  if (!value) return null;
  try {
    if (value.length > 300) throw new Error("too long");
    const parsed = cursorSchema.safeParse(JSON.parse(value));
    if (parsed.success) return parsed.data;
  } catch { /* Return a client error, never interpolate malformed cursor text. */ }
  throw new AppError(400, "BAD_REQUEST", "This page cursor is invalid. Refresh and try again.");
}

export function nextFeedCursor(rows: Record<string, unknown>[], size: number): string | null {
  if (rows.length <= size) return null;
  const last = rows[size - 1]!;
  // Keep PostgreSQL's timestamp precision rather than truncating to milliseconds.
  return JSON.stringify({ at: String(last.cursor_at), id: String(last.id) });
}
