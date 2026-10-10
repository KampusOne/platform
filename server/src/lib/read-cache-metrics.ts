import type { Bindings } from "../types";

export type CacheOutcome = "hit" | "miss" | "coalesced" | "bypass" | "corrupt" | "read_failed" | "store_failed" | "oversize" | "revision_unavailable";
export type ReadMetrics = {
  startedAt: number; dbQueries: number; dbRoundTrips: number; dbMs: number; dbFailures: number;
  authMs: number; authQueries: number; authDbMs: number;
  cache: Partial<Record<CacheOutcome, number>>;
  completed?: { requestId: string; method: string; route: string; status: number };
};
// Middleware supplies new bindings for each request; never log SQL/parameters.
const requests = new WeakMap<Bindings, ReadMetrics>();
export function beginReadMetrics(env: Bindings) {
  const metrics: ReadMetrics = { startedAt: performance.now(), dbQueries: 0, dbRoundTrips: 0, dbMs: 0, dbFailures: 0, authMs: 0, authQueries: 0, authDbMs: 0, cache: {} };
  requests.set(env, metrics);
  return metrics;
}
export async function measureAuthorization<T>(env: Bindings, operation: () => Promise<T>): Promise<T> {
  const metrics = requests.get(env);
  if (!metrics) return operation();
  const startedAt = performance.now(), queries = metrics.dbQueries, dbMs = metrics.dbMs;
  try { return await operation(); }
  finally {
    metrics.authMs += performance.now() - startedAt;
    metrics.authQueries += metrics.dbQueries - queries;
    metrics.authDbMs += metrics.dbMs - dbMs;
  }
}
export function readMetrics(env: Bindings) { return requests.get(env); }
export function cacheOutcome(env: Bindings, outcome: CacheOutcome) {
  const metrics = requests.get(env);
  if (metrics) {
    metrics.cache[outcome] = (metrics.cache[outcome] ?? 0) + 1;
    // Cache API writes finish in waitUntil, often after the response log.
    if (outcome === "store_failed" && metrics.completed)
      console.log(JSON.stringify({ event: "read.cache.background", ...metrics.completed, outcome }));
  }
}
export async function measureDatabase<T>(env: Bindings, queries: number, operation: () => PromiseLike<T>): Promise<T> {
  const metrics = requests.get(env);
  if (!metrics) return operation();
  metrics.dbQueries += queries;
  metrics.dbRoundTrips++;
  const start = performance.now();
  try { return await operation(); }
  catch (error) { metrics.dbFailures++; throw error; }
  finally { metrics.dbMs += performance.now() - start; }
}
