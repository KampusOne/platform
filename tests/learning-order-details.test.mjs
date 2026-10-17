import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { typescript as ts } from './helpers/typescript.mjs';
import { hookRenderer } from './helpers/hook-renderer.mjs';
import { orderDate, orderStatusLabel } from '../mobile/src/lib/order-presentation.ts';
function load(path, mocks) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, module: { exports }, require: name => { if (!(name in mocks)) throw Error('Missing mock: ' + name); return mocks[name]; }, AbortController, Error, Intl, process: { env: {} } });
  return exports;
}
const theme = { font: { body: 'Inter', medium: 'InterMedium', semibold: 'InterSemibold', bold: 'InterBold', display: 'Lato', displayStrong: 'LatoBold' } };
const flatten = value => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === 'object' ? [value, ...flatten(value.props?.children), ...flatten(value.props?.action), ...flatten(value.props?.footer)] : [];
function harness(path, component, props, overrides = {}) {
  const host = hookRenderer(), routes = [], notices = [], requests = [];
  let tree;
  const mocks = {
    react: host.react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' },
    'react-native': { Text: 'Text', View: 'View', Pressable: 'Pressable', Platform: { OS: 'android' }, StyleSheet: { create: s => s, absoluteFill: {} } },
    'expo-router': { router: { push: route => routes.push(route) } }, '@expo/vector-icons': { Ionicons: 'Icon' },
    '@/src/lib/appearance': { useThemeStyles: factory => ({ theme, styles: factory(theme) }) },
    '@/src/lib/api': { api: async (path, init) => { requests.push([path, init]); return overrides.request ? overrides.request(path, init) : { saved: JSON.parse(init.body).saved }; } },
    '@/src/lib/digital-billing-policy': { isPlayDistribution: () => overrides.play ?? false }, '@/src/lib/share-content': { shareItem: async () => {} },
    '@/src/lib/order-presentation': { orderDate, orderStatusLabel }, './toast': { useToast: () => (...args) => notices.push(args) },
  };
  for (const [file, name] of Object.entries({ 'media-image': 'MediaImage', 'profile-avatar': 'ProfileAvatar', 'verified-badge': 'VerifiedBadge' })) mocks['./' + file] = { [name]: name };
  mocks['./toolkit'] = { ToolPage: 'ToolPage', ToolButton: 'ToolButton' };
  const screen = load(path, mocks);
  const render = () => host.render(() => tree = screen[component](props));
  const nodes = () => flatten(tree);
  const by = (type, label) => nodes().find(n => n.type === type && (!label || n.props.label === label || n.props.accessibilityLabel === label));
  const settle = async () => { for (let n = 0; n < 4; n++) { await new Promise(setImmediate); render(); } };
  render(); return { render, settle, by, nodes, routes, notices, requests, unmount: host.unmount };
}
const resource = { id: 'material', title: 'Fluid mechanics', description: 'Engineering study material.', publisher_name: 'An old publisher', tutor_name: 'Current Tutor', tutor_profile_id: 'tutor-id', tutor_image_url: 'https://example.invalid/tutor.jpg', tutor_verified: true, is_saved: false, resource_type: 'PDF', course_code: 'GET', subject: 'Engineering', access_model: 'FREE', can_access: true, price_kobo: 0, preview_text: null, listing_id: null };
const details = (r = resource, overrides) => harness('mobile/src/components/learning-resource-details.tsx', 'LearningResourceDetails', { resource: r }, overrides);
test('resource details display the current tutor photo, name and trusted badge, linking to the tutor', () => {
  const h = details();
  assert.equal(h.by('ProfileAvatar').props.name, 'Current Tutor'); assert.equal(h.by('ProfileAvatar').props.imageUrl, resource.tutor_image_url);
  assert.equal(h.by('VerifiedBadge').props.label, 'Verified tutor');
  h.by('Pressable', 'View tutor Current Tutor, verified').props.onPress();
  assert.equal(h.routes.at(-1).pathname, '/student-service'); assert.equal(h.routes.at(-1).params.id, 'tutor-id'); h.unmount();
  const unverified = details({ ...resource, tutor_verified: false, publisher_verified: true });
  assert.equal(unverified.by('VerifiedBadge'), undefined); unverified.unmount();
});
test('bookmarks persist both directions and keep their previous state when a request fails', async () => {
  let fail = false;
  const h = details(resource, { request: async (_path, init) => { if (fail) throw Error('Offline'); return { saved: JSON.parse(init.body).saved }; } });
  h.by('Pressable', 'Save resource').props.onPress(); await h.settle();
  assert.equal(h.by('Pressable', 'Remove from saved resources').props.accessibilityState.selected, true);
  fail = true; h.by('Pressable', 'Remove from saved resources').props.onPress(); await h.settle();
  assert.ok(h.by('Pressable', 'Remove from saved resources')); assert.equal(h.notices.at(-1)[1], 'error');
  fail = false; h.by('Pressable', 'Remove from saved resources').props.onPress(); await h.settle();
  assert.ok(h.by('Pressable', 'Save resource')); h.unmount();
});
test('a second bookmark tap does not duplicate a pending request, and leaving cancels UI completion', async () => {
  let resolve;
  const h = details(resource, { request: () => new Promise(done => resolve = done) });
  const button = h.by('Pressable', 'Save resource'); button.props.onPress(); button.props.onPress(); h.render();
  assert.equal(h.requests.length, 1); assert.equal(h.by('Pressable', 'Save resource').props.disabled, true);
  h.unmount(); resolve({ saved: true }); await h.settle(); assert.equal(h.notices.length, 0);
});
test('free and purchased resources open the viewer while a new paid resource opens checkout', () => {
  for (const [r, label, pathname] of [[resource, 'Open resource', '/learning-viewer'], [{ ...resource, access_model: 'PAID', price_kobo: 50000 }, 'Open resource', '/learning-viewer'], [{ ...resource, access_model: 'PAID', price_kobo: 50000, can_access: false }, 'Buy resource', '/learning-checkout']]) {
    const h = details(r); h.by('ToolButton', label).props.onPress(); assert.equal(h.routes.at(-1).pathname, pathname); h.unmount();
  }
});
test('unavailable billing never enables a purchase, including in the Play build', () => {
  const paid = { ...resource, access_model: 'PAID', can_access: false, pricing_ready: false };
  const h = details(paid); const button = h.by('ToolButton', 'Available soon'); assert.equal(button.props.disabled, true); button.props.onPress(); assert.equal(h.routes.length, 0); h.unmount();
  const play = details({ ...paid, pricing_ready: true }, { play: true }); assert.equal(play.by('ToolButton', 'Buy resource'), undefined); play.unmount();
});
test('playlist contents show real titles and Kira only receives the preview as an extract', () => {
  const h = details({ ...resource, parts: [{ mediaId: 'one', title: 'Hydrostatics' }, { mediaId: 'two', title: 'Fluid flow' }], preview_text: 'Visible preview only.' });
  h.nodes().find(n => n.props?.accessibilityRole === 'tab' && flatten(n).some(c => c.props?.children === 'Contents (2)')).props.onPress(); h.render();
  assert.ok(h.nodes().find(n => n.props?.children === 'Hydrostatics'));
  const summary = h.nodes().find(n => n.type === 'Pressable' && flatten(n).some(c => c.props?.children === 'Summarise preview'));
  summary.props.onPress(); assert.match(h.routes.at(-1).params.question, /extract, not the full document/); h.unmount();
});
test('completed orders keep the timeline compact and expose actual events when expanded', () => {
  const h = harness('mobile/src/components/order-progress.tsx', 'OrderProgress', { status: 'DELIVERED', pickup: true, timeline: [{ status: 'PAID', occurred_at: '2026-10-17T10:00:00Z' }, { status: 'DELIVERED', occurred_at: '2026-10-17T11:00:00Z' }] });
  assert.equal(h.by('View', 'Order timeline'), undefined); h.by('Pressable', 'View order timeline').props.onPress(); h.render();
  assert.ok(h.by('View', 'Order timeline')); assert.ok(h.nodes().find(n => n.props?.children === 'Collected')); h.unmount();
});
test('pending and failed orders retain their truthful status and never show a completed delivery', () => {
  for (const status of ['PENDING_PAYMENT', 'PAYMENT_FAILED', 'DISPUTED']) {
    const h = harness('mobile/src/components/order-progress.tsx', 'OrderProgress', { status, pickup: false });
    assert.ok(h.nodes().some(n => n.type === 'Text' && n.props.children === orderStatusLabel(status)));
    assert.equal(h.nodes().some(n => n.type === 'Text' && n.props.children === 'Delivered'), false); h.unmount();
  }
});
