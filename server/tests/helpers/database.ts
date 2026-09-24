import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import snapshot from "../fixtures/database-schema.json";

export const unifiedMigrations = [
  "20260913200000_unified_student_platform.sql",
  "20260913210000_timetable_course_alarm_sync.sql",
  "20260913220000_ai_requests.sql",
  "20260913230000_community_workflows.sql",
  "20260913240000_verified_identity_and_resources.sql",
  "20260913250000_one_time_alarms.sql",
  "20260924000000_student_ai_profiles.sql",
];

/** Schema only. No production rows, passwords or provider credentials. */
export async function createTestDatabase() {
  const db = new PGlite();
  await db.exec("create schema app_private");
  for (const statement of [...snapshot.enums, ...snapshot.tables])
    await db.exec(statement);
  // GENERATED identity attributes are recorded in the baseline migration;
  // pg_get_expr does not include them in the schema-only column snapshot.
  for (const table of [
    "app_private.audit_events",
    "public.delivery_events",
    "public.ledger_lines",
  ])
    await db.exec(
      `alter table ${table} alter column id add generated always as identity`,
    );
  for (const fk of [false, true])
    for (const statement of snapshot.constraints.filter(
      (s) => s.includes("FOREIGN KEY") === fk,
    ))
      await db.exec(statement);
  for (const statement of snapshot.indexes) {
    try {
      await db.exec(statement);
    } catch (e) {
      if ((e as { code?: string }).code !== "42P07") throw e;
    }
  }
  for (const statement of [...snapshot.functions, ...snapshot.triggers])
    await db.exec(statement);
  for (const migration of unifiedMigrations)
    await db.exec(
      readFileSync(
        new URL(
          "../../../database/neon/migrations/" + migration,
          import.meta.url,
        ),
        "utf8",
      ),
    );
  return db;
}

export function testDatabaseAdapter(db: PGlite) {
  const dialect = new PgDialect();
  return {
    execute(statement: SQL) {
      const compiled = dialect.sqlToQuery(statement);
      return db.query(compiled.sql, compiled.params);
    },
  };
}

/** Match Neon's lazy tagged queries: transaction construction must not execute them. */
export function testSqlClient(db: PGlite) {
  const client = (strings: TemplateStringsArray, ...params: unknown[]) => {
    const sql = strings.reduce(
      (out, part, i) => out + (i ? `$${i}` : "") + part,
      "",
    );
    return {
      sql,
      params,
      then(
        resolve: (rows: unknown[]) => unknown,
        reject?: (e: unknown) => unknown,
      ) {
        return db
          .query(sql, params)
          .then((r) => r.rows)
          .then(resolve, reject);
      },
    };
  };
  client.transaction = (queries: ReturnType<typeof client>[]) =>
    db.transaction(async (tx) => {
      const results = [];
      for (const q of queries)
        results.push((await tx.query(q.sql, q.params)).rows);
      return results;
    });
  return client;
}
