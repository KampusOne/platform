import { sql, type SQL } from "drizzle-orm";
import { database, firstRow } from "./database";
import { AppError } from "./errors";
import type { Bindings } from "../types";

const cache = new WeakMap<object, { ready: boolean; expires: number }>();

export async function profileSafetyReady(env: Bindings) {
  const saved = cache.get(env);
  if (saved && saved.expires > Date.now()) return saved.ready;
  const row = firstRow(
    await database(env).execute<{ ready: boolean }>(sql`
      select
        to_regclass('public.user_blocks') is not null
        and to_regclass('public.direct_threads') is not null
        and to_regclass('public.direct_messages') is not null as ready
    `),
  );
  const ready = row?.ready === true;
  cache.set(env, { ready, expires: Date.now() + (ready ? 60_000 : 5_000) });
  return ready;
}

export async function requireProfileSafety(env: Bindings) {
  if (!(await profileSafetyReady(env))) {
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Messages are being connected. Please try again shortly.",
    );
  }
}

export function unblockedAuthor(viewer: string, author: SQL) {
  return sql`not exists(
    select 1 from public.user_blocks ub
    where (ub.blocker_id=${viewer}::uuid and ub.blocked_id=${author})
       or (ub.blocked_id=${viewer}::uuid and ub.blocker_id=${author})
  )`;
}

export async function unblockedAuthorIfReady(
  env: Bindings,
  viewer: string,
  author: SQL,
) {
  return (await profileSafetyReady(env)) ? unblockedAuthor(viewer, author) : sql`true`;
}

export type BlockRelationship =
  | "NONE"
  | "BLOCKED_BY_VIEWER"
  | "BLOCKED_BY_TARGET";

export async function blockRelationship(
  env: Bindings,
  viewer: string,
  target: string,
): Promise<BlockRelationship> {
  if (viewer === target || !(await profileSafetyReady(env))) return "NONE";
  const row = firstRow(
    await database(env).execute<{
      blocked_by_viewer: boolean;
      blocked_by_target: boolean;
    }>(sql`
      select
        exists(
          select 1 from public.user_blocks
          where blocker_id=${viewer}::uuid and blocked_id=${target}::uuid
        ) as blocked_by_viewer,
        exists(
          select 1 from public.user_blocks
          where blocker_id=${target}::uuid and blocked_id=${viewer}::uuid
        ) as blocked_by_target
    `),
  );
  if (row?.blocked_by_target) return "BLOCKED_BY_TARGET";
  if (row?.blocked_by_viewer) return "BLOCKED_BY_VIEWER";
  return "NONE";
}

export async function requireUnblocked(
  env: Bindings,
  viewer: string,
  target: string,
) {
  const relationship = await blockRelationship(env, viewer, target);
  if (relationship !== "NONE") {
    throw new AppError(
      404,
      "NOT_FOUND",
      "This profile or conversation is unavailable.",
    );
  }
}
