import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { input } from "../lib/input";
import { database, firstRow } from "../lib/database";
import { AppError } from "../lib/errors";
import { sha256 } from "../lib/security";
import { allowedOrigins } from "../lib/config";
import { createSession } from "../services/sessions";
import { setSessionCookies } from "../middleware/auth";
import {
  resolveSupabaseIdentity,
  supabaseAuthRequest,
  supabaseConfiguration,
} from "../services/supabase-identity";
import type { Bindings, Variables } from "../types";
export const socialAuthRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();
socialAuthRoutes.get("/config", (c) => {
  const { url } = supabaseConfiguration(c.env);
  return c.json({ url, providers: ["google", "apple"] });
});
socialAuthRoutes.post("/complete", async (c) => {
  const origin = c.req.header("Origin");
  if (origin && !allowedOrigins(c.env).has(origin))
    throw new AppError(403, "FORBIDDEN", "This sign-in origin is not allowed.");
  const d = await input(
    c,
    z.object({
      authCode: z.string().min(1).max(4096),
      codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
      deviceLabel: z.string().max(120).optional(),
    }),
  );
  const key = await sha256(
    c.req.header("CF-Connecting-IP") ??
      c.req.header("X-Forwarded-For")?.split(",")[0] ??
      "unknown",
  );
  const allowed = firstRow(
    await database(c.env).execute<{ allowed: boolean }>(
      sql`select app_private.consume_request_rate_limit('SOCIAL_AUTH',${key},20,900,900) allowed`,
    ),
  );
  if (!allowed?.allowed)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Too many sign-in attempts. Please try again later.",
    );
  const result = (await supabaseAuthRequest(c.env, "token?grant_type=pkce", {
    auth_code: d.authCode,
    code_verifier: d.codeVerifier,
  })) as { access_token?: string };
  if (!result?.access_token)
    throw new AppError(401, "UNAUTHENTICATED", "Sign-in did not complete.");
  const user = await resolveSupabaseIdentity(c.env, result.access_token);
  const session = await createSession(c.env, user, {
    deviceLabel: d.deviceLabel ?? "Social sign-in",
    ...(c.req.header("CF-Connecting-IP")
      ? { ipAddress: c.req.header("CF-Connecting-IP")! }
      : {}),
    ...(c.req.header("User-Agent")
      ? { userAgent: c.req.header("User-Agent")! }
      : {}),
  });
  setSessionCookies(c, c.env, session.accessToken, session.refreshToken);
  return c.json(session);
});
