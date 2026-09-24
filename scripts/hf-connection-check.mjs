import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';

// Only this self-contained handler is uploaded to an expiring remote preview.
// No live application route, user input, database binding or production deploy.
export async function probe(request, env) {
  const reply = value => Response.json({ kind: 'kampusone-hf-probe-v1', ...value }, { headers: { 'Cache-Control': 'no-store' } });
  const supplied = request.headers.get('x-probe-token') ?? '', expiry = Number(env.PROBE_EXPIRES_AT);
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/__hf_connection_probe' || !/^[a-f0-9]{64}$/.test(env.PROBE_TOKEN ?? '') || !/^[a-f0-9]{64}$/.test(supplied) || !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 240000) return new Response(null, { status: 404 });
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= supplied.charCodeAt(i) ^ env.PROBE_TOKEN.charCodeAt(i);
  if (difference) return new Response(null, { status: 404 });
  if (env.AI_ASSISTANT_ENABLED !== 'true') return reply({ outcome: 'ai_paused' });
  const token = typeof env.HF_TOKEN === 'string' ? env.HF_TOKEN.trim() : '';
  const model = typeof env.HF_CHAT_MODEL === 'string' ? env.HF_CHAT_MODEL.trim() : '';
  if (!token || !model) return reply({ outcome: 'configuration_missing' });
  if (!/^hf_[a-zA-Z0-9]+$/.test(token)) return reply({ outcome: 'token_format_invalid' });
  if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?::[a-zA-Z0-9._-]+)?$/.test(model) || model.length > 160) return reply({ outcome: 'model_format_invalid' });
  let http;
  try {
    // Exactly one bounded call. Never accept an arbitrary caller prompt or retry.
    const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: 'You are a university learning assistant. Answer briefly and accurately.' }, { role: 'user', content: "State Ohm's law in one short sentence." }], max_tokens: 128, temperature: 0.1, stream: false }),
    });
    http = response.status;
    const reader = response.body?.getReader();
    const chunks = []; let size = 0, complete = true;
    try {
      if (reader) for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16384) { complete = false; await reader.cancel(); break; }
        chunks.push(value);
      }
    } finally { reader?.releaseLock(); }
    let payload = {};
    if (complete) {
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* Raw body never returned. */ }
    }
    if (response.ok) {
      const choice = payload?.choices?.[0];
      const usable = typeof choice?.message?.content === 'string' && choice.message.content.trim().length > 0 && choice.finish_reason === 'stop';
      return reply({ outcome: usable ? 'generation_succeeded' : 'generation_unusable', http });
    }
    const rawMessage = typeof payload?.error === 'string' ? payload.error : typeof payload?.error?.message === 'string' ? payload.error.message : typeof payload?.message === 'string' ? payload.message : '';
    const message = rawMessage.toLowerCase();
    const hint = /credit|pre.?paid|payment|balance/.test(message) ? 'credits_or_payment' : /permission|inference providers.*access|insufficient.*scope/.test(message) ? 'permission' : /model.*(?:not supported|not found|unavailable)|no provider/.test(message) ? 'model_unavailable' : /invalid.*token|authentication/.test(message) ? 'authentication' : 'unclassified';
    return reply({ outcome: 'provider_rejected', http, hint });
  } catch (error) {
    return reply({ outcome: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'transport_failure', ...(http ? { http } : {}) });
  }
}

async function selfTests() {
  const nonce = randomBytes(32).toString('hex');
  const env = { PROBE_TOKEN: nonce, PROBE_EXPIRES_AT: String(Date.now() + 180000), AI_ASSISTANT_ENABLED: 'true', HF_TOKEN: 'hf_SYNTHETIC', HF_CHAT_MODEL: 'test/model' };
  const request = (token = nonce) => new Request('https://example.invalid/__hf_connection_probe', { method: 'POST', headers: { 'x-probe-token': token } });
  const originalFetch = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(url, 'https://router.huggingface.co/v1/chat/completions');
      assert.equal(options.method, 'POST');
      assert.equal(JSON.parse(options.body).max_tokens, 128);
      assert.equal(JSON.parse(options.body).messages[1].content, "State Ohm's law in one short sentence.");
      return Response.json({ error: { message: 'Insufficient permissions hf_SYNTHETIC PRIVATE_INPUT' } }, { status: 403 });
    };
    assert.equal((await probe(request('0'.repeat(64)), env)).status, 404);
    assert.equal((await probe(request(), { ...env, PROBE_EXPIRES_AT: '0' })).status, 404);
    assert.equal(calls, 0);
    const rejected = await (await probe(request(), env)).json();
    assert.equal(rejected.hint, 'permission');
    assert.equal(rejected.http, 403);
    assert.equal(JSON.stringify(rejected).includes('SYNTHETIC'), false);
    assert.equal(JSON.stringify(rejected).includes('PRIVATE_INPUT'), false);
    assert.equal((await (await probe(request(), { ...env, HF_TOKEN: '"hf_SYNTHETIC"' })).json()).outcome, 'token_format_invalid');
    assert.equal(calls, 1);
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'SYNTHETIC_ANSWER' } }] });
    const success = await (await probe(request(), env)).json();
    assert.equal(success.outcome, 'generation_succeeded');
    assert.equal(JSON.stringify(success).includes('SYNTHETIC_ANSWER'), false);
    globalThis.fetch = async () => new Response('x'.repeat(20000), { status: 403 });
    assert.equal((await (await probe(request(), env)).json()).hint, 'unclassified');
    globalThis.fetch = async () => { throw new TypeError('PRIVATE_INPUT'); };
    assert.equal((await (await probe(request(), env)).json()).outcome, 'transport_failure');
  } finally { globalThis.fetch = originalFetch; }
  console.log('PASS: authorization, expiry, single bounded request, token validation, redaction, oversized response and transport tests.');
}
await selfTests();
if (process.argv.includes('--self-test')) process.exit(0);

