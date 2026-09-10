import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import type { Bindings } from "../types";
import { AppError } from "./errors";

type DatabaseClient = NeonHttpDatabase<Record<string, never>> & {
  $client: NeonQueryFunction<false, false>;
};

export function sqlClient(env: Bindings): NeonQueryFunction<false, false> {
  if (!env.DATABASE_URL) {
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "The database connection is not configured.");
  }

  return neon(env.DATABASE_URL, {
    fetchOptions: { cache: "no-store" },
    fullResults: false,
  });
}

export function database(env: Bindings): DatabaseClient {
  return drizzle(sqlClient(env)) as DatabaseClient;
}

export function firstRow<T>(result: { rows: T[] }): T | undefined {
  return result.rows[0];
}
