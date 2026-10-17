import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { typescript as ts } from './helpers/typescript.mjs';
import { hookRenderer } from './helpers/hook-renderer.mjs';
import { nairaToKobo } from '../mobile/src/lib/money-input.ts';
function load(path, mocks) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, module: { exports }, require: name => { if (!(name in mocks)) throw Error('Missing mock: ' + name); return mocks[name]; }, AbortController, Error, URL, Number, Date, setTimeout, clearTimeout });
  return exports;
}
const fields = load('mobile/src/lib/draft-fields.ts', {});
const editor = load('mobile/src/lib/tutor-listing-editor.ts', { './draft-fields': fields, './money-input': { nairaToKobo } });
const material = { id: 'material', title: 'Fluid mechanics', description: 'A fluid mechanics revision workbook.', course_code: 'CPE201', resource_type: 'PDF', status: 'PUBLISHED', price_kobo: 25000, access_model: 'PAID', subject: 'Physics', cover_url: 'https://example.invalid/cover.jpg', revision: '2026-10-17 14:00:00.000001+00' };
function harness({ initialDraft = null, readFails = false, readError = false, persistFails = false, current = material, request, kind = 'resource' } = {}) {
  const host = hookRenderer(), calls = [], writes = [], routes = [], notices = [], confirmations = [];
  let tree;
  const device = { getDeviceCacheRevision: () => 0, readOwnedDraft: async () => { if (readFails) throw Error('Draft restore failed. Try again.'); return initialDraft; },
    saveOwnedDraft: async (key, value) => { writes.push({ key, value }); if (persistFails) throw Error('Device storage is full'); return 'device'; } };
  const deps = { react: host.react, './device-cache': device, './request-policy': { waitForRequest: promise => promise } };
  const restore = load('mobile/src/lib/use-owned-draft-restore.ts', deps), save = load('mobile/src/lib/use-owned-draft-save.ts', deps);
  const mocks = {
    react: host.react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' },
    'react-native': { Text: 'Text', View: 'View', Alert: { alert: (...args) => confirmations.push(args) } },
    'expo-router': { useLocalSearchParams: () => ({ id: current.id, kind }), router: { back: () => routes.push('back') } },
    '@/src/auth/auth-context': { useAuth: () => ({ user: { id: 'owner' } }) }, '@/src/lib/appearance': { useAppearance: () => ({ theme: { font: { body: 'Inter' } } }) },
    '@/src/lib/api': { api: async (path, init) => { calls.push([path, init]); if (request) return request(path, init); if (readError) throw Error('Offline'); return { resources: [current], listings: [current] }; } },
    '@/src/lib/device-cache': device, '@/src/lib/request-policy': { cacheScopeForUser: () => 'owner:campus' },
    '@/src/lib/uploads': { pickAndUpload: async () => ({ url: 'https://example.invalid/new-cover.jpg' }) },
    '@/src/lib/use-owned-draft-restore': restore, '@/src/lib/use-owned-draft-save': save, '@/src/lib/tutor-listing-editor': editor,
    '@/src/components/toast': { useToast: () => (...args) => notices.push(args) },
  };
  for (const [file, names] of Object.entries({ toolkit: ['ToolPage', 'ToolField', 'ToolButton'], 'choice-field': ['ChoiceField'], 'draft-recovery': ['DraftRecovery'], 'media-image': ['MediaImage'], 'retry-icon-button': ['RetryIconButton'], skeleton: ['ScreenSkeleton'] })) mocks['@/src/components/' + file] = Object.fromEntries(names.map(name => [name, name]));
  const screen = load('mobile/app/tutor-edit.tsx', mocks);
  const render = () => host.render(() => { tree = screen.default(); while (typeof tree.type === 'function') tree = tree.type(tree.props); return tree; });
  const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
  const by = (type, label) => nodes(tree).find(n => n.type === type && (!label || n.props.label === label));
  const settle = async () => { for (let n = 0; n < 6; n++) { await new Promise(setImmediate); render(); } };
  render();
  return { render, settle, by, calls, writes, routes, notices, confirmations, unmount: host.unmount };
}
test('material edit loads its original fields and saves the same record with the exact revision', async () => {
  let payload;
  const h = harness({ request: async (_path, init) => init?.method === 'PATCH' ? (payload = JSON.parse(init.body), { id: material.id }) : { resources: [material], listings: [] } });
  await h.settle(); assert.equal(h.by('ToolField', 'Title').props.value, 'Fluid mechanics');
  assert.equal(h.by('ToolField', 'Price (₦)').props.value, '250');
  h.by('ToolField', 'Title').props.onChangeText('Fluid mechanics revised'); h.render();
  await h.by('ToolButton', 'Save changes').props.onPress(); await h.settle();
  assert.equal(payload.expectedRevision, material.revision); assert.equal(payload.coverUrl, material.cover_url); assert.equal(payload.priceKobo, 25000);
  assert.equal(payload.title, 'Fluid mechanics revised'); assert.equal(h.calls.some(([path, init]) => path === '/v1/agents/tutorial-resources/material' && init?.method === 'PATCH'), true);
  assert.equal(h.calls.some(([, init]) => init?.method === 'POST'), false); assert.equal(h.routes.at(-1), 'back');
  assert.equal(h.writes.at(-1).value, null); assert.match(h.writes[0].key, /^listing-draft\.owner:campus\.tutor\.edit\./); h.unmount();
});
test('a lost save response is reconciled against the updated listing without duplicating the material', async () => {
  let current = { ...material };
  const h = harness({ request: async (_path, init) => {
    if (init?.method === 'PATCH') { current = { ...current, title: JSON.parse(init.body).title, revision: 'new-revision' }; throw Error('Connection interrupted'); }
    return { resources: [current], listings: [] };
  } });
  await h.settle(); h.by('ToolField', 'Title').props.onChangeText('A confirmed revision'); h.render();
  await h.by('ToolButton', 'Save changes').props.onPress(); await h.settle();
  assert.equal(h.notices.at(-1)[0], 'Material updated'); assert.equal(h.routes.at(-1), 'back'); h.unmount();
});
test('a failed draft restore or listing read never enables editing or writes a blank replacement', async () => {
  for (const failure of [{ readFails: true }, { readError: true }]) {
    const h = harness(failure); await h.settle();
    assert.equal(h.by('ToolButton', 'Save changes'), undefined); assert.equal(h.by('ToolField', 'Title'), undefined);
    assert.equal(h.writes.length, 0); assert.equal(h.calls.some(([, init]) => init?.method === 'PATCH'), false);
    h.unmount(); assert.equal(h.writes.length, 0);
  }
});
test('an outdated draft remains visible but blocks overwrite until the user reloads', async () => {
  const local = { ...editor.tutorEditForm(material), title: 'My unsaved revision' };
  const h = harness({ initialDraft: { form: local, revision: 'older-revision' } }); await h.settle();
  assert.equal(h.by('ToolField', 'Title').props.value, local.title); assert.equal(h.by('ToolButton', 'Save changes').props.disabled, true);
  h.by('ToolButton', 'Save changes').props.onPress(); await h.settle(); assert.equal(h.calls.some(([, init]) => init?.method === 'PATCH'), false);
  h.by('ToolButton', 'Reload latest details').props.onPress(); h.confirmations.at(-1)[2].find(item => item.text === 'Reload').onPress(); await h.settle();
  assert.equal(h.by('ToolField', 'Title').props.value, material.title); assert.equal(h.by('ToolButton', 'Save changes').props.disabled, false); h.unmount();
});
test('failed draft persistence prevents the request and retains the typed changes', async () => {
  const h = harness({ persistFails: true }); await h.settle();
  h.by('ToolField', 'Title').props.onChangeText('Keep my changes'); h.render();
  await h.by('ToolButton', 'Save changes').props.onPress(); await h.settle();
  assert.equal(h.calls.some(([, init]) => init?.method === 'PATCH'), false); assert.equal(h.by('ToolField', 'Title').props.value, 'Keep my changes'); assert.equal(h.routes.length, 0); h.unmount();
});
test('tutorial edits retain location and cancellation settings and use the tutorial endpoint', async () => {
  const session = { ...material, resource_type: undefined, format: 'HYBRID', capacity: 30, location_text: 'Library', cancellation_cutoff_hours: 4 };
  let payload;
  const h = harness({ current: session, kind: 'tutorial', request: async (_path, init) => init?.method === 'PATCH' ? (payload = JSON.parse(init.body), {}) : { resources: [], listings: [session] } });
  await h.settle(); await h.by('ToolButton', 'Save changes').props.onPress(); await h.settle();
  assert.equal(payload.locationText, 'Library'); assert.equal(payload.cancellationCutoffHours, 4); assert.equal(payload.capacity, 30);
  assert.equal(h.calls.some(([path, init]) => path === '/v1/agents/tutorials/material' && init?.method === 'PATCH'), true); h.unmount();
});
