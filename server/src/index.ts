import { sql } from "drizzle-orm";

import { app } from "./app";
import { database } from "./lib/database";
import type { Bindings } from "./types";

export default {
  fetch: app.fetch,
  scheduled(_controller, env, executionContext) {
    executionContext.waitUntil(
      Promise.all([
        database(env).execute(sql`select * from app_private.expire_stale_commerce()`),
        database(env).execute(sql`select app_private.cleanup_request_rate_limits() as deleted`),
      ])
        .then(([commerce, rateLimits]) => {
          console.log(JSON.stringify({
            level: "info",
            event: "scheduled.maintenance.completed",
            commerce: commerce.rows[0] ?? null,
            rateLimits: rateLimits.rows[0] ?? null,
          }));
        })
        .catch((error: unknown) => {
          console.error(JSON.stringify({
            level: "error",
            event: "scheduled.maintenance.failed",
            message: error instanceof Error ? error.message : "Unknown expiry failure",
          }));
          throw error;
        }),
    );
  },
} satisfies ExportedHandler<Bindings>;
