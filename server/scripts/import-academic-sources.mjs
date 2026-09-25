#!/usr/bin/env node
/**
 * Requirements 32, 146, 157, 159: repeatable academic evidence staging.
 * Defaults to an offline dry-run. Never writes live academic/student tables.
 * No new provider credential: --apply uses the existing server DATABASE_URL.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const MANIFEST_PATH = fileURLToPath(new URL(
  "../../database/imports/2026-09-21-academic-sources/manifest.json",
  import.meta.url,
));
const REQUIRED_TABLES = [
  "public.academic_source_documents",
  "public.academic_import_batches",
  "public.academic_source_claims",
];

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const digest = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");

function deterministicUuid(hash) {
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function ensureArray(value, field) {
  requireValue(Array.isArray(value), `${field} must be an array.`);
  return value;
}

function assertText(value, field) {
  requireValue(typeof value === "string" && value.trim().length > 0, `${field} must be non-empty text.`);
}

function assertUrl(value, field) {
  assertText(value, field);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${field} must be an absolute URL.`); }
  requireValue(["https:", "http:"].includes(url.protocol) && !url.username && !url.password,
    `${field} must be an HTTP(S) source without credentials.`);
}

/** Validate source provenance before constructing any database statement. */
export function buildImportPlan(manifest) {
  requireValue(manifest?.schema_version === "1.0.0", "Unsupported academic manifest schema_version.");
  assertText(manifest.extraction_version, "extraction_version");
  requireValue(manifest.import_policy?.publish_automatically === false,
    "Academic evidence must enter staging without automatic publication.");
  const documents = ensureArray(manifest.documents, "documents");
  requireValue(documents.length > 0, "The manifest must contain source documents.");
  const byId = new Map();
  for (const document of documents) {
    assertText(document.id, "document.id");
    assertText(document.filename, "document.filename");
    requireValue(!byId.has(document.id), `Duplicate document ID: ${document.id}.`);
    requireValue(/^[a-f0-9]{64}$/.test(document.sha256), `Invalid document SHA-256: ${document.id}.`);
    requireValue(Number.isInteger(document.pages) && document.pages > 0,
      `Invalid document page count: ${document.id}.`);
    requireValue(document.source_kind === "secondary_research_compilation" &&
      document.independently_verified_current === false,
      `Document ${document.id} must retain its secondary, unverified status.`);
    byId.set(document.id, { document, claims: [], seen: new Set() });
  }

  const addClaim = (kind, item, reportRef, page) => {
    const entry = byId.get(item.source_document_id);
    requireValue(Boolean(entry), `Unknown source document in ${kind}.`);
    assertText(reportRef, `${kind}.report_ref`);
    requireValue(Number.isInteger(page) && page > 0 && page <= entry.document.pages,
      `Invalid source page for ${kind}:${reportRef}.`);
    const ref = `${kind}:${reportRef}`;
    requireValue(!entry.seen.has(ref), `Duplicate claim reference: ${ref}.`);
    entry.seen.add(ref);
    entry.claims.push({
      report_ref: ref,
      page,
      claim_kind: kind,
      payload: { ...item, original_primary_source_verified: false, eligible_for_automated_academic_decisions: false },
      review_status: "PENDING",
    });
  };

  const institutions = ensureArray(manifest.institutions, "institutions");
  for (const item of institutions) {
    assertText(item.name_as_reported, "institution.name_as_reported");
    requireValue(/^[FSP]\d{3}$/.test(item.report_reference_id), "Invalid report-local institution reference.");
    requireValue(["federal", "state", "private"].includes(item.ownership), "Invalid institution ownership.");
    requireValue({ F: "federal", S: "state", P: "private" }[item.report_reference_id[0]] === item.ownership,
      "Institution ownership disagrees with the report-local prefix.");
    requireValue(["V0", "V1", "V2"].includes(item.coverage_code), "Invalid coverage code.");
    requireValue(item.is_nuc_issued_identifier === false && item.current_status_verified === false,
      "Institution claims must not impersonate regulator identifiers or current verification.");
    addClaim("institution", item, item.report_reference_id, item.source_report_page);
  }
  for (const item of ensureArray(manifest.institution_profiles, "institution_profiles")) {
    assertText(item.title, "profile.title");
    addClaim("profile", item, item.report_reference_id, item.page);
  }
  for (const item of ensureArray(manifest.rule_sections, "rule_sections")) {
    assertText(item.title, "rule.title");
    requireValue(item.eligible_for_automated_academic_decisions === false,
      "Rule claims cannot authorize automated academic decisions.");
    addClaim("rule", item, item.report_rule_id, item.page);
  }
  for (const item of ensureArray(manifest.primary_source_directory, "primary_source_directory")) {
    assertText(item.title, "source_reference.title");
    assertUrl(item.official_url_as_reported, "source_reference.official_url_as_reported");
    requireValue(item.primary_document_retrieved_in_this_audit === false,
      "Cited URL presence must not be represented as current source verification.");
    addClaim("source_reference", item, item.report_source_code, item.report_page);
  }
  const counts = manifest.verified_document_counts;
  requireValue(counts && counts.register_rows === institutions.length,
    "Institution count disagrees with the source coverage manifest.");
  for (const ownership of ["federal", "state", "private"]) {
    requireValue(counts[`${ownership}_rows`] === institutions.filter((i) => i.ownership === ownership).length,
      `${ownership} count disagrees with the source coverage manifest.`);
  }

  const batches = [...byId.values()].map(({ document, claims }) => {
    claims.sort((a, b) => a.report_ref.localeCompare(b.report_ref, "en"));
    const hash = digest({ schema_version: manifest.schema_version, extraction_version: manifest.extraction_version,
      document, claims });
    return {
      source_key: `${document.id}:${document.sha256}`,
      id: deterministicUuid(hash), hash, document, claims,
      summary: {
        extraction_version: manifest.extraction_version,
        source_kind: document.source_kind,
        records: claims.length,
        counts: claims.reduce((out, claim) => ({ ...out, [claim.claim_kind]: (out[claim.claim_kind] || 0) + 1 }), {}),
        publishes_live_data: false,
        review_required: true,
      },
    };
  });
  return { schema_version: manifest.schema_version, batches };
}

