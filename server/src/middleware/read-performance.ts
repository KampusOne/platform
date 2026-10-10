import type { MiddlewareHandler } from "hono";
import { beginReadMetrics } from "../lib/read-cache-metrics";
import type { Bindings, Variables } from "../types";

export const readPerformance: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (c, next) => {
  if (c.env.READ_CACHE_METRICS_ENABLED !== "true") return next();
  c.env = { ...c.env };
  const metrics = beginReadMetrics(c.env);
  try { await next(); }
  finally {
    metrics.completed = {
      requestId: c.get("requestId"), method: c.req.method,
      route: c.req.routePath || "/unmatched", status: c.res.status,
    };
    console.log(JSON.stringify({
      event: "read.performance", ...metrics.completed,
      durationMs: Math.round((performance.now() - metrics.startedAt) * 100) / 100,
      dbQueries: metrics.dbQueries, dbRoundTrips: metrics.dbRoundTrips,
      dbMs: Math.round(metrics.dbMs * 100) / 100, dbFailures: metrics.dbFailures, cache: metrics.cache,
      authMs: Math.round(metrics.authMs * 100) / 100, authQueries: metrics.authQueries,
      authDbMs: Math.round(metrics.authDbMs * 100) / 100,
    }));
  }
};
