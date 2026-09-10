import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { ingestAnalyticsEvents, validateAnalyticsBatch } from "./lib/analytics";
import { authenticateSupabaseUser, hasProductAnalyticsConsent } from "./lib/auth";
import { allowedOrigins, getPublicConfig, readiness } from "./lib/config";
import { errorResponse } from "./lib/errors";
import type { Bindings, Variables } from "./types";

export const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("*", requestId());
app.use("*", secureHeaders());
app.use("/v1/*", async (context, next) => {
  const origins = allowedOrigins(context.env);
  return cors({
    origin: (origin) => (origins.has(origin) ? origin : undefined),
    allowMethods: ["GET", "POST", "HEAD", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
    exposeHeaders: ["X-Request-Id"],
    maxAge: 86400,
  })(context, next);
});

app.get("/", (context) =>
  context.json({
    service: "kampusone-api",
    message: "KampusOne privileged API boundary",
    documentation: "/v1/config/public",
    requestId: context.get("requestId"),
  }),
);

app.get("/health/live", (context) =>
  context.json({
    status: "ok" as const,
    service: "kampusone-api" as const,
    environment: context.env.ENVIRONMENT,
    requestId: context.get("requestId"),
  }),
);

app.get("/health/ready", (context) => {
  const state = readiness(context.env);
  return context.json(
    {
      status: state.ready ? "ready" : "not_ready",
      checks: state.checks,
      requestId: context.get("requestId"),
    },
    state.ready ? 200 : 503,
  );
});

app.get("/v1/config/public", (context) => context.json(getPublicConfig(context.env)));

app.post("/v1/analytics/events", async (context) => {
  if (context.env.ANALYTICS_INGEST_ENABLED.toLowerCase() !== "true") {
    return errorResponse(context, 503, "FEATURE_DISABLED", "Product analytics ingestion is disabled.");
  }
  if (!context.env.NEON_DATABASE_URL) {
    return errorResponse(context, 503, "PROVIDER_UNAVAILABLE", "The analytics store is not configured.");
  }

  const contentLength = Number(context.req.header("content-length") ?? 0);
  if (contentLength > 128_000) {
    return errorResponse(context, 413, "BAD_REQUEST", "The analytics batch is too large.");
  }

  const authorization = context.req.header("authorization");
  const user = await authenticateSupabaseUser(context.env, authorization);
  if (!user || !authorization) {
    return errorResponse(context, 401, "UNAUTHENTICATED", "A valid KampusOne session is required.");
  }

  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    return errorResponse(context, 400, "BAD_REQUEST", "The request body must be valid JSON.");
  }
  const batch = validateAnalyticsBatch(body);
  if (!batch.ok) return errorResponse(context, 400, "BAD_REQUEST", batch.message);

  const consent = await hasProductAnalyticsConsent(context.env, authorization, user.id);
  if (!consent) {
    return context.json({ accepted: 0, skipped: batch.events.length, reason: "analytics_consent_disabled", requestId: context.get("requestId") }, 202);
  }

  const accepted = await ingestAnalyticsEvents(context.env, user.id, batch.events);
  return context.json({ accepted, skipped: batch.events.length - accepted, requestId: context.get("requestId") }, 202);
});

app.notFound((context) =>
  errorResponse(context, 404, "NOT_FOUND", "The requested resource does not exist."),
);

app.onError((error, context) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "request.failed",
      requestId: context.get("requestId"),
      method: context.req.method,
      path: context.req.path,
      message: error.message,
    }),
  );

  return errorResponse(
    context,
    500,
    "INTERNAL_ERROR",
    "The service could not complete this request.",
  );
});
