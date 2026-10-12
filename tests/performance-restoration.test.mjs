import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nativeTransport } from './helpers/native-transport.mjs';
import { invalidationTargets } from '../mobile/src/lib/request-policy.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('background usage writes do not evict campus or academic reads', async () => {
  assert.deepEqual(invalidationTargets('/v1/usage'), []);
  let reads = 0;
  const transport = nativeTransport(async (url, init) => {
    if (String(url).includes('/v1/student/gpa')) return Response.json({ revision: ++reads });
    if (String(url).includes('/v1/usage')) return Response.json({ accepted: true });
    throw Error('Unexpected route: ' + url);
  });
  transport.setAccessToken('test', 'student-one');
  const first = await transport.api('/v1/student/gpa');
  await transport.api('/v1/usage', { method: 'POST', body: JSON.stringify({ seconds: 1 }) });
  const second = await transport.api('/v1/student/gpa');
  assert.equal(first.revision, second.revision);
  assert.equal(reads, 1);
});

test('a standard 15-second screen timeout still benefits from the read cache', async () => {
  let calls = 0;
  const transport = nativeTransport(async () => Response.json({ revision: ++calls }));
  transport.setAccessToken('test', 'student-one');
  const first = await transport.api('/v1/student/feed?limit=20', { timeoutMs: 15_000 });
  const second = await transport.api('/v1/student/feed?limit=20', { timeoutMs: 15_000 });
  assert.equal(first.revision, second.revision);
  assert.equal(calls, 1);
});

test('targeted push invalidation retains unrelated GPA data', async () => {
  const calls = new Map();
  const transport = nativeTransport(async url => {
    const path = new URL(String(url)).pathname;
    const next = (calls.get(path) ?? 0) + 1;
    calls.set(path, next);
    return Response.json({ revision: next });
  });
  transport.setAccessToken('test', 'student-one');
  await transport.api('/v1/student/gpa');
  await transport.api('/v1/messages/inbox');
  transport.invalidateApiReads(['/v1/notifications', '/v1/messages/inbox']);
  assert.equal((await transport.api('/v1/student/gpa')).revision, 1);
  assert.equal((await transport.api('/v1/messages/inbox')).revision, 2);
});

test('Android can remove its local sign-in when the logout endpoint is unavailable', async () => {
  const transport = nativeTransport(async () => { throw new TypeError('Network unavailable'); });
  transport.setAccessToken('test', 'student-one');
  const result = await transport.authApi.logout();
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { status: 'signed_out', serverRevoked: false });
});

test('timetable and exam imports expose real transfer progress rather than fake AI percentages', () => {
  const loader = read('mobile/src/components/import-progress.tsx');
  const uploads = read('mobile/src/lib/uploads.ts');
  const timetable = read('mobile/app/timetable-import.tsx');
  const exam = read('mobile/app/exam-timetable.tsx');
  assert.match(loader, /accessibilityRole="progressbar"/);
  assert.match(loader, /indeterminate indicator|indeterminate/);
  assert.doesNotMatch(loader, /ActivityIndicator/);
  assert.match(uploads, /onProgress,'resource'/);
  assert.match(timetable, /<ImportProgress/);
  assert.match(exam, /<ImportProgress/);
  assert.match(exam, /retryWithNewKey/);
});

test('logout navigation and legal approval notice are explicit', () => {
  assert.match(read('mobile/app/account.tsx'), /router\.replace\("\/\(auth\)\/welcome"\)/);
  assert.match(read('mobile/app/legal.tsx'), /Pending legal and operator verification/);
  assert.match(read('docs/legal/2026-10-12-publication-checklist.md'), /NOT APPROVED FOR PUBLICATION/);
});
