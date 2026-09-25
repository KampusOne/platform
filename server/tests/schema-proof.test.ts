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