/** Parameterised statements; no source text is interpolated into SQL. */
export function buildStatements(plan, environment) {
  requireValue(["local", "preview", "staging", "production"].includes(environment),
    "Choose --environment local, preview, staging, or production for an apply run.");
  const statements = [];
  for (const batch of plan.batches) {
    statements.push({
      kind: "documents",
      text: `insert into public.academic_source_documents(source_key, filename, sha256, metadata_json)
        values ($1, $2, $3, $4::jsonb) on conflict (source_key) do nothing returning source_key`,
      params: [batch.source_key, batch.document.filename, batch.document.sha256, JSON.stringify(batch.document)],
    }, {
      kind: "batches",
      text: `insert into public.academic_import_batches(id, source_key, hash, status, summary_json)
        values ($1::uuid, $2, $3, 'STAGED', $4::jsonb)
        on conflict (source_key, hash) do nothing returning id`,
      params: [batch.id, batch.source_key, batch.hash, JSON.stringify({ ...batch.summary, requested_environment: environment })],
    }, {
      kind: "claims",
      text: `insert into public.academic_source_claims(batch_id, source_key, report_ref, page, claim_kind, payload, review_status)
        select batch.id, batch.source_key, claim.report_ref, claim.page, claim.claim_kind, claim.payload, 'PENDING'
        from public.academic_import_batches batch
        cross join jsonb_to_recordset($3::jsonb) as claim(report_ref text, page integer, claim_kind text, payload jsonb)
        where batch.source_key = $1 and batch.hash = $2
        on conflict (batch_id, report_ref) do nothing returning id`,
      params: [batch.source_key, batch.hash, JSON.stringify(batch.claims)],
    });
  }
  return statements;
}

export function summarizePlan(plan) {
  return {
    mode: "dry-run",
    database_accessed: false,
    live_records_published: 0,
    documents: plan.batches.length,
    claims: plan.batches.reduce((sum, batch) => sum + batch.claims.length, 0),
    batches: plan.batches.map(({ id, hash, document, summary }) => ({
      batch_id: id, hash, source_filename: document.filename, source_sha256: document.sha256, ...summary,
    })),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const options = { manifest: MANIFEST_PATH, apply: false, environment: undefined };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help") {
      console.log("Academic source staging: node scripts/import-academic-sources.mjs [--manifest FILE] [--dry-run | --apply --environment staging]\nDry-run is offline and is the default. Apply uses the existing DATABASE_URL. No live institutions, rules, student profiles or grading schemes are modified.");
      return;
    }
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") {
      requireValue(!args.includes("--apply"), "Choose either --dry-run or --apply.");
    } else if (["--manifest", "--environment"].includes(arg)) {
      requireValue(args[i + 1] && !args[i + 1].startsWith("--"), `${arg} requires a value.`);
      options[arg.slice(2)] = args[++i];
    } else throw new Error(`Unknown option: ${arg}. Use --help.`);
  }
  const manifest = JSON.parse(await readFile(resolve(options.manifest), "utf8"));
  const plan = buildImportPlan(manifest);
  const summary = summarizePlan(plan);
  if (!options.apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  const statements = buildStatements(plan, options.environment);
  requireValue(Boolean(process.env.DATABASE_URL), "Set the existing server DATABASE_URL securely before --apply.");
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL);
    const schema = await sql.query(
      "select value as name, to_regclass(value) is not null as present from unnest($1::text[]) as value",
      [REQUIRED_TABLES],
    );
    requireValue(schema.every((row) => row.present), "Academic staging migration is missing.");
    const results = await sql.transaction(statements.map((s) => sql.query(s.text, s.params)));
    const inserted = results.reduce((counts, rows, i) => ({
      ...counts, [statements[i].kind]: (counts[statements[i].kind] || 0) + rows.length,
    }), {});
    console.log(JSON.stringify({ ...summary, mode: "applied-to-staging-tables", database_accessed: true,
      environment: options.environment, inserted, live_records_published: 0 }, null, 2));
  } catch {
    // Do not print provider errors, URLs, connection credentials, or SQL payloads.
    throw new Error("Academic staging failed. Check the existing DATABASE_URL and migration 20260921100000_operations_permissions_academic.sql. Import writes are transactional; no live records are published by this script.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
