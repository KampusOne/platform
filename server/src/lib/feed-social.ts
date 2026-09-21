import { sql } from "drizzle-orm";
import { database, firstRow } from "./database";
import { AppError } from "./errors";
import type { Bindings } from "../types";

const readinessCache = new WeakMap<object, { expires: number; ready: boolean }>();
const repliesReadinessCache = new WeakMap<object, { expires: number; ready: boolean }>();

// Reads retain the legacy feed until the additive migration exists.
export async function socialSchemaReady(env: Bindings): Promise<boolean> {
  if (env.UNIFIED_SCHEMA_READY !== "true") return false;
  const cached = readinessCache.get(env);
  if (cached && cached.expires > Date.now()) return cached.ready;
  const result = await database(env).execute<{ ready: boolean }>(sql`
    select to_regclass('public.feed_comments') is not null
      and to_regclass('public.feed_reposts') is not null
      and exists(select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'feed_posts'
          and column_name = 'quoted_post_id') as ready
  `);
  const ready = firstRow(result)?.ready === true;
  readinessCache.set(env, { ready, expires: Date.now() + (ready ? 60_000 : 5_000) });
  return ready;
}

export async function commentRepliesSchemaReady(env: Bindings): Promise<boolean> {
  const cached = repliesReadinessCache.get(env);
  if (cached && cached.expires > Date.now()) return cached.ready;
  const result = await database(env).execute<{ ready: boolean }>(sql`
    select exists(select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'feed_comments' and column_name = 'parent_comment_id') as ready
  `);
  const ready = firstRow(result)?.ready === true;
  repliesReadinessCache.set(env, { ready, expires: Date.now() + (ready ? 60_000 : 5_000) });
  return ready;
}

export function visiblePost(campus: string) {
  return sql`posts.status in ('PUBLISHED', 'CORRECTED') and posts.published_at <= now()
    and (posts.university_id = ${campus}::uuid or posts.audience->>'visibility' = 'PUBLIC')`;
}

export function parseFeedCursor(value: string | undefined): { at: string; id: string } | null {
  if (!value) return null;
  const [at, id, extra] = value.split("|");
  if (!at || !id || extra !== undefined || !/^\d{4}-\d{2}-\d{2}T/.test(at)
    || !Number.isFinite(Date.parse(at))
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new AppError(400, "BAD_REQUEST", "That page link is not valid.");
  }
  return { at, id };
}

export function nextFeedCursor(row: Record<string, unknown>, field: string): string {
  const value = `${String(row.cursor_at ?? row[field])}|${String(row.id)}`;
  parseFeedCursor(value);
  return value;
}
