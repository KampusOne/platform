import { sql } from "drizzle-orm";
import { database, firstRow } from "./database";
import { AppError } from "./errors";
import type { Bindings } from "../types";
const readiness = new WeakMap<object, { ready: boolean; until: number }>();
export async function adminWorkspaceReady(env: Bindings) {
  const saved = readiness.get(env);
  if (saved && saved.until > Date.now()) return saved.ready;
  const ready =
    firstRow(
      await database(env).execute<{ ready: boolean }>(
        sql`select to_regclass('app_private.staff_account_provisions')is not null and to_regclass('app_private.operations_documents')is not null and to_regclass('app_private.managed_publishers')is not null and exists(select 1 from information_schema.columns where table_schema='public'and table_name='product_events'and column_name='platform') ready`,
      ),
    )?.ready === true;
  readiness.set(env, { ready, until: Date.now() + (ready ? 60000 : 5000) });
  return ready;
}
export async function requireAdminWorkspace(env: Bindings) {
  if (!(await adminWorkspaceReady(env)))
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "This workspace is awaiting its database update. Other workspaces remain available.",
    );
}
export async function staffRequestDigest(env: Bindings, payload: unknown) {
  if ((env.JWT_SECRET?.length ?? 0) < 32)
    throw new AppError(
      503,
      "PROVIDER_UNAVAILABLE",
      "Secure staff provisioning is not configured.",
    );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode("K1:STAFF:CREATE:v1:" + JSON.stringify(payload)),
  );
  return [...new Uint8Array(signed)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
