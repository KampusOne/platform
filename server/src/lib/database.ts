import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import type { Bindings } from "../types";
import { AppError } from "./errors";
import { measureDatabase, readMetrics } from "./read-cache-metrics";

type DatabaseClient = NeonHttpDatabase<Record<string, never>> & {
  $client: NeonQueryFunction<false, false>;
};
const clients = new WeakMap<Bindings, NeonQueryFunction<false, false>>();
const databases = new WeakMap<Bindings, DatabaseClient>();

// Neon query promises are lazy and are also passed into transaction(). Keep
// their parameterizedQuery/options intact; measure at execution, not creation.
function instrumentQuery<T extends object>(env: Bindings, query: T): T {
  return new Proxy(query, {
    get(target, property, receiver) {
      if (property === "then") return (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        measureDatabase(env, 1, () => (target as unknown as PromiseLike<unknown>).then(value => value)).then(resolve, reject);
      if (property === "catch") return (reject: (error: unknown) => unknown) =>
        measureDatabase(env, 1, () => (target as unknown as PromiseLike<unknown>).then(value => value)).catch(reject);
      if (property === "finally") return (finish: () => void) =>
        measureDatabase(env, 1, () => (target as unknown as PromiseLike<unknown>).then(value => value)).finally(finish);
      return Reflect.get(target, property, receiver);
    },
  });
}

export function sqlClient(env: Bindings): NeonQueryFunction<false, false> {
  if (!env.DATABASE_URL) {
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "The database connection is not configured.");
  }

  const existing = clients.get(env);
  if (existing) return existing;
  const client = neon(env.DATABASE_URL, {
    fetchOptions: { cache: "no-store" },
    fullResults: false,
  });
  if (!readMetrics(env)) return client;
  const measured = new Proxy(client, {
    apply(target, thisArg, args) { return instrumentQuery(env, Reflect.apply(target, thisArg, args)); },
    get(target, property, receiver) {
      if (property === "query") return (...args: Parameters<typeof client.query>) => instrumentQuery(env, target.query(...args));
      if (property === "transaction") return (queries: Parameters<typeof client.transaction>[0], options: Parameters<typeof client.transaction>[1]) => {
        if (typeof queries === "function") {
          const callback = (sql: Parameters<typeof queries>[0]) => {
            const batch = queries(sql);
            const metrics = readMetrics(env);
            if (metrics) metrics.dbQueries += batch.length;
            return batch;
          };
          return measureDatabase(env, 0, () => Reflect.apply(target.transaction, target, [callback, options]) as Promise<unknown>);
        }
        return measureDatabase(env, queries.length, () => target.transaction(queries, options));
      };
      return Reflect.get(target, property, receiver);
    },
  });
  clients.set(env, measured);
  return measured;
}

export function database(env: Bindings): DatabaseClient {
  const existing = databases.get(env);
  if (existing) return existing;
  const db = drizzle(sqlClient(env)) as DatabaseClient;
  if (readMetrics(env)) databases.set(env, db);
  return db;
}

export function firstRow<T>(result: { rows: T[] }): T | undefined {
  return result.rows[0];
}
