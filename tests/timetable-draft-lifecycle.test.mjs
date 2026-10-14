import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { hookRenderer, virtualClock } from './helpers/hook-renderer.mjs';
const ts = createRequire(new URL('../server/package.json', import.meta.url))('typescript');
class ApiError extends Error { constructor(status,code,message,details) {super(message);Object.assign(this,{status,code,details});} }
const entry = {title:'MTH201',courseCode:'MTH201',dayOfWeek:1,startsAt:'08:00',endsAt:'10:00',venue:'',lecturer:'',reminderMinutes:15,reminderEnabled:true};
function harness({result=async()=>({documentType:'class_timetable',entries:[entry],warnings:[]})}={}) {
  const host=hookRenderer(),time=virtualClock(),calls=[],saves=[];let tree,profile={level_code:'200'};
  const theme={font:{body:'Inter',semibold:'Inter',displayStrong:'Lato'},text:'#29231F',textMuted:'#9A8D84',deepBrand:'#A8462E',error:'#A8462E'};
  const modules={
    'react':host.react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'Fragment'},
    'expo-router':{useLocalSearchParams:()=>({}),router:{replace(){}}},'expo-crypto':{randomUUID},
    'react-native':{Image:'Image',Pressable:'Pressable',Text:'Text',View:'View'},'@expo/vector-icons':{Ionicons:'Ionicons'},
    '@/src/components/toolkit':{ToolPage:'ToolPage',ToolButton:'ToolButton',ToolField:'ToolField'},
    '@/src/auth/auth-context':{useAuth:()=>({user:{id:'11111111-1111-4111-8111-111111111111'},profile})},
    '@/src/lib/appearance':{useAppearance:()=>({theme})},'@/src/components/toast':{useToast:()=>()=>{}},
    '@/src/lib/api':{ApiError,api:async(path,init)=>{const body=JSON.parse(init.body);calls.push({path,body});return result(path,body);}},
    '@/src/lib/uploads':{pickAttachment:async()=>null,uploadAttachment:async file=>file},
    '@/src/lib/device-cache':{writeCache:async()=>{}},'@/src/lib/request-policy':{cacheScopeForUser:()=> 'verified-scope'},
    '@/src/components/academic-import-usage':{AcademicImportUsage:'AcademicImportUsage'},
    '@/src/components/import-progress':{ImportProgress:'ImportProgress',useImportProgress:()=>{const[stage,setStage]=host.react.useState(null);return{stage,setStage,failureStage:null};}},
    '@/src/components/draft-recovery':{DraftRecovery:'DraftRecovery'},'@/src/lib/form-drafts':{},
    '@/src/lib/use-owned-draft-restore':{useOwnedDraftRestore:()=>({ready:true,loading:false,error:'',retry(){}})},
    '@/src/lib/use-owned-draft-save':{useOwnedDraftSave:()=>({warning:'',discard(){},persist:async value=>saves.push(value)})},
    '@/src/lib/alarms':{syncAlarms:async()=>true},
  };
  const exports={},source=ts.transpileModule(readFileSync(new URL('../mobile/app/timetable-import.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  runInNewContext(source,{exports,module:{exports},require:key=>{if(key in modules)return modules[key];throw Error(key);},Error,AbortController});
  const render=()=>host.render(()=>{let node=exports.default();while(typeof node.type==='function')node=node.type(node.props);tree=node;return tree;});
  const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
  const by=(type,label)=>nodes(tree).find(node=>node.type===type&&(label===undefined||node.props.label===label));
  const field=(label,value)=>{by('ToolField',label).props.onChangeText(value);render();};
  render();render();field('Timetable text','Monday MTH201 08:00–10:00');
  return{render,by,field,time,calls,saves,host,setProfile:value=>{profile=value;render();}};
}
test('a failed re-scan clears stale review data, persists the fresh retry key and reuses that key on retry',async()=>{
  let attempts=0;const h=harness({result:async()=>{if(++attempts===2)throw new ApiError(422,'BAD_REQUEST','Incomplete scan',{retryWithNewKey:true,reason:'AI_INCOMPLETE_SCHEDULE'});return{documentType:'class_timetable',entries:[entry],warnings:[]};}});
  h.by('ToolButton','Read timetable').props.onPress();await h.time.advance(0);h.render();assert.ok(h.by('ToolButton','Save reviewed classes'));
  h.by('ToolButton','Read timetable').props.onPress();await h.time.advance(0);h.render();
  assert.equal(h.by('ToolButton','Save reviewed classes'),undefined);assert.equal(h.by('ToolField','Timetable text').props.value,'Monday MTH201 08:00–10:00');
  const retry=h.saves.at(-1).key;assert.notEqual(retry,h.calls[1].body.idempotencyKey);assert.equal(h.saves.at(-1).entries.length,0);
  h.by('ToolButton','Read timetable').props.onPress();await h.time.advance(0);h.render();assert.equal(h.calls[2].body.idempotencyKey,retry);assert.ok(h.by('ToolButton','Save reviewed classes'));h.host.unmount();
});
test('duplicate read taps submit once and explicit level/course selection survives in the draft and request',async()=>{
  const h=harness();h.field('Level to import','100');h.field('Courses (optional, separated by commas)','GET201, ECP281');
  const button=h.by('ToolButton','Read timetable');button.props.onPress();button.props.onPress();await h.time.advance(0);h.render();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.scheduleLevel,'100');assert.deepEqual(Array.from(h.calls[0].body.courseCodes),['GET201','ECP281']);
  assert.equal(h.saves.at(-1).scheduleLevel,'100');assert.equal(h.saves.at(-1).courseCodes,'GET201, ECP281');
  h.field('Level to import','200');assert.equal(h.by('ToolButton','Save reviewed classes'),undefined);h.host.unmount();
});
test('a later profile read displays its default without mutating a submitted draft or dropping explicit fields on schema failure',async()=>{
  const h=harness({result:async()=>{throw new ApiError(400,'BAD_REQUEST','Check the highlighted information and try again.');}});
  h.by('ToolButton','Read timetable').props.onPress();await h.time.advance(0);h.render();const key=h.calls[0].body.idempotencyKey;
  h.setProfile({level_code:'300'});assert.equal(h.by('ToolField','Level to import').props.value,'300');
  h.by('ToolButton','Read timetable').props.onPress();await h.time.advance(0);assert.equal(h.calls[1].body.idempotencyKey,key);assert.equal(h.calls[1].body.scheduleLevel,undefined);assert.equal(h.calls.length,2);h.host.unmount();
});
