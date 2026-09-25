import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { buildImportPlan, buildStatements, summarizePlan } from "../../server/scripts/import-academic-sources.mjs";

const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { PGlite } = require("@electric-sql/pglite");
const manifest = JSON.parse(await readFile(new URL("./2026-09-21-academic-sources/manifest.json", import.meta.url), "utf8"));
const plan = buildImportPlan(manifest);
const db = new PGlite();
const countRows = async (table) => Number((await db.query(`select count(*)::integer as count from ${table}`)).rows[0].count);
async function apply(statements) {
  return db.transaction(async (transaction) => {
    const result = [];
    for (const statement of statements) result.push((await transaction.query(statement.text, statement.params)).rows);
    return result;
  });
}

before(async () => {
  const migration = await readFile(new URL("../neon/migrations/20260921100000_operations_permissions_academic.sql", import.meta.url), "utf8");
  const first = migration.indexOf("create table if not exists public.academic_source_documents");
  assert.ok(first >= 0, "Staging migration block exists");
  await db.exec("create table public.institution_config(institution_id text primary key, grading_scale jsonb not null default '{}'); insert into public.institution_config values('existing', '{\"A\":4,\"F\":0}');");
  // The same migration also relaxes legacy feed constraints. Include its
  // prerequisite table so this isolated importer fixture matches the schema.
  await db.exec(`create table public.feed_posts (
    title text constraint feed_posts_title_check check (char_length(title) between 3 and 180),
    summary text constraint feed_posts_summary_check check (char_length(summary) between 3 and 500)
  )`);
  await db.exec(migration.slice(first, migration.lastIndexOf("commit;")));
  await db.exec("create table public.universities(id text primary key, name text); insert into public.universities values('existing', 'Existing reviewed university');");
});
after(async () => db.close());

test("dry-run accounts for both compilations without pretending to publish data", () => {
  const summary = summarizePlan(plan);
  assert.equal(summary.database_accessed, false);
  assert.equal(summary.documents, 2);
  assert.equal(summary.claims, 530);
  assert.equal(summary.live_records_published, 0);
  assert.deepEqual(summary.batches.map((b) => b.records), [488, 42]);
  assert.equal(summary.batches[0].counts.institution, 328);
  assert.equal(summary.batches[0].counts.source_reference, 95);
});

test("claim order and JSON object ordering cannot create duplicate batches", () => {
  const other = structuredClone(manifest);
  other.institutions.reverse();
  other.primary_source_directory.reverse();
  assert.deepEqual(buildImportPlan(other).batches.map((b) => b.hash), plan.batches.map((b) => b.hash));
});

test("duplicate references, missing provenance and invalid page/URL fail before writes", () => {
  for (const [mutate, pattern] of [
    [(m) => m.institutions.push(m.institutions[0]), /Duplicate claim reference/],
    [(m) => m.institutions[0].source_report_page = 1000, /Invalid source page/],
    [(m) => m.institutions[0].source_document_id = "missing", /Unknown source document/],
    [(m) => m.documents[0].sha256 = "invalid", /Invalid document SHA/],
    [(m) => m.primary_source_directory[0].official_url_as_reported = "file:///tmp/private", /HTTP\(S\)/],
    [(m) => m.rule_sections[0].eligible_for_automated_academic_decisions = true, /cannot authorize/],
    [(m) => m.import_policy.publish_automatically = true, /without automatic publication/],
  ]) {
    const copy = structuredClone(manifest);
    mutate(copy);
    assert.throws(() => buildImportPlan(copy), pattern);
  }
});

test("staging rerun is idempotent and preserves review decisions and real universities", async () => {
  const statements = buildStatements(plan, "staging");
  const first = await apply(statements);
  assert.equal(first.reduce((sum, rows) => sum + rows.length, 0), 534);
  await db.query("update public.academic_source_claims set review_status = 'APPROVED' where report_ref = $1", ["institution:F030"]);
  const repeat = await apply(statements);
  assert.ok(repeat.every((rows) => rows.length === 0));
  assert.equal(await countRows("public.academic_source_documents"), 2);
  assert.equal(await countRows("public.academic_import_batches"), 2);
  assert.equal(await countRows("public.academic_source_claims"), 530);
  assert.equal((await db.query("select review_status from public.academic_source_claims where report_ref = 'institution:F030'")).rows[0].review_status, "APPROVED");
  assert.deepEqual((await db.query("select * from public.universities")).rows, [{ id: "existing", name: "Existing reviewed university" }]);
  assert.deepEqual((await db.query("select grading_scale from public.institution_config where institution_id = 'existing'")).rows[0].grading_scale, { A: 4, F: 0 });
});

test("new extraction version creates a new batch while original evidence stays intact", async () => {
  const revised = structuredClone(manifest);
  revised.extraction_version = "revised-extraction-test";
  const updated = buildImportPlan(revised);
  assert.notEqual(updated.batches[0].hash, plan.batches[0].hash);
  await apply(buildStatements(updated, "staging"));
  assert.equal(await countRows("public.academic_source_documents"), 2);
  assert.equal(await countRows("public.academic_import_batches"), 4);
  assert.equal(await countRows("public.academic_source_claims"), 1060);
});

test("one failed statement rolls the entire import transaction back", async () => {
  const revised = structuredClone(manifest);
  revised.extraction_version = "failing-extraction-test";
  const statements = buildStatements(buildImportPlan(revised), "staging");
  statements.push({ text: "select 'invalid'::integer", params: [] });
  await assert.rejects(apply(statements));
  assert.equal(await countRows("public.academic_import_batches"), 4);
  assert.equal(await countRows("public.academic_source_claims"), 1060);
});
