import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { typescript as ts } from './helpers/typescript.mjs';
import { hookRenderer, virtualClock } from './helpers/hook-renderer.mjs';
function load(path,mocks,globals={}){const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,module:{exports},require:name=>{if(name in mocks)return mocks[name];if(name.includes('/assets/'))return 1;throw Error('Missing '+name);},URLSearchParams,AbortController,Date,Intl,setTimeout,clearTimeout,...globals});return exports;}
const paging=load('mobile/src/lib/pagination.ts',{});
const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'Fragment'};
const theme=new Proxy({font:new Proxy({},{get:(_t,k)=>k}),motion:{screen:0}},{get:(target,k)=>target[k]??'#A8462E'});
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes([value.props?.children,value.props?.ListHeaderComponent,value.props?.ListFooterComponent])]:[];
test('numbered pagination has a selected brand surface, labelled boundaries, and no redundant single-page control',()=>{
 const clicks=[],{Pagination}=load('mobile/src/components/pagination.tsx',{'react/jsx-runtime':jsx,'react-native':{Pressable:'Pressable',Text:'Text',View:'View',useWindowDimensions:()=>({width:390})},'@expo/vector-icons':{Ionicons:'Icon'},'@/src/lib/appearance':{useAppearance:()=>({theme})},'@/src/lib/pagination':paging});
 assert.equal(Pagination({page:1,pageSize:24,total:24,totalPages:1,onChange:()=>{}}),null);
 const render=(page,disabled=false)=>nodes(Pagination({page,pageSize:24,total:2400,totalPages:100,label:'Products',disabled,onChange:n=>clicks.push(n)}));
 const first=render(1),selected=first.find(n=>n.props?.accessibilityLabel==='Products page 1');assert.equal(selected.props.accessibilityState.selected,true);assert.equal(selected.props.style({pressed:false})[1].backgroundColor,theme.deepBrand);
 assert.equal(first.find(n=>n.props?.accessibilityLabel==='Previous products page').props.disabled,true);first.find(n=>n.props?.accessibilityLabel==='Next products page').props.onPress();assert.deepEqual(clicks,[2]);
 const middle=render(50);assert.equal(middle.filter(n=>n.type==='Pressable').length<=7,true);assert.ok(middle.find(n=>n.props?.accessibilityLabel==='Products page 100'));assert.equal(render(100).find(n=>n.props?.accessibilityLabel==='Next products page').props.disabled,true);
 render(50,true).find(n=>n.props?.accessibilityLabel==='Products page 100').props.onPress();assert.deepEqual(clicks,[2]);
});
function tutorialFixture(){
 const host=hookRenderer(),clock=virtualClock(),reads=[];let tree;
 const materials=Array.from({length:61},(_,n)=>({id:'resource-'+n,title:'Study material '+(n+1),publisher_name:'Ada Tutor',course_code:'GET205',description:'Fluid mechanics',resource_type:n%2?'PDF':'VIDEO',access_model:'FREE',price_kobo:0,subject:'Engineering'}));
 const sessions=Array.from({length:8},(_,n)=>({id:'listing-'+n,title:'Session '+n,description:'Fluid mechanics',tutor_name:'Ada Tutor',course_code:'GET205',format:'IN_PERSON',price_kobo:0,capacity:5,availability:[]}));
 const api=async path=>{reads.push(path);const url=new URL(path,'https://fixture.invalid'),params=url.searchParams,page=Number(params.get('page')),category=params.get('category'),type=params.get('resourceType'),term=params.get('q')??'';const r=category==='Tutors'?[]:materials.filter(r=>(!type||r.resource_type===type)&&(!term||r.title.toLowerCase().includes(term)));const l=category==='All'||category==='Tutors'?sessions.filter(l=>!term||l.title.toLowerCase().includes(term)):[];const combined=[...r.map(item=>({item,type:'resource'})),...l.map(item=>({item,type:'listing'}))],slice=combined.slice((page-1)*30,page*30);return{resources:slice.filter(i=>i.type==='resource').map(i=>i.item),listings:slice.filter(i=>i.type==='listing').map(i=>i.item),subjects:['Engineering'],pagination:{page,pageSize:30,total:combined.length,totalPages:Math.max(1,Math.ceil(combined.length/30))}};};
 const modules={'react':host.react,'react/jsx-runtime':jsx,'react-native':{View:'View',Text:'Text',Pressable:'Pressable',FlatList:'FlatList',Image:'Image',ScrollView:'ScrollView',StyleSheet:{create:s=>s},Platform:{OS:'android'},useWindowDimensions:()=>({width:360}),AccessibilityInfo:{isReduceMotionEnabled:async()=>true,addEventListener:()=>({remove(){}})}},'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Icon'},'expo-router':{router:{setParams(){},push(){}},useLocalSearchParams:()=>({}),useFocusEffect:fn=>host.react.useEffect(fn,[fn])},'expo-crypto':{randomUUID:()=> 'synthetic'},'@/src/lib/appearance':{useThemeStyles:styles=>({theme,styles:styles(theme)})},'@/src/lib/pagination':paging,'@/src/lib/api':{api,ApiError:class extends Error{}},'@/src/lib/haptics':{},'@/src/lib/share-content':{},'@/src/lib/toast':{},'@/src/components/toast':{useToast:()=>()=>{}},'@/src/theme':{theme},'@/src/components/product-ui':{FilterRow:'FilterRow',SearchField:'SearchField'},'@/src/components/skeleton':{InlineLoading:'InlineLoading'},'../../../packages/contracts/src/learning-search':{matchesLearningSearch:(item,term)=>!term||(item.title+' '+item.description).toLowerCase().includes(term)}};
 for(const [file,name]of Object.entries({'pagination':'Pagination','learning-feed':'LearningFeed','tutor-directory':'TutorDirectory','search-loading':'SearchLoading','discount-code-field':'DiscountCodeField','create-action':'CreateAction'}))modules['@/src/components/'+file]={[name]:name};
 const Screen=load('mobile/app/(tabs)/tutorials.tsx',modules,{setTimeout:clock.schedule,clearTimeout:clock.cancel}).default;
 const render=()=>host.render(()=>tree=Screen()),all=()=>nodes(tree),by=type=>all().find(n=>n.type===type);
 const settle=async()=>{for(let i=0;i<5;i++){render();await clock.advance(0);}};
 render();return{all,by,render,settle,reads,clock,unmount:host.unmount};
}
test('tutorials share 30 items per page across materials and sessions and reset search/category to page one',async()=>{
 const h=tutorialFixture();await h.settle();assert.equal(h.by('LearningFeed').props.resources.length,30);assert.equal(h.by('FlatList').props.data.length,0);assert.equal(h.by('Pagination').props.total,69);
 h.by('Pagination').props.onChange(3);await h.settle();assert.equal(h.by('LearningFeed').props.resources.length,1);assert.equal(h.by('FlatList').props.data.length,8);
 const categories=h.all().find(n=>n.type==='FilterRow'&&n.props.items.includes('Videos'));categories.props.onSelect('Videos');await h.settle();assert.equal(h.by('Pagination').props.page,1);assert.equal(h.by('LearningFeed').props.resources.length,30);assert.equal(h.by('Pagination').props.total,31);
 h.by('Pagination').props.onChange(2);await h.settle();assert.equal(h.by('LearningFeed').props.resources.length,1);
 h.by('SearchField').props.onChangeText('Study material 61');h.render();await h.clock.advance(220);await h.settle();assert.equal(h.by('Pagination').props.page,1);assert.equal(h.by('LearningFeed').props.resources.length,1);assert.equal(h.by('Pagination').props.total,1);h.unmount();
});

