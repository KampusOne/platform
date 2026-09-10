import { sql } from "drizzle-orm";

import { database } from "./database";
import type { Bindings } from "../types";

export async function recordAudit(
  env: Bindings,
  event: {
    actorUserId?: string;
    universityId?: string | null;
    action: string;
    targetType: string;
    targetId?: string;
    requestId?: string;
    outcome?: "succeeded" | "denied" | "failed";
    metadata?: Record<string, unknown>;
  },
) {
  await database(env).execute(sql`
    insert into app_private.audit_events (
      actor_user_id, university_id, action, target_type, target_id,
      request_id, outcome, metadata
    ) values (
      ${event.actorUserId ?? null}::uuid, ${event.universityId ?? null}::uuid,
      ${event.action}, ${event.targetType}, ${event.targetId ?? null},
      ${event.requestId ?? null}, ${event.outcome ?? "succeeded"},
      ${JSON.stringify(event.metadata ?? {})}::jsonb
    )
  `);
}
