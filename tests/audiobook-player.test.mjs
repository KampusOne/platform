import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { typescript as ts } from './helpers/typescript.mjs';
import { hookRenderer, virtualClock } from './helpers/hook-renderer.mjs';

function fixture({ loaded = true, seek, ...props } = {}) {
  const host = hookRenderer(), clock = virtualClock(), calls = [], retries = [];
  const status = { isLoaded: loaded, isBuffering: false, currentTime: 5, duration: 60, playing: false, didJustFinish: false, playbackState: loaded ? 'readyToPlay' : 'loading' };
  const player = { loop: false, play: () => calls.push('play'), pause: () => calls.push('pause'), seekTo: async value => { calls.push(['seek', value]); await seek?.(value); status.currentTime = value; }, setPlaybackRate: value => calls.push(['rate', value]) };
  const mocks = {
    react: host.react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator' }, '@expo/vector-icons': { Ionicons: 'Icon' },
    'expo-audio': { useAudioPlayer: (url, options) => { assert.equal(url, 'https://private.invalid/audio?access=synthetic'); assert.equal(options.downloadFirst, false); return player; }, useAudioPlayerStatus: () => status },
    '@/src/lib/appearance': { useAppearance: () => ({ theme: { font: {} } }) }, './playback-slider': { PlaybackSlider: 'Slider' }, './skeleton': { InlineLoading: 'InlineLoading' },
  };
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../mobile/src/components/audiobook-player.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, module: { exports }, require: name => { if (!(name in mocks)) throw Error('Missing mock ' + name); return mocks[name]; }, setTimeout: clock.schedule, clearTimeout: clock.cancel });
  let tree;
  const flatten = node => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === 'object' ? [node, ...flatten(node.props?.children)] : [];
  const render = () => host.render(() => tree = exports.AudiobookPlayer({ url: 'https://private.invalid/audio?access=synthetic', onRetry: () => retries.push(true), ...props }));
  const nodes = () => flatten(tree), by = label => nodes().find(n => n.props?.accessibilityLabel === label);
  const settle = async () => { for (let n = 0; n < 5; n++) { await clock.advance(0); render(); } };
  render(); return { status, player, calls, retries, by, nodes, render, settle, clock, unmount: host.unmount, slider: () => nodes().find(n => n.type === 'Slider') };
}

test('audio play, pause, bounded skips, scrub, repeat and speed use the live player', async () => {
  const h = fixture();
  h.by('Play audio').props.onPress(); await h.settle(); assert.equal(h.calls.at(-1), 'play');
  h.status.playing = true; h.render(); h.by('Pause audio').props.onPress(); await h.settle(); assert.equal(h.calls.at(-1), 'pause');
  h.by('Back 15 seconds').props.onPress(); await h.settle(); assert.deepEqual(h.calls.at(-1), ['seek', 0]);
  h.status.currentTime = 58; h.render(); h.by('Forward 15 seconds').props.onPress(); await h.settle(); assert.deepEqual(h.calls.at(-1), ['seek', 60]);
  h.slider().props.onPreview(23); h.render(); assert.equal(h.slider().props.value, 23);
  h.slider().props.onSeek(23); await h.settle(); assert.deepEqual(h.calls.at(-1), ['seek', 23]);
  h.by('Repeat audio').props.onPress(); await h.settle(); assert.equal(h.player.loop, true); assert.equal(h.by('Turn repeat off').props.accessibilityState.selected, true);
  h.by('Turn repeat off').props.onPress(); await h.settle(); assert.equal(h.player.loop, false);
  for (const [before, after] of [[1, 1.25], [1.25, 1.5], [1.5, 2], [2, 1]]) {
    h.by(`Playback speed ${before} times. Change speed`).props.onPress(); await h.settle(); assert.deepEqual(h.calls.at(-1), ['rate', after]);
  }
  assert.equal(h.nodes().some(n => /download/i.test(n.props?.accessibilityLabel ?? '')), false); h.unmount();
});

test('completed audio restarts at zero before replay, and duplicate pending seeks are ignored', async () => {
  let finish; const h = fixture({ seek: () => new Promise(resolve => finish = resolve) });
  h.status.didJustFinish = true; h.status.currentTime = 60; h.render();
  h.by('Play audio').props.onPress(); h.by('Play audio').props.onPress(); h.render();
  assert.deepEqual(h.calls, [['seek', 0]]); assert.equal(h.by('Play audio').props.disabled, true);
  finish(); await h.settle(); assert.deepEqual(h.calls, [['seek', 0], 'play']); h.unmount();
});

test('unloaded audio disables controls, recovers when loaded, and offers a signed-link retry after a stall', async () => {
  const h = fixture({ loaded: false });
  assert.equal(h.by('Play audio').props.disabled, true); assert.equal(h.slider().props.disabled, true);
  h.by('Play audio').props.onPress(); assert.equal(h.calls.length, 0);
  await h.clock.advance(15000); h.render(); assert.ok(h.by('Retry audio'));
  h.by('Retry audio').props.onPress(); assert.equal(h.retries.length, 1);
  h.status.isLoaded = true; h.render(); h.render(); assert.equal(h.by('Retry audio'), undefined); assert.equal(h.by('Play audio').props.disabled, false);
  h.unmount(); assert.equal(h.clock.timers.size, 0);
});

test('playback failures are visible and chapter controls invoke real callbacks', async () => {
  const chapter = [], h = fixture({ chapter: 'Chapter 2 of 3', onPrevious: () => chapter.push(1), onNext: () => chapter.push(3), seek: async () => { throw Error('Source expired'); } });
  h.by('Previous chapter').props.onPress(); h.by('Next chapter').props.onPress(); assert.deepEqual(chapter, [1, 3]);
  h.slider().props.onSeek(20); await h.settle(); assert.ok(h.by('Retry audio')); assert.equal(h.by('Play audio').props.disabled, true); h.unmount();
  const first = fixture({ chapter: 'Chapter 1 of 2', onNext() {} }); assert.equal(first.by('Previous chapter').props.disabled, true); first.unmount();
});
