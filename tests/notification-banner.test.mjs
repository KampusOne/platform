import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { typescript as ts } from './helpers/typescript.mjs';
import { hookRenderer } from './helpers/hook-renderer.mjs';
function harness() {
  const host = hookRenderer(); let dark = false, userId = 'owner', tree;
  const theme = () => ({ text: dark ? '#F5F5F5' : '#29231F', surfaceGlassStrong: dark ? '#101010' : '#FFFFFF', border: '#999', textMuted: '#666', accentText: '#A8462E', error: '#A8462E', success: '#4B7B54', shadow: {}, font: { body: 'Inter', semibold: 'Inter' } });
  const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  const mocks = {
    react: { ...host.react, createContext: () => ({ Provider: 'Provider' }) }, 'react/jsx-runtime': jsx,
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', PanResponder: { create: () => ({ panHandlers: {} }) }, Platform: { OS: 'android' }, StyleSheet: { create: v => v } },
    '@/src/lib/appearance': { useThemeStyles: factory => ({ theme: theme(), isDark: dark, styles: factory(theme()) }) },
    '@/src/auth/auth-context': { useAuth: () => ({ user: { id: userId } }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24 }) },
    'expo-blur': { BlurView: 'BlurView', BlurTargetView: 'BlurTargetView' }, '@expo/vector-icons': { Ionicons: 'Ionicons' }, './profile-avatar': { ProfileAvatar: 'ProfileAvatar' },
  };
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../mobile/src/components/toast.tsx', import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText, {exports,module:{exports},require:key=>{if(key in mocks)return mocks[key];throw Error(key);},Date,Map,Math,setTimeout,clearTimeout});
  const render = () => host.render(() => tree = exports.ToastProvider({children:null}));
  const nodes = n => Array.isArray(n) ? n.flatMap(nodes) : n && typeof n === 'object' ? [n, ...nodes(n.props?.children)] : [];
  render(); render();
  return { show: (...args) => { tree.props.value(...args); render(); }, all: () => nodes(tree), dark: () => { dark=true;render(); }, switchAccount: () => { userId='another-owner';render();render(); }, close:host.unmount };
}
test('person notifications show their profile picture; system cart notices do not', () => {
  const h=harness();h.show('Replied to your post','info',undefined,{title:'Ada',actor:{id:'ada',name:'Ada',imageUrl:'https://example.invalid/ada.jpg'}});
  assert.equal(h.all().find(n=>n.type==='ProfileAvatar').props.imageUrl,'https://example.invalid/ada.jpg');
  h.show('Added to cart','success');assert.equal(h.all().some(n=>n.type==='ProfileAvatar'),false);
  assert.equal(h.all().find(n=>n.type==='Ionicons').props.name,'bag-check-outline');h.close();
});
test('a duplicate live/push delivery is shown once and respects appearance changes', () => {
  const h=harness();h.show('First notice','info',undefined,{dedupeKey:'notice:1'});h.show('Duplicate delivery','info',undefined,{dedupeKey:'notice:1'});
  const message=()=>h.all().find(n=>n.type==='Text'&&n.props.children==='First notice');assert.ok(message());
  assert.equal(message().props.style.color,'#29231F');h.dark();assert.equal(message().props.style.color,'#F5F5F5');
  h.switchAccount();assert.equal(h.all().some(n=>n.props?.accessibilityRole==='alert'),false);h.close();
});
