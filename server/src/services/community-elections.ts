import { sql } from "drizzle-orm";
import { database } from "../lib/database";
import type { Bindings } from "../types";
export async function closeDueElections(env: Bindings) {
  if (env.UNIFIED_SCHEMA_READY !== "true") return;
  await database(env).execute(
    sql`select app_private.finalize_community_election(id) from (select id from public.community_elections where status='SCHEDULED' and ends_at<=now() order by ends_at limit 100) due`,
  );
}
