import { sql } from "drizzle-orm";
import { database, firstRow } from "./database";
import type { Bindings } from "../types";
const cache = new WeakMap<object, { ready: boolean; expires: number }>();
export async function feedExperienceReady(env: Bindings): Promise<boolean> {
  if (env.UNIFIED_SCHEMA_READY !== "true") return false;
  const saved = cache.get(env);
  if (saved && saved.expires > Date.now()) return saved.ready;
  const row = firstRow(await database(env).execute<{ ready: boolean }>(sql`
    select to_regclass('public.feed_post_views') is not null
      and exists(select 1 from information_schema.columns where table_schema='public' and table_name='feed_comments' and column_name='media_object_id') as ready
  `));
  const ready = row?.ready === true;
  cache.set(env, { ready, expires: Date.now() + (ready ? 60_000 : 5_000) });
  return ready;
}
