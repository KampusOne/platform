import { sql } from "drizzle-orm";

import { app } from "./app";
import { database } from "./lib/database";
import type { Bindings } from "./types";
import { deliverQueuedNotifications } from "./services/notification-outbox";
import { closeDueElections } from "./services/community-elections";

export default {
  fetch: app.fetch,
  scheduled(_controller, env, executionContext) {
    executionContext.waitUntil(deliverQueuedNotifications(env));
    executionContext.waitUntil(closeDueElections(env));
    executionContext.waitUntil(
      Promise.all([
        database(env).execute(
          sql`select * from app_private.expire_stale_commerce()`,
        ),
        database(env).execute(
          sql`select app_private.cleanup_request_rate_limits() as deleted`,
        ),
        env.UNIFIED_SCHEMA_READY === "true"
          ? database(env).execute(sql`with removed as (
              delete from app_private.ai_requests
              where result->>'version'='2'
                and (created_at < now()-interval '90 days'
                  or (result->>'deleted'='true' and created_at < now()-interval '2 days'))
              returning 1
            ) select count(*)::int as deleted from removed`)
          : Promise.resolve({ rows: [] }),
      ])
        .then(([commerce, rateLimits, aiRetention]) => {
          console.log(
            JSON.stringify({
              level: "info",
              event: "scheduled.maintenance.completed",
              commerce: commerce.rows[0] ?? null,
              rateLimits: rateLimits.rows[0] ?? null,
              aiRetention: aiRetention.rows[0] ?? null,
            }),
          );
        })
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              level: "error",
              event: "scheduled.maintenance.failed",
              message:
                error instanceof Error
                  ? error.message
                  : "Unknown expiry failure",
            }),
          );
          throw error;
        }),
    );
  },
} satisfies ExportedHandler<Bindings>;
