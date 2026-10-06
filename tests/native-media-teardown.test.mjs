import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createNativeMediaLifetime, isReleasedNativeMediaError } from '../mobile/src/lib/native-media-lifetime.ts';
import { postVideoSource } from '../mobile/src/lib/video-source.ts';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const ts = require('typescript');
const root = new URL('../', import.meta.url).pathname;

/**
 * Exercise the real component callbacks with Expo's native teardown contract:
 * the media hook's passive cleanup releases first; layout cleanup runs before
 * passive cleanup. A released proxy throws on every read, write and method.
 * This catches the actual failure without requiring an Android device.
 * NATIVE_MEDIA_SOURCE_REF=HEAD runs the same regression against the old source.
 */
function nativeHarness(file, exported = 'default') {
  const passive = [], layout = [], timers = [], routeListeners = [], appListeners = [];
  const cleanups = [];
  let released = false, afterReleaseAccesses = 0, handle = null, playerCreates = 0, tree;
  let stateCursor = 0, refCursor = 0;
  const stateSlots = [], refs = [];
  const values = { playing: false, muted: true, status: 'readyToPlay', currentTime: 4, duration: 25, videoTrack: null, availableVideoTracks: [],
    pause() {}, play() {}, seekBy() {}, replaceAsync: () => Promise.resolve() };
  const player = new Proxy(values, {
    get(target, key) {
      if (released) { afterReleaseAccesses++; throw new Error('Cannot use shared object that was already released'); }
      return target[key];
    },
    set(target, key, value) {
      if (released) { afterReleaseAccesses++; throw new Error('Cannot use shared object that was already released'); }
      target[key] = value; return true;
    },
  });
  const react = {
    useState: (value) => {
      const index = stateCursor++;
      if (!(index in stateSlots)) stateSlots[index] = typeof value === 'function' ? value() : value;
      return [stateSlots[index], (next) => { stateSlots[index] = typeof next === 'function' ? next(stateSlots[index]) : next; }];
    },
    useRef: (value) => { const index = refCursor++; return refs[index] ??= { current: value }; },
    useMemo: (fn) => fn(), useCallback: (fn) => fn,
    useEffect: (fn) => passive.push(fn), useLayoutEffect: (fn) => layout.push(fn),
  };
  const noop = () => null;
  const theme = { font: { body: 'Inter', medium: 'Inter', semibold: 'Inter' } };
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    expo: { useEvent: (_player, _event, initial) => initial },
    'expo-video': { VideoView: noop, useVideoPlayer: (_source, setup) => {
      playerCreates++;
      setup?.(player);
      react.useEffect(() => () => { released = true; });
      return player;
    } },
    'react-native': { Image: noop, Platform: { OS: 'android' }, Modal: noop, Pressable: noop, Text: noop, View: noop,
      StyleSheet: { create: (x) => x, absoluteFill: {} },
      AppState: { currentState: 'active', addEventListener: (_event, fn) => { appListeners.push(fn); return { remove() {} }; } },
    },
    'react-native-safe-area-context': { SafeAreaView: noop },
    '@expo/vector-icons': { Ionicons: noop },
    'expo-status-bar': { StatusBar: noop },
    'expo-router': { useLocalSearchParams: () => ({ id: '8ea652a5-7061-4b16-a0cb-609f24470de4', url: 'https://api.kampusone.app/v1/media/8ea652a5-7061-4b16-a0cb-609f24470de4' }),
      useFocusEffect: (fn) => passive.push(fn), router: { canGoBack: () => true, back() {}, replace() {}, push() {} } },
    '@/src/auth/auth-context': { useAuth: () => ({ profile: null }) },
    '@/src/lib/appearance': { useAppearance: () => ({ theme }) },
    '@/src/components/toast': { useToast: () => () => {} },
    '@/src/lib/media-downloads': { downloadPostMedia: async () => {} },
    '@/src/lib/signed-media': { useSignedMedia: (url) => url },
    '@/src/lib/video-playback-session': { readVideoPlaybackSession: () => null, writeVideoPlaybackSession() {} },
    '@/src/lib/feed-video-playback': { isFeedRoutePlaybackActive: () => false, isFeedMuted: () => true, setFeedMuted() {}, subscribeFeedMute: () => () => {},
      subscribeFeedRoutePlayback: (fn) => { routeListeners.push(fn); fn(false); return () => {}; } },
    '@/src/lib/video-source': { cachedVideoSource: (uri) => ({ uri, useCaching: true }), FAST_VIDEO_BUFFER_OPTIONS: {}, postVideoSource },
    '@/src/lib/native-media-lifetime': { createNativeMediaLifetime },
    '@/src/lib/video-playback-lifecycle': { createVideoPlaybackLifecycle: () => { let v = 0; return { beginSource: () => ++v, currentVersion: () => v, completeSource: (n) => n === v, invalidate: () => { v++; }, canPlay: () => false }; } },
    '@/src/lib/api': { api: () => new Promise(() => {}), ApiError: Error },
    '@/src/lib/feed-posts': { validPostId: () => true, sharePostLink: async () => {} },
    '@/src/lib/feed-time': { compactCount: String },
    '@/src/lib/feed-social': { safeCount: Number },
  };
  const source = process.env.NATIVE_MEDIA_SOURCE_REF
    ? execFileSync('git', ['show', `${process.env.NATIVE_MEDIA_SOURCE_REF}:${file}`], { cwd: root, encoding: 'utf8' })
    : readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source + (exported === 'default' ? '' : `\nexport { ${exported} };`), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require: (name) => modules[name] ?? (name.startsWith('@/src/components/') ? new Proxy({}, { get: () => noop }) : (() => { throw new Error(`Unmocked ${name}`); })()),
    setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval() {},
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {}, console,
  }, { filename: file });
  const props = { url: 'https://api.kampusone.app/v1/media/test', label: 'Post video', playbackMode: 'feed-autoplay', suspended: false, initialAspect: 4 / 3,
    onPlaybackHandle: (next) => { if (!next) handle?.setViewportVisible(false); else { handle = next; next.setViewportVisible(false); } } };
  const render = () => { stateCursor = 0; refCursor = 0; tree = exports[exported](props); return tree; };
  render();
  for (const fn of layout) cleanups.push({ layout: true, cleanup: fn() });
  for (const fn of passive) cleanups.push({ layout: false, cleanup: fn() });
  return {
    unmount() {
      for (const item of cleanups.filter((item) => item.layout)) item.cleanup?.();
      for (const item of cleanups.filter((item) => !item.layout)) item.cleanup?.();
    },
    staleCallbacks() {
      handle?.setViewportVisible(false);
      for (const fn of timers) fn();
      for (const fn of routeListeners) fn(false);
      for (const fn of appListeners) fn('background');
    },
    afterReleaseAccesses: () => afterReleaseAccesses,
    render,
    tree: () => tree,
    handle: () => handle,
    playerCreates: () => playerCreates,
  };
}

