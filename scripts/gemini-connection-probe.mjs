import { appendFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

// This module is invoked by the dedicated production-authorized diagnostic job.
// The provider key never leaves Cloudflare. Only three named bindings are inherited
// by an expiring preview; the production application and database are untouched.
export async function probe(request, env) {
  const reply = body => Response.json({ kind: 'kampusone-gemini-connection-v3', ...body }, { headers: { 'Cache-Control': 'no-store' } });
  const supplied = request.headers.get('x-probe-token') ?? '', expiry = Number(env.PROBE_EXPIRES_AT);
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/__ai_connection_probe' || !/^[a-f0-9]{64}$/.test(env.PROBE_TOKEN ?? '') || !/^[a-f0-9]{64}$/.test(supplied) || !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 240000) return new Response(null, { status: 404 });
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= supplied.charCodeAt(i) ^ env.PROBE_TOKEN.charCodeAt(i);
  if (diff) return new Response(null, { status: 404 });
  if (env.AI_ASSISTANT_ENABLED !== 'true') return reply({ outcome: 'ai_paused' });
  const key = typeof env.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '';
  const model = typeof env.GEMINI_MODEL === 'string' ? env.GEMINI_MODEL.trim().replace(/^models\//, '') : '';
  if (!key || !model) return reply({ outcome: 'configuration_missing' });
  const format = key.startsWith('AQ.') ? 'aq_format' : key.startsWith('AIza') ? 'aiza_format' : 'other_format';
  if (/[^\x21-\x7e]|["']/.test(key) || /^(?:GEMINI_API_KEY|GOOGLE_API_KEY)\s*=/.test(key)) return reply({ outcome: 'local_key_format', format });
  if (!/^gemini-[a-zA-Z0-9._-]{1,100}$/.test(model)) return reply({ outcome: 'model_setting_invalid', format });
  const reasons = new Set(['API_KEY_INVALID','API_KEY_EXPIRED','API_KEY_NOT_FOUND','API_KEY_SERVICE_BLOCKED','API_KEY_HTTP_REFERRER_BLOCKED','API_KEY_IP_ADDRESS_BLOCKED','API_KEY_ANDROID_APP_BLOCKED','API_KEY_IOS_APP_BLOCKED','ACCESS_TOKEN_TYPE_UNSUPPORTED','ACCESS_TOKEN_EXPIRED','CREDENTIALS_MISSING','SERVICE_DISABLED','CONSUMER_INVALID','CONSUMER_SUSPENDED','BILLING_DISABLED','USER_PROJECT_DENIED','IAM_PERMISSION_DENIED','RATE_LIMIT_EXCEEDED','RESOURCE_EXHAUSTED','SECURITY_POLICY_VIOLATED']);
  const statuses = new Set(['INVALID_ARGUMENT','UNAUTHENTICATED','PERMISSION_DENIED','NOT_FOUND','FAILED_PRECONDITION','RESOURCE_EXHAUSTED','INTERNAL','UNAVAILABLE','DEADLINE_EXCEEDED']);
  let phase = 'headers', http;
  const inference = env.PROBE_INFERENCE === 'true';
  try {
    const headers = new Headers({ 'x-goog-api-key': key, 'Content-Type': 'application/json' });
    phase = 'google_fetch';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}${inference ? ':generateContent' : ''}`;
    // At most one generation call with a fixed, non-private academic question.
    // No arbitrary prompt, file, tool, automatic retry or fallback is accepted.
    const response = await fetch(url, {
      method: inference ? 'POST' : 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(30000),
      ...(inference ? { body: JSON.stringify({
        systemInstruction: { parts: [{ text: "You are KampusOne's university learning assistant. Explain academic topics clearly and admit uncertainty." }] },
        contents: [{ role: 'user', parts: [{ text: "State Ohm's law in one short sentence." }] }],
        generationConfig: { maxOutputTokens: 128, temperature: 0.2 },
      }) } : {}),
    });
    http = response.status;
    if ((response.ok && !inference) || (http >= 300 && http < 400)) {
      void response.body?.cancel().catch(() => undefined);
      return reply({ outcome: response.ok ? 'metadata_accepted' : 'google_redirect', http, format });
    }
    phase = 'response_body';
    const reader = response.body?.getReader();
    const chunks = []; let length = 0, complete = true;
    try {
      if (reader) for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 16384) { complete = false; await reader.cancel(); break; }
        chunks.push(value);
      }
    } finally { reader?.releaseLock(); }
    phase = 'response_decode';
    let payload = {};
    if (complete) {
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* Never emit the raw body. */ }
    }
    if (response.ok) {
      const candidate = payload?.candidates?.[0];
      const text = Array.isArray(candidate?.content?.parts) ? candidate.content.parts.filter(part => !part?.thought && typeof part?.text === 'string').map(part => part.text).join('').trim() : '';
      const usable = Boolean(text) && (!candidate?.finishReason || candidate.finishReason === 'STOP') && !payload?.promptFeedback?.blockReason;
      return reply({ outcome: usable ? 'generation_succeeded' : 'generation_unusable', http, format });
    }
    const error = payload && typeof payload === 'object' ? payload.error : undefined;
    const reason = Array.isArray(error?.details) ? error.details.map(item => item?.reason).find(value => reasons.has(value)) : undefined;
    const status = statuses.has(error?.status) ? error.status : undefined;
    const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
    const hint = message.includes('reported as leaked') ? 'known_leaked_key' : message.includes('project has been denied access') ? 'project_access_denied' : 'none';
    return reply({ outcome: 'google_rejected', http, format, reason: reason ?? 'UNCLASSIFIED', status: status ?? 'UNCLASSIFIED', hint });
  } catch (error) {
    const errorName = ['TypeError','RangeError','TimeoutError','AbortError','Error'].includes(error?.name) ? error.name : 'UNCLASSIFIED';
    return reply({ outcome: 'transport_failure', phase, http, format, errorName });
  }
}

async function selfTests() {
  const nonce = randomBytes(32).toString('hex');
  const env = { PROBE_TOKEN: nonce, PROBE_EXPIRES_AT: String(Date.now() + 180000), PROBE_INFERENCE: 'true', AI_ASSISTANT_ENABLED: 'true', GEMINI_API_KEY: 'AQ.synthetic-test-value', GEMINI_MODEL: 'gemini-test-model' };
  const request = (token = nonce) => new Request('https://example.invalid/__ai_connection_probe', { method: 'POST', headers: { 'x-probe-token': token } });
  const realFetch = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(options.method, 'POST');
      assert.equal(JSON.parse(options.body).generationConfig.maxOutputTokens, 128);
      assert.equal(JSON.parse(options.body).contents[0].parts[0].text, "State Ohm's law in one short sentence.");
      return Response.json({ error: { status: 'UNAUTHENTICATED', message: 'PRIVATE_INPUT AQ.synthetic-test-value', details: [{ reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED', metadata: { secret: 'PRIVATE_INPUT' } }] } }, { status: 401 });
    };
    assert.equal((await probe(request('0'.repeat(64)), env)).status, 404);
    assert.equal((await probe(request(), { ...env, PROBE_EXPIRES_AT: '0' })).status, 404);
    assert.equal(calls, 0);
    const result = await (await probe(request(), env)).json();
    assert.equal(result.reason, 'ACCESS_TOKEN_TYPE_UNSUPPORTED');
    assert.equal(JSON.stringify(result).includes('PRIVATE_INPUT'), false);
    assert.equal(JSON.stringify(result).includes('synthetic-test-value'), false);
    for (const key of ['"AQ.synthetic"','AQ.synthetic\u200b','GEMINI_API_KEY=AQ.synthetic']) {
      assert.equal((await (await probe(request(), { ...env, GEMINI_API_KEY: key })).json()).outcome, 'local_key_format');
    }
    assert.equal(calls, 1);
    globalThis.fetch = async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'SYNTHETIC_RESPONSE' }] } }] });
    const generated = await (await probe(request(), env)).json();
    assert.equal(generated.outcome, 'generation_succeeded');
    assert.equal(JSON.stringify(generated).includes('SYNTHETIC_RESPONSE'), false);
    globalThis.fetch = async () => { throw new TypeError('PRIVATE_INPUT'); };
    const failure = await (await probe(request(), env)).json();
    assert.equal(failure.phase, 'google_fetch');
    assert.equal(failure.errorName, 'TypeError');
    assert.equal(JSON.stringify(failure).includes('PRIVATE_INPUT'), false);
  } finally { globalThis.fetch = realFetch; }
  console.log('PASS: diagnostic authorization, expiry, single bounded generation, output validation and secret redaction tests.');
}
await selfTests();
if (process.argv.includes('--self-test')) process.exit(0);

const lines = ['# Gemini connection diagnostic', '', 'Uses an expiring remote preview, not a live application route. No user content, database access, credential export, fallback or production configuration change.', ''];
const report = text => { console.log(text); lines.push(text); };
const account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
let stage = 'configuration';
const fetchSafe = (url, options = {}) => fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(40000) });
const cf = async (suffix, options = {}) => {
  const response = await fetchSafe(`https://api.cloudflare.com/client/v4/accounts/${account}${suffix}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.success) throw new Error('Cloudflare operation not successful');
  return data.result;
};
try {
  if (!token || !/^[a-f0-9]{32}$/i.test(account ?? '')) throw new Error('Deployment credentials unavailable');
  stage = 'read active bindings';
  const settings = await cf('/workers/scripts/platformp/settings');
  const names = ['GEMINI_API_KEY','GEMINI_MODEL','AI_ASSISTANT_ENABLED'];
  for (const name of names) if (!settings.bindings?.some(binding => binding.name === name)) throw new Error('Required binding missing');
  if (settings.bindings.find(binding => binding.name === 'GEMINI_API_KEY')?.type !== 'secret_text') throw new Error('Key is not secret');
  report('PASS: required production bindings present; key value not read by CI.');
  stage = 'create remote preview session';
  const session = await cf('/workers/scripts/platformp/subdomain/edge-preview');
  let sessionToken = session.token, host = 'platformp.divine-haze-54eb.workers.dev';
  if (session.exchange_url) {
    const exchange = new URL(session.exchange_url);
    if (exchange.protocol !== 'https:' || !['.cloudflarepreviews.com','.workers.dev'].some(suffix => exchange.hostname.endsWith(suffix))) throw new Error('Unexpected preview host');
    const response = await fetchSafe(exchange.href);
    if (response.ok) { const data = await response.json(); if (typeof data.token === 'string') sessionToken = data.token; }
    host = 'platformp' + exchange.hostname.slice(exchange.hostname.indexOf('.'));
  }
  if (typeof sessionToken !== 'string') throw new Error('Preview token missing');
  const probeToken = randomBytes(32).toString('hex');
  const inference = process.env.PROBE_INFERENCE === 'true';
  report(inference ? 'Mode: one fixed 128-output-token-maximum generation request; existing provider quota applies.' : 'Mode: model metadata only; no generation.');
  const form = new FormData();
  form.set('metadata', JSON.stringify({ main_module: 'probe.mjs', compatibility_date: '2026-09-09', bindings: [...names.map(name => ({ name, type: 'inherit' })), { name: 'PROBE_TOKEN', type: 'plain_text', text: probeToken }, { name: 'PROBE_EXPIRES_AT', type: 'plain_text', text: String(Date.now() + 180000) }, { name: 'PROBE_INFERENCE', type: 'plain_text', text: String(inference) }] }));
  form.set('probe.mjs', new Blob([`export default { fetch: ${probe.toString()} };`], { type: 'application/javascript+module' }), 'probe.mjs');
  form.set('wrangler-session-config', JSON.stringify({ workers_dev: true }));
  stage = 'upload isolated preview';
  const preview = await cf('/workers/scripts/platformp/edge-preview', { method: 'POST', body: form, headers: { 'cf-preview-upload-config-token': sessionToken } });
  if (typeof preview.preview_token !== 'string') throw new Error('Preview access token missing');
  stage = 'invoke provider diagnostic';
  const response = await fetchSafe(`https://${host}/__ai_connection_probe`, { method: 'POST', headers: { 'cf-workers-preview-token': preview.preview_token, 'x-probe-token': probeToken } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json();
  if (result.kind !== 'kampusone-gemini-connection-v3') throw new Error('Unexpected probe result');
  const allowed = new Set(['ai_paused','configuration_missing','local_key_format','model_setting_invalid','metadata_accepted','generation_succeeded','generation_unusable','google_rejected','google_redirect','transport_failure','aq_format','aiza_format','other_format','known_leaked_key','project_access_denied','none','headers','google_fetch','response_body','response_decode','TypeError','RangeError','TimeoutError','AbortError','Error','UNCLASSIFIED','API_KEY_INVALID','API_KEY_EXPIRED','API_KEY_NOT_FOUND','API_KEY_SERVICE_BLOCKED','API_KEY_HTTP_REFERRER_BLOCKED','API_KEY_IP_ADDRESS_BLOCKED','API_KEY_ANDROID_APP_BLOCKED','API_KEY_IOS_APP_BLOCKED','ACCESS_TOKEN_TYPE_UNSUPPORTED','ACCESS_TOKEN_EXPIRED','CREDENTIALS_MISSING','SERVICE_DISABLED','CONSUMER_INVALID','CONSUMER_SUSPENDED','BILLING_DISABLED','USER_PROJECT_DENIED','IAM_PERMISSION_DENIED','RATE_LIMIT_EXCEEDED','RESOURCE_EXHAUSTED','SECURITY_POLICY_VIOLATED','INVALID_ARGUMENT','UNAUTHENTICATED','PERMISSION_DENIED','NOT_FOUND','FAILED_PRECONDITION','INTERNAL','UNAVAILABLE','DEADLINE_EXCEEDED']);
  for (const field of ['outcome','format','reason','status','hint','phase','errorName']) if (allowed.has(result[field])) report(`${field}: ${result[field]}`);
  if (Number.isInteger(result.http) && result.http >= 100 && result.http <= 599) report(`Google HTTP status: ${result.http}`);
  report('This tests the provider connection, not signed-in app routing, reservations or saved-history writes. Temporary preview expires in three minutes.');
} catch (error) {
  report(`CHECK FAILED at ${stage}: ${/^HTTP [1-5][0-9]{2}$/.test(error?.message ?? '') ? error.message : 'raw error withheld'}.`);
  process.exitCode = 1;
} finally {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}
