import { sql } from "drizzle-orm";
import { database, firstRow } from "../lib/database";
import { phase3SchemaReady } from "../lib/features";
import type { Bindings } from "../types";

export async function purchaseReviewSchemaReady(env: Bindings) {
  if (!phase3SchemaReady(env) || env.UNIFIED_SCHEMA_READY !== "true")
    return false;
  return Boolean(
    firstRow(
      await database(env).execute<{ ready: boolean }>(
        sql`select to_regprocedure('app_private.queue_due_purchase_review_notifications(uuid)') is not null as ready`,
      ),
    )?.ready,
  );
}
export async function queueDuePurchaseReviews(env: Bindings, userId?: string) {
  if (!(await purchaseReviewSchemaReady(env))) return { queued: 0 };
  return (
    firstRow(
      await database(env).execute<{ queued: number }>(
        sql`select app_private.queue_due_purchase_review_notifications(${userId ?? null}::uuid) as queued`,
      ),
    ) ?? { queued: 0 }
  );
}
