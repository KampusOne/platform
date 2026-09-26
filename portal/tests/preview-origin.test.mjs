import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewApiRequest } from '../lib/preview-origin.ts';

const env = { VERCEL_ENV: 'preview', VERCEL_URL: 'owned-build.vercel.app', VERCEL_BRANCH_URL: 'owned-branch.vercel.app' };
const headers = (values = {}) => new Headers({ host: env.VERCEL_URL, origin: `https://${env.VERCEL_URL}`, ...values });
const decide = (values = {}, method = 'POST') => previewApiRequest('/api/v1/auth/forgot-password', method, headers(values), env);

test('forwards only same-origin deployment and branch requests through the canonical portal', () => {
  for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
    const original = headers({ host, origin: `https://${host}`, 'content-type': 'application/json', authorization: 'Bearer test-only' });
    const decision = previewApiRequest('/api/v1/auth/refresh', 'POST', original, env);
    assert.equal(decision.kind, 'forward');
    assert.equal(decision.headers.get('origin'), 'https://kampusone-platform-preview.vercel.app');
    assert.equal(decision.headers.get('authorization'), 'Bearer test-only');
    assert.equal(decision.headers.get('content-type'), 'application/json');
    assert.equal(original.get('origin'), `https://${host}`);
  }
});

test('rejects foreign, sibling, null, malformed and downgraded origins', () => {
  for (const origin of ['https://attacker.invalid', `https://${env.VERCEL_BRANCH_URL}`, 'null', 'https://owned-build.vercel.app.attacker.invalid', `http://${env.VERCEL_URL}`, `https://${env.VERCEL_URL}:444`, `https://${env.VERCEL_URL}/`])
    assert.equal(decide({ origin }).kind, 'reject');
});

test('rejects untrusted Host even if Origin or forwarded-host claims ownership', () => {
  for (const host of ['attacker.vercel.app', 'owned-build.vercel.app.attacker.invalid', 'owned-build.vercel.app:444'])
    assert.equal(decide({ host, origin: `https://${host}`, 'x-forwarded-host': env.VERCEL_URL }).kind, 'reject');
});

test('missing deployment metadata fails closed', () => {
  for (const missing of [{ VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'preview', VERCEL_URL: '*.vercel.app' }])
    assert.equal(previewApiRequest('/api/v1/auth/refresh', 'POST', headers(), missing).kind, 'reject');
});

test('cross-site and same-site fetch metadata are rejected, including cookie-bearing GETs', () => {
  for (const site of ['cross-site', 'same-site'])
    for (const method of ['GET', 'POST'])
      assert.equal(decide({ 'sec-fetch-site': site, cookie: 'k1_access=test-only' }, method).kind, 'reject');
});

test('writes require Origin; normal reads may omit Origin', () => {
  const noOrigin = headers(); noOrigin.delete('origin');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
    assert.equal(previewApiRequest('/api/v1/account/profile', method, noOrigin, env).kind, 'reject');
  assert.equal(previewApiRequest('/api/v1/auth/social/config', 'GET', noOrigin, env).kind, 'forward');
});

test('forwards only API session cookies and strips the hosting bypass header', () => {
  const decision = decide({ cookie: 'hosting_secret=private; k1_access=access-test; _vercel_jwt=private; k1_refresh=refresh-test', 'x-vercel-protection-bypass': 'private' });
  assert.equal(decision.headers.get('cookie'), 'k1_access=access-test; k1_refresh=refresh-test');
  assert.equal(decision.headers.has('x-vercel-protection-bypass'), false);
  assert.equal(decide({ cookie: 'hosting_secret=private' }).headers.has('cookie'), false);
});

test('production, local development and portal page host separation are untouched', () => {
  for (const VERCEL_ENV of ['production', 'development', undefined])
    assert.equal(previewApiRequest('/api/v1/auth/refresh', 'POST', headers(), { ...env, VERCEL_ENV }).kind, 'unchanged');
  for (const path of ['/admin', '/agents', '/engineering', '/api-other'])
    assert.equal(previewApiRequest(path, 'GET', headers(), env).kind, 'unchanged');
});
