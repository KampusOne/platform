import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {nairaToKobo} from '../mobile/src/lib/money-input.ts';
const ts=createRequire(new URL('../server/package.json',import.meta.url))('typescript');
function formHarness(api) {
  const states=[],refs=[],effects=[];let state=0,ref=0,mounted=false,tree;
  const react={useState:value=>{const i=state++;if(!(i in states))states[i]=value;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},useRef:value=>refs[ref++]??(refs[ref-1]={current:value}),useCallback:fn=>fn,useEffect:fn=>{if(!mounted)effects.push(fn);}};
  const theme={font:{body:'Inter',displayStrong:'Lato',semibold:'Inter'},surfaceTint:'#F1DFC8',surface:'#fff',text:'#29231F',textMuted:'#9A8D84',deepBrand:'#A8462E',error:'#A8462E'};
  const modules={'react':react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'Fragment'},'expo-crypto':{randomUUID},'@expo/vector-icons':{Ionicons:'Ionicons'},'expo-router':{router:{back(){}},useLocalSearchParams:()=>({role:'VENDOR'})},'react-native':{Image:'Image',Pressable:'Pressable',Text:'Text',View:'View'},'@/src/lib/money-input':{nairaToKobo},'@/src/components/toolkit':{ToolPage:'ToolPage',ToolButton:'ToolButton',ToolField:'ToolField'},'@/src/components/toast':{useToast:()=>()=>{}},'@/src/lib/appearance':{useAppearance:()=>({theme})},'@/src/lib/api':{api},'@/src/lib/uploads':{pickAndUpload:async()=>({url:'https://fixture.invalid/photo.jpg'})}};
  const exports={};
  const code=ts.transpileModule(readFileSync(new URL('../mobile/app/agent-create.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  runInNewContext(code,{exports,module:{exports},require:key=>{if(key in modules)return modules[key];throw Error(key);},setTimeout,clearTimeout,Error});
  function render(){state=0;ref=0;tree=exports.default();if(!mounted){mounted=true;effects.forEach(fn=>fn());}return tree;}
  function nodes(value){if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=='object')return[];return[value,...nodes(value.props?.children)];}
  const by=(type,label)=>nodes(tree).find(n=>n.type===type&&(n.props.label===label||n.props.accessibilityLabel===label));
  const flush=async()=>{await new Promise(setImmediate);render();};
  render();return{render,flush,by,states};
}
test('a failed category read is visible and retry restores a completed product form without discarding its input or photos',async()=>{
  let reads=0,created;
  const category={id:randomUUID(),name:'Stationery'};
  const h=formHarness(async(path,init)=>{
    if(path==='/v1/agents/product-categories'){if(++reads===1)throw Error('KampusOne took too long to respond.');return{categories:[category]};}
    if(path==='/v1/agents/products'){created=JSON.parse(init.body);return{id:randomUUID()};}
    return null;
  });
  await h.flush();assert.ok(h.by('ToolButton','Retry product categories'));
  for(const [label,value] of [['Product name','Testing'],['Description','Testing marketplace storefront'],['Price (₦)','1000'],['Stock quantity','2']])h.by('ToolField',label).props.onChangeText(value);
  await h.by('Pressable','Add product photo').props.onPress();await h.flush();
  assert.equal(h.by('ToolButton','Upload product').props.disabled,true);
  await h.by('ToolButton','Retry product categories').props.onPress();await h.flush();
  h.by('Pressable','Stationery').props.onPress();h.render();
  assert.equal(h.by('ToolButton','Upload product').props.disabled,false);
  assert.equal(h.by('ToolField','Description').props.value,'Testing marketplace storefront');
  await h.by('ToolButton','Upload product').props.onPress();await h.flush();
  assert.equal(created.categoryId,category.id);assert.equal(created.priceKobo,100000);assert.equal(created.stockQuantity,2);assert.equal(created.imageUrls.length,1);
});
test('loaded categories do not permit invalid stock or malformed prices to be submitted',async()=>{
  const category={id:randomUUID(),name:'Stationery'};
  const h=formHarness(async()=>({categories:[category]}));await h.flush();
  h.by('Pressable','Stationery').props.onPress();
  for(const [label,value] of [['Product name','Testing'],['Description','Testing marketplace storefront'],['Price (₦)','1000'],['Stock quantity','2']])h.by('ToolField',label).props.onChangeText(value);
  await h.by('Pressable','Add product photo').props.onPress();await h.flush();
  assert.equal(h.by('ToolButton','Upload product').props.disabled,false);
  h.by('ToolField','Stock quantity').props.onChangeText('1.5');h.render();assert.equal(h.by('ToolButton','Upload product').props.disabled,true);
  h.by('ToolField','Stock quantity').props.onChangeText('2');h.by('ToolField','Price (₦)').props.onChangeText('abc');h.render();assert.equal(h.by('ToolButton','Upload product').props.disabled,true);
});
