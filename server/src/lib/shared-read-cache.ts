import type { Context } from "hono";
import { cacheOutcome } from "./read-cache-metrics";
import { sha256 } from "./security";
import type { Bindings, Variables } from "../types";

/** Non-personal VALUE cache. The caller authorizes on every request; user-facing
 * responses, credentials, permissions and signed URLs never enter this store. */
export type SharedResource = "academic-catalog" | "campus-places" | "campus-features" | "campus-paths" | "campus-capabilities" | "product-categories" | "notification-sound" | "website-articles" | "website-article" | "website-settings";
export type JsonCache = { match(key: Request): Promise<Response | undefined>; put(key: Request, value: Response): Promise<void> };
type Envelope<T> = { version: 2; createdAt: number; expiresAt: number; value: T };
const flights = new Map<string, Promise<unknown>>();
const maxFlights = 128;
const maxBytes = 8 * 1024 * 1024;

export async function cachedSharedRead<T>(
  context: Context<{ Bindings: Bindings; Variables: Variables }>,
  resource: SharedResource, scope: string, ttlSeconds: number, load: () => Promise<T>, injectedCache?: JsonCache,
): Promise<T> {
  const cache = injectedCache ?? (typeof caches === "undefined" ? undefined : (caches as CacheStorage & { default?: JsonCache }).default);
  const bypass = /(?:no-cache|no-store)/i.test(context.req.header?.("Cache-Control") ?? "");
  if (!cache || context.env.ENVIRONMENT === "local" || context.env.SHARED_READ_CACHE_ENABLED !== "true" || bypass || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    cacheOutcome(context.env, "bypass"); return load();
  }
  const digest = await sha256(JSON.stringify([context.env.ENVIRONMENT, resource, scope]));
  const keyUrl = new URL(context.req.url);
  keyUrl.pathname = "/__kampusone_internal_cache/v2/" + resource;
  keyUrl.search = "?scope=" + digest;
  const key = new Request(keyUrl.toString());
  const keyString = key.url;
  const pending = flights.get(keyString) as Promise<T> | undefined;
  if (pending) { cacheOutcome(context.env, "coalesced"); return pending; }

  let write: Promise<void> = Promise.resolve();
  const job = (async () => {
    try {
      const found = await cache.match(key);
      if (found?.status === 200) {
        const saved = await found.json() as Envelope<T>;
        const now = Date.now();
        if (saved?.version === 2 && Number.isFinite(saved.createdAt) && saved.createdAt <= now && Number.isFinite(saved.expiresAt) && saved.expiresAt > now && saved.expiresAt - saved.createdAt <= 900_000 && Object.hasOwn(saved, "value")) {
          cacheOutcome(context.env, "hit"); return saved.value;
        }
        cacheOutcome(context.env, "corrupt");
      }
    } catch { cacheOutcome(context.env, "read_failed"); }
    cacheOutcome(context.env, "miss");
    const result = await load();
    // Downward jitter makes the requested TTL an upper bound.
    const seconds = Math.max(1, Math.floor(Math.min(900, ttlSeconds) * (0.9 + parseInt(digest.slice(0,2),16) / 2550)));
    try {
      const now = Date.now();
      const body = JSON.stringify({ version: 2, createdAt: now, expiresAt: now + seconds * 1000, value: result } satisfies Envelope<T>);
      if (new TextEncoder().encode(body).byteLength > maxBytes) { cacheOutcome(context.env, "oversize"); return result; }
      write = cache.put(key, new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=" + seconds } })).catch(() => { cacheOutcome(context.env, "store_failed"); });
      try { context.executionCtx.waitUntil(write); } catch { /* Tests may have no execution context. */ }
    } catch { cacheOutcome(context.env, "store_failed"); }
    return result;
  })();
  if (flights.size < maxFlights) flights.set(keyString, job);
  // Hold singleflight through cache.put without delaying the live result.
  const remove = () => { if (flights.get(keyString) === job) flights.delete(keyString); };
  void job.then(() => write.then(remove), remove);
  return job;
}
