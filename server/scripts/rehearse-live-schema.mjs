import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";

// Offline rehearsal only. This script has no provider client or production
// connection and never turns a successful schema check into promotion proof.
const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
if (args.length % 2 || args.some((arg, i) => i % 2 === 0 && !["--schema", "--catalogue", "--output"].includes(arg)))
  throw new Error("Use --schema PATH --catalogue PATH --output PATH");
const option = name => args[args.indexOf(name) + 1];
if (!["--schema", "--catalogue", "--output"].every(name => args.includes(name)))
  throw new Error("All three file options are required");
const schemaBytes = readFileSync(resolve(option("--schema")));
const snapshot = JSON.parse(schemaBytes);
const catalogue = JSON.parse(readFileSync(resolve(option("--catalogue"))));
const manifest = JSON.parse(readFileSync(resolve(root, "database/verification/2026-09-30-migration-manifest.json")));
const registered = new Map(snapshot.ledger.map(row => [row.version, row]));
const hash = (value, algorithm = "sha256") => createHash(algorithm).update(value).digest("hex");
const compatiblePrerequisites = new Set([
  "20260925110000_notification_sound_catalogue",
  "20260928120500_profile_activity_dismissals_and_demo_retirement",
]);
const candidates = [];
for (const migration of manifest.migrations) {
  if (!/^database\/neon\/migrations\/\d{14}_[a-z0-9_]+\.sql$/.test(migration.path))
    throw new Error("Invalid migration path");
  const bytes = readFileSync(resolve(root, migration.path));
  const blobHash = hash(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), "sha1");
  if (hash(bytes) !== migration.sha256 || blobHash !== migration.gitBlobSha)
    throw new Error("Migration source checksum mismatch: " + migration.version);
  const ledger = registered.get(migration.version);
  if (ledger && ledger.source_blob_sha !== blobHash)
    throw new Error("Registered migration source mismatch: " + migration.version);
  if (!ledger && migration.version >= "20260921000000" && !compatiblePrerequisites.has(migration.version))
    candidates.push({ ...migration, bytes });
}
candidates.sort((a, b) => a.version.localeCompare(b.version));
const db = new PGlite();
let failedVersion;
try {
  await db.exec("create schema app_private; set search_path=public,app_private");
  for (const statement of [...snapshot.enums, ...snapshot.tables]) await db.exec(statement);
  // Column NOT NULL attributes were emitted in CREATE TABLE. The live PG18
  // snapshot also names them as constraints; avoid creating them twice.
  const constraints = snapshot.constraints.filter(statement => !/\bNOT NULL [a-z_]+;$/i.test(statement));
  for (const statement of constraints.filter(statement => !statement.includes("FOREIGN KEY")))
    await db.exec(statement);
  for (const statement of snapshot.indexes) {
    try { await db.exec(statement); }
    catch (error) { if (error.code !== "42P07") throw error; }
  }
  for (const statement of constraints.filter(statement => statement.includes("FOREIGN KEY")))
    await db.exec(statement);
  for (const statement of [...snapshot.functions, ...snapshot.triggers]) await db.exec(statement);
  // Only public academic catalogue records are supplied. No users, profiles,
  // orders, chats, identity documents or other customer records are cloned.
  for (const table of ["universities", "faculties", "departments", "courses"])
    for (const row of catalogue[table] ?? []) {
      const columns = Object.keys(row);
      if (columns.some(column => !/^[a-z_]+$/.test(column))) throw new Error("Invalid academic column");
      await db.query(`insert into public.${table} (${columns.join(",")}) values (${columns.map((_, index) => "$" + (index + 1)).join(",")})`, columns.map(column => row[column]));
    }
  for (const migration of candidates) {
    failedVersion = migration.version;
    await db.exec(migration.bytes.toString("utf8"));
    console.log("Passed offline schema rehearsal: " + migration.version);
  }
  failedVersion = undefined;
  const coverage = (await db.query(`select count(*)::int institutions,
    count(*) filter(where exists(select 1 from public.faculties f where f.university_id=u.id and f.deleted_at is null))::int with_faculties,
    count(*) filter(where exists(select 1 from public.departments d join public.faculties f on f.id=d.faculty_id where f.university_id=u.id and f.deleted_at is null and d.deleted_at is null))::int with_departments
    from public.universities u where u.deleted_at is null`)).rows[0];
  const uniben = (await db.query(`select u.id,
    (select count(*)::int from public.faculties f where f.university_id=u.id and f.deleted_at is null) faculties,
    (select count(*)::int from public.departments d join public.faculties f on f.id=d.faculty_id where f.university_id=u.id and f.deleted_at is null and d.deleted_at is null) departments
    from public.universities u where u.name='University of Benin' and u.deleted_at is null`)).rows[0];
  const report = {
    verifiedAt: new Date().toISOString(), observedAt: snapshot.observed_at,
    schemaSnapshotSha256: hash(schemaBytes),
    scope: "Offline current-live-schema rehearsal with public academic catalogue only; no production writes or customer data.",
    productionReady: false, requiresCurrentProductionBranchRehearsal: true,
    counts: { registered: registered.size, candidates: candidates.length, compatiblePrerequisites: compatiblePrerequisites.size },
    coverage, uniben,
    candidates: candidates.map(({ bytes, ...migration }) => ({ ...migration, status: "offline_schema_rehearsal_passed" })),
    supersededPrerequisites: [...compatiblePrerequisites],
    preservedLegacyVersions: manifest.migrations.filter(migration => !registered.has(migration.version) && migration.version < "20260921000000").map(migration => migration.version),
    limitations: [
      "Live customer rows, ACLs, RLS policies and provider side effects are not exercised by this offline fixture.",
      "Some older unregistered objects exist; cloud branch data and signature checks remain mandatory before promotion.",
      "The compatible prerequisite migration creates sound and dismissal tables without tightening existing media kinds or cancelling bookings.",
      "Universities without sourced departments retain the student submission/review path; this does not establish nationwide completeness.",
    ],
  };
  writeFileSync(resolve(option("--output")), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ counts: report.counts, coverage, uniben, productionReady: false }));
} catch (error) {
  console.error("Offline rehearsal failed" + (failedVersion ? " at " + failedVersion : " while restoring the schema") + ": " + error.message);
  process.exitCode = 1;
} finally { await db.close(); }
