import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { allowedOrigins, getPublicConfig, readiness } from "./lib/config";
import { errorResponse } from "./lib/errors";
import { authenticateUser, callPrivilegedRpc, SupabaseBoundaryError } from "./lib/supabase";
import type { Bindings, Variables } from "./types";

export const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("*", requestId());
app.use("*", secureHeaders());
app.use("/v1/*", async (context, next) => {
  const origins = allowedOrigins(context.env);
  return cors({
    origin: (origin) => (origins.has(origin) ? origin : undefined),
    allowMethods: ["GET", "POST", "HEAD", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-Request-Id"],
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

app.post("/v1/admin/agent-applications/:applicationId/review", async (context) => {
  if (!getPublicConfig(context.env).features.agentApplications) {
    return errorResponse(context, 403, "FEATURE_DISABLED", "Agent application operations are currently disabled.");
  }
  const applicationId = context.req.param("applicationId");
  const body = await context.req.json<{ decision?: string; reason?: string }>().catch((): { decision?: string; reason?: string } => ({}));
  if (!/^[0-9a-f-]{36}$/i.test(applicationId) || !["started", "request_information", "approve", "reject"].includes(body.decision ?? "") || (body.reason?.trim().length ?? 0) < 4) {
    return errorResponse(context, 400, "BAD_REQUEST", "A valid application, decision and review reason are required.");
  }
  const user = await authenticateUser(context.env, context.req.header("Authorization"));
  const data = await callPrivilegedRpc(context.env, "review_agent_application", {
    target_application_id: applicationId,
    review_decision: body.decision!,
    review_reason: body.reason!.trim(),
    actor_id: user.id,
  });
  return context.json({ data, requestId: context.get("requestId") });
});

app.post("/v1/admin/agent-documents/:documentId/review", async (context) => {
  if (!getPublicConfig(context.env).features.agentApplications) {
    return errorResponse(context, 403, "FEATURE_DISABLED", "Agent application operations are currently disabled.");
  }
  const documentId = context.req.param("documentId");
  const body = await context.req.json<{ outcome?: string; reason?: string }>().catch((): { outcome?: string; reason?: string } => ({}));
  if (!/^[0-9a-f-]{36}$/i.test(documentId) || !["pass", "review", "fail"].includes(body.outcome ?? "") || (body.reason?.trim().length ?? 0) < 4) {
    return errorResponse(context, 400, "BAD_REQUEST", "A valid document, outcome and review reason are required.");
  }
  const user = await authenticateUser(context.env, context.req.header("Authorization"));
  const data = await callPrivilegedRpc(context.env, "review_agent_document", {
    target_document_id: documentId,
    review_outcome: body.outcome!,
    review_reason: body.reason!.trim(),
    actor_id: user.id,
  });
  return context.json({ data, requestId: context.get("requestId") });
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

  if (error instanceof SupabaseBoundaryError) {
    return errorResponse(
      context,
      error.status as 401 | 403 | 409 | 503,
      error.status === 401 ? "UNAUTHENTICATED" : error.status === 403 ? "FORBIDDEN" : error.status === 409 ? "CONFLICT" : "PROVIDER_UNAVAILABLE",
      error.message,
    );
  }

  return errorResponse(
    context,
    500,
    "INTERNAL_ERROR",
    "The service could not complete this request.",
  );
});
