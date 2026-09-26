import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { buildPublicationPlan, publicationStatements, publicationSummary } from "../../server/scripts/import-primary-catalogue.mjs";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { PGlite } = require("@electric-sql/pglite");
const snapshot = JSON.parse(await readFile(new URL("./2026-09-26-primary-catalogue/snapshot.json", import.meta.url), "utf8"));
const db = new PGlite();
const school = "11000000-0000-4000-8000-000000000001";
async function existing() {
  return Object.fromEntries(await Promise.all(["universities", "faculties", "departments", "programmes"].map(async (kind) =>
    [kind, (await db.query(`select * from public.${kind === "programmes" ? "courses" : kind}`)).rows])));
}
async function apply(plan, injectFailure = false) {
  return db.transaction(async (transaction) => {
    for (const statement of publicationStatements(plan, "local")) await transaction.query(statement.text, statement.params);
    if (injectFailure) throw new Error("injected failure");
  });
}
before(async () => {
  await db.exec(`
    create table public.universities(id uuid primary key,name varchar(160) unique not null,slug varchar(180) unique not null,country text default 'Nigeria',state text,website_url text,updated_at timestamp not null,deleted_at timestamp);
    create table public.faculties(id uuid primary key,university_id uuid references public.universities(id),name varchar(160),slug varchar(180),updated_at timestamp,deleted_at timestamp,unique(university_id,slug));
    create table public.departments(id uuid primary key,faculty_id uuid references public.faculties(id),name varchar(160),slug varchar(180),updated_at timestamp,deleted_at timestamp,unique(faculty_id,slug));
    create table public.courses(id uuid primary key,department_id uuid references public.departments(id),name varchar(180),code varchar(40),updated_at timestamp,deleted_at timestamp,primary_source_url text,source_verified_at timestamp,unique(department_id,name));
    create table public.institution_config(institution_id uuid primary key references public.universities(id),status text,grading_scale jsonb,source_url text);
  `);
  await db.exec(await readFile(new URL("../neon/migrations/20260926170000_academic_catalogue_provenance.sql", import.meta.url), "utf8"));
  await db.query("insert into public.universities(id,name,slug,updated_at) values($1,'University of Benin','uniben',now())", [school]);
  await db.query("insert into public.institution_config values($1,'LIVE','{\"A\":4,\"F\":0}',null)", [school]);
});
after(async () => db.close());

test("snapshot has checked NUC identities and explicitly bounded ABU coverage", () => {
  const plan = buildPublicationPlan(snapshot);
  const summary = publicationSummary(plan);
  assert.equal(summary.database_accessed, false);
  assert.equal(summary.coverage.universities.total, 328);
  assert.equal(summary.coverage.faculties.total, 18);
  assert.equal(summary.coverage.departments.total, 67);
  assert.equal(summary.coverage.programmes.total, 101);
  assert.deepEqual(["federal", "state", "private"].map((ownership) => snapshot.universities.filter((row) => row.ownership === ownership).length), [77, 69, 182]);
  assert.equal(snapshot.source_programme_rows, 114);
  assert.equal(snapshot.gaps.filter((gap) => gap.kind === "unmapped_programme").length, 11);
  assert.equal(snapshot.gaps.filter((gap) => gap.kind === "duplicate_programme_row").length, 2);
});

test("staging/unverified sources, duplicate keys and ambiguous identities fail before writes", () => {
  const unverified = structuredClone(snapshot); unverified.sources[0].review_status = "PENDING";
  assert.throws(() => buildPublicationPlan(unverified), /Unreviewed compilations/);
  const duplicate = structuredClone(snapshot); duplicate.faculties.push(duplicate.faculties[0]);
  assert.throws(() => buildPublicationPlan(duplicate), /Duplicate\/invalid catalogue key/);
  assert.throws(() => buildPublicationPlan(snapshot, { universities: [
    { id: school, name: "University of Benin", slug: "uniben" },
    { id: "12000000-0000-4000-8000-000000000001", name: "UNIBEN", slug: "duplicate" },
  ] }), /Ambiguous existing identity/);
});

test("publication matches existing IDs, preserves real names/service/grading and is idempotent", async () => {
  const first = buildPublicationPlan(snapshot, await existing());
  assert.equal(publicationSummary(first).coverage.universities.matchedExisting, 1);
  await apply(first);
  const second = buildPublicationPlan(snapshot, await existing());
  await apply(second);
  assert.equal(publicationSummary(second).coverage.universities.new, 0);
  assert.equal((await db.query("select count(*)::int count from public.universities")).rows[0].count, 328);
  assert.equal((await db.query("select count(*)::int count from public.courses")).rows[0].count, 101);
  assert.deepEqual((await db.query("select name,slug from public.universities where id=$1", [school])).rows[0], { name: "University of Benin", slug: "uniben" });
  assert.deepEqual((await db.query("select status,grading_scale from public.institution_config where institution_id=$1", [school])).rows[0], { status: "LIVE", grading_scale: { A: 4, F: 0 } });
  assert.equal((await db.query("select count(*)::int count from public.academic_catalogue_imports")).rows[0].count, 1);
  assert.equal((await db.query("select count(*)::int count from public.institution_config where status='CATALOGUED' and grading_scale='{}'")).rows[0].count, 327);
});

test("archived records are not revived, and a failed publication rolls back its new records", async () => {
  const records = await existing();
  records.universities.find((row) => row.id === school).deleted_at = new Date().toISOString();
  assert.throws(() => buildPublicationPlan(snapshot, records), /Archived identity/);
  const next = structuredClone(snapshot); next.version = "test-rollback";
  next.universities.push({ key: "test-fixture-only", name: "Test fixture only institution", source_id: next.sources[0].id, aliases: [] });
  await assert.rejects(apply(buildPublicationPlan(next, await existing()), true), /injected failure/);
  assert.equal((await db.query("select count(*)::int count from public.universities")).rows[0].count, 328);
  assert.equal((await db.query("select count(*)::int count from public.academic_catalogue_imports")).rows[0].count, 1);
});