test('feed video unregistration and delayed viewability events never access a released native player', () => {
  const harness = nativeHarness('mobile/src/components/media-preview.tsx', 'Video');
  assert.doesNotThrow(() => harness.unmount());
  assert.doesNotThrow(() => harness.staleCallbacks());
  assert.equal(harness.afterReleaseAccesses(), 0);
});

test('full-screen video source, timer and focus cleanup never read a released player', async () => {
  const harness = nativeHarness('mobile/app/video.tsx');
  assert.doesNotThrow(() => harness.unmount());
  await Promise.resolve();
  assert.doesNotThrow(() => harness.staleCallbacks());
  assert.equal(harness.afterReleaseAccesses(), 0);
});

test('an off-screen feed video has a measurable frame, then activates the source when visible', { skip: Boolean(process.env.NATIVE_MEDIA_SOURCE_REF) }, () => {
  const harness = nativeHarness('mobile/src/components/media-preview.tsx', 'ManagedVideo');
  assert.equal(harness.playerCreates(), 0);
  assert.ok(harness.handle(), 'The placeholder must expose a viewport handle before video creation');
  assert.equal(harness.tree().props.children.props.style[1].aspectRatio, 4 / 3);
  harness.handle().setViewportVisible(true);
  const tree = harness.render();
  assert.equal(tree.props.children.type.name, 'Video');
  const states = [];
  tree.props.children.props.onPlaybackHandle({ setViewportVisible: (visible) => states.push(visible) });
  assert.deepEqual(states, [true]);
  harness.handle().setViewportVisible(false);
  assert.deepEqual(states, [true, false]);
  harness.unmount();
  harness.handle().setViewportVisible(true);
  assert.deepEqual(states, [true, false]);
});

test('retired native lifetimes cannot affect a replacement player and active failures remain observable', () => {
  const old = createNativeMediaLifetime(), next = createNativeMediaLifetime();
  let accesses = 0;
  old.dispose();
  assert.equal(old.run(() => { accesses++; }), undefined);
  old.activate();
  old.run(() => { accesses++; });
  old.dispose();
  next.run(() => { accesses++; });
  assert.equal(accesses, 2);
  assert.throws(() => next.run(() => { throw new Error('Actual playback failure'); }), /Actual playback failure/);
  assert.equal(isReleasedNativeMediaError(new Error('Cannot use shared object that was already released')), true);
  assert.equal(isReleasedNativeMediaError(new Error('Actual playback failure')), false);
});
