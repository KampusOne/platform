import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { groups, verifySchemaProof } from '../server/scripts/verify-schema-proof.mjs';

const manifest = JSON.parse(readFileSync(new URL('../database/verification/2026-10-04-correction-manifest.json', import.meta.url)));
const load = version => readFileSync(new URL(`../database/neon/migrations/${version}.sql`, import.meta.url));
// A test-only attestation. These tests neither connect to nor approve production.
const fixture = () => ({
  environment: 'production', projectId: 'rough-breeze-36415261',
  branchId: 'br-quiet-butterfly-ayrj264q', database: 'neondb',
  approval: { productionMigrationApproved: true, at: '2026-10-04T00:00:00Z' },
  verifiedAt: '2026-10-04T01:00:00Z',
  rehearsal: { parentBranchId: 'br-quiet-butterfly-ayrj264q', branchId: 'br-reused-isolated-fixture' },
  checks: { october4: 'passed', fixturesRolledBack: true, isolatedBranchRehearsal: 'passed',
    existingAccountCountsPreserved: true, mediaAndBookingsPreserved: true,
    communityProjectionsPreserved: true, agentApprovalProjectionsPreserved: true,
    bankAndPayoutBoundaryUnchanged: true, privatePrivileges: 'passed' },
  migrations: manifest.migrations.map(({ version, sourceBlobSha }) => ({ version, sourceBlobSha })),
});

test('October 4 corrections require their exact reviewed source files', () => {
  assert.equal(groups.october4.length, 3);
  assert.equal(new Set(groups.october4).size, 3);
  for (const migration of manifest.migrations) {
    const bytes = load(migration.version);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), migration.sha256);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), migration.sourceBlobSha);
  }
  assert.equal(verifySchemaProof(fixture(), 'october4', load), 3);
  assert.throws(() => verifySchemaProof(fixture(), 'october4', version => Buffer.concat([load(version), Buffer.from('\n-- changed')])), /changed after verification/);
  const missing = fixture(); missing.migrations.pop();
  assert.throws(() => verifySchemaProof(missing, 'october4', load), /Missing or invalid proof/);
});

test('October 4 corrections require isolated rehearsal and preservation', () => {
  const noRehearsal = fixture(); noRehearsal.rehearsal.branchId = noRehearsal.branchId;
  assert.throws(() => verifySchemaProof(noRehearsal, 'october4', load), /Isolated correction rehearsal/);
  const lostCommunity = fixture(); lostCommunity.checks.communityProjectionsPreserved = false;
  assert.throws(() => verifySchemaProof(lostCommunity, 'october4', load), /data-preservation/);
  const noRollback = fixture(); noRollback.checks.fixturesRolledBack = false;
  assert.throws(() => verifySchemaProof(noRollback, 'october4', load), /Approved and verified production migration proof/);
});
