import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const groups = {
  phase3: ["20260912200000_phase_3_commerce_foundation"],
  unified: [
    "20260913200000_unified_student_platform",
    "20260913210000_timetable_course_alarm_sync",
    "20260913220000_ai_requests",
    "20260913230000_community_workflows",
    "20260913240000_verified_identity_and_resources",
    "20260913250000_one_time_alarms",
  ],
};

export function verifySchemaProof(proof, group, loadMigration) {
  const required = groups[group];
  if (!required) throw new Error("Unknown migration proof group");
  if (
    proof?.environment !== "production" ||
    proof?.projectId !== "rough-breeze-36415261" ||
    proof?.branchId !== "br-quiet-butterfly-ayrj264q" ||
    proof?.database !== "neondb" ||
    proof?.approval?.productionMigrationApproved !== true ||
    !Number.isFinite(Date.parse(proof?.approval?.at)) ||
    !Number.isFinite(Date.parse(proof?.verifiedAt)) ||
    Date.parse(proof.verifiedAt) < Date.parse(proof.approval.at) ||
    proof?.checks?.[group] !== "passed" ||
    proof?.checks?.fixturesRolledBack !== true ||
    !Array.isArray(proof?.migrations)
  ) throw new Error("Approved and verified production migration proof is required");
  for (const version of required) {
    const records = proof.migrations.filter((item) => item.version === version);
    if (records.length !== 1 || !/^[a-f0-9]{40}$/.test(records[0].sourceBlobSha)) {
      throw new Error(`Missing or invalid proof for ${version}`);
    }
    const bytes = Buffer.from(loadMigration(version));
    const actual = createHash("sha1")
      .update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (actual !== records[0].sourceBlobSha) {
      throw new Error(`Migration ${version} changed after verification; obtain new proof`);
    }
  }
  return required.length;
}

// This validates a dated operator attestation, not a new live database probe.
// Existing GitHub migration-proof variables remain supported by the workflow.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = new URL("../../", import.meta.url);
  try {
    const proof = JSON.parse(readFileSync(new URL("database/verification/production-20260920.json", root), "utf8"));
    const count = verifySchemaProof(proof, process.argv[2], (version) =>
      readFileSync(new URL(`database/neon/migrations/${version}.sql`, root)));
    console.log(`Verified recorded production proof: ${process.argv[2]} (${count} migration files).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Migration proof verification failed");
    process.exitCode = 1;
  }
}