test('lesson titles never expose raw storage keys and preserve readable course names',()=>{
 const {learningTitle}=load('mobile/src/lib/learning-title.ts',{});assert.equal(learningTitle('9b885811bf026a1490c70076c25997c9.mp4','Lesson 2'),'Lesson 2');assert.equal(learningTitle('GET205_fluid-mechanics_pdf'),'GET205 fluid mechanics');assert.equal(learningTitle('Hydrostatics - worked examples.pdf'),'Hydrostatics - worked examples');
});


test('protected learning links resolve the web proxy and only allow insecure HTTP on local development hosts',()=>{
 const {learningMediaUrl}=load('mobile/src/lib/learning-media-url.ts',{}, {URL});
 assert.equal(learningMediaUrl('/api/v1/media/file?access=private','https://mobile.kampusone.app'),'https://mobile.kampusone.app/api/v1/media/file?access=private');
 assert.equal(learningMediaUrl('https://media.example.invalid/file?access=private'),'https://media.example.invalid/file?access=private');
 assert.equal(learningMediaUrl('http://localhost:8787/v1/media/file?access=private','http://localhost:8100'),'http://localhost:8787/v1/media/file?access=private');
 assert.throws(()=>learningMediaUrl('http://localhost:8787/file'));
 assert.throws(()=>learningMediaUrl('http://localhost:8787/file','https://mobile.kampusone.app'));
 assert.throws(()=>learningMediaUrl('http://example.invalid/file','http://localhost:8100'));
});
