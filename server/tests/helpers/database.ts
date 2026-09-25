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
  "20260921100000_operations_permissions_academic.sql",
  "20260921110000_ai_history_and_streak_activity.sql",
  "20260921120000_publishing_capabilities.sql",
  "20260921130000_academic_publication.sql",
  "20260921140000_notification_delivery.sql",
  "20260921150000_broadcasts.sql",
  "20260921160000_payout_setup.sql",
  "20260921170000_application_checks.sql",
  "20260921180000_idempotent_timetable_import.sql",
  "20260921180000_feed_social_interactions.sql",
  "20260921183000_feed_post_likes.sql",
  "20260921184500_feed_comment_likes.sql",
  "20260921200000_feed_comment_replies.sql",
  "20260922140000_feed_conversation_experience.sql",
  "20260924000000_student_ai_profiles.sql",
  "20260925090000_calendar_and_campus_places.sql",
  "20260925100000_campus_map_foundation.sql",
  "20260925110000_notification_sound_catalogue.sql",
  "20260925120000_community_push_delivery.sql",
  "20260925130000_programme_metadata.sql",
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
