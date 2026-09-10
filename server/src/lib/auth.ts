import type { Bindings } from "../types";

export type AuthenticatedUser = {
  id: string;
  email?: string;
};

export async function authenticateSupabaseUser(
  env: Bindings,
  authorization: string | undefined,
): Promise<AuthenticatedUser | null> {
  if (!authorization?.startsWith("Bearer ") || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    return null;
  }

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization,
    },
  });

  if (!response.ok) return null;
  const candidate = (await response.json()) as { id?: unknown; email?: unknown };
  if (typeof candidate.id !== "string" || !isUuid(candidate.id)) return null;

  return {
    id: candidate.id,
    ...(typeof candidate.email === "string" ? { email: candidate.email } : {}),
  };
}

export async function hasProductAnalyticsConsent(
  env: Bindings,
  authorization: string,
  userId: string,
) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return false;

  const query = new URL(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/onboarding_progress`);
  query.searchParams.set("select", "analytics_consent");
  query.searchParams.set("user_id", `eq.${userId}`);
  query.searchParams.set("limit", "1");

  const response = await fetch(query, {
    headers: {
      accept: "application/json",
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization,
    },
  });
  if (!response.ok) return false;

  const rows = (await response.json()) as Array<{ analytics_consent?: unknown }>;
  return rows[0]?.analytics_consent === true;
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
