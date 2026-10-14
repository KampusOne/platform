import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {typescript as ts} from './helpers/typescript.mjs';
import * as links from '../packages/contracts/src/payment-links.ts';

const mobileRequire=createRequire(new URL('../mobile/package.json',import.meta.url));
const {extractExpoPathFromURL}=mobileRequire('expo-router/build/fork/extractPathFromURL');
const {getRoutes}=mobileRequire('expo-router/build/getRoutes');
const {getReactNavigationConfig}=mobileRequire('expo-router/build/getReactNavigationConfig');
const parserPath=mobileRequire.resolve('expo-router/build/fork/getStateFromPath');
const parserRequire=createRequire(parserPath),parser={};
// Use the installed SDK's parser and validation, without mounting native views.
runInNewContext(readFileSync(parserPath,'utf8'),{exports:parser,require:name=>name==='../react-navigation/native'
  ?mobileRequire('expo-router/build/react-navigation/core/validatePathConfig'):parserRequire(name),URL,console,process});
const keys=readdirSync(new URL('../mobile/app',import.meta.url),{recursive:true}).filter(file=>/\.[tj]sx?$/.test(file)).map(file=>'./'+file);
const context=()=>({default:()=>null});context.keys=()=>keys;
const routes=getRoutes(context,{platform:'android',importMode:'sync',skipGenerated:true});
const config=getReactNavigationConfig(routes,true);
const reference='K1-B-O-e123f2b3-0df5-407f-910f-00646434e5c5';

function compile(file,mocks,globals={}) {
  const exports={};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText,{exports,module:{exports},require:name=>{if(name in mocks)return mocks[name];throw Error(name);},
    URL,Intl,Date,Number,Error,AbortController,Promise,setTimeout,clearTimeout,...globals});
  return exports;
}
const intent=compile('mobile/app/+native-intent.tsx',{'../../packages/contracts/src/payment-links':links});
for(const initial of [true,false])test(`${initial?'cold':'foreground'} callbacks match the real Android receipt route and keep the reference`,()=>{
  for(const path of [
    'kampusone://payment-return?reference='+reference,
    'kampusone:///payment-return?reference='+reference,
    'kampusone://payment/return?trxref='+reference,
    'https://links.kampusone.app/payment/return?reference='+reference,
    '/payment/return?reference='+reference,
  ]) {
    const rewritten=intent.redirectSystemPath({path,initial});
    const state=parser.getStateFromPath(extractExpoPathFromURL([],rewritten),config);
    const route=state.routes.at(-1);
    assert.equal(route.name,'payment-return');assert.equal(route.params.reference,reference);
    assert.ok(!JSON.stringify(state).includes('+not-found'));
  }
});
test('the portal link targets the registered route and conflicting or invalid references cannot become a receipt',()=>{
  assert.equal(links.nativePaymentReturnUrl(reference),'kampusone:///payment-return?reference='+reference);
  for(const query of ['reference=../../sign-in','reference='+reference+'&reference=K1-B-O-other','reference='+reference+'&trxref=K1-B-O-other'])
    assert.equal(intent.redirectSystemPath({path:'kampusone://payment-return?'+query,initial:true}),'/payment-return');
  for(const path of ['kampusone://post?id=post','https://other.invalid/payment/return?reference='+reference])
    assert.equal(intent.redirectSystemPath({path,initial:false}),path);
});

