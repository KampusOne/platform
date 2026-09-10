import type { Bindings } from "../types";

type AuthenticatedUser = { id: string; email?: string };

export class SupabaseBoundaryError extends Error {
  constructor(
    message: string,
    readonly kind: "configuration" | "unauthenticated" | "upstream",
    readonly status = 500,
  ) {
    super(message);
  }
}

function requiredConfiguration(env: Bindings) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.SUPABASE_SECRET_KEY) {
    throw new SupabaseBoundaryError("The data service is not configured.", "configuration", 503);
  }
  return {
    url: env.SUPABASE_URL.replace(/\/$/, ""),
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
    secretKey: env.SUPABASE_SECRET_KEY,
  };
}

export async function authenticateUser(env: Bindings, authorization: string | undefined): Promise<AuthenticatedUser> {
  if (!authorization?.startsWith("Bearer ")) {
    throw new SupabaseBoundaryError("Sign in before using this operation.", "unauthenticated", 401);
  }
  const config = requiredConfiguration(env);
  let response: Response;
  try {
    response = await fetch(`${config.url}/auth/v1/user`, {
      headers: { apikey: config.publishableKey, Authorization: authorization },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new SupabaseBoundaryError("Identity verification is temporarily unavailable.", "upstream", 503);
  }
  if (response.status === 401 || response.status === 403) {
    throw new SupabaseBoundaryError("Your session is invalid or expired.", "unauthenticated", 401);
  }
  if (!response.ok) {
    throw new SupabaseBoundaryError("Identity verification is temporarily unavailable.", "upstream", 503);
  }
  const payload = await response.json<AuthenticatedUser>();
  if (!payload.id) throw new SupabaseBoundaryError("Your session is invalid or expired.", "unauthenticated", 401);
  return payload;
}

export async function callPrivilegedRpc<T>(env: Bindings, functionName: "review_agent_application" | "review_agent_document", body: Record<string, string>): Promise<T> {
  const config = requiredConfiguration(env);
  let response: Response;
  try {
    response = await fetch(`${config.url}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      headers: {
        apikey: config.secretKey,
        Authorization: `Bearer ${config.secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new SupabaseBoundaryError("The review service is temporarily unavailable.", "upstream", 503);
  }
  if (!response.ok) {
    const upstream = await response.json<{ message?: string }>().catch((): { message?: string } => ({}));
    const forbidden = response.status === 401 || response.status === 403 || upstream.message === "Not authorised";
    throw new SupabaseBoundaryError(
      forbidden ? "This account is not allowed to review this record." : "The review could not be recorded.",
      forbidden ? "unauthenticated" : "upstream",
      forbidden ? 403 : response.status >= 500 ? 503 : 409,
    );
  }
  return response.json<T>();
}
