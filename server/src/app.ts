import { publicBadgeAdminRoutes, publicBadgeProfileRoutes } from "./routes/public-badges";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";

import { allowedOrigins, getPublicConfig, readiness } from "./lib/config";
import { AppError, errorResponse } from "./lib/errors";
import { hashPassword, verifyPassword } from "./lib/security";
import { authRoutes } from "./routes/auth";
import { studentRoutes } from "./routes/student";
import { feedPostRoutes } from "./routes/feed-posts";
import { feedExperienceRoutes } from "./routes/feed-experience";
import { agentRoutes } from "./routes/agents";
import { adminRoutes } from "./routes/admin";
import { paymentRoutes } from "./routes/payments";
import { accountRoutes } from "./routes/account";
import { mediaRoutes } from "./routes/media";
import { learningRoutes } from "./routes/learning";
import { applicationRoutes } from "./routes/applications";
import { manageRoutes } from "./routes/manage";
import { aiRoutes } from "./routes/ai";
import { communityRoutes } from "./routes/communities";
import { socialAuthRoutes } from "./routes/social-auth";
import type { Bindings, Variables } from "./types";

export const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use("*", requestId());
app.use("*", secureHeaders());
app.use("/v1/*", async (c, next) =>
  bodyLimit({
    maxSize: c.req.path === "/v1/media" || c.req.path === "/v1/media/" ? 10 * 1024 * 1024 + 4096 : 256 * 1024,
    onError: () => { throw new AppError(413, "BAD_REQUEST", "This upload or request is too large."); },
  })(c, next),
);
app.use("/v1/*", async (context, next) => {
  const origins = allowedOrigins(context.env);
  return cors({
    origin: (origin) => (origins.has(origin) ? origin : undefined),
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-Request-Id", "X-Device-Label", "X-Admin-Bootstrap-Token"],
    exposeHeaders: ["X-Request-Id"], credentials: true, maxAge: 86400,
  })(context, next);
});
app.get("/", (context) => context.json({ service: "kampusone-api", message: "KampusOne privileged API boundary", documentation: "/v1/config/public", requestId: context.get("requestId") }));
app.get("/health/live", (context) => context.json({ status: "ok" as const, service: "kampusone-api" as const, environment: context.env.ENVIRONMENT, requestId: context.get("requestId") }));
app.get("/health/ready", (context) => {
  const state = readiness(context.env);
  return context.json({ status: state.ready ? "ready" : "not_ready", checks: state.checks, requestId: context.get("requestId") }, state.ready ? 200 : 503);
});
app.get("/health/crypto", async (context) => {
  if (context.env.ENVIRONMENT !== "local") return errorResponse(context, 404, "NOT_FOUND", "The requested resource does not exist.");
  const probePassword = "KampusOne Worker runtime crypto probe";
  const hash = await hashPassword(probePassword);
  const verified = await verifyPassword(probePassword, hash);
  if (!verified) return errorResponse(context, 500, "INTERNAL_ERROR", "Password hashing runtime verification failed.");
  return context.json({ status: "ok" as const, algorithm: "pbkdf2-sha256" as const, requestId: context.get("requestId") });
});
app.get("/v1/config/public", (context) => context.json(getPublicConfig(context.env)));
app.use("/v1/*", async (c, next) => {
  if (/^\/v1\/(account|media|learning|applications|manage|communities)(\/|$)/.test(c.req.path) && c.env.UNIFIED_SCHEMA_READY !== "true")
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "This service is being connected. Please try again shortly.");
  await next();
});
app.route("/v1/auth", authRoutes);
// Additive conversation features preserve the original read/deletion authorization.
app.route("/v1/student/feed", feedExperienceRoutes);
app.route("/v1/student/feed", feedPostRoutes);
app.route("/v1/student", publicBadgeProfileRoutes);
app.route("/v1/student", studentRoutes);
app.route("/v1/agents", agentRoutes);
app.route("/v1/admin/public-badges", publicBadgeAdminRoutes);
app.route("/v1/admin", adminRoutes);
app.route("/v1/payments", paymentRoutes);
app.route("/v1/account", accountRoutes);
app.route("/v1/media", mediaRoutes);
app.route("/v1/learning", learningRoutes);
app.route("/v1/applications", applicationRoutes);
app.route("/v1/manage", manageRoutes);
app.route("/v1/ai", aiRoutes);
app.route("/v1/communities", communityRoutes);
app.route("/v1/auth/social", socialAuthRoutes);
app.notFound((context) => errorResponse(context, 404, "NOT_FOUND", "The requested resource does not exist."));
app.onError((error, context) => {
  if (error instanceof AppError) return errorResponse(context, error.status, error.code, error.message, error.details);
  // Never log database payloads: they may include private identity or message data.
  console.error(JSON.stringify({ level: "error", event: "request.failed", requestId: context.get("requestId"), method: context.req.method, path: context.req.path, errorName: error.name, errorCode: typeof (error as Error & { code?: unknown }).code === "string" ? (error as Error & { code?: unknown }).code : undefined }));
  return errorResponse(context, 500, "INTERNAL_ERROR", "The service could not complete this request.");
});
