import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groups, verifySchemaProof } from "../scripts/verify-schema-proof.mjs";

const load = (version: string) => readFileSync(new URL(`../../database/neon/migrations/${version}.sql`, import.meta.url));
// Synthetic operator evidence tests the guard only; never save this as production evidence.
const proof = () => ({
  environment: "production", projectId: "rough-breeze-36415261",
  branchId: "br-quiet-butterfly-ayrj264q", database: "neondb",
  approval: { productionMigrationApproved: true, at: "2026-09-21T00:00:00Z" },
  verifiedAt: "2026-09-21T01:00:00Z",
  checks: { corrections: "passed", fixturesRolledBack: true },
  migrations: groups.corrections.map((version: string) => {
    const bytes = load(version);
    return { version, sourceBlobSha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") };
  }),
});
describe("correction deployment guard", () => {
  it("rejects current-release proof without rehearsal, preservation, or private replay boundaries", () => {
    const currentProof = {
      ...proof(),
      rehearsal: { parentBranchId: "br-quiet-butterfly-ayrj264q", branchId: "br-fixture-rehearsal" },
      checks: { current: "passed", fixturesRolledBack: true, isolatedBranchRehearsal: "passed", existingAccountCountsPreserved: true, mediaAndBookingsPreserved: true, financialRecordsPreserved: true, durableReplayGuards: "passed", privatePrivileges: "passed" },
      migrations: groups.current.map((version: string) => {
        const bytes = load(version);
        return { version, sourceBlobSha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") };
      }),
    };
    expect(verifySchemaProof(currentProof, "current", load)).toBe(6);
    expect(() => verifySchemaProof({ ...currentProof, rehearsal: undefined }, "current", load)).toThrow(/rehearsal/);
    expect(() => verifySchemaProof({ ...currentProof, checks: { ...currentProof.checks, financialRecordsPreserved: false } }, "current", load)).toThrow(/preservation/);
    expect(() => verifySchemaProof({ ...currentProof, checks: { ...currentProof.checks, durableReplayGuards: "failed" } }, "current", load)).toThrow();
    expect(() => verifySchemaProof({ ...currentProof, checks: { ...currentProof.checks, privatePrivileges: "failed" } }, "current", load)).toThrow();
  });
  it("requires platform evidence and rejects an offline rehearsal report", () => {
    const evidence = proof();
    const platformProof = {
      ...evidence,
      rehearsal: { parentBranchId: "br-quiet-butterfly-ayrj264q", branchId: "br-fixture-rehearsal" },
      checks: { platform: "passed", fixturesRolledBack: true, currentLiveBranchRehearsal: "passed", existingAccountCountsPreserved: true, mediaAndBookingsPreserved: true, privatePrivileges: "passed" },
      migrations: groups.platform.map((version: string) => {
        const bytes = load(version);
        return { version, sourceBlobSha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") };
      }),
    };
    expect(verifySchemaProof(platformProof, "platform", load)).toBe(groups.platform.length);
    expect(() => verifySchemaProof({ ...platformProof, rehearsal: undefined }, "platform", load)).toThrow(/rehearsal/);
    expect(() => verifySchemaProof(evidence, "platform", load)).toThrow();
    const offline = JSON.parse(readFileSync(new URL("../../database/verification/2026-10-01-offline-live-schema-rehearsal.json", import.meta.url), "utf8"));
    expect(() => verifySchemaProof(offline, "platform", load)).toThrow();
  });
  it("requires the exact compatible source and explicit supersession instead of false original-source evidence", () => {
    const evidence = proof();
    const compatible = "20260930190000_live_legacy_prerequisites";
    const bytes = load(compatible);
    const amended = {
      ...evidence,
      migrations: evidence.migrations.filter((item: { version: string }) => item.version !== "20260925110000_notification_sound_catalogue").concat({ version: compatible, sourceBlobSha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") }),
      supersededPrerequisites: [{ version: "20260925110000_notification_sound_catalogue", by: compatible }],
    };
    expect(verifySchemaProof(amended, "corrections", load)).toBe(groups.corrections.length);
    expect(() => verifySchemaProof({ ...amended, supersededPrerequisites: [] }, "corrections", load)).toThrow();
    expect(() => verifySchemaProof(amended, "corrections", version => version === compatible ? "changed SQL" : load(version))).toThrow(/changed/);
  });
  it("requires reviewed evidence for every exact migration file", () => {
    expect(verifySchemaProof(proof(), "corrections", load)).toBe(groups.corrections.length);
    expect(groups.corrections.map((name: string) => `${name}.sql`).sort()).toEqual(readdirSync(new URL("../../database/neon/migrations/", import.meta.url)).filter((name: string) => name.startsWith("20260921") || name.startsWith("20260922") || name.startsWith("20260924") || name.startsWith("20260925")).sort());
  });
  it("rejects the earlier production attestation", () => {
    const previous = JSON.parse(readFileSync(new URL("../../database/verification/production-20260920.json", import.meta.url), "utf8"));
    expect(() => verifySchemaProof(previous, "corrections", load)).toThrow();
  });
  it("rejects missing, changed, unapproved and wrong-branch evidence", () => {
    const missing = proof(); missing.migrations.pop();
    expect(() => verifySchemaProof(missing, "corrections", load)).toThrow();
    expect(() => verifySchemaProof(proof(), "corrections", () => "changed SQL")).toThrow(/changed/);
    const unapproved = proof(); unapproved.approval.productionMigrationApproved = false;
    expect(() => verifySchemaProof(unapproved, "corrections", load)).toThrow();
    const wrongBranch = proof(); wrongBranch.branchId = "preview-branch";
    expect(() => verifySchemaProof(wrongBranch, "corrections", load)).toThrow();
  });
});
