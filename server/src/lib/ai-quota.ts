import { aiLimit } from "./ai-provider";
import { sha256 } from "./security";
import type { AuthenticatedUser, Bindings } from "../types";

export type AIQuota = { user: number; global: number; unlimited: boolean };

/**
 * The caller must pass currentUser(c), resolved by requireAuth from public.users.
 * Never accept an email, role or unlimited flag from a request or profile metadata.
 * Hashes keep raw account addresses out of deployment configuration; they are not
 * secrets and are not authentication credentials. Only the Worker can grant this.
 */
export async function resolveAIQuota(env: Bindings, user: AuthenticatedUser): Promise<AIQuota> {
  const allowed = new Set((env.AI_UNLIMITED_EMAIL_HASHES ?? "")
    .split(/[\s,]+/)
    .map(value => value.toLowerCase())
    .filter(value => /^[a-f0-9]{64}$/.test(value)));
  const email = user.email.trim().toLowerCase();
  const unlimited = Boolean(user.id && email && allowed.size && allowed.has(await sha256(email)));
  return {
    user: aiLimit(env.AI_DAILY_USER_LIMIT, 5, 100),
    global: aiLimit(env.AI_DAILY_GLOBAL_LIMIT, 100, 100000),
    unlimited,
  };
}

export function aiAllowance(quota: AIQuota, used: number, globalUsed: number, resetsAt: string) {
  return {
    unlimited: quota.unlimited,
    limit: quota.unlimited ? null : quota.user,
    used,
    remaining: quota.unlimited ? null : Math.max(0, quota.user - used),
    resetsAt,
    globalAvailable: globalUsed < quota.global,
    policy: quota.unlimited
      ? "No personal daily AI cap. Shared service and provider limits still apply. Attempts remain recorded; retrying an existing request does not call the provider again."
      : "One reservation per new attempt. Provider failures count; replaying the same request is free. Invalid files, missing configuration and rejected reservations do not count.",
  };
}
