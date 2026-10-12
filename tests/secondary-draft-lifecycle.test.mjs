import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {hookRenderer,virtualClock} from './helpers/hook-renderer.mjs';
const ts=createRequire(new URL('../server/package.json',import.meta.url))('typescript');
const account='11111111-1111-4111-8111-111111111111',post='22222222-2222-4222-8222-222222222222',media='33333333-3333-4333-8333-333333333333';
function load(relative,modules,globals={}) {
  const exports={},code=ts.transpileModule(readFileSync(new URL('../mobile/'+relative,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  runInNewContext(code,{exports,module:{exports},require:key=>{if(key in modules)return modules[key];throw Error('Missing '+key);},Date,Error,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,process:{env:{}},...globals});return exports;
}
const fields=load('src/lib/draft-fields.ts',{}),photos=load('src/lib/listing-photos.ts',{'./draft-fields':fields}),forms=load('src/lib/form-drafts.ts',{'./draft-fields':fields,'./listing-photos':photos});
const policy=load('src/lib/request-policy.ts',{});
function harness(screen,{initialDraft,readFails=false,persistFails=false,commit,upload,refreshFails=false,params={},calendarRows=[]}={}) {
  const host=hookRenderer(),time=virtualClock(),records=new Map(),writes=[],clears=[],requests=[],routes=[];let tree,reads=0,uploads=0;
  const key=screen==='academic-calendar'?'calendar-local.'+account:screen==='ai'?'ai-workspace-v3.'+account+'.ask':screen==='publishing-create'?'publisher-draft.v2.'+account:'answer-draft.'+account+'.'+post;
  if(initialDraft)records.set(key,initialDraft);
  const device={getDeviceCacheRevision:()=>1,readOwnedDraft:async key=>{if(readFails)throw Error('The encrypted draft could not be read. Its saved copy has been kept.');return records.get(key)??null;},saveOwnedDraft:async(key,value)=>{writes.push({key,value});records.set(key,value);if(persistFails)throw Error('Device storage full. Keep this screen open.');return'device';},writeCache:async(key,value)=>{records.set(key,value);if(screen==='academic-calendar'){writes.push({key,value});if(persistFails)throw Error('Device storage full. Keep this screen open.');}if(value===null)clears.push(key);}};
  const hookModules={'react':host.react,'./device-cache':device,'./request-policy':policy};
  const globals={setTimeout:time.schedule,clearTimeout:time.cancel,setInterval:time.schedule,clearInterval:time.cancel};
  const restore=load('src/lib/use-owned-draft-restore.ts',hookModules,globals),save=load('src/lib/use-owned-draft-save.ts',hookModules,globals);
  const theme={text:'#29231F',textMuted:'#9A8D84',deepBrand:'#A8462E',brand:'#A8462E',error:'#A8462E',font:{body:'Inter',semibold:'Inter',display:'Lato'}};
  class ApiError extends Error {}
  const api=async(path,init)=>{
    if(path==='/v1/student/publishing/capabilities')return{formats:['POLL','QA','ANONYMOUS_QA']};
    if(path==='/v1/ai/status')return{enabled:true,tier:'standard',capabilities:{text:true,images:true,documents:true},study:{limit:3,remaining:3},subscription:{checkoutEnabled:false}};
    if(init?.method==='POST') {requests.push({path,body:JSON.parse(init.body),signal:init.signal});return commit?commit(requests.at(-1),requests.length,ApiError):screen==='ai'?{requestId:requests.at(-1).body.idempotencyKey,text:'A retained answer'}:{id:post,status:'PENDING'};}
    reads++;if(refreshFails&&reads>1)throw Error('Refresh unavailable; try again.');
    if(screen==='academic-calendar')return{events:calendarRows};
    return{post:{id:post,format:'QA',body:'Campus question',is_owner:false,closes_at:null},answers:[],options:[]};
  };
  const router={replace:value=>routes.push(value),push(){},canGoBack:()=>true,back(){}};
  const modules={
    'react':host.react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'Fragment'},
    'react-native':{Pressable:'Pressable',Text:'Text',View:'View',TextInput:'TextInput',KeyboardAvoidingView:'KeyboardAvoidingView',Image:'Image',Platform:{OS:'android'},StyleSheet:{create:value=>value,hairlineWidth:1},Linking:{openURL:async()=>true}},
    'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Ionicons'},'expo-crypto':{randomUUID},'expo-router':{router,useLocalSearchParams:()=>({id:post,...params}),useFocusEffect:fn=>host.react.useEffect(fn,[fn])},
    '@/src/auth/auth-context':{useAuth:()=>({user:{id:account,universityId:'A',roles:['STUDENT'],operatorRoles:[]},profile:{first_name:'Student'}})},
    '@/src/lib/appearance':{useAppearance:()=>({theme}),useThemeStyles:()=>({theme,styles:new Proxy({},{get:()=>({})})})},
    '@/src/lib/api':{api,ApiError,clearApiCache(){}},'@/src/lib/screen-read':{refreshScreenRead:async(path,apply)=>{const result=await api(path);apply(result);return result;}},'@/src/lib/private-cache-migration':{readMigratedPrivateCache:async(_legacy,key)=>device.readOwnedDraft(key)},'@/src/lib/calendar-recovery':load('src/lib/calendar-recovery.ts',{}),'@/src/components/academic-import-usage':{AcademicImportUsage:'AcademicImportUsage'},'@/src/components/bulk-selection':{useBulkSelection:()=>({}),BulkMenu:'BulkMenu',BulkToolbar:'BulkToolbar',SelectionCheckbox:'SelectionCheckbox'},'@/src/lib/device-cache':device,'@/src/lib/request-policy':{cacheScopeForUser:()=> 'verified-scope'},
    '@/src/lib/use-owned-draft-restore':restore,'@/src/lib/use-owned-draft-save':save,'@/src/lib/form-drafts':forms,
    '@/src/components/draft-recovery':{DraftRecovery:'DraftRecovery'},'@/src/components/toolkit':{ToolPage:'ToolPage',ToolButton:'ToolButton',ToolField:'ToolField'},'@/src/components/skeleton':{ScreenSkeleton:'ScreenSkeleton',SkeletonBlock:'SkeletonBlock',ListSkeleton:'ListSkeleton'},
    '@/src/components/product-ui':{EmptyResult:'EmptyResult'},'@/src/components/keyboard-viewport':{KeyboardScrollView:'ScrollView',KeyboardModal:'Modal'},
    '@/src/lib/use-active-screen':{useActiveScreen:()=>true},'@/src/lib/digital-billing-policy':{isPlayDistribution:()=>false},'@/src/lib/shared-links':{},'@/src/lib/share-content':{},'expo-clipboard':{},
    '@/src/components/kira-voice-input':{KiraVoiceInput:'KiraVoiceInput'},'@/src/components/import-progress':{ImportProgress:'ImportProgress',useImportProgress:()=>{const[stage,setStage]=host.react.useState(null);return{stage,setStage,failureStage:'uploading'};}},
    '@/src/components/attachment-preview':{AttachmentPreview:'AttachmentPreview'},'@/src/components/study-answer':{StudyAnswer:'StudyAnswer'},'@/src/components/ai-edge-glow':{AIEdgeGlow:'AIEdgeGlow'},'@/src/components/toast':{useToast:()=>()=>{}},'@/src/lib/alarms':{},
    '@/src/lib/kira-request':{requestKiraResult:async args=>args.submit()},
    '@/src/lib/uploads':{pickAndUpload:async()=>null,pickAttachment:async()=>({name:'Lecture.pdf',type:'application/pdf',size:18*1024*1024,uri:'file://private-lecture.pdf'}),uploadAttachment:async(...args)=>{uploads++;return upload?upload(...args):{...args[0],mediaId:media};}},
  };
  const component=load('app/'+screen+'.tsx',modules,globals).default;
  const render=()=>host.render(()=>{let node=component();while(typeof node.type==='function')node=node.type(node.props);tree=node;return node;});
  const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
  const by=(type,label)=>nodes(tree).find(node=>node.type===type&&(label===undefined||node.props.label===label||node.props.accessibilityLabel===label));
  async function settle(delay=0){await time.advance(delay);for(let i=0;i<3;i++){render();await time.advance(0);}}
  function pressText(label){const button=nodes(tree).find(node=>node.type==='Pressable'&&nodes(node.props.children).some(child=>child.type==='Text'&&child.props.children===label));assert.ok(button,'Missing button '+label);button.props.onPress();}
  async function edit(value='My work'){
    if(screen==='publishing-create')by('TextInput','Poll title').props.onChangeText(value);
    else if(screen==='publishing-post')by('ToolField','Your answer').props.onChangeText(value);
    else if(screen==='academic-calendar')by('ToolField','Title').props.onChangeText(value);
    else by('TextInput','Message Kira').props.onChangeText(value);
    await settle();
  }
  function submit(){
    if(screen==='academic-calendar')pressText('Add to calendar');
    else if(screen==='publishing-create')by('Pressable','Publish').props.onPress();
    else if(screen==='publishing-post'){
      const consent=nodes(tree).find(node=>node.props?.accessibilityRole==='checkbox');
      if(!consent.props.accessibilityState.checked&&!consent.props.disabled){consent.props.onPress();render();}
      by('ToolButton','Send private answer').props.onPress();
    }else by('KiraVoiceInput').props.onSend();
  }
  render();return{host,time,render,settle,edit,submit,by,records,writes,clears,requests,routes,key,pressText,all:()=>nodes(tree),uploads:()=>uploads};
}
test('unreadable publishing and Kira drafts stay locked without empty autosaves or submit requests',async()=>{
  for(const screen of ['publishing-create','publishing-post','ai']){
    const h=harness(screen,{readFails:true});await h.settle(500);
    assert.match(h.by('DraftRecovery').props.error,/saved copy has been kept/);assert.equal(h.writes.length,0);assert.equal(h.requests.length,0);
    if(screen==='publishing-create')assert.equal(h.by('Pressable','Publish').props.disabled,true);
    else if(screen==='publishing-post')assert.equal(h.by('ToolField','Your answer').props.editable,false);
    else assert.equal(h.by('TextInput','Message Kira').props.editable,false);
    h.host.unmount();
  }
});
async function poll(h) {await h.settle();await h.edit('Which study room?');for(const[label,value]of [['Poll option 1','Library'],['Poll option 2','Department']])h.by('TextInput',label).props.onChangeText(value);await h.settle();}
test('publishing storage failure keeps the edited poll and sends no create request',async()=>{
  const h=harness('publishing-create',{persistFails:true});await poll(h);h.submit();await h.settle();
  assert.equal(h.requests.length,0);assert.equal(h.clears.length,0);assert.equal(h.by('TextInput','Poll title').props.value,'Which study room?');assert.equal(h.by('TextInput','Poll title').props.editable,true);h.host.unmount();
});
test('a failed poll submit retains its exact request and closing date while duplicate retry taps send one request',async()=>{
  let finish;const h=harness('publishing-create',{commit:(_request,n)=>n===1?Promise.reject(Error('Network interrupted')):new Promise(resolve=>{finish=resolve;})});
  await poll(h);h.submit();await h.settle();h.submit();h.submit();await h.settle();assert.equal(h.requests.length,2);
  assert.equal(h.requests[0].body.requestId,h.requests[1].body.requestId);assert.equal(h.requests[0].body.closesAt,h.requests[1].body.closesAt);
  finish({id:post});await h.settle(500);assert.equal(h.records.get(h.key),null);assert.equal(h.routes.length,1);h.host.unmount();
});
test('a poll receipt after leaving cannot clear a saved draft or navigate the next session',async()=>{
  let finish;const h=harness('publishing-create',{commit:()=>new Promise(resolve=>{finish=resolve;})});await poll(h);h.submit();await h.settle();h.host.unmount();finish({id:post});await h.time.advance(0);assert.equal(h.clears.length,0);assert.equal(h.routes.length,0);
});
test('private answer storage failure retains text and fresh consent without posting',async()=>{
  const h=harness('publishing-post',{persistFails:true});await h.settle();await h.edit('My private answer');
  h.submit();await h.settle();assert.equal(h.requests.length,0);assert.equal(h.by('ToolField','Your answer').props.value,'My private answer');assert.equal(h.by('ToolField','Your answer').props.editable,true);h.host.unmount();
});
test('a confirmed private answer clears once, survives refresh failure, and permits a new draft',async()=>{
  const h=harness('publishing-post',{refreshFails:true});await h.settle();await h.edit('Private response');h.submit();h.submit();await h.settle(500);
  assert.equal(h.requests.length,1);assert.equal(h.clears.length,1);assert.equal(h.records.get(h.key),null);assert.equal(h.by('ToolField','Your answer').props.value,'');
  await h.edit('Another answer');await h.settle(400);assert.equal(h.records.get(h.key).body,'Another answer');assert.notEqual(h.requests[0].body.requestId,h.records.get(h.key).requestId);h.host.unmount();
});
test('an answer receipt after unmount does not clear primary work',async()=>{
  let finish;const h=harness('publishing-post',{commit:()=>new Promise(resolve=>{finish=resolve;})});await h.settle();await h.edit();h.submit();await h.settle();h.host.unmount();finish({status:'PENDING'});await h.time.advance(0);assert.equal(h.clears.length,0);
});
test('Kira refuses submission on save failure and retains the visible question',async()=>{
  const h=harness('ai',{persistFails:true});await h.settle();await h.edit('Explain my lecture');h.submit();await h.settle();
  assert.equal(h.requests.length,0);assert.equal(h.by('TextInput','Message Kira').props.value,'Explain my lecture');assert.equal(h.by('TextInput','Message Kira').props.editable,true);h.host.unmount();
});
test('an uploaded Kira file survives extraction failure without persisting signed URLs or local bytes',async()=>{
  const h=harness('ai',{upload:async(file,_user,_prompt,_tier,_progress,options)=>{options.onUploaded({...file,mediaId:media,sourceText:'Private extracted bytes'});throw Error('Extraction unavailable');}});
  await h.settle();await h.edit('Explain the lecture');h.by('KiraVoiceInput').props.onAttach();await h.settle();h.submit();await h.settle(400);
  assert.equal(h.requests.length,0);const saved=h.records.get(h.key);assert.equal(saved.prompt,'Explain the lecture');assert.equal(saved.attachment.mediaId,media);assert.equal(saved.attachment.uri,undefined);assert.equal(saved.attachment.sourceText,undefined);assert.ok(h.by('AttachmentPreview'));h.host.unmount();
});
test('a completed Kira request cannot resurrect its old draft and the next typed question autosaves',async()=>{
  const h=harness('ai');await h.settle();await h.edit('First question');h.submit();h.submit();await h.settle(500);
  assert.equal(h.requests.length,1);assert.equal(h.records.get(h.key),null);assert.ok(h.by('StudyAnswer'));await h.edit('Next question');await h.settle(400);assert.equal(h.records.get(h.key).prompt,'Next question');h.host.unmount();
});
test('leaving Kira aborts its request and ignores the late answer without erasing the draft',async()=>{
  let finish;const h=harness('ai',{commit:()=>new Promise(resolve=>{finish=resolve;})});await h.settle();await h.edit();h.submit();await h.settle();h.host.unmount();assert.equal(h.requests[0].signal.aborted,true);finish({requestId:h.requests[0].body.idempotencyKey,text:'Late'});await h.time.advance(0);assert.equal(h.clears.length,0);
});
test('Kira restores existing work ahead of a link question and never trusts a cached Pro plan',async()=>{
  const h=harness('ai',{initialDraft:{prompt:'Existing draft',mode:'study',tier:'pro',key:post},params:{question:'Question from a link'}});await h.settle();assert.equal(h.by('TextInput','Message Kira').props.value,'Existing draft');await h.settle(400);assert.equal(h.records.get(h.key).tier,'standard');h.host.unmount();
});
test('a recovered Kira manual retry keeps the original thread and request identity after a failed response',async()=>{
  const h=harness('ai',{initialDraft:{prompt:'Follow-up question',mode:'study',tier:'standard',key:post,pending:true,replyTo:media},commit:()=>Promise.reject(Error('Network interrupted'))});
  await h.settle();h.submit();await h.settle(400);assert.equal(h.requests[0].body.idempotencyKey,post);assert.equal(h.requests[0].body.replyTo,media);assert.equal(h.records.get(h.key).pending,true);assert.equal(h.records.get(h.key).replyTo,media);
  await h.edit('A changed question');await h.settle(400);assert.notEqual(h.records.get(h.key).key,post);assert.equal(h.records.get(h.key).pending,undefined);h.host.unmount();
});
test('ordinary Kira composer recovery starts fresh even if obsolete thread metadata is present',async()=>{
  const h=harness('ai',{initialDraft:{prompt:'Unsubmitted question',mode:'study',tier:'standard',key:post,replyTo:media}});await h.settle();h.submit();await h.settle();assert.equal(h.requests[0].body.replyTo,undefined);h.host.unmount();
});
test('secondary draft decoders preserve IDs and partial input while rejecting malformed shapes',()=>{
  const publisher=forms.restorePublisherDraft({format:'POLL',anonymousPoll:true,body:'My question',options:['','unfinished'],hours:'24',requestId:post});assert.equal(publisher.requestId,post);assert.equal(publisher.options[0],'');
  assert.equal(forms.restoreAnswerDraft({body:'Draft',requestId:post}).body,'Draft');
  const kira=forms.restoreKiraDraft({prompt:'Lecture',mode:'summary',tier:'pro',key:post,attachment:{name:'Lecture.pdf',type:'application/pdf',mediaId:media,uri:'https://private.invalid/signed',sourceText:'Secret'}});assert.equal(kira.attachment.mediaId,media);assert.equal(kira.attachment.uri,undefined);assert.equal(kira.attachment.sourceText,undefined);
  for(const[parse,value]of [[forms.restorePublisherDraft,{format:'POLL',anonymousPoll:true,body:'',options:[1,2],hours:'24'}],[forms.restorePublisherDraft,{format:'POLL',anonymousPoll:true,options:['a','b'],hours:'9999'}],[forms.restoreAnswerDraft,{body:42}],[forms.restoreKiraDraft,{prompt:'Draft',mode:'admin',tier:'pro'}]])assert.throws(()=>parse(value));
});
const calendarEvent={id:media,title:'Saved semester date',starts_on:'2026-11-05',ends_on:'2026-11-05',semester:'First semester'};
async function personalDate(h){await h.settle();h.by('Pressable','Add a date').props.onPress();await h.settle();await h.edit('Project defence');h.by('ToolField','Start date').props.onChangeText('2026-11-05');await h.settle();}
test('unreadable personal calendar storage keeps server dates visible and blocks all replacement writes',async()=>{
  const h=harness('academic-calendar',{readFails:true,calendarRows:[calendarEvent]});await h.settle(500);
  assert.match(h.by('DraftRecovery').props.error,/saved copy has been kept/);assert.equal(h.by('Pressable','Add a date').props.disabled,true);assert.equal(h.by('ToolPage').props.action,null);assert.equal(h.writes.length,0);assert.ok(h.all().some(node=>node.type==='Text'&&node.props.children===calendarEvent.title));h.host.unmount();
});
test('malformed personal date arrays are rejected as a whole without replacing their saved copy',async()=>{
  assert.throws(()=>forms.restorePersonalCalendar(JSON.stringify([{...calendarEvent,id:'../account'}])));
  assert.throws(()=>forms.restorePersonalCalendar(JSON.stringify([calendarEvent,calendarEvent])));
  const raw=JSON.stringify([calendarEvent,null]),h=harness('academic-calendar',{initialDraft:raw});await h.settle(500);assert.match(h.by('DraftRecovery').props.error,/saved copy has been kept/);assert.equal(h.records.get(h.key),raw);assert.equal(h.writes.length,0);h.host.unmount();
});
test('a confirmed calendar save remains successful when its device-copy update fails and duplicate taps commit once',async()=>{
  const h=harness('academic-calendar',{persistFails:true,commit:async()=>({event:{...calendarEvent,title:'Project defence'}})});await personalDate(h);h.submit();h.submit();await h.settle();
  assert.equal(h.requests.length,1);assert.equal(h.by('ToolField','Title'),undefined);assert.ok(h.by('ToolButton','Retry saving device copy'));assert.ok(h.all().some(node=>node.type==='Text'&&String(node.props.children).includes('saved online')));assert.ok(h.all().some(node=>node.type==='Text'&&node.props.children==='Project defence'));h.host.unmount();
});
test('offline personal-date storage failure retains the editable date and the original retry ID',async()=>{
  const h=harness('academic-calendar',{persistFails:true,commit:async(_request,_count,ApiError)=>{const error=new ApiError('Offline');error.code='NETWORK_UNAVAILABLE';throw error;}});await personalDate(h);h.submit();await h.settle();h.submit();await h.settle();
  assert.equal(h.by('ToolField','Title').props.value,'Project defence');assert.equal(h.by('ToolField','Title').props.editable,true);assert.equal(h.requests[0].body.requestId,h.requests[1].body.requestId);assert.equal(h.by('ToolButton','Retry saving device copy'),undefined);h.host.unmount();
});
test('calendar receipts after leaving cannot change the saved personal-date copy',async()=>{
  let finish;const h=harness('academic-calendar',{commit:()=>new Promise(resolve=>{finish=resolve;})});await personalDate(h);h.submit();await h.settle();h.host.unmount();finish({event:calendarEvent});await h.time.advance(0);assert.equal(h.writes.length,0);
});