const lines = ['# Hugging Face connection check', '', 'One fixed academic question with a maximum of 128 output tokens. Existing provider charges/credits apply. No user content, credential export, production deployment, billing activation or automatic fallback.', ''];
const report = text => { console.log(text); lines.push(text); };
const account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
let stage = 'configuration';
const fetchSafe = (url, options = {}) => fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(40000) });
const cf = async (suffix, options = {}) => {
  const response = await fetchSafe(`https://api.cloudflare.com/client/v4/accounts/${account}${suffix}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.success) throw new Error('Cloudflare operation failed');
  return data.result;
};
try {
  if (!token || !/^[a-f0-9]{32}$/i.test(account ?? '')) throw new Error('Deployment credentials unavailable');
  stage = 'read binding metadata';
  const settings = await cf('/workers/scripts/platformp/settings');
  const names = ['HF_TOKEN', 'HF_CHAT_MODEL', 'AI_ASSISTANT_ENABLED'];
  for (const name of names) if (!settings.bindings?.some(binding => binding.name === name)) throw new Error('Required binding missing');
  if (settings.bindings.find(binding => binding.name === 'HF_TOKEN')?.type !== 'secret_text') throw new Error('Token must be a secret');
  report('PASS: required production bindings present; HF token value not read by CI.');
  stage = 'create isolated remote preview session';
  const session = await cf('/workers/scripts/platformp/subdomain/edge-preview');
  let sessionToken = session.token, host = 'platformp.divine-haze-54eb.workers.dev';
  if (session.exchange_url) {
    const exchange = new URL(session.exchange_url);
    if (exchange.protocol !== 'https:' || !['.cloudflarepreviews.com', '.workers.dev'].some(suffix => exchange.hostname.endsWith(suffix))) throw new Error('Unexpected preview host');
    const response = await fetchSafe(exchange.href);
    if (response.ok) { const data = await response.json(); if (typeof data.token === 'string') sessionToken = data.token; }
    host = 'platformp' + exchange.hostname.slice(exchange.hostname.indexOf('.'));
  }
  if (typeof sessionToken !== 'string') throw new Error('Missing preview session');
  const form = new FormData(), probeToken = randomBytes(32).toString('hex');
  form.set('metadata', JSON.stringify({ main_module: 'probe.mjs', compatibility_date: '2026-09-09', bindings: [...names.map(name => ({ name, type: 'inherit' })), { name: 'PROBE_TOKEN', type: 'plain_text', text: probeToken }, { name: 'PROBE_EXPIRES_AT', type: 'plain_text', text: String(Date.now() + 180000) }] }));
  form.set('probe.mjs', new Blob([`export default { fetch: ${probe.toString()} };`], { type: 'application/javascript+module' }), 'probe.mjs');
  form.set('wrangler-session-config', JSON.stringify({ workers_dev: true }));
  stage = 'upload isolated preview';
  const preview = await cf('/workers/scripts/platformp/edge-preview', { method: 'POST', body: form, headers: { 'cf-preview-upload-config-token': sessionToken } });
  if (typeof preview.preview_token !== 'string') throw new Error('Missing preview access token');
  stage = 'run one HF generation check';
  const response = await fetchSafe(`https://${host}/__hf_connection_probe`, { method: 'POST', headers: { 'cf-workers-preview-token': preview.preview_token, 'x-probe-token': probeToken } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json();
  if (result.kind !== 'kampusone-hf-probe-v1') throw new Error('Unexpected result');
  const allow = new Set(['ai_paused', 'configuration_missing', 'token_format_invalid', 'model_format_invalid', 'generation_succeeded', 'generation_unusable', 'provider_rejected', 'credits_or_payment', 'permission', 'model_unavailable', 'authentication', 'unclassified', 'timeout', 'transport_failure']);
  for (const field of ['outcome', 'hint']) if (allow.has(result[field])) report(`${field}: ${result[field]}`);
  if (Number.isInteger(result.http) && result.http >= 100 && result.http <= 599) report(`Hugging Face HTTP status: ${result.http}`);
  report('Provider connection check only; no study routing or history change. Preview expires after three minutes.');
} catch (error) {
  report(`CHECK FAILED at ${stage}: ${/^HTTP [1-5][0-9]{2}$/.test(error?.message ?? '') ? error.message : 'raw error withheld'}.`);
  process.exitCode = 1;
} finally {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}
