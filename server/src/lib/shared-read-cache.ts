import type { Context } from "hono";
import type { Bindings, Variables } from "../types";

/**
 * Cache ONLY institution-wide, non-personal datasets after the route has
 * authorized the requester. A key must include the institution/campus and
 * content revision. Sensitive endpoints must never call this helper.
 *
 * The public Cache API is used internally as a shared JSON object store;
 * the actual API response stays private,no-store and is rebuilt per request,
 * so authorization, CORS and request headers are not stored in the cache.
 */
type JsonCache = {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, value: Response): Promise<void>;
};
const flights = new Map<string, Promise<unknown>>();

export async function cachedSharedRead<T>(
  context: Context<{ Bindings: Bindings; Variables: Variables }>,
  resource: string,
  scope: string,
  ttlSeconds: number,
  load: () => Promise<T>,
  injectedCache?: JsonCache,
): Promise<T> {
  const cache = injectedCache ?? (typeof caches === "undefined" ? undefined : caches.default);
  if (!cache || context.env.ENVIRONMENT === "local" || context.env.SHARED_READ_CACHE_ENABLED === "false") return load();

  // Internal key: excludes cookies, bearer tokens, IPs, user IDs and all
  // transient response headers. Cross-tenant reuse is prevented by scope.
  const keyUrl = new URL(context.req.url);
  keyUrl.pathname = "/__kampusone_internal_cache/v1/" + encodeURIComponent(resource);
  keyUrl.search = "?scope=" + encodeURIComponent(scope);
  const key = new Request(keyUrl.toString());

  try {
    const found = await cache.match(key);
    if (found?.ok) return await found.json<T>();
  } catch {
    // Cache read failure is not a user-facing backend error.
  }
  const keyString = keyUrl.toString();
  const alreadyLoading = flights.get(keyString) as Promise<T> | undefined;
  if (alreadyLoading) return alreadyLoading;

  const job = (async () => {
    const result = await load();
    const safeSeconds = Math.min(900, Math.max(1, Math.floor(ttlSeconds)));
    try {
      const response = Response.json(result, {
        headers: { "Cache-Control": "public, max-age=" + safeSeconds },
      });
      const write = cache.put(key, response).catch(() => {
        // Failure to populate the optimization must never fail the real request.
      });
      try {
        context.executionCtx.waitUntil(write);
      } catch {
        void write; // Node tests and local runtimes may not provide waitUntil.
      }
    } catch {
      // JSON/cache API failures must not turn an otherwise valid read into a 500.
    }
    return result;
  })();
  flights.set(keyString, job);
  try {
    return await job;
  } finally {
    if (flights.get(keyString) === job) flights.delete(keyString);
  }
}
