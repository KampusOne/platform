import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";

import { createTestDatabase } from "./helpers/database";

const migrationPath = resolve(
  process.cwd(),
  "../database/neon/migrations/20260927130000_multi_university_onboarding_catalogue.sql",
);

describe("multi-university onboarding catalogue migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDatabase();
  }, 60000);

  afterAll(async () => {
    await db?.close();
  });

  it("adds all 328 universities without replacing the existing UNIBEN identity", async () => {
    const existingUnibenId = "30000000-0000-4000-8000-000000000001";
    await db.query(
      "insert into public.universities(id,name,slug,website_url,updated_at) values($1,'University of Benin','uniben','https://uniben.edu',now())",
      [existingUnibenId],
    );

    const migration = readFileSync(migrationPath, "utf8");
    await db.exec(migration);

    const count = (
      await db.query<{ count: number }>(
        "select count(*)::int as count from public.universities where deleted_at is null",
      )
    ).rows[0]?.count;
    expect(count).toBe(328);

    const uniben = (
      await db.query<{ id: string; slug: string }>(
        "select id,slug from public.universities where name='University of Benin'",
      )
    ).rows[0];
    expect(uniben).toEqual({ id: existingUnibenId, slug: "uniben" });

    const configCount = (
      await db.query<{ count: number }>(
        "select count(*)::int as count from public.institution_config",
      )
    ).rows[0]?.count;
    expect(configCount).toBe(328);

    const liveConfigCount = (
      await db.query<{ count: number }>(
        "select count(*)::int as count from public.institution_config where status='LIVE'",
      )
    ).rows[0]?.count;
    expect(liveConfigCount).toBe(0);

    const facultyCount = (
      await db.query<{ count: number }>(
        "select count(*)::int as count from public.faculties",
      )
    ).rows[0]?.count;
    expect(facultyCount).toBe(0);
  });
});
