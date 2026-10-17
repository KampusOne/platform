import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { hookRenderer, virtualClock } from './helpers/hook-renderer.mjs';
import { typescript as ts } from './helpers/typescript.mjs';
import { applyPostViewCounts } from '../mobile/src/lib/feed-view-state.ts';
import * as exams from '../mobile/src/lib/exam-period.ts';

const jsx = (type, props) => ({ type, props });
function load(file, modules, globals = {}) {
  const source = process.env.MOBILE_PERFORMANCE_SOURCE_REF
    ? execFileSync('git', ['show', `${process.env.MOBILE_PERFORMANCE_SOURCE_REF}:${file}`], { cwd: new URL('../', import.meta.url), encoding: 'utf8' })
    : readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  runInNewContext(code, { exports, module: { exports }, require: name => {
    if (name in modules) return modules[name];
    if (name.startsWith('@/src/components/')) return new Proxy({}, { get: (_target, key) => String(key) });
    throw Error('Unmocked ' + name);
  }, setTimeout, clearTimeout, requestAnimationFrame: fn => fn(), ...globals });
  return exports;
}
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const flush = () => new Promise(setImmediate);

test('a batch of confirmed feed views preserves the list and untouched row identities', () => {
  const posts = Array.from({ length: 500 }, (_, i) => ({ id: String(i), view_count: 10 }));
  const unchanged = new Map(posts.slice(0, 20).map(post => [post.id, 10]));
  for (let callback = 0; callback < 100; callback++) assert.equal(applyPostViewCounts(posts, unchanged), posts);
  const next = applyPostViewCounts(posts, new Map([['1', 12], ['2', 2], ['3', NaN], ['4', -4]]));
  assert.notEqual(next, posts);
  assert.equal(next[1].view_count, 12);
  assert.equal(posts[1].view_count, 10);
  assert.equal(next[0], posts[0]);
  assert.equal(next[2], posts[2]);
  assert.equal(next[3], posts[3]);
  assert.equal(next[4], posts[4]);
});

test('session restoration starts while the native connectivity check is unresolved', async () => {
  const host = hookRenderer(); let finishNetwork, networkChanged, offlineReads = 0, validations = 0;
  const states = [];
  const modules = {
    react: { ...host.react, createContext: () => ({ Provider: 'AuthContext' }) },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Alert: {}, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    'expo-network': { getNetworkStateAsync: () => new Promise(resolve => { finishNetwork = resolve; }), addNetworkStateListener: callback => { networkChanged = callback; return { remove() {} }; } },
    '../lib/screen-read': { clearScreenSync() {} },
    '../lib/network-state': { setNetworkOffline: value => states.push(value) },
    '../lib/offline-session': { readOfflineSession: async () => { offlineReads++; return null; }, saveOfflineSession: async () => {}, removeOfflineSession: async () => {} },
    '../lib/request-policy': { cacheScopeForUser: () => 'account' },
    '@/src/lib/build-version': { checkBuildVersion() {} },
    '@/src/lib/api': { onSessionChange: () => () => {}, authApi: { refresh: async () => { validations++; return null; } } },
    '@/src/lib/device-cache': { readCache: async () => null },
    '@/src/lib/alarms': {}, '@/src/lib/preferences': {}, '@/src/lib/push-registration': {}, '@/src/lib/session-storage': {},
  };
  const { AuthProvider } = load('mobile/src/auth/auth-context.tsx', modules);
  host.render(() => AuthProvider({ children: null }));
  await flush();
  assert.equal(offlineReads, 1);
  assert.equal(validations, 1);
  networkChanged({ isConnected: false });
  finishNetwork({ isConnected: true, isInternetReachable: true });
  await flush();
  assert.deepEqual(states, [true], 'a late connectivity snapshot must not replace a newer event');
  host.unmount();
});

