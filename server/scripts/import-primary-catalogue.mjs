#!/usr/bin/env node
/** Publish checked primary-source identities/relationships; offline dry-run by default.
 * Unlike import-academic-sources.mjs this CAN add live catalogue rows when --apply
 * is explicitly selected. It never deletes/renames student data or sets grading rules.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { canonicalJson } from "./import-academic-sources.mjs";

const defaultSnapshot = fileURLToPath(new URL("../../database/imports/2026-09-26-primary-catalogue/snapshot.json", import.meta.url));
const hash = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
class CatalogueValidationError extends Error {}
const assert = (condition, message) => { if (!condition) throw new CatalogueValidationError(message); };
const normalize = (text) => text.trim().toLowerCase().replace(/\s+/g, " ");
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const uuid = (key) => {
  const h = hash(["kampusone-primary-catalogue-v1", key]);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const kinds = ["universities", "faculties", "departments", "programmes"];

export function buildPublicationPlan(snapshot, existing = {}) {
  assert(typeof snapshot.version === "string" && snapshot.version, "Snapshot version is required.");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(snapshot.retrieved_at), "Retrieval date is required.");
  assert(Array.isArray(snapshot.sources) && snapshot.sources.length, "Primary sources are required.");
  const sources = new Map();
  for (const source of snapshot.sources) {
    const url = new URL(source.url);
    assert(url.protocol === "https:" && !url.username && !url.password, "Use HTTPS primary sources.");
    assert(source.review_status === "PRIMARY_SOURCE_CHECKED" && source.retrieval === "direct_html", "Unreviewed compilations cannot be published by this importer.");
    assert(/^[a-f0-9]{64}$/.test(source.sha256), "Source content SHA-256 is required.");
    assert(!sources.has(source.id), "Duplicate source ID.");
    sources.set(source.id, source);
  }
  const mapped = new Map();
  const plan = { version: snapshot.version, sha256: hash(snapshot), sources: snapshot.sources, gaps: snapshot.gaps || [], rows: {} };
  for (const kind of kinds) {
    assert(Array.isArray(snapshot[kind]), `${kind} must be an array.`);
    plan.rows[kind] = [];
    const targetIds = new Set();
    for (const row of snapshot[kind]) {
      assert(typeof row.key === "string" && row.key && !mapped.has(row.key), `Duplicate/invalid catalogue key: ${row.key}.`);
      assert(typeof row.name === "string" && row.name.trim().length >= 2 && row.name.length <= (kind === "programmes" ? 180 : 160), "Invalid catalogue name.");
      const source = sources.get(row.source_id);
      assert(source, `Missing source for ${row.key}.`);
      const parentKey = row.university_key || row.faculty_key || row.department_key;
      const parent = parentKey ? mapped.get(parentKey) : null;
      assert(kind === "universities" || parent, `Missing parent for ${row.key}.`);
      const parentColumn = { faculties: "university_id", departments: "faculty_id", programmes: "department_id" }[kind];
      const names = [row.name, ...(row.aliases || [])].map(normalize);
      const identitySlug = row.slug || slug(row.name);
      assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(identitySlug), "Invalid catalogue slug.");
      const matches = (existing[kind] || []).filter((candidate) =>
        (!parentColumn || candidate[parentColumn] === parent.id) &&
        (names.includes(normalize(candidate.name)) || (kind !== "programmes" && candidate.slug === identitySlug)),
      );
      assert(matches.length <= 1, `Ambiguous existing identity for ${row.name}; review aliases before publication.`);
      const match = matches[0];
      assert(!match?.deleted_at, `Archived identity ${row.name} needs explicit review; it will not be revived or duplicated.`);
      const id = match?.id || uuid(row.key);
      assert(!targetIds.has(id), `Two source rows map to the same ${kind} record; review before publication.`);
      targetIds.add(id);
      const mappedRow = { id, parent_id: parent?.id || null, name: row.name, slug: identitySlug,
        website_url: row.website_url || null, existing: Boolean(match), expected_name: match?.name || null,
        expected_slug: match?.slug || null,
        metadata: { source_url: source.url, source_sha256: source.sha256, retrieved_at: source.retrieved_at,
          source_name: row.name, source_row: row.source_row || null, status: "PRIMARY_SOURCE_CHECKED",
          snapshot: snapshot.version, aliases: [...new Set([...(Array.isArray(match?.catalogue_metadata?.aliases) ? match.catalogue_metadata.aliases : []), ...(row.aliases || [])])], ownership: row.ownership || null },
      };
      mapped.set(row.key, mappedRow);
      plan.rows[kind].push(mappedRow);
    }
  }
  return plan;
}

export function publicationSummary(plan) {
  return { mode: "dry-run", database_accessed: false, snapshot: plan.version, sha256: plan.sha256,
    sources: plan.sources.length, coverage: Object.fromEntries(kinds.map((kind) => [kind,
      { total: plan.rows[kind].length, new: plan.rows[kind].filter((row) => !row.existing).length,
        matchedExisting: plan.rows[kind].filter((row) => row.existing).length }])),
    withheldOrCoverageNotes: plan.gaps.length, deletes: 0, renamedRecords: 0, gradingRulesChanged: 0,
    note: "Institution identities do not imply nationwide faculty coverage, programme accreditation or live campus services." };
}

export function publicationStatements(plan, environment) {
  assert(["local", "preview", "staging", "production"].includes(environment), "An explicit valid --environment is required with --apply.");
  const statements = [
    { text: "select pg_advisory_xact_lock(hashtextextended('kampusone-primary-catalogue',0))", params: [] },
    { text: "lock table public.universities,public.faculties,public.departments,public.courses in share row exclusive mode", params: [] },
  ];
  // Fail atomically if an administrator changed an identity/parent after the
  // read-only reconciliation. Never apply stale identity matches silently.
  for (const kind of kinds) {
    const matched = plan.rows[kind].filter((row) => row.existing);
    if (!matched.length) continue;
    const table = kind === "programmes" ? "courses" : kind;
    const parentColumn = { faculties: "university_id", departments: "faculty_id", programmes: "department_id" }[kind];
    statements.push({ text: `select 1 / case when not exists (
      select 1 from jsonb_to_recordset($1::jsonb) as r(id uuid,parent_id uuid,expected_name text,expected_slug text)
      left join public.${table} t on t.id=r.id
      where t.id is null or t.deleted_at is not null or t.name is distinct from r.expected_name
        ${kind === "programmes" ? "" : "or t.slug is distinct from r.expected_slug"}
        ${parentColumn ? `or t.${parentColumn} is distinct from r.parent_id` : ""}
    ) then 1 else 0 end as reconciliation_still_current`, params: [JSON.stringify(matched)] });
  }
  for (const kind of kinds) {
    const rows = plan.rows[kind];
    if (!rows.length) continue;
    const recordset = `jsonb_to_recordset($1::jsonb) as r(id uuid,parent_id uuid,name text,slug text,website_url text,metadata jsonb)`;
    if (kind === "universities") statements.push({ text: `insert into public.universities(id,name,slug,country,website_url,updated_at,catalogue_metadata)
      select r.id,r.name,r.slug,'Nigeria',r.website_url,now(),r.metadata from ${recordset}
      on conflict(id) do update set catalogue_metadata=universities.catalogue_metadata || excluded.catalogue_metadata
      where universities.deleted_at is null returning id`, params: [JSON.stringify(rows)] });
    else if (kind === "programmes") statements.push({ text: `insert into public.courses(id,department_id,name,code,updated_at,primary_source_url,source_verified_at)
      select r.id,r.parent_id,r.name,null,now(),r.metadata->>'source_url',now() from ${recordset}
      on conflict(id) do nothing returning id`, params: [JSON.stringify(rows)] });
    else {
      const parentColumn = kind === "faculties" ? "university_id" : "faculty_id";
      statements.push({ text: `insert into public.${kind}(id,${parentColumn},name,slug,updated_at,catalogue_metadata)
        select r.id,r.parent_id,r.name,r.slug,now(),r.metadata from ${recordset}
        on conflict(id) do update set catalogue_metadata=${kind}.catalogue_metadata || excluded.catalogue_metadata
        where ${kind}.deleted_at is null and ${kind}.${parentColumn}=excluded.${parentColumn} returning id`, params: [JSON.stringify(rows)] });
    }
  }
  statements.push({ text: `insert into public.institution_config(institution_id,status,grading_scale,source_url)
    select r.id,'CATALOGUED','{}'::jsonb,r.metadata->>'source_url'
    from jsonb_to_recordset($1::jsonb) as r(id uuid,metadata jsonb)
    on conflict(institution_id) do nothing`, params: [JSON.stringify(plan.rows.universities)] });
  statements.push({ text: `insert into public.academic_catalogue_imports(snapshot_sha256,snapshot_version,source_manifest,environment,summary)
    values($1,$2,$3::jsonb,$4,$5::jsonb) on conflict(snapshot_sha256) do nothing`,
    params: [plan.sha256, plan.version, JSON.stringify(plan.sources), environment, JSON.stringify(publicationSummary(plan))] });
  return statements;
}

async function main() {
  const args = process.argv.slice(2);
  const options = { snapshot: defaultSnapshot, apply: false, environment: null, existing: null };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help") { console.log("node scripts/import-primary-catalogue.mjs [--dry-run] [--existing FIXTURE.json] [--snapshot FILE] [--apply --environment staging]\nOffline dry-run is default. Apply adds real catalogue records using server DATABASE_URL; it does not modify profiles, existing names, grading or service availability."); return; }
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") assert(!args.includes("--apply"), "Choose --dry-run or --apply, not both.");
    else if (["--snapshot", "--environment", "--existing"].includes(arg)) {
      assert(args[index + 1] && !args[index + 1].startsWith("--"), `${arg} requires a value.`);
      options[arg.slice(2)] = args[++index];
    } else throw new Error(`Unknown option ${arg}.`);
  }
  const snapshot = JSON.parse(await readFile(resolve(options.snapshot), "utf8"));
  let existing = options.existing ? JSON.parse(await readFile(resolve(options.existing), "utf8")) : {};
  // Validate before touching a database.
  buildPublicationPlan(snapshot, existing);
  if (!options.apply) { console.log(JSON.stringify(publicationSummary(buildPublicationPlan(snapshot, existing)), null, 2)); return; }
  assert(!options.existing, "An apply run must reconcile against the database, not a fixture.");
  assert(["local", "preview", "staging", "production"].includes(options.environment), "Specify --environment for publication.");
  assert(process.env.DATABASE_URL, "Set the existing server DATABASE_URL securely before publication.");
  const { neon } = await import("@neondatabase/serverless");
  const client = neon(process.env.DATABASE_URL);
  existing = Object.fromEntries(await Promise.all(kinds.map(async (kind) => [kind,
    await client.query(`select * from public.${kind === "programmes" ? "courses" : kind}`),
  ])));
  const plan = buildPublicationPlan(snapshot, existing);
  const statements = publicationStatements(plan, options.environment);
  await client.transaction(statements.map(({ text, params }) => client.query(text, params)));
  console.log(JSON.stringify({ ...publicationSummary(plan), mode: "applied", database_accessed: true, environment: options.environment }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error instanceof CatalogueValidationError ? error.message : "Catalogue publication failed; no transaction was committed. Check the snapshot, schema and secure database configuration."); process.exitCode = 1; });
}
