import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Ownership and branch aliases were checked with Vercel's deployment API.
// No user-supplied origins, wildcard domains, code uploads or schema changes.
export const portalOrigins = Object.freeze([
  'https://kampusone-platform-preview-qeyz49mg4-warriorpikins-projects.vercel.app',
  'https://kampusone-platform-preview-git-fi-061b28-warriorpikins-projects.vercel.app',
]);
const apiOrigin = 'https://platformp.divine-haze-54eb.workers.dev';
const originBinding = 'ALLOWED_ORIGINS';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

const stable = value => JSON.stringify(value, (_, item) =>
  item && !Array.isArray(item) && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    : item);

export function repairPlan(bindings, versionId) {
  if (!uuid.test(versionId ?? '') || !Array.isArray(bindings) || !bindings.length)
    throw new Error('Invalid live configuration');
  if (bindings.some(binding => !binding?.name || !binding.type) ||
      new Set(bindings.map(binding => binding.name)).size !== bindings.length)
    throw new Error('Invalid live bindings');
  const current = bindings.find(binding => binding.name === originBinding);
  if (current?.type !== 'plain_text' || typeof current.text !== 'string')
    throw new Error('The origin allowlist must be readable plain text');
  const before = current.text.split(',').map(value => value.trim()).filter(Boolean);
  // Fail closed if an existing value is not an exact HTTPS origin.
  if (!before.length || before.some(value => {
    try { const url = new URL(value); return url.protocol !== 'https:' || url.origin !== value || value.includes('*'); }
    catch { return true; }
  })) throw new Error('The existing origin allowlist needs separate review');
  const missing = portalOrigins.filter(origin => !before.includes(origin));
  const after = [...new Set([...before, ...missing])];
  return {
    before, after, missing,
    settings: { bindings: bindings.map(binding => binding.name === originBinding
      ? { name: originBinding, type: 'plain_text', text: after.join(',') }
      : { name: binding.name, type: 'inherit', version_id: versionId }) },
  };
}

export function activeVersion(deployments, versions) {
  const active = deployments?.deployments?.[0]?.versions;
  const latest = versions?.items?.[0]?.id;
  if (!Array.isArray(active) || active.length !== 1 || active[0].percentage !== 100 ||
      !uuid.test(active[0].version_id ?? '') || latest !== active[0].version_id)
    throw new Error('Stop: active and latest Worker versions must be identical');
  return latest;
}

export function assertPreserved(before, after, expectedOrigins) {
  const otherBindings = settings => settings.bindings
    .filter(binding => binding.name !== originBinding)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (stable(otherBindings(before)) !== stable(otherBindings(after)))
    throw new Error('Unexpected change to another binding');
  const actual = after.bindings.find(binding => binding.name === originBinding);
  if (actual?.type !== 'plain_text' || actual.text !== expectedOrigins.join(','))
    throw new Error('Origin allowlist verification failed');
  for (const key of ['compatibility_date', 'compatibility_flags', 'usage_model', 'logpush',
    'observability', 'limits', 'placement', 'tail_consumers', 'tags', 'migration_tag']) {
    if (stable(before[key]) !== stable(after[key])) throw new Error('Unexpected change to Worker settings');
  }
}

export async function runRepair({ cf, publicFetch, apply = false, report = console.log }) {
  const deployments = await cf('/deployments');
  const versions = await cf('/versions');
  const versionId = activeVersion(deployments, versions);
  const version = await cf(`/versions/${versionId}`);
  const etag = version?.resources?.script?.etag;
  if (typeof etag !== 'string' || !etag) throw new Error('Worker code fingerprint unavailable');
  const before = await cf('/settings');
  const plan = repairPlan(before.bindings, versionId);
  report(`Active Worker version: ${versionId}`);
  report(`Before origins: ${plan.before.join(',')}`);
  report(`Exact origins to add: ${plan.missing.join(',') || 'none (already present)'}`);
  report('Only ALLOWED_ORIGINS may change. Other bindings are inherited from the active version.');
  if (!apply) return { applied: false, plan };

  if (plan.missing.length) {
    // Recheck immediately before the single write; never activate a pending version.
    if (activeVersion(await cf('/deployments'), await cf('/versions')) !== versionId ||
        stable(await cf('/settings')) !== stable(before))
      throw new Error('Configuration changed during review; no update made');
    const form = new FormData();
    form.set('settings', JSON.stringify(plan.settings));
    await cf('/settings', { method: 'PATCH', body: form });
  }
  const after = await cf('/settings');
  assertPreserved(before, after, plan.after);
  const afterId = activeVersion(await cf('/deployments'), await cf('/versions'));
  const afterVersion = await cf(`/versions/${afterId}`);
  if (afterVersion?.resources?.script?.etag !== etag)
    throw new Error('Worker code fingerprint changed; inspect before any further action');
  report('PASS: Worker code, other bindings and runtime settings preserved.');

  // Invalid input stops before account lookup, token issuance or email sending.
  for (const origin of [...portalOrigins, 'https://untrusted-origin.invalid']) {
    for (const [path, acceptedStatus] of [['forgot-password', 400], ['refresh', 401]]) {
      const response = await publicFetch(`${apiOrigin}/v1/auth/${path}`, {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}',
      });
      const expected = portalOrigins.includes(origin) ? acceptedStatus : 403;
      const result = await response.json();
      const code = expected === 400 ? 'BAD_REQUEST' : expected === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN';
      if (response.status !== expected || result?.error?.code !== code)
        throw new Error('Live origin boundary check failed');
      report(`PASS: ${path}, ${portalOrigins.includes(origin) ? 'approved preview' : 'foreign origin'}, HTTP ${expected}.`);
    }
  }
  report(`Configuration repair complete; active Worker version: ${afterId}. No reset email sent.`);
  return { applied: plan.missing.length > 0, versionId: afterId, plan };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lines = ['# Portal preview origin repair', ''];
  const report = line => { console.log(line); lines.push(line); };
  try {
    const apply = process.argv.includes('--apply');
    if (apply && (process.env.GITHUB_REPOSITORY !== 'KampusOne/platform' ||
        process.env.GITHUB_REF !== 'refs/heads/fix/student-experience-20260926'))
      throw new Error('Configuration repair is restricted to the reviewed repository and branch');
    const token = process.env.CLOUDFLARE_API_TOKEN;
    const account = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!token || !/^[a-f0-9]{32}$/i.test(account ?? '')) throw new Error('Deployment credentials unavailable');
    const publicFetch = (url, options = {}) => fetch(url, {
      ...options, redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    const cf = async (suffix, options = {}) => {
      const response = await publicFetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/platformp${suffix}`, {
        ...options, headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Cloudflare HTTP ${response.status}`);
      const data = await response.json();
      if (!data.success) throw new Error('Cloudflare configuration request failed');
      return data.result;
    };
    await runRepair({ cf, publicFetch, apply, report });
  } catch (error) {
    // Never dump Cloudflare responses, binding values, headers or credentials.
    report(`FAILED: ${error instanceof Error && /^(Invalid live|The origin|The existing|Stop:|Worker code|Configuration|Unexpected change|Origin allowlist|Live origin|Deployment credentials|Cloudflare)/.test(error.message) ? error.message : 'Operation failed; raw diagnostic withheld'}`);
    process.exitCode = 1;
  } finally {
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }
}
