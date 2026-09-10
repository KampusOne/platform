import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

import { allowedOrigins, getPublicConfig, readiness } from "./lib/config";
import { AppError, errorResponse } from "./lib/errors";
import { authRoutes } from "./routes/auth";
import { studentRoutes } from "./routes/student";
import { agentRoutes } from "./routes/agents";
import { adminRoutes } from "./routes/admin";
import { paymentRoutes } from "./routes/payments";
import type { Bindings, Variables } from "./types";

export const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("*", requestId());
app.use("*", secureHeaders());
app.use("/v1/*", async (context, next) => {
  const origins = allowedOrigins(context.env);
  return cors({
    origin: (origin) => (origins.has(origin) ? origin : undefined),
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-Request-Id", "X-Device-Label", "X-Admin-Bootstrap-Token"],
    exposeHeaders: ["X-Request-Id"],
    credentials: true,
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
app.route("/v1/auth", authRoutes);
app.route("/v1/student", studentRoutes);
app.route("/v1/agents", agentRoutes);
app.route("/v1/admin", adminRoutes);
app.route("/v1/payments", paymentRoutes);

app.notFound((context) =>
  errorResponse(context, 404, "NOT_FOUND", "The requested resource does not exist."),
);

app.onError((error, context) => {
  if (error instanceof AppError) {
    return errorResponse(context, error.status, error.code, error.message, error.details);
  }

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
