import { sql } from "drizzle-orm";
import { database, firstRow } from "./database";
import { AppError } from "./errors";
import { phase3SchemaReady } from "./features";
import type { Bindings } from "../types";

export async function fulfilmentSchemaReady(env: Bindings) {
  if (!phase3SchemaReady(env)) return false;
  return Boolean(
    firstRow(
      await database(env).execute<{ ready: boolean }>(sql`
    select to_regprocedure('app_private.create_store_order_v3(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,numeric,numeric,text,jsonb,text,text)') is not null as ready
  `),
    )?.ready,
  );
}
export async function requireFulfilmentSchema(env: Bindings) {
  if (!(await fulfilmentSchemaReady(env)))
    throw new AppError(
      503,
      "FEATURE_DISABLED",
      "These delivery options are awaiting the scheduled database update.",
    );
}
