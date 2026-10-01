import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, relative } from "node:path";

// Read-only reconciliation. Object-name presence is evidence for review, never
// permission to replay a migration or proof its columns/functions match.
const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
for (const [index, arg] of args.entries())
  if (
    index % 2 === 0 &&
    !["--manifest", "--snapshot", "--output"].includes(arg)
  )
    throw new Error("Unknown reconciliation option");
if (args.length % 2) throw new Error("Each option requires a path");
const manifest = JSON.parse(
  readFileSync(
    resolve(
      root,
      value("--manifest") ??
        "database/verification/2026-09-30-migration-manifest.json",
    ),
    "utf8",
  ),
);
const snapshotPath = resolve(
  root,
    value("--snapshot") ?? manifest.liveReconciliation?.schema ?? "database/verification/2026-10-01-live-schema.json",
);
const snapshotBytes = readFileSync(snapshotPath),
  snapshot = JSON.parse(snapshotBytes.toString("utf8"));
const tables = new Set(snapshot.tables),
  functions = new Set(snapshot.functions.map((f) => f.schema + "." + f.name)),
  columns = new Set(snapshot.columns.map((c) => c.table + "." + c.name));
const ledger = new Map(snapshot.ledger.map((row) => [row.version, row]));
const seen = new Set();
const migrations = manifest.migrations.map((m) => {
  if (
    seen.has(m.version) ||
    !/^database\/neon\/migrations\/\d{14}_[a-z0-9_]+\.sql$/.test(m.path)
  )
    throw new Error("Invalid or duplicated migration identity: " + m.version);
  seen.add(m.version);
  const bytes = readFileSync(resolve(root, m.path)),
    sha256 = createHash("sha256").update(bytes).digest("hex"),
    gitBlobSha = createHash("sha1")
      .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
      .digest("hex");
  if (m.sha256 !== sha256 || m.gitBlobSha !== gitBlobSha)
    throw new Error("Manifest checksum mismatch: " + m.version);
  const text = bytes.toString("utf8"),
    recorded = ledger.get(m.version),
    queued = m.status === "queued_in_this_update";
  const objects = [
    ...new Set(
      [
        ...text.matchAll(
          /create\s+(?:or\s+replace\s+)?(table|function)\s+(?:if\s+not\s+exists\s+)?((?:public|app_private)\.[a-z_][a-z_0-9]*)/gi,
        ),
      ].map((match) => match[1].toLowerCase() + ":" + match[2].toLowerCase()),
    ),
  ];
  const additions = [
    ...new Set(
      [
        ...text.matchAll(
          /alter\s+table\s+((?:public|app_private)\.[a-z_][a-z_0-9]*)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z_0-9]*)/gi,
        ),
      ].map((match) => match[1].toLowerCase() + "." + match[2].toLowerCase()),
    ),
  ];
  const present = (object) => {
    const [kind, name] = object.split(":");
    return (kind === "table" ? tables : functions).has(name);
  };
  return {
    version: m.version,
    path: m.path,
    sha256,
    gitBlobSha,
    status: recorded
      ? recorded.source_blob_sha === gitBlobSha
        ? "registered_applied_match"
        : "registered_applied_source_mismatch"
      : queued
        ? "new_version_not_registered"
        : "unregistered_requires_structural_review",
    ...(recorded
      ? {
          registeredBlobSha: recorded.source_blob_sha,
          appliedAt: recorded.applied_at,
        }
      : {}),
    observedNames: {
      present: objects.filter(present),
      absent: objects.filter((o) => !present(o)),
      presentAddedColumns: additions.filter((c) => columns.has(c)),
      absentAddedColumns: additions.filter((c) => !columns.has(c)),
    },
  };
});
const counts = {};
for (const migration of migrations)
  counts[migration.status] = (counts[migration.status] ?? 0) + 1;
const result = {
  observedAt: snapshot.observed_at,
  snapshot: relative(root, snapshotPath),
  snapshotSha256: createHash("sha256").update(snapshotBytes).digest("hex"),
  scope:
    "Read-only structural and registered-source reconciliation. No production writes.",
  executionAuthorized: false,
  applyList: null,
  reason:
    "An absent ledger record does not prove a version is unapplied. Review unregistered and mismatched sources on an isolated production branch before creating an apply list. Name-only presence does not verify function bodies, constraints or data effects.",
  counts,
  unmatchedLedgerVersions: snapshot.ledger
    .filter((row) => !seen.has(row.version))
    .map((row) => row.version),
  migrations,
};
const output = value("--output");
if (output)
  writeFileSync(resolve(root, output), JSON.stringify(result, null, 2) + "\n");
console.log(
  JSON.stringify({
    observedAt: result.observedAt,
    counts,
    applyList: null,
    unmatchedLedgerVersions: result.unmatchedLedgerVersions,
  }),
);
