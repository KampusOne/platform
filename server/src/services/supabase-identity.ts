import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { AppError } from "../lib/errors";
import { findUserById, toAuthenticatedUser } from "./sessions";
import type { Bindings } from "../types";
const identitySchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  email_confirmed_at: z.string().nullable().optional(),
  is_anonymous: z.boolean().optional(),
  user_metadata: z.record(z.string(), z.unknown()).optional(),
});
export function supabaseConfiguration(env: Bindings) {
  if (
    env.UNIFIED_SCHEMA_READY !== "true" ||
    !env.SUPABASE_URL ||
    !env.SUPABASE_PUBLISHABLE_KEY
  )
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "This sign-in method is not connected yet.",
    );
  const base = new URL(env.SUPABASE_URL);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.pathname !== "/"
  )
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Authentication configuration needs review.",
    );
  return { url: base.origin, key: env.SUPABASE_PUBLISHABLE_KEY };
}
export async function supabaseAuthRequest(
  env: Bindings,
  path: string,
  payload?: unknown,
  token?: string,
  method = payload === undefined ? "GET" : "POST",
) {
  const config = supabaseConfiguration(env);
  let response: Response;
  try {
    response = await fetch(config.url + "/auth/v1/" + path, {
      method,
      headers: {
        apikey: config.key,
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "The sign-in provider could not be reached.",
    );
  }
  if (!response.ok) {
    if (response.status === 429)
      throw new AppError(
        429,
        "RATE_LIMITED",
        "Too many attempts. Please try again later.",
      );
    if (response.status >= 500)
      throw new AppError(
        503,
        "PROVIDER_UNAVAILABLE",
        "The sign-in provider is temporarily unavailable.",
      );
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "Sign-in could not be verified. Check your details and try again.",
    );
  }
  return response.status === 204 ? null : (response.json() as Promise<unknown>);
}
// Provider identity is verified with Auth; user-editable metadata never assigns a role.
export async function resolveSupabaseIdentity(
  env: Bindings,
  accessToken: string,
) {
  const parsed = identitySchema.safeParse(
    await supabaseAuthRequest(env, "user", undefined, accessToken),
  );
  if (
    !parsed.success ||
    !parsed.data.email_confirmed_at ||
    parsed.data.is_anonymous
  )
    throw new AppError(403, "FORBIDDEN", "Verify your email to continue.");
  const provider = parsed.data;
  const email = provider.email.toLowerCase();
  const db = database(env);
  const existing = firstRow(
    await db.execute<{
      id: string;
      supabase_user_id: string | null;
      status: string;
      deleted_at: string | null;
      privileged: boolean;
    }>(
      sql`select u.id,u.supabase_user_id,u.status::text,u.deleted_at,exists(select 1 from public.operator_roles where user_id=u.id) privileged from public.users u where u.supabase_user_id=${provider.id}::uuid or u.email=${email} order by (u.supabase_user_id=${provider.id}::uuid) desc nulls last limit 1`,
    ),
  );
  let target: string;
  if (existing) {
    if (
      existing.deleted_at ||
      existing.status !== "ACTIVE" ||
      (existing.supabase_user_id && existing.supabase_user_id !== provider.id)
    )
      throw new AppError(
        403,
        "FORBIDDEN",
        "This account cannot use that identity.",
      );
    if (existing.privileged && !existing.supabase_user_id)
      throw new AppError(
        403,
        "FORBIDDEN",
        "Sign in with your existing administrator method before linking a provider.",
      );
    target = existing.id;
    const linked = firstRow(
      await db.execute(
        sql`update public.users set supabase_user_id=${provider.id}::uuid,email_verified_at=coalesce(email_verified_at,now()),updated_at=now() where id=${target}::uuid and (supabase_user_id is null or supabase_user_id=${provider.id}::uuid) returning id`,
      ),
    );
    if (!linked)
      throw new AppError(
        409,
        "CONFLICT",
        "This account is already linked to another identity.",
      );
  } else {
    target = crypto.randomUUID();
    const text = (value: unknown, max: number) =>
      typeof value === "string" ? value.trim().slice(0, max) : "";
    const first =
      text(provider.user_metadata?.first_name, 40) ||
      text(provider.user_metadata?.full_name, 40).split(" ")[0] ||
      "Student";
    const last = text(provider.user_metadata?.last_name, 40);
    const username = "student_" + target.replaceAll("-", "").slice(0, 20);
    const r = await db.execute(
      sql`with account as(insert into public.users(id,email,password_hash,supabase_user_id,email_verified_at,updated_at) values(${target}::uuid,${email},'!provider-auth-only',${provider.id}::uuid,now(),now()) on conflict do nothing returning id) insert into public.profiles(id,user_id,username,display_name,first_name,last_name,onboarding_step,updated_at) select gen_random_uuid(),id,${username},${(first + " " + last).trim()},${first},${last},'PROFILE',now() from account returning user_id`,
    );
    if (!firstRow(r))
      throw new AppError(
        409,
        "CONFLICT",
        "Another sign-in is finishing. Try again.",
      );
  }
  const user = await findUserById(env, target);
  if (!user) throw new AppError(403, "FORBIDDEN", "Account unavailable.");
  return toAuthenticatedUser(user);
}