function screen({state='authenticated',receipt=null,restoreError=''}={}) {
  const events=[],cleanups=[],back=[];let stateIndex=0;
  const auth={state,user:{id:'buyer-id'},sessionRestoreError:restoreError,retrySessionRestore:async()=>events.push('restore')};
  const jsx=(type,props)=>({type,props});
  const mocks={
    react:{useCallback:fn=>fn,useRef:value=>({current:value}),useState:value=>[stateIndex++===0?receipt:value,()=>{}]},
    'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},
    'react-native':{Platform:{OS:'android'},AppState:{currentState:'active',addEventListener:()=>({remove(){}})},BackHandler:{addEventListener:(_,handler)=>{back.push(handler);return{remove(){}};}},Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',View:'View'},
    'expo-network':{addNetworkStateListener:()=>({remove(){}}),getNetworkStateAsync:async()=>({isConnected:true})},
    '@expo/vector-icons':{Ionicons:'Icon'},
    'expo-router':{router:{replace:value=>events.push({replace:value}),push:value=>events.push({push:value})},useLocalSearchParams:()=>({reference}),useFocusEffect:fn=>{const cleanup=fn();if(cleanup)cleanups.push(cleanup);}},
    '@/src/components/toolkit':{ToolPage:'ToolPage',ToolButton:'ToolButton'},
    '@/src/components/skeleton':{InlineLoading:'Loading'},
    '@/src/lib/appearance':{useAppearance:()=>({theme:{font:{display:'Lato',body:'Inter',semibold:'Inter'}}})},
    '@/src/auth/auth-context':{useAuth:()=>auth},
    '@/src/lib/api':{api:async(path)=>{events.push({request:path});return{payment:receipt};},invalidateApiReads(){}},
    '@/src/lib/hosted-payment':{dismissPayment:async(user,ref)=>events.push({dismiss:{user,ref}})},
    '@/src/lib/payment-flow':{validPaymentReference:links.validPaymentReference,paymentContinuation:payment=>({pathname:'/order-detail',params:{id:payment.resource_id}})},
    '@/src/lib/device-cache':{getDeviceCacheRevision:()=>1},
  };
  const module=compile('mobile/app/payment-return.tsx',mocks);
  const inner=module.default(),view=inner.type(inner.props);
  const nodes=[];const visit=node=>{if(Array.isArray(node))node.forEach(visit);else if(node&&typeof node==='object'){nodes.push(node);visit(node.props?.children);}};visit(view);
  return{view,nodes,events,back,close:()=>cleanups.forEach(fn=>fn())};
}
const verified={provider_reference:reference,status:'SUCCEEDED',resource_type:'STORE_ORDER',resource_id:'purchased-order',amount_kobo:31300,title:'Test store'};
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
test('a cached account cannot query payment status before secure session restoration',async()=>{
  const s=screen({state:'loading',restoreError:'Connection unavailable'});await settle();
  assert.equal(s.events.length,0);assert.equal(s.back.length,0);
  assert.ok(s.nodes.some(node=>node.type==='ToolButton'&&node.props.label==='Restore session again'));
  assert.ok(!s.nodes.some(node=>node.props?.label==='Sign in to confirm payment'));
  s.close();
});
test('confirmed receipts continue to Home, while Track order opens the exact saved order',async()=>{
  for(const action of ['Continue to Home','Track order','header','hardware']) {
    const s=screen({receipt:verified});await settle();
    if(action==='header')s.view.props.onBack();
    else if(action==='hardware')assert.equal(s.back[0](),true);
    else s.nodes.find(node=>node.type==='ToolButton'&&node.props.label===action).props.onPress();
    await settle();
    assert.deepEqual(s.events.find(event=>event.dismiss)?.dismiss,{user:'buyer-id',ref:reference});
    const destination=s.events.find(event=>event.replace)?.replace;
    if(action==='Track order')assert.deepEqual(destination,{pathname:'/order-detail',params:{id:'purchased-order'}});
    else assert.equal(destination,'/(tabs)');
    assert.ok(!s.events.some(event=>event.push));s.close();
  }
});
test('a genuinely expired session keeps the payment reference through interactive sign-in',()=>{
  const s=screen({state:'anonymous'});
  s.nodes.find(node=>node.props?.label==='Sign in to confirm payment').props.onPress();
  assert.equal(s.events[0].push.pathname,'/(auth)/sign-in');
  assert.equal(s.events[0].push.params.paymentReference,reference);s.close();
});