test('typing 60 characters keeps the conversation cell renderer and message array stable', async () => {
  const host = hookRenderer(), time = virtualClock();
  const theme = { font: {}, deepBrand: '#A8462E' }, styles = new Proxy({}, { get: (_target, key) => key });
  const account = { id: 'self' }, messages = Array.from({ length: 50 }, (_, i) => ({ id: String(i), sender_id: i % 2 ? 'self' : 'peer', body: 'Message ' + i, created_at: '2026-10-17T17:00:00Z', reactions: [] }));
  const data = { thread: { status: 'ACCEPTED', initiator_id: 'self', recipient_id: 'peer' }, profile: { user_id: 'peer', display_name: 'Student' }, messages };
  const modules = {
    react: host.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { FlatList: 'FlatList', TextInput: 'TextInput', Text: 'Text', View: 'View', Pressable: 'Pressable', Image: 'Image', Keyboard: { dismiss() {} }, Platform: { OS: 'android' }, StyleSheet: { create: value => value }, AppState: { addEventListener: () => ({ remove() {} }) }, useWindowDimensions: () => ({ width: 393, height: 850 }) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, '@expo/vector-icons': { Ionicons: 'Ionicons' }, 'expo-blur': { BlurTargetView: 'BlurTargetView' },
    'expo-router': { useLocalSearchParams: () => ({ id: 'thread' }), useFocusEffect: fn => host.react.useEffect(fn, [fn]), router: {} },
    '@/src/auth/auth-context': { useAuth: () => ({ user: account }) },
    '@/src/lib/appearance': { useThemeStyles: () => ({ theme, styles }) },
    '@/src/lib/live-updates': { useLiveRefresh() {} }, '@/src/lib/message-read': { markConversationRead: async () => {} },
    '@/src/lib/screen-read': { refreshScreenRead: async (_path, publish) => { publish(data); return data; } },
    '@/src/lib/message-drafts': { readConversationDraft: async () => null, onPendingTextChange: () => () => {}, onTextDelivered: () => () => {}, saveConversationDraft: async () => {} },
    '@/src/lib/request-policy': { cacheScopeForUser: () => 'scope' }, '@/src/lib/device-cache': { getDeviceCacheRevision: () => 0 },
    '@/src/lib/message-links': {}, '@/src/lib/share-content': {}, '@/src/lib/message-upload': {}, '@/src/lib/private-media-download': {}, '@/src/lib/text-retry-coordinator': {}, '@/src/lib/text-transfer': {}, '@/src/lib/api': {},
    'expo-crypto': {}, 'expo-document-picker': {}, 'expo-image-picker': {}, 'expo-image-manipulator': {},
  };
  const { default: Screen } = load('mobile/app/conversation.tsx', modules, { setTimeout: time.schedule, clearTimeout: time.cancel });
  const render = () => host.render(Screen);
  render(); await flush(); let tree = render();
  const list = nodes(tree).find(node => node.type === 'FlatList');
  assert.equal(list.props.data.length, 50);
  const renderer = list.props.renderItem, rows = list.props.data;
  for (let i = 0; i < 60; i++) {
    nodes(tree).find(node => node.type === 'TextInput').props.onChangeText('a'.repeat(i + 1));
    tree = render();
    const current = nodes(tree).find(node => node.type === 'FlatList');
    assert.equal(current.props.renderItem, renderer);
    assert.equal(current.props.data, rows);
  }
  assert.equal(list.props.windowSize, 7);
  host.unmount();
});

test('exam countdown advances from upcoming through ongoing to completed in Nigeria time', () => {
  const period = { semester: 'First semester', startsOn: '2027-02-08', endsOn: '2027-02-26', status: 'upcoming' };
  assert.equal(exams.examCountdown(period, Date.parse('2027-02-07T23:59:59+01:00')).daysRemaining, 1);
  const ongoing = exams.examCountdown(period, Date.parse('2027-02-08T00:00:00+01:00'));
  assert.equal(ongoing.phase, 'ongoing'); assert.equal(ongoing.daysRemaining, 19);
  assert.equal(exams.examCountdown(period, Date.parse('2027-02-26T23:59:59+01:00')).phase, 'ongoing');
  const completed = exams.examCountdown(period, Date.parse('2027-02-27T00:00:00+01:00'));
  assert.equal(completed.phase, 'completed'); assert.equal(completed.daysRemaining, 0);
});

test('profile countdown stays inset, switches to days left, and pauses offscreen without leaking another account', async () => {
  const host = hookRenderer(), clock = virtualClock();
  let now = Date.parse('2027-02-07T23:59:30+01:00'), change;
  let user = { id: 'one', universityId: 'campus' };
  const app = { currentState: 'active', addEventListener: (_event, callback) => { change = callback; return { remove() {} }; } };
  const period = { semester: 'First', startsOn: '2027-02-08', endsOn: '2027-02-26', status: 'upcoming' };
  const theme = { font: {} };
  const modules = {
    react: host.react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { AppState: app, Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: value => value } },
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    'expo-router': { useFocusEffect: fn => host.react.useEffect(fn, [fn]), router: { push() {} } },
    '@/src/auth/auth-context': { useAuth: () => ({ user }) },
    '@/src/lib/api': { api: async () => ({ examPeriods: [period] }) },
    '@/src/lib/appearance': { useThemeStyles: factory => ({ theme, styles: factory(theme) }) },
    '@/src/lib/exam-period': exams,
  };
  class Clock extends Date { static now() { return now; } }
  const { AcademicExamStatus } = load('mobile/src/components/academic-exam-status.tsx', modules, { Date: Clock, setTimeout: clock.schedule, clearTimeout: clock.cancel });
  const render = () => host.render(AcademicExamStatus);
  render(); await flush(); let tree = render();
  assert.match(tree.props.accessibilityLabel, /1 day to go/);
  assert.equal(tree.props.style({ pressed: false })[0].marginHorizontal, 20);
  assert.equal(tree.props.style({ pressed: false })[0].width, undefined);
  now += 31_000; await clock.advance(31_000); tree = render();
  assert.match(tree.props.accessibilityLabel, /Exams in progress, 19 days left/);
  app.currentState = 'background'; change();
  assert.equal(clock.timers.size, 0);
  user = { id: 'two', universityId: 'another-campus' };
  assert.equal(render(), null);
  host.unmount();
});
