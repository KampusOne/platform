import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { database, firstRow } from "./database";
import { cachedSharedRead, type SharedResource } from "./shared-read-cache";
import { cacheOutcome } from "./read-cache-metrics";
import type { Bindings, Variables } from "../types";

export type CacheNamespace = "academic.catalog" | "campus.maps" | "commerce.categories" | "notification.sounds" | "website.articles" | "website.settings";
type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;

// Every location reads the committed revision, including for out-of-router edits.
export async function sharedCacheRevision(c: AppContext, namespace: CacheNamespace): Promise<string | undefined> {
  if (c.env.SHARED_READ_CACHE_ENABLED !== "true" || c.env.VERSIONED_READ_CACHE_ENABLED !== "true" || c.env.ENVIRONMENT === "local") return undefined;
  try {
    const row = firstRow(await database(c.env).execute<{ revision: string }>(sql`
      select revision::text from app_private.cache_resource_revisions where resource=${namespace}
    `));
    if (row && /^[1-9][0-9]*$/.test(row.revision)) return row.revision;
  } catch { /* A missing migration/revision must fall back to fresh data. */ }
  cacheOutcome(c.env, "revision_unavailable");
  return undefined;
}
export async function cachedVersionedRead<T>(c: AppContext, resource: SharedResource, namespace: CacheNamespace, scope: string, ttl: number, load: () => Promise<T>): Promise<T> {
  if (/(?:no-cache|no-store)/i.test(c.req.header?.("Cache-Control") ?? "")) {
    cacheOutcome(c.env, "bypass"); return load();
  }
  const revision = await sharedCacheRevision(c, namespace);
  if (!revision) { cacheOutcome(c.env, "bypass"); return load(); }
  return cachedSharedRead(c, resource, JSON.stringify([namespace, revision, scope]), ttl, load);
}
