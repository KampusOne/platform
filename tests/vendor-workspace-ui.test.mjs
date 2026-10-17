import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { typescript as ts } from './helpers/typescript.mjs';
import { hookRenderer } from './helpers/hook-renderer.mjs';
import { normalizeNigerianPhone } from '../packages/contracts/src/commerce-input.ts';
import { learningSearchTerms, learningTypeLabels, matchesLearningSearch } from '../packages/contracts/src/learning-search.ts';
const search = { learningSearchTerms, learningTypeLabels, matchesLearningSearch };
function load(path, mocks) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, module: { exports }, require: name => { if (name in mocks) return mocks[name]; throw Error('Missing mock: ' + name); },
    AbortController, Intl, Date, Error, Number, Math, setTimeout, clearTimeout,
  });
  return exports;
}
const input = load('mobile/src/lib/storefront-input.ts', { '../../../packages/contracts/src/commerce-input': { normalizeNigerianPhone } });
const theme = { font: { body: 'Inter', semibold: 'Inter', displayStrong: 'Lato' }, error: '#A8462E' };
function harness(path, name, api, extra = {}) {
  const host = hookRenderer(), calls = [], routes = [], notices = []; let tree;
  const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
  const mocks = {
    'react': host.react, 'react/jsx-runtime': jsx,
    'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', Alert: { alert() {} }, AppState: { currentState: 'active' }, Linking: {} },
    'expo-router': { useFocusEffect: cb => host.react.useEffect(cb, [cb]), useLocalSearchParams: () => ({ role: 'TUTOR' }), router: { push: path => routes.push(path), setParams: path => routes.push(path) } },
    '@expo/vector-icons': { Ionicons: 'Ionicons' },
    '@/src/lib/api': { api: async (...args) => { calls.push(args); return api(...args); } },
    '@/src/lib/appearance': { useAppearance: () => ({ theme }) },
    '@/src/components/toast': { useToast: () => (...args) => notices.push(args) },
    '@/src/auth/auth-context': { useAuth: () => ({ user: { id: 'test-owner' } }) },
    '@/src/lib/request-policy': { cacheScopeForUser: () => 'test-owner-campus' },
    '@/src/lib/storefront-input': input,
    '@/src/lib/agent-location': { shareAgentLocation: async () => {} },
    '@/src/lib/live-updates': { useLiveRefresh() {} },
    ...extra,
  };
  for (const [file, component] of Object.entries({ 'toolkit': ['ToolPage','ToolButton','ToolField','ToolRow'], 'header-menu': ['HeaderMenu'], 'brand-switch': ['BrandSwitch'], 'campus-place-choice': ['CampusPlaceChoice'], 'skeleton': ['ScreenSkeleton','SkeletonBlock'], 'retry-icon-button': ['RetryIconButton'], 'media-image': ['MediaImage'], 'product-ui': ['EmptyResult'], 'vendor-analytics': ['VendorAnalytics'] })) {
    const exports = Object.fromEntries(component.map(key => [key, key]));
    mocks['@/src/components/' + file] ??= exports; mocks['./' + file] ??= exports;
  }
  const screen = load(path, mocks);
  const render = () => host.render(() => { tree = screen[name](); while (typeof tree.type === 'function') tree = tree.type(tree.props); return tree; });
  const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children), ...nodes(value.props?.action)] : [];
  const all = () => nodes(tree);
  const by = (type, label) => all().find(n => n.type === type && (!label || n.props?.label === label || n.props?.accessibilityLabel === label));
  const text = () => all().filter(n => n.type === 'Text').map(n => Array.isArray(n.props.children) ? n.props.children.flat().join('') : String(n.props.children)).join('\n');
  const settle = async () => { for (let i=0;i<4;i++) { await new Promise(setImmediate); render(); } };
  render(); return { render, settle, by, all, text, calls, routes, notices, unmount: host.unmount };
}
const store = { vendor_profile_id: 'test-vendor', status: 'APPROVED', display_name: 'Campus books', description: 'Books for university students.', contact_phone_e164: '+2348012345678', pickup_location: 'Library entrance', pickup_locations: ['Library entrance','Faculty gate'], opening_hours: {}, default_preparation_minutes: 90, pickup_enabled: true };
test('store save accepts blank optional hours, normalizes a local phone and reuses loaded pickup points', async () => {
  let payload;
  const points = [{ id: 'map-point', name: 'Library' }];
  const h = harness('mobile/app/store-settings.tsx','default',async (path, init) => {
    if (!init?.method) return { storefront: store, fulfilmentReady: true, pickupPoints: points };
    if (path === '/v1/agents/storefront') { payload = JSON.parse(init.body); return { vendor_profile_id: store.vendor_profile_id, status: 'APPROVED' }; }
    return { saved: true };
  });
  await h.settle();
  assert.equal(h.by('CampusPlaceChoice').props.options, points);
  assert.equal(h.by('HeaderMenu','Store options').props.items.some(item => item.label === 'Submit for review'), false);
  assert.equal(h.calls.filter(([,init]) => !init?.method).length, 1);
  h.by('ToolField','Contact phone (+234…)').props.onChangeText('0801 234 5678'); h.render();
  await h.by('ToolButton','Save store').props.onPress(); await h.settle();
  assert.deepEqual(payload.openingHours, {}); assert.equal(payload.contactPhoneE164,'+2348012345678');
  assert.deepEqual(payload.pickupLocations,['Library entrance','Faculty gate']); assert.equal(payload.defaultPreparationMinutes,90);
  assert.equal(h.notices.at(-1)[0],'Store saved'); assert.equal(h.text().includes('I can deliver orders myself'),false);
});
test('invalid store fields stay visible and prevent a request without a generic error toast', async () => {
  const h = harness('mobile/app/store-settings.tsx','default',async () => ({ storefront: store, fulfilmentReady: true, pickupPoints: [] })); await h.settle();
  h.by('ToolField','Contact phone (+234…)').props.onChangeText('123'); h.render();
  await h.by('ToolButton','Save store').props.onPress(); await h.settle();
  assert.match(h.text(),/Enter a Nigerian mobile number/); assert.equal(h.calls.some(([,init]) => init?.method==='PUT'),false);
});
test('a later delivery-option failure accurately reports saved store details and retains input', async () => {
  const h = harness('mobile/app/store-settings.tsx','default',async (path,init) => {
    if (!init?.method) return { storefront: store, fulfilmentReady: true, pickupPoints: [] };
    if (path.endsWith('/fulfilment')) throw Error('Connection interrupted. Retry saving delivery options.');
    return { vendor_profile_id: store.vendor_profile_id, status: 'APPROVED' };
  }); await h.settle(); await h.by('ToolButton','Save store').props.onPress(); await h.settle();
  assert.match(h.text(),/Store details saved\. Connection interrupted/); assert.equal(h.by('ToolField','Store name').props.value,store.display_name);
});
test('campus picker with supplied points never refetches the storefront', async () => {
  const points=[{id:'mapped',name:'Library'}]; let chosen;
  // Exercise the component with props using an independent hook host.
  const host=hookRenderer(),m=load('mobile/src/components/campus-place-choice.tsx',{'react':host.react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'react-native':{View:'View',Text:'Text',Pressable:'Pressable'},'@/src/lib/api':{api:()=>{throw Error('Duplicate storefront request');}},'@/src/lib/appearance':{useAppearance:()=>({theme})},'./toolkit':{ToolField:'ToolField'},'./retry-icon-button':{RetryIconButton:'RetryIconButton'}});
  const tree=host.render(()=>m.CampusPlaceChoice({label:'Map',value:null,onChange:value=>chosen=value,options:points}));
  assert.ok(tree); host.unmount();
});
test('sales failure never fabricates a zero balance and retry renders bigint totals', async () => {
  let attempts=0;
  const h=harness('mobile/src/components/vendor-analytics.tsx','VendorAnalytics',async()=>{if(++attempts===1)throw Error('Sales could not load');return{trend:[{day:'2026-10-17',orders:2,delivered:1,net_kobo:'350000'}]};});
  assert.ok(h.by('View','Loading sales')); assert.doesNotMatch(h.text(),/₦0/);
  await h.settle(); assert.match(h.text(),/Sales could not load/); assert.doesNotMatch(h.text(),/₦0/);
  await h.by('RetryIconButton','Retry sales').props.onPress(); await h.settle();
  assert.match(h.text(),/3,500\.00/); assert.match(h.text(),/2 paid orders · 1 delivered/);
});
test('tutor dashboard leaves only Upload beneath its summary and moves secondary actions into its menu', async () => {
  const h=harness('mobile/app/agent.tsx','default',async()=>({listings:[],resources:[]}),{'@/src/components/agent-shortcuts':{useCapabilities:()=>({ready:true,profiles:[{id:'tutor',agent_type:'TUTOR',display_name:'Ada',status:'ACTIVE'},{id:'rider',agent_type:'RIDER',display_name:'Ada'}],communities:[]})}});
  await h.settle(); const buttons=h.all().filter(n=>n.type==='ToolButton'); assert.deepEqual(buttons.map(n=>n.props.label),['Upload']);
  assert.equal(h.all().some(n=>n.type==='ToolRow'),false);
  buttons[0].props.onPress(); assert.equal(h.routes.at(-1),'/learning-publish');
  const menu=h.by('HeaderMenu','Tutor dashboard options'); assert.ok(menu.props.items.some(item=>item.label==='Set up booking times & fee'));
  assert.equal(h.text().includes('Campus capture missions'),false); assert.equal(h.all().some(n=>n.props?.accessibilityRole==='tab'),false);
});
test('material search matches formats, subjects, tutor names and playbook part titles', () => {
  const pdf={title:'Introduction',description:'Limits',resource_type:'PDF',subject:'Physics',publisher_name:'Ada',course_code:'PHY102'};
  assert.equal(matchesLearningSearch(pdf,'pdf physics'),true); assert.equal(matchesLearningSearch(pdf,'materials ada'),true);
  assert.equal(matchesLearningSearch(pdf,'video physics'),false);
  const collection={...pdf,resource_type:'AUDIOBOOK',parts:[{title:'Introduction'},{title:'Derivatives'}]};
  assert.equal(matchesLearningSearch(collection,'playbook derivatives'),true); assert.equal(matchesLearningSearch(collection,'audiobooks physics'),true);
});
