import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {groups,verifySchemaProof} from '../server/scripts/verify-schema-proof.mjs';
const load=version=>readFileSync(new URL(`../database/neon/migrations/${version}.sql`,import.meta.url));
// Synthetic attestation tests the release gate. It is not production evidence.
const fixture=()=>({environment:'production',projectId:'rough-breeze-36415261',branchId:'br-quiet-butterfly-ayrj264q',database:'neondb',
 approval:{productionMigrationApproved:true,at:'2026-10-13T00:00:00Z'},verifiedAt:'2026-10-13T01:00:00Z',
 rehearsal:{parentBranchId:'br-quiet-butterfly-ayrj264q',branchId:'br-synthetic-rehearsal'},
 checks:{agentBanks:'passed',fixturesRolledBack:true,isolatedBranchRehearsal:'passed',bankRevisionIsolation:'passed',payoutIdempotencyAndRecovery:'passed'},
 provider:{name:'BACHS',liveConnectEnabled:true,bankNameLookup:'passed',verifiedAgentBankPayout:'passed'},
 migrations:groups.agentBanks.map(version=>{const b=load(version);return {version,sourceBlobSha:createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex')};})});
test('an APK needs both bank lookup and a verified Bachs agent payout',()=>{
 assert.equal(verifySchemaProof(fixture(),'agentBanks',load),5);
 for(const missing of ['liveConnectEnabled','bankNameLookup','verifiedAgentBankPayout']){
  const proof=fixture();proof.provider[missing]=false;
  assert.throws(()=>verifySchemaProof(proof,'agentBanks',load),/Bachs Connect activation/);
 }
 const sandbox=fixture();sandbox.provider.name='PAYSTACK';assert.throws(()=>verifySchemaProof(sandbox,'agentBanks',load),/Bachs Connect activation/);
});
test('rehearsal alone and changed migrations cannot authorize the APK',()=>{
 const rehearsal=fixture();rehearsal.environment='rehearsal';assert.throws(()=>verifySchemaProof(rehearsal,'agentBanks',load),/production migration proof/);
 const sameBranch=fixture();sameBranch.rehearsal.branchId=sameBranch.branchId;assert.throws(()=>verifySchemaProof(sameBranch,'agentBanks',load),/isolated bank/);
 assert.throws(()=>verifySchemaProof(fixture(),'agentBanks',version=>Buffer.concat([load(version),Buffer.from('\n-- changed')])),/changed after verification/);
});
