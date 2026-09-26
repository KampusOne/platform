import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeVersion, assertPreserved, inspectVersions, portalOrigins, repairPlan, runRepair } from './repair-portal-origins.mjs';

const versionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const bindings = [
  { name: 'ALLOWED_ORIGINS', type: 'plain_text', text: 'https://admin.kampusone.app' },
  { name: 'DATABASE_URL', type: 'secret_text' },
  { name: 'MEDIA_BUCKET', type: 'r2_bucket', bucket_name: 'existing-bucket' },
  { name: 'UNIFIED_SCHEMA_READY', type: 'plain_text', text: 'false' },
];
const deployment = { deployments: [{ versions: [{ version_id: versionId, percentage: 100 }] }] };
const versions = { items: [{ id: versionId }] };

test('adds only the two verified exact origins and preserves existing origins', () => {
  const plan = repairPlan(bindings, versionId);
  assert.deepEqual(plan.after, ['https://admin.kampusone.app', ...portalOrigins]);
  assert.deepEqual(plan.settings.bindings.slice(1), bindings.slice(1).map(({ name }) =>
    ({ name, type: 'inherit', version_id: versionId })));
  assert.equal(JSON.stringify(plan.settings).includes('existing-bucket'), false);
});

test('repeated repair is idempotent', () => {
  const plan = repairPlan(bindings, versionId);
  assert.deepEqual(repairPlan([{ ...bindings[0], text: plan.after.join(',') }, ...bindings.slice(1)], versionId).missing, []);
});

test('rejects wildcard, non-origin, missing, duplicate and unreadable allowlists', () => {
  for (const text of ['', '*', 'https://*.vercel.app', 'https://admin.kampusone.app/path', 'http://admin.kampusone.app', 'null'])
    assert.throws(() => repairPlan([{ ...bindings[0], text }], versionId));
  assert.throws(() => repairPlan(bindings.slice(1), versionId));
  assert.throws(() => repairPlan([...bindings, bindings[0]], versionId));
  assert.throws(() => repairPlan([{ name: 'ALLOWED_ORIGINS', type: 'secret_text' }], versionId));
});

test('refuses split traffic and unactivated newer versions', () => {
  assert.equal(activeVersion(deployment, versions), versionId);
  assert.throws(() => activeVersion(deployment, { items: [{ id: 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee' }] }));
  assert.throws(() => activeVersion({ deployments: [{ versions: [{ version_id: versionId, percentage: 50 }] }] }, versions));
});

test('detects changes to feature flags, secrets, buckets and runtime settings', () => {
  const before = { bindings, compatibility_date: '2026-09-09' };
  const plan = repairPlan(bindings, versionId);
  const after = { ...before, bindings: [{ ...bindings[0], text: plan.after.join(',') }, ...bindings.slice(1)] };
  assertPreserved(before, after, plan.after);
  assert.throws(() => assertPreserved(before, { ...after, bindings: after.bindings.slice(0, -1) }, plan.after));
  assert.throws(() => assertPreserved(before, { ...after, compatibility_date: '2026-09-10' }, plan.after));
  assert.throws(() => assertPreserved(before, { ...after, bindings: after.bindings.map(b => b.name === 'MEDIA_BUCKET' ? { ...b, bucket_name: 'wrong' } : b) }, plan.after));
});

test('dry run never writes; apply performs one settings-only update and email-free checks', async () => {
  let settings = { bindings };
  const writes = [];
  const publicRequests = [];
  const cf = async (path, init = {}) => {
    if (init.method) {
      writes.push({ path, method: init.method });
      const payload = JSON.parse(init.body.get('settings'));
      settings = { bindings: payload.bindings.map(b => b.type === 'inherit' ? bindings.find(old => old.name === b.name) : b) };
    }
    if (path === '/deployments') return deployment;
    if (path === '/versions') return versions;
    if (path.startsWith('/versions/')) return { resources: { script: { etag: 'same-code' } } };
    if (path === '/settings') return structuredClone(settings);
    throw new Error('Unexpected endpoint');
  };
  const publicFetch = async (url, init) => {
    publicRequests.push({ url, init });
    const allowed = portalOrigins.includes(init.headers.Origin);
    const status = !allowed ? 403 : url.endsWith('/refresh') ? 401 : 400;
    return Response.json({ error: { code: status === 400 ? 'BAD_REQUEST' : status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN' } }, { status });
  };
  await runRepair({ cf, publicFetch, report() {} });
  assert.equal(writes.length, 0);
  assert.equal(publicRequests.length, 0);
  await runRepair({ cf, publicFetch, apply: true, report() {} });
  assert.deepEqual(writes, [{ path: '/settings', method: 'PATCH' }]);
  assert.equal(publicRequests.length, 6);
  assert.ok(publicRequests.every(({ init }) => init.body === '{}' && !init.headers.Cookie));
  await runRepair({ cf, publicFetch, apply: true, report() {} });
  assert.equal(writes.length, 1);
});

test('stops before mutation if live settings drift during review', async () => {
  let reads = 0;
  let writes = 0;
  await assert.rejects(runRepair({ apply: true, report() {}, publicFetch() { throw new Error('No live call expected'); },
    cf: async (path, init) => {
      if (init) writes++;
      if (path === '/deployments') return deployment;
      if (path === '/versions') return versions;
      if (path.startsWith('/versions/')) return { resources: { script: { etag: 'same' } } };
      return { bindings, compatibility_date: ++reads === 1 ? '2026-09-09' : '2026-09-10' };
    },
  }), /changed during review/);
  assert.equal(writes, 0);
});

test('version inspection never writes or prints binding values', async () => {
  const logs = [];
  await inspectVersions(async (path, init) => {
    assert.equal(init, undefined);
    if (path === '/deployments') return deployment;
    if (path === '/versions') return versions;
    return { resources: { script: { etag: 'private-fingerprint' }, bindings: [{ name: 'PRIVATE', text: 'never-log-this' }] } };
  }, line => logs.push(line));
  assert.ok(logs.some(line => line === 'Same code fingerprint: true'));
  assert.equal(logs.join('\n').includes('never-log-this'), false);
  assert.equal(logs.join('\n').includes('private-fingerprint'), false);
});
