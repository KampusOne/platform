import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {hookRenderer,virtualClock} from './helpers/hook-renderer.mjs';
import {nairaToKobo} from '../mobile/src/lib/money-input.ts';
const ts=createRequire(new URL('../server/package.json',import.meta.url))('typescript');
const draftFieldsExports={},photoExports={};
runInNewContext(ts.transpileModule(readFileSync(new URL('../mobile/src/lib/draft-fields.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:draftFieldsExports,module:{exports:draftFieldsExports},URL,Error});
runInNewContext(ts.transpileModule(readFileSync(new URL('../mobile/src/lib/listing-photos.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:photoExports,module:{exports:photoExports},URL,Error,require:key=>{assert.equal(key,'./draft-fields');return draftFieldsExports;}});
const {listingPhotos}=photoExports;
const editorExports={};
runInNewContext(ts.transpileModule(readFileSync(new URL('../mobile/src/lib/listing-editor.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:editorExports,module:{exports:editorExports},require:key=>{assert.equal(key,'./listing-photos');return{listingPhotos};}});
function formHarness(api,{rates=async amount=>({ready:true,ruleId:'33333333-3333-4333-8333-333333333333',baseKobo:amount,platformKobo:0,processingEstimateKobo:0,customerEstimateKobo:amount,sellerCommissionKobo:0}),role='VENDOR',id,storedDraft,persist=async()=>{},photo=async()=>({url:'https://fixture.invalid/photo.jpg'}),restore={ready:true,error:'',loading:false,retry(){}}}={}) {
  const host=hookRenderer(),clock=virtualClock(),react=host.react;let tree;
  const callApi=(path,options)=>path.startsWith('/v1/agents/products/price-preview')?rates(Number(path.split('priceKobo=')[1]),options):api(path,options);
  const alerts=[];
  const theme={font:{body:'Inter',displayStrong:'Lato',semibold:'Inter'},surfaceTint:'#F1DFC8',surface:'#fff',text:'#29231F',textMuted:'#9A8D84',deepBrand:'#A8462E',error:'#A8462E'};
  const modules={'@/src/auth/auth-context':{useAuth:()=>({user:{id:'test-owner'}})},'@/src/lib/device-cache':{readCache:async()=>null,writeCache:async()=>{}},'react':react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'Fragment'},'expo-crypto':{randomUUID},'@expo/vector-icons':{Ionicons:'Ionicons'},'expo-router':{router:{back(){}},useLocalSearchParams:()=>({role})},'react-native':{Image:'Image',Pressable:'Pressable',Text:'Text',View:'View'},'@/src/lib/money-input':{nairaToKobo},'@/src/components/toolkit':{ToolPage:'ToolPage',ToolButton:'ToolButton',ToolField:'ToolField'},'@/src/components/toast':{useToast:()=>()=>{}},'@/src/lib/appearance':{useAppearance:()=>({theme})},'@/src/lib/api':{api:callApi},'@/src/lib/uploads':{pickAndUpload:async()=>({url:'https://fixture.invalid/photo.jpg'})}};
  modules['@/src/lib/use-owned-draft-save']={useOwnedDraftSave:()=>({warning:'',persist,discard(){}})};
  modules['expo-router'].useLocalSearchParams=()=>({role,id});
  modules['react-native'].Alert={alert:(...args)=>alerts.push(args)};
  modules['@/src/lib/listing-editor']=editorExports;
  modules['@/src/lib/use-owned-draft-restore']={useOwnedDraftRestore:(key,apply)=>{react.useEffect(()=>{if(storedDraft!==undefined)apply(storedDraft);},[key]);return restore;}};
  modules['@/src/lib/form-drafts']={restoreListingDraft:value=>value};
  modules['@/src/components/draft-recovery']={DraftRecovery:'DraftRecovery'};
  modules['@/src/components/retry-icon-button']={RetryIconButton:'RetryIconButton'};
  modules['@/src/components/media-image']={MediaImage:'MediaImage'};
  modules['@/src/components/image-viewer']={ImageViewer:'ImageViewer'};
  modules['@/src/lib/listing-photos']={moveListingPhoto:(photos,from,to)=>{const next=[...photos];next.splice(to,0,next.splice(from,1)[0]);return next;}};
  modules['@/src/lib/uploads']={pickAndUpload:photo};
  modules['@/src/lib/request-policy']={cacheScopeForUser:()=> 'synthetic-owner-scope'};
  const exports={};
  const code=ts.transpileModule(readFileSync(new URL('../mobile/app/agent-create.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  runInNewContext(code,{exports,module:{exports},require:key=>{if(key in modules)return modules[key];throw Error(key);},setTimeout:clock.schedule,clearTimeout:clock.cancel,AbortController,Error});
  function render(){return host.render(()=>{tree=exports.default();while(typeof tree.type==='function')tree=tree.type(tree.props);return tree;});}
  function nodes(value){if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=='object')return[];return[value,...nodes(value.props?.children)];}
  const by=(type,label)=>nodes(tree).find(n=>n.type===type&&(n.props.label===label||n.props.accessibilityLabel===label));
  const flush=async()=>{render();await clock.advance(300);await new Promise(setImmediate);render();};
  render();return{render,flush,by,clock,alerts,nodes:()=>nodes(tree)};
}
const editCategory={id:randomUUID(),name:'Books'};
function editableProduct(){return{id:randomUUID(),name:'Campus notebook',description:'A clean unused campus notebook.',category_id:editCategory.id,price_kobo:100000,stock_quantity:3,listing_revision:1,status:'PUBLISHED',image_url:'https://fixture.invalid/original.jpg',image_urls:['https://fixture.invalid/original.jpg'],preparation_minutes:90,package_weight_grams:400,package_length_cm:20,package_width_cm:15,package_height_cm:2,bicycle_delivery_eligible:true};}
test('seller edit loads the existing product, adds photos and updates without creating another listing',async()=>{
 const p=editableProduct();let updated,creates=0;
 const h=formHarness(async(path,init)=>{if(path==='/v1/agents/product-categories')return{categories:[editCategory]};if(path==='/v1/agents/products'){if(init?.method==='POST')creates++;return{products:[p]};}if(path==='/v1/agents/products/'+p.id){updated=JSON.parse(init.body);assert.equal(init.method,'PUT');return{id:p.id};}throw Error(path);},{id:p.id,photo:async()=>({url:'https://fixture.invalid/new.jpg'})});
 await h.flush();await h.flush();
 assert.equal(h.by('ToolField','Product name').props.value,p.name);
 assert.equal(h.by('ToolField','Price (₦)').props.value,'1000');
 h.by('ToolField','Product name').props.onChangeText('New notebook');
 await h.by('Pressable','Add product photo').props.onPress();await h.flush();
 await h.by('ToolButton','Save changes').props.onPress();await h.flush();
 assert.equal(creates,0);assert.equal(updated.expectedRevision,1);assert.equal(updated.name,'New notebook');
 assert.deepEqual(updated.imageUrls,[p.image_url,'https://fixture.invalid/new.jpg']);
 assert.equal(updated.preparationMinutes,90);assert.equal(updated.packageWeightGrams,400);assert.equal(updated.bicycleDeliveryEligible,true);
 assert.equal('stockQuantity' in updated,false);
});
test('a lost edit response is confirmed from owned current details without a second mutation',async()=>{
 let p=editableProduct(),writes=0;
 const h=formHarness(async(path,init)=>{if(path==='/v1/agents/product-categories')return{categories:[editCategory]};if(path==='/v1/agents/products')return{products:[p]};if(path==='/v1/agents/products/'+p.id){writes++;const d=JSON.parse(init.body);p={...p,name:d.name,price_kobo:d.priceKobo,image_urls:d.imageUrls,image_url:d.imageUrl,listing_revision:2};throw Error('Response lost');}throw Error(path);},{id:p.id});
 await h.flush();await h.flush();h.by('ToolField','Product name').props.onChangeText('Saved notebook');h.render();
 await h.by('ToolButton','Save changes').props.onPress();await h.flush();
 assert.equal(writes,1);assert.equal(h.by('ToolButton','Done').props.disabled,false);
 await h.by('ToolButton','Done').props.onPress();await h.flush();assert.equal(writes,1);
});
test('a stale seller edit preserves the draft and requires explicit reload before another write',async()=>{
 let p=editableProduct(),writes=0;
 const h=formHarness(async(path,init)=>{if(path==='/v1/agents/product-categories')return{categories:[editCategory]};if(path==='/v1/agents/products')return{products:[p]};if(path==='/v1/agents/products/'+p.id){writes++;p={...p,name:'Changed on another device',listing_revision:2};throw Object.assign(Error('Product changed'),{code:'CONFLICT'});}throw Error(path);},{id:p.id});
 await h.flush();await h.flush();h.by('ToolField','Product name').props.onChangeText('Unsaved change');h.render();
 await h.by('ToolButton','Save changes').props.onPress();await h.flush();
 assert.equal(writes,1);assert.equal(h.by('ToolField','Product name').props.value,'Unsaved change');assert.equal(h.by('ToolButton','Save changes').props.disabled,true);
 h.by('RetryIconButton','Reload current product').props.onPress();
 h.alerts.at(-1)[2].find(button=>button.text==='Reload').onPress();await h.flush();await h.flush();
 assert.equal(h.by('ToolField','Product name').props.value,p.name);assert.equal(h.by('ToolButton','Save changes').props.disabled,false);
});
test('editing an unavailable product never falls back to creating a listing',async()=>{
 let writes=0;
 const h=formHarness(async(path,init)=>{if(init?.method==='POST'||init?.method==='PUT')writes++;return path==='/v1/agents/product-categories'?{categories:[editCategory]}:{products:[]};},{id:randomUUID()});
 await h.flush();await h.flush();assert.equal(h.by('ToolButton','Save changes').props.disabled,true);assert.ok(h.by('RetryIconButton','Retry loading product'));assert.equal(writes,0);
});
test('a failed category read is visible and retry restores a completed product form without discarding its input or photos',async()=>{
  let reads=0,created;
  const category={id:randomUUID(),name:'Stationery'};
  const h=formHarness(async(path,init)=>{
    if(path==='/v1/agents/product-categories'){if(++reads===1)throw Error('KampusOne took too long to respond.');return{categories:[category]};}
    if(path==='/v1/agents/products'){created=JSON.parse(init.body);return{id:randomUUID()};}
    return null;
  });
  await h.flush();assert.ok(h.by('RetryIconButton','Retry product categories'));
  for(const [label,value] of [['Product name','Testing'],['Description','Testing marketplace storefront'],['Price (₦)','1000'],['Stock quantity','2']])h.by('ToolField',label).props.onChangeText(value);
  await h.by('Pressable','Add product photo').props.onPress();await h.flush();
  assert.equal(h.by('ToolButton','Upload product').props.disabled,true);
  await h.by('RetryIconButton','Retry product categories').props.onPress();await h.flush();
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
test('tutorial submission retry resumes the created listing without another create',async()=>{
  const id=randomUUID();let creates=0,submits=0;
  const h=formHarness(async(path,init)=>{
    if(path==='/v1/agents/tutorials'){creates++;assert.ok(JSON.parse(init.body).requestId);return{id};}
    if(path===`/v1/agents/tutorials/${id}/status`){if(++submits===1)throw Error('Connection interrupted');return{status:'SUBMITTED'};}
    return null;
  },{role:'TUTOR'});
  await h.flush();
  for(const [label,value]of [['Tutorial title','Calculus revision'],['Description','A helpful first-year calculus revision session.'],['Price (₦)','1000'],['Available places','20'],['Course code','MTH 101']])h.by('ToolField',label).props.onChangeText(value);
  h.render();await h.by('ToolButton','Submit for review').props.onPress();await h.flush();
  assert.equal(h.by('ToolField','Tutorial title').props.editable,false);
  assert.equal(h.by('ToolButton','Retry submission').props.disabled,false);
  await h.by('ToolButton','Retry submission').props.onPress();await h.flush();
  assert.equal(creates,1);assert.equal(submits,2);
});
test('a failed primary draft save prevents listing creation and leaves the edited form available',async()=>{
 let creates=0;
 const h=formHarness(async(path)=>{if(path==='/v1/agents/tutorials')creates++;return null;},{role:'TUTOR',persist:async()=>{throw Error('Encrypted draft storage is full');}});
 await h.flush();
 for(const [label,value]of [['Tutorial title','Calculus revision'],['Description','A helpful first-year calculus revision session.'],['Price (₦)','1000'],['Available places','20'],['Course code','MTH 101']])h.by('ToolField',label).props.onChangeText(value);
 h.render();await h.by('ToolButton','Submit for review').props.onPress();await h.flush();
 assert.equal(creates,0);assert.equal(h.by('ToolField','Tutorial title').props.value,'Calculus revision');
 assert.equal(h.by('ToolField','Tutorial title').props.editable,true);assert.equal(h.by('ToolButton','Submit for review').props.disabled,false);
});
test('gallery reorder and removal keep the cover, preview and submitted photo order consistent',async()=>{
 const category={id:randomUUID(),name:'Stationery'},urls=['https://fixture.invalid/a.jpg','https://fixture.invalid/b.jpg'];let chosen=0,created;
 const h=formHarness(async(path,init)=>{if(path==='/v1/agents/product-categories')return{categories:[category]};if(path==='/v1/agents/products'){created=JSON.parse(init.body);return{id:randomUUID()};}return null;},{photo:async()=>({url:urls[chosen++]})});await h.flush();
 for(const [label,value]of [['Product name','Testing'],['Description','An honest product description.'],['Price (₦)','500'],['Stock quantity','2']])h.by('ToolField',label).props.onChangeText(value);
 h.by('Pressable','Stationery').props.onPress();h.render();await h.by('Pressable','Add product photo').props.onPress();await h.flush();await h.by('Pressable','Add product photo').props.onPress();await h.flush();
 assert.equal(h.by('Pressable','Move photo 1 earlier').props.disabled,true);assert.equal(h.by('Pressable','Move photo 2 later').props.disabled,true);
 h.by('Pressable','Move photo 2 earlier').props.onPress();h.render();h.by('Pressable','Preview product photo 1').props.onPress();h.render();assert.equal(h.by('ImageViewer').props.uri,urls[1]);
 h.by('Pressable','Remove photo 2').props.onPress();h.render();assert.equal(h.by('Pressable','Preview product photo 2'),undefined);
 await h.by('ToolButton','Upload product').props.onPress();await h.flush();assert.equal(created.imageUrl,urls[1]);assert.deepEqual(created.imageUrls,[urls[1]]);
});
test('repeated photo responses do not create duplicate gallery keys and removing the last photo disables submission',async()=>{
 const h=formHarness(async()=>({categories:[{id:randomUUID(),name:'Stationery'}]}));await h.flush();
 await h.by('Pressable','Add product photo').props.onPress();await h.flush();await h.by('Pressable','Add product photo').props.onPress();await h.flush();
 assert.equal(h.by('Pressable','Preview product photo 2'),undefined);h.by('Pressable','Remove photo 1').props.onPress();h.render();assert.equal(h.by('ToolButton','Upload product').props.disabled,true);
});
test('failed draft restoration locks listing edits and create actions while exposing a recovery control',async()=>{
 let creates=0;const h=formHarness(async(path)=>{if(path==='/v1/agents/products')creates++;return{categories:[]};},{restore:{ready:false,error:'Saved copy could not be restored',loading:false,retry(){}}});await h.flush();
 assert.equal(h.by('DraftRecovery').props.error,'Saved copy could not be restored');assert.equal(h.by('ToolField','Product name').props.editable,false);assert.equal(h.by('Pressable','Add product photo').props.disabled,true);
 await h.by('ToolButton','Upload product').props.onPress();assert.equal(creates,0);
});
test('a failed optional price preview does not block a valid product; its icon refresh pins a recovered policy',async()=>{
  const category={id:randomUUID(),name:'Stationery'};let rateReads=0,created;
  const h=formHarness(async(path,init)=>path==='/v1/agents/product-categories'?{categories:[category]}:path==='/v1/agents/products'?(created=JSON.parse(init.body),{id:randomUUID()}):null,{rates:async amount=>{if(++rateReads===1)throw Error('Rates could not load');return{ready:true,ruleId:'33333333-3333-4333-8333-333333333333',baseKobo:amount,platformKobo:10000,processingEstimateKobo:2000,customerEstimateKobo:amount+12000,sellerCommissionKobo:0};}});
  await h.flush();for(const [label,value]of [['Product name','Stationery pack'],['Description','A stationery pack with an honest description.'],['Price (₦)','1000'],['Stock quantity','2']])h.by('ToolField',label).props.onChangeText(value);
  h.by('Pressable','Stationery').props.onPress();h.render();await h.by('Pressable','Add product photo').props.onPress();await h.flush();
  assert.equal(h.by('ToolButton','Upload product').props.disabled,false);assert.ok(h.by('RetryIconButton','Refresh product pricing'));
  h.by('RetryIconButton','Refresh product pricing').props.onPress();await h.flush();assert.equal(h.by('ToolButton','Upload product').props.disabled,false);
  await h.by('ToolButton','Upload product').props.onPress();await h.flush();assert.equal(created.pricingPolicyId,'33333333-3333-4333-8333-333333333333');assert.equal(created.priceKobo,100000);
});
test('a campus without checkout rates can upload a valid listing without inventing a policy or losing photos',async()=>{
 const category={id:randomUUID(),name:'Stationery'};let created;
 const h=formHarness(async(path,init)=>path==='/v1/agents/product-categories'?{categories:[category]}:path==='/v1/agents/products'?(created=JSON.parse(init.body),{id:randomUUID()}):null,{rates:async()=>({ready:false,message:'Checkout pricing is temporarily unavailable. You can still upload this product.'})});
 await h.flush();for(const [label,value]of [['Product name','Stationery pack'],['Description','A stationery pack with an honest description.'],['Price (₦)','1000'],['Stock quantity','2']])h.by('ToolField',label).props.onChangeText(value);
 h.by('Pressable','Stationery').props.onPress();h.render();await h.by('Pressable','Add product photo').props.onPress();await h.flush();
 assert.equal(h.by('ToolButton','Upload product').props.disabled,false);
 await h.by('ToolButton','Upload product').props.onPress();await h.flush();
 assert.equal(created.pricingPolicyId,undefined);assert.equal(created.priceKobo,100000);assert.equal(created.imageUrls.length,1);
});
