import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { hookRenderer, virtualClock } from './helpers/hook-renderer.mjs';
const ts=createRequire(new URL('../server/package.json',import.meta.url))('typescript');
function examHarness({commit,persist=async()=>{},scheduleFails=false}={}) {
  const host=hookRenderer(),time=virtualClock(),notices=[],clears=[],saves=[];let tree,imports=0,schedules=0,blur;
  const theme={font:{body:'Inter',semibold:'Inter',displayStrong:'Lato'},text:'#29231F',textMuted:'#9A8D84',deepBrand:'#A8462E',error:'#A8462E'};
  const modules={'react':host.react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'Fragment'},'@/src/lib/screen-read':{refreshScreenRead:async(_path,apply)=>{schedules++;if(scheduleFails&&schedules>1)throw Error('Refresh unavailable');apply({exams:[],period:{active:false}});}},'@/src/components/import-progress':{ImportProgress:'ImportProgress',useImportProgress:()=>{const[stage,setStage]=host.react.useState(null);return{stage,setStage,failureStage:null};}},'@/src/lib/api':{ApiError:class extends Error{},api:async(path)=>{if(path==='/v1/exams/import'){imports++;return commit?commit():{imported:1};}if(path==='/v1/learning/alarms')return{alarms:[]};throw Error(path);}},'expo-router':{useFocusEffect:fn=>host.react.useEffect(()=>{blur=fn();return blur;},[fn]),router:{push(){}}},'expo-crypto':{randomUUID},'@expo/vector-icons':{Ionicons:'Ionicons'},'react-native':{Pressable:'Pressable',Text:'Text',View:'View'},'@/src/components/toolkit':{ToolPage:'ToolPage',ToolButton:'ToolButton',ToolField:'ToolField'},'@/src/auth/auth-context':{useAuth:()=>({user:{id:'11111111-1111-4111-8111-111111111111'}})},'@/src/lib/appearance':{useAppearance:()=>({theme})},'@/src/lib/uploads':{pickAttachment:async()=>null},'@/src/lib/alarms':{syncAlarms:async()=>true},'@/src/lib/device-cache':{writeCache:async(key,value)=>clears.push({key,value})},'@/src/components/toast':{useToast:()=>message=>notices.push(message)},'@/src/lib/use-owned-draft-restore':{useOwnedDraftRestore:()=>({ready:true,loading:false,error:'',retry(){}})},'@/src/lib/form-drafts':{},'@/src/lib/request-policy':{cacheScopeForUser:()=> 'verified-scope'},'@/src/components/draft-recovery':{DraftRecovery:'DraftRecovery'},'@/src/lib/use-owned-draft-save':{useOwnedDraftSave:()=>({warning:'',begin(){},discard(){},persist:async value=>{saves.push(value);await persist(value);}})}};
  const exports={},source=ts.transpileModule(readFileSync(new URL('../mobile/app/exam-timetable.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  runInNewContext(source,{exports,module:{exports},require:key=>{if(key in modules)return modules[key];throw Error(key);},Error,AbortController,setTimeout:time.schedule,clearTimeout:time.cancel});
  const render=()=>host.render(()=>{let node=exports.default();while(typeof node.type==='function')node=node.type(node.props);tree=node;return tree;});
  const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
  const by=(type,label)=>nodes(tree).find(node=>node.type===type&&(label===undefined||node.props.label===label));
  async function paper(){await time.advance(0);render();by('ToolButton','Upload exam timetable').props.onPress();render();by('ToolButton','Add a paper manually').props.onPress();render();for(const[label,value]of [['Course title','Calculus'],['Date · YYYY-MM-DD','2026-11-05'],['Start · 24h','09:00'],['End · 24h','11:00']])by('ToolField',label).props.onChangeText(value);render();}
  render();return{render,paper,by,time,notices,clears,saves,imports:()=>imports,blur:()=>blur?.(),host};
}
test('a storage failure keeps reviewed exam input editable without committing or clearing it',async()=>{
  const h=examHarness({persist:async()=>{throw Error('Device storage full');}});await h.paper();await h.by('ToolButton','Save exam timetable').props.onPress();await h.time.advance(0);h.render();
  assert.equal(h.imports(),0);assert.equal(h.clears.length,0);assert.equal(h.by('ToolField','Course title').props.value,'Calculus');assert.equal(h.by('ToolField','Course title').props.editable,true);assert.equal(h.by('ToolPage').props.status.props.stage,'failed');h.host.unmount();
});
test('duplicate exam taps share one commit and a failed post-save refresh does not turn the confirmed import into failure',async()=>{
  let finish;const h=examHarness({commit:()=>new Promise(resolve=>{finish=resolve;}),scheduleFails:true});await h.paper();const button=h.by('ToolButton','Save exam timetable');button.props.onPress();button.props.onPress();await h.time.advance(0);assert.equal(h.imports(),1);finish({imported:1});await h.time.advance(0);h.render();
  assert.equal(h.clears.length,1);assert.equal(h.clears[0].value,null);assert.equal(h.by('ToolPage').props.status.props.stage,'completed');assert.ok(h.by('ToolButton','Retry saved exams'));assert.ok(h.notices.includes('1 exam papers saved'));h.host.unmount();
});
test('a commit result received after leaving the screen cannot clear drafts or publish success',async()=>{
  let finish;const h=examHarness({commit:()=>new Promise(resolve=>{finish=resolve;})});await h.paper();h.by('ToolButton','Save exam timetable').props.onPress();await h.time.advance(0);assert.equal(h.imports(),1);h.blur();finish({imported:1});await h.time.advance(0);assert.equal(h.clears.length,0);assert.equal(h.notices.length,0);h.host.unmount();
});
