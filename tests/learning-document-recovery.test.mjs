import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { typescript as ts } from './helpers/typescript.mjs';
import { hookRenderer, virtualClock } from './helpers/hook-renderer.mjs';

function reader(web = false) {
  const host = hookRenderer(), clock = virtualClock(), scripts = [], messages = [], listeners = new Map();
  let tree, refreshes = 0, props = { url: 'https://files.example.invalid/book?access=first', title: 'Engineering notes', onRefresh: () => refreshes++ };
  const target = { postMessage: (...value) => messages.push(value) };
  const browser = { location: { origin: 'https://mobile.example.invalid' }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const modules = {
    react: host.react,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-native': { Text: 'Text', View: 'View' },
    'react-native-webview': { WebView: 'WebView' },
    '@/src/lib/appearance': { useAppearance: () => ({ isDark: false, theme: { canvas: '#FBF7F2', font: { body: 'Inter' } } }) },
    './toolkit': { ToolButton: 'ToolButton' },
  };
  const exports = {};
  const path = `../mobile/src/components/learning-document${web ? '.web' : ''}.tsx`;
  runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, module: { exports }, require: name => modules[name], window: browser, setTimeout: clock.schedule, clearTimeout: clock.cancel,
  });
  const render = () => host.render(() => tree = exports.LearningDocument(props));
  render();
  tree.props.ref.current = web ? { contentWindow: target } : { injectJavaScript: script => scripts.push(script) };
  return { render, tree: () => tree, scripts, messages, clock, refreshes: () => refreshes, update: url => { props = { ...props, url }; render(); },
    ready: () => { web ? listeners.get('message')({ source: target, origin: browser.location.origin, data: 'ready' }) : tree.props.onMessage({ nativeEvent: { data: 'ready' } }); render(); },
    emit: event => listeners.get('message')?.(event), unmount: host.unmount };
}

test('native PDF reader resends refreshed access to the ready WebView and restores after process loss', () => {
  const h = reader(); assert.equal(h.scripts.length, 0);
  h.ready(); assert.equal(h.scripts.length, 1); assert.match(h.scripts[0], /access=first/);
  h.update('https://files.example.invalid/book?access=renewed'); assert.equal(h.scripts.length, 2); assert.match(h.scripts[1], /access=renewed/);
  h.tree().props.onRenderProcessGone(); h.render(); h.ready(); assert.equal(h.scripts.length, 3); assert.match(h.scripts[2], /access=renewed/); h.unmount();
});

test('a failed native viewer bootstrap ends with retry instead of an endless opening screen', async () => {
  const h = reader(); await h.clock.advance(15000); h.render();
  const button = h.tree().props.children.find(node => node.type === 'ToolButton');
  assert.equal(button.props.label, 'Retry document'); button.props.onPress(); h.render(); assert.equal(h.refreshes(), 1); assert.equal(h.tree().type, 'WebView'); h.unmount();
});

test('web PDF reader sends refreshed access links only to its own ready frame', () => {
  const h = reader(true);
  h.emit({ source: {}, origin: 'https://mobile.example.invalid', data: 'ready' }); h.render(); assert.equal(h.messages.length, 0);
  h.ready(); assert.equal(h.messages.length, 1); assert.equal(h.messages[0][0].url, 'https://files.example.invalid/book?access=first');
  h.update('https://files.example.invalid/book?access=renewed'); assert.equal(h.messages.length, 2); assert.equal(h.messages[1][0].url, 'https://files.example.invalid/book?access=renewed'); h.unmount();
});


test('a cached web frame opens even when its initial ready message precedes the host listener', () => {
  const h=reader(true);h.tree().props.onLoad();h.render();
  assert.equal(h.messages.length,1);assert.match(h.messages[0][0].url,/access=first/);h.unmount();
});
