import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { typescript as ts } from './helpers/typescript.mjs';
import { hookRenderer } from './helpers/hook-renderer.mjs';

function fixture({ request, options, disabled = false } = {}) {
 const host=hookRenderer(),requests=[],selections=[],changes=[];let tree,value=null;
 const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'Fragment'};
 const modules={react:host.react,'react/jsx-runtime':jsx,'react-native':{View:'View',Text:'Text',Pressable:'Pressable',FlatList:'FlatList',ActivityIndicator:'ActivityIndicator',Keyboard:{dismiss(){}}},'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Icon'},
  '@/src/lib/appearance':{useAppearance:()=>({theme:{font:{body:'Inter',medium:'InterMedium',semibold:'InterSemibold',displayStrong:'LatoBold'}}})},'@/src/lib/api':{api:async(path,init)=>{requests.push({path,init});return request?request(path):{places:[]};}},'./toolkit':{ToolField:'ToolField'},'./keyboard-viewport':{KeyboardModal:'Modal'},'./retry-icon-button':{RetryIconButton:'RetryIconButton'}};
 const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('../mobile/src/components/campus-place-choice.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,module:{exports},require:name=>{if(name in modules)return modules[name];throw Error('Missing '+name);},AbortController,Map,Set,Error,encodeURIComponent});
 const render=()=>host.render(()=>tree=exports.CampusPlaceChoice({label:'Delivery point on the campus map',value,options,disabled,onChange:id=>{value=id;changes.push(id);},onSelect:place=>selections.push(place)}));
 const flatten=node=>Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...flatten(node.props?.children)]:[];
 const by=(type,label)=>flatten(tree).find(node=>node.type===type&&(!label||node.props?.accessibilityLabel===label||node.props?.label===label));
 const settle=async()=>{for(let n=0;n<5;n++){await Promise.resolve();render();}};
 render();return{render,settle,by,requests,changes,selections,unmount:host.unmount};
}
const place=(n)=>({id:String(n),name:`Campus place ${String(n).padStart(3,'0')}`,campus_name:'Ugbowo campus',search_aliases:[]});
test('location chooser loads every page, searches aliases and campus names, and selects beyond the old 20-row cutoff',async()=>{
 const last={...place(205),name:'Hall Four',search_aliases:['Hall 4','Student hostel']};
 const f=fixture({request:path=>path.includes('cursor=')?{places:[last],nextCursor:null}:{places:Array.from({length:200},(_,n)=>place(n)),nextCursor:'page-2'}});
 await f.settle();assert.equal(f.requests.length,2);assert.match(f.requests[1].path,/cursor=page-2$/);
 f.by('Pressable','Choose delivery point on the campus map').props.onPress();f.render();assert.equal(f.by('Modal').props.visible,true);
 assert.equal(f.by('FlatList').props.data.length,201);
 f.by('ToolField','Search campus locations').props.onChangeText('ugbowo hall 4');f.render();assert.equal(f.by('FlatList').props.data.length,1);
 const row=f.by('FlatList').props.renderItem({item:last});row.props.onPress();f.render();assert.deepEqual(f.changes,['205']);assert.equal(f.selections[0].name,'Hall Four');assert.equal(f.by('Modal').props.visible,false);
 f.by('Pressable','Choose delivery point on the campus map').props.onPress();f.render();assert.equal(f.by('FlatList').props.data.length,201);f.by('Pressable','Clear selected location').props.onPress();f.render();assert.equal(f.changes.at(-1),null);f.unmount();
});
test('an incomplete directory stays visible as an error and retry loads a complete result',async()=>{
 let fail=true;
 const f=fixture({request:()=>{if(fail)throw Error('Network unavailable. Try again.');return{places:[place(1)]};}});await f.settle();assert.ok(f.by('RetryIconButton','Retry campus locations'));
 fail=false;f.by('RetryIconButton','Retry campus locations').props.onPress();await f.settle();assert.equal(f.by('FlatList').props.data.length,1);f.unmount();
});
test('provided pickup options do not refetch and closing the chooser does not change a location',async()=>{
 const f=fixture({options:[place(1)],disabled:true});await f.settle();assert.equal(f.requests.length,0);assert.equal(f.by('Pressable','Choose delivery point on the campus map').props.disabled,true);
 f.by('Pressable','Close campus locations').props.onPress();f.render();assert.deepEqual(f.changes,[]);f.unmount();
});
