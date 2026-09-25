import { sql } from "drizzle-orm";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";

import type { AuthenticatedUser, Bindings, Variables } from "../types";
import { database, firstRow } from "../lib/database";
import { allowedOrigins } from "../lib/config";
import { AppError } from "../lib/errors";
import { verifyAccessToken } from "../lib/security";

// Only successfully checked Context objects, never identities shared across requests.
const authenticatedRequests = new WeakSet<object>();

type AppEnvironment = { Bindings: Bindings; Variables: Variables };

function bearerToken(header: string | undefined) {
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice(7).trim() || undefined;
}

export const requireAuth = createMiddleware<AppEnvironment>(
  async (context, next) => {
    if (authenticatedRequests.has(context)) return next();
    const bearer = bearerToken(context.req.header("Authorization"));
    const token = bearer ?? getCookie(context, "k1_access");
    if (!token)
      throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
    if (!bearer && !["GET", "HEAD", "OPTIONS"].includes(context.req.method)) {
      const origin = context.req.header("Origin");
      if (!origin || !allowedOrigins(context.env).has(origin)) {
        throw new AppError(
          403,
          "FORBIDDEN",
          "This browser origin is not allowed to change account data.",
        );
      }
    }

    const claims = await verifyAccessToken(context.env, token);
    if (context.env.UNIFIED_SCHEMA_READY === "true" && !claims.sessionFamilyId)
      throw new AppError(
        401,
        "UNAUTHENTICATED",
        "Refresh your session to continue.",
      );
    const result = await database(context.env).execute<{
      id: string;
      email: string;
      roles: string[] | null;
      university_id: string | null;
      operator_roles: string[] | null;
    }>(sql`
    select
      users.id,
      users.email,
      users.roles::text[] as roles,
      profiles.university_id,
      coalesce(
        array_agg(distinct operator_roles.role) filter (
          where operator_roles.role is not null
            and (operator_roles.role <> 'PLATFORM_ADMIN' or operator_roles.university_id is null)
            and (operator_roles.expires_at is null or operator_roles.expires_at > now())
        ),
        '{}'::text[]
      ) as operator_roles
    from public.users users
    left join public.profiles profiles on profiles.user_id = users.id and profiles.deleted_at is null
    left join public.operator_roles operator_roles on operator_roles.user_id = users.id
    where users.id = ${claims.id}::uuid
      and users.deleted_at is null
      and users.status::text = 'ACTIVE'
      and (${claims.sessionFamilyId ?? null}::uuid is null or exists (
        select 1 from public.refresh_tokens rt where rt.user_id=users.id
          and rt.family_id=${claims.sessionFamilyId ?? null}::uuid and rt.revoked_at is null and rt.expires_at>now()
      ))
    group by users.id, users.email, users.roles, profiles.university_id
    limit 1
  `);
    const row = firstRow(result);
    if (!row)
      throw new AppError(
        401,
        "UNAUTHENTICATED",
        "This account is unavailable.",
      );

    const user: AuthenticatedUser = {
      id: row.id,
      email: row.email,
      roles: row.roles ?? [],
      universityId: row.university_id,
      operatorRoles: row.operator_roles ?? [],
      ...(claims.sessionFamilyId
        ? { sessionFamilyId: claims.sessionFamilyId }
        : {}),
    };
    context.set("user", user);
    if (
      context.env.UNIFIED_SCHEMA_READY === "true" &&
      !["/v1/account/restrictions", "/v1/account/support"].includes(
        context.req.path,
      ) &&
      !context.req.path.startsWith("/v1/auth/")
    ) {
      const restriction = firstRow(
        await database(context.env).execute<{
          kind: string;
          reason: string;
          ends_at: string | null;
        }>(
          sql`select kind,reason,ends_at from public.account_restrictions where user_id=${user.id}::uuid and revoked_at is null and starts_at<=now() and(ends_at is null or ends_at>now()) order by starts_at desc limit 1`,
        ),
      );
      if (restriction)
        throw new AppError(
          403,
          "ACCOUNT_RESTRICTED",
          "Your account has been restricted.",
          restriction,
        );
    }
    authenticatedRequests.add(context);
    await next();
  },
);

export function currentUser(context: {
  get(key: "user"): AuthenticatedUser | undefined;
}) {
  const user = context.get("user");
  if (!user) throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
  return user;
}

export function requireOperator(...accepted: string[]) {
  return createMiddleware<AppEnvironment>(async (context, next) => {
    const user = currentUser(context);
    if (!accepted.some((role) => user.operatorRoles.includes(role))) {
      throw new AppError(
        403,
        "FORBIDDEN",
        "You do not have permission to use this workspace.",
      );
    }
    await next();
  });
}

export function setSessionCookies(
  context: Parameters<typeof setCookie>[0],
  env: Bindings,
  accessToken: string,
  refreshToken: string,
) {
  const shared = {
    httpOnly: true,
    sameSite: "Lax" as const,
    secure: env.ENVIRONMENT !== "local",
    path: "/",
    ...sessionCookieDomain(context, env),
  };
  setCookie(context, "k1_access", accessToken, { ...shared, maxAge: 15 * 60 });
  setCookie(context, "k1_refresh", refreshToken, {
    ...shared,
    maxAge: 30 * 24 * 60 * 60,
  });
}

export function refreshCookie(context: Parameters<typeof getCookie>[0]) {
  return getCookie(context, "k1_refresh");
}

export function clearSessionCookies(
  context: Parameters<typeof deleteCookie>[0],
  env: Bindings,
) {
  const options = {
    path: "/",
    ...sessionCookieDomain(context, env),
  };
  deleteCookie(context, "k1_access", options);
  deleteCookie(context, "k1_refresh", options);
}

function sessionCookieDomain(
  context: Parameters<typeof setCookie>[0],
  env: Bindings,
) {
  if (!env.COOKIE_DOMAIN) return {};
  const domain = env.COOKIE_DOMAIN.replace(/^\./, "").toLowerCase();
  const origin = context.req.header("Origin");
  // A same-origin preview proxy cannot set a cookie for the owned production
  // domain. Browsers silently discard it, causing repeated login on reopening.
  const hostname = new URL(
    origin && allowedOrigins(env).has(origin) ? origin : context.req.url,
  ).hostname;
  return hostname === domain || hostname.endsWith(`.${domain}`)
    ? { domain: env.COOKIE_DOMAIN }
    : {};
}
