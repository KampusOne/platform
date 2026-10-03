import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { groups, verifySchemaProof } from '../server/scripts/verify-schema-proof.mjs';

const manifest = JSON.parse(readFileSync(new URL('../database/verification/2026-10-03-experience-manifest.json', import.meta.url)));
const load = version => readFileSync(new URL(`../database/neon/migrations/${version}.sql`, import.meta.url));
// Explicit test attestation: no production branch is contacted or approved here.
const fixture = () => ({ environment:'production', projectId:'rough-breeze-36415261', branchId:'br-quiet-butterfly-ayrj264q', database:'neondb',
  approval:{productionMigrationApproved:true,at:'2026-10-03T00:00:00Z'}, verifiedAt:'2026-10-03T01:00:00Z',
  rehearsal:{parentBranchId:'br-quiet-butterfly-ayrj264q',branchId:'br-test-rehearsal'},
  checks:{experience:'passed',fixturesRolledBack:true,currentLiveBranchRehearsal:'passed',existingAccountCountsPreserved:true,mediaAndBookingsPreserved:true,privatePrivileges:'passed'},
  migrations:manifest.migrations.map(({version,sourceBlobSha})=>({version,sourceBlobSha})),
});
test('all eight experience migration sources are frozen and match their manifest', () => {
  assert.equal(groups.experience.length,8);
  assert.equal(new Set(groups.experience).size,8);
  for (const migration of manifest.migrations) {
    const bytes=load(migration.version);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),migration.sha256);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),migration.sourceBlobSha);
  }
});
test('experience release needs exact sources and isolated current branch preservation evidence', () => {
  assert.equal(verifySchemaProof(fixture(),'experience',load),8);
  const missing=fixture();missing.migrations.pop();assert.throws(()=>verifySchemaProof(missing,'experience',load),/Missing or invalid proof/);
  const noRehearsal=fixture();noRehearsal.rehearsal.branchId=noRehearsal.branchId;assert.throws(()=>verifySchemaProof(noRehearsal,'experience',load),/rehearsal/);
  const lostRecords=fixture();lostRecords.checks.existingAccountCountsPreserved=false;assert.throws(()=>verifySchemaProof(lostRecords,'experience',load),/preservation/);
  assert.throws(()=>verifySchemaProof(fixture(),'experience',version=>Buffer.concat([load(version),Buffer.from('\n-- changed')])),/changed after verification/);
});
