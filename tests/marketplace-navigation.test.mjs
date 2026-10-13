import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { typescript as ts } from './helpers/typescript.mjs';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { hookRenderer, virtualClock } from './helpers/hook-renderer.mjs';
const owner='11111111-1111-4111-8111-111111111111',vendor='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
function load(relative,mocks,globals={}){const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('../mobile/'+relative,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,module:{exports},require:name=>{if(name in mocks)return mocks[name];throw Error('Missing '+name);},Date,Error,Number,Math,setTimeout,clearTimeout,...globals});return exports;}
function fixture({width=393,initialCart={},params={}}={}){
 const host=hookRenderer(),time=virtualClock(),routes=[],requests=[],saves=[];let tree,checkout=false,stored=initialCart,failSaves=false;
 const react={...host.react,useSyncExternalStore:(_subscribe,snapshot)=>snapshot()};
 const jsx={jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key}),Fragment:'Fragment'};
 const font=new Proxy({},{get:()=> 'Lato'}),theme=new Proxy({font,motion:{screen:0},border:'#E7E0D8',canvas:'#FBF7F2',surface:'#fff'},{get:(o,k)=>o[k]??'#8D4B35'});
 const device={getDeviceCacheRevision:()=>1,readOwnedDraft:async()=>stored,saveOwnedDraft:async(_key,items)=>{if(failSaves)throw Error('Cart storage is unavailable');stored=items;saves.push(items);return'device';}};
 const globals={setTimeout:time.schedule,clearTimeout:time.cancel};
 const cart=load('src/lib/marketplace-cart.ts',{'react':react,'./device-cache':device},globals);
 const product={id,vendor_profile_id:vendor,name:'Campus wireless headphones with a long full product name',description:'All details',category:'Phones & accessories',price_kobo:1000000,stock_quantity:5,image_url:null,vendor_name:'Campus Audio',pickup_enabled:true,pickup_location:'Store counter'};
 const api=async(path,options)=>{requests.push({path,body:JSON.parse(options?.body??'{}')});if(path.endsWith('order-quotes'))return{quote:{id:randomUUID(),expiresAt:new Date(Date.now()+60000).toISOString(),pricing:{listedItemsKobo:1000000,discountKobo:0,fareKobo:0,cashDueKobo:0,payableKobo:1000000,totalKobo:1000000},fare:null}};if(path.endsWith('/orders'))return{id:randomUUID(),totalKobo:1000000};return{};};
 const router={push:path=>routes.push(path),replace:path=>routes.push(path),back:()=>routes.push('back'),setParams:()=>{}};
 const modules={
  'react':react,'react/jsx-runtime':jsx,
  'react-native':{View:'View',Text:'Text',Pressable:'Pressable',TextInput:'TextInput',FlatList:'FlatList',Image:'Image',KeyboardAvoidingView:'KeyboardAvoidingView',Keyboard:{dismiss(){}},Alert:{alert(){}},Platform:{OS:'android'},Animated:{Value:class{stopAnimation(){}setValue(){}interpolate(){return 0;}},timing:()=>({start(){},stop(){}}),View:'Animated.View'},Easing:{cubic:0,out:()=>0},StyleSheet:{create:s=>s,absoluteFill:{position:'absolute'},hairlineWidth:1},useWindowDimensions:()=>({width,height:800,fontScale:1.4})},
  'react-native-safe-area-context':{SafeAreaView:'SafeAreaView',useSafeAreaInsets:()=>({top:20,bottom:24})},
  'expo-router':{router,useLocalSearchParams:()=>params,useFocusEffect:fn=>host.react.useEffect(fn,[fn])},'expo-crypto':{randomUUID},
  '@/src/auth/auth-context':{useAuth:()=>({user:{id:owner,universityId:'A',roles:['STUDENT'],operatorRoles:[]}})},
  '@/src/lib/appearance':{useThemeStyles:styles=>({theme,styles:styles(theme)})},'@/src/lib/device-cache':device,'@/src/lib/marketplace-cart':cart,
  '@/src/lib/request-policy':{cacheScopeForUser:()=> 'verified'},'@/src/lib/api':{api,ApiError:class extends Error{}},
  '@/src/lib/screen-read':{refreshScreenRead:async(_path,apply)=>{apply({products:[product],deliveryZones:[],checkoutEnabled:true,riderDeliveryEnabled:false,catalogueMode:'LIVE'});}},
  '@/src/components/keyboard-viewport':{KeyboardScrollView:'ScrollView',KeyboardModal:'Modal'},'@expo/vector-icons':{Ionicons:'Ionicons'},
  '@/src/components/visual-system':{useReducedMotionPreference:()=>true},'@/src/components/toast':{useToast:()=>()=>{}},'@/src/theme':{theme},
 };
 for(const [name,member] of Object.entries({'product-preview':'ProductPreview','media-image':'MediaImage','search-loading':'SearchLoading','sync-status':'SyncStatus','discount-code-field':'DiscountCodeField','campus-place-choice':'CampusPlaceChoice','popular-shops':'PopularShops','create-action':'CreateAction'}))modules['@/src/components/'+name]={[member]:member};
 modules['@/src/components/skeleton']={InlineLoading:'InlineLoading'};
 const screen=load('app/(tabs)/store.tsx',modules,globals);
 const render=()=>host.render(()=>{let node=(checkout?screen.MarketplaceCheckoutScreen:screen.default)();while(typeof node.type==='function')node=node.type(node.props);tree=node;return tree;});
 const nodes=(value,parents=[])=>Array.isArray(value)?value.flatMap(v=>nodes(v,parents)):value&&typeof value==='object'?[{node:value,parents},...nodes([value.props?.children,value.props?.ListHeaderComponent],[...parents,value])]:[];
 const all=()=>nodes(tree);
 const by=(label)=>all().find(({node})=>node.props?.accessibilityLabel===label)?.node;
 const settle=async()=>{await time.advance(0);for(let i=0;i<5;i++){render();await time.advance(0);}};
 render();return{render,settle,all,by,routes,requests,saves,product,openCheckout:(buyNow)=>{checkout=true;params.buyNow=buyNow;render();},stored:()=>stored,setSaveFailure:value=>{failSaves=value;}};
}

test('a single product stays in two columns at phone widths and Add to cart is immediate',async()=>{
 for(const width of [320,393,430]){
  const f=fixture({width});await f.settle();let list=f.all().find(({node})=>node.type==='FlatList').node;assert.equal(list.props.numColumns,2);
  const cell=list.props.renderItem({item:f.product});assert.ok(cell.props.width<width/2);cell.props.onAdd();f.render();
  list=f.all().find(({node})=>node.type==='FlatList').node;assert.equal(list.props.renderItem({item:f.product}).props.quantity,1);
  assert.equal(f.requests.length,0,'Adding to cart must not wait for a quote');
 }
});
test('Proceed to checkout is pinned outside the cart scroll view and navigates after a verified save',async()=>{
 const f=fixture({initialCart:{[id]:1}});await f.settle();f.by('Open cart with 1 item').props.onPress();f.render();assert.ok(f.all().some(({node})=>node.type==='Modal'&&node.props.visible));const action=f.all().find(({node})=>node.props?.accessibilityLabel==='Proceed to checkout');assert.ok(action);assert.equal(action.parents.some(node=>node.type==='ScrollView'),false);assert.equal(action.node.props.disabled,false);
 action.node.props.onPress();await f.settle();assert.ok(f.saves.length>0);assert.equal(f.routes.at(-1),'/marketplace-checkout');
});
test('Buy now checks out one chosen product while preserving the remaining cart quantity',async()=>{
 const f=fixture({initialCart:{[id]:3}});await f.settle();const list=f.all().find(({node})=>node.type==='FlatList').node;list.props.renderItem({item:f.product}).props.onPreview();f.render();
 const preview=f.all().find(({node})=>node.type==='ProductPreview').node;assert.equal(typeof preview.props.onBuyNow,'function');preview.props.onBuyNow();await f.settle();assert.equal(f.routes.at(-1).pathname,'/marketplace-checkout');assert.equal(f.routes.at(-1).params.buyNow,id);
 f.openCheckout(id);await f.settle();f.by('Review route and checkout total').props.onPress();f.by('Review route and checkout total').props.onPress();await f.settle();assert.equal(f.requests.filter(r=>r.path.endsWith('order-quotes')).length,1);
 assert.equal(f.requests[0].body.items[0].quantity,1);const confirm=f.all().find(({node})=>String(node.props?.accessibilityLabel??'').startsWith('Confirm order and pay')).node;confirm.props.onPress();await f.settle();assert.equal(f.stored()[id],2);assert.equal(f.routes.at(-1).pathname,'/payment-review');
});

test('checkout retains quantity and blocks a quote until the changed cart is verified on disk',async()=>{
 const f=fixture({initialCart:{[id]:1}});await f.settle();f.openCheckout();await f.settle();f.setSaveFailure(true);
 const stepper=f.all().find(({node})=>node.props?.product?.id===id&&typeof node.props.onChange==='function').node;
 stepper.props.onChange(1);await f.settle();f.by('Review route and checkout total').props.onPress();await f.settle();
 assert.equal(f.requests.length,0);assert.equal(f.stored()[id],1);assert.ok(f.all().some(({node})=>String(node.props?.children??'').includes('Cart storage is unavailable')));
 f.setSaveFailure(false);f.by('Review route and checkout total').props.onPress();await f.settle();
 assert.equal(f.stored()[id],2);assert.equal(f.requests.length,1);assert.equal(f.requests[0].body.items[0].quantity,2);
});

test('confirmation verifies the cart again and a failed save creates no order',async()=>{
 const f=fixture({initialCart:{[id]:1}});await f.settle();f.openCheckout();await f.settle();f.by('Review route and checkout total').props.onPress();await f.settle();
 const confirm=()=>f.all().find(({node})=>String(node.props?.accessibilityLabel??'').startsWith('Confirm order and pay')).node;
 f.setSaveFailure(true);confirm().props.onPress();await f.settle();
 assert.equal(f.requests.filter(r=>r.path.endsWith('/orders')).length,0);assert.equal(f.routes.length,0);assert.equal(f.stored()[id],1);
 f.setSaveFailure(false);confirm().props.onPress();await f.settle();
 assert.equal(f.requests.filter(r=>r.path.endsWith('/orders')).length,1);assert.equal(f.routes.at(-1).pathname,'/payment-review');
});

test('checkout visits reach both analytics and the first-party activity stream',async()=>{
 const host=hookRenderer(),time=virtualClock(),analytics=[],activity=[];
 const {ScreenVisitTracker}=load('src/components/screen-visit-tracker.tsx',{
  'react':host.react,'expo-router':{usePathname:()=>'/marketplace-checkout'},
  '@/src/auth/auth-context':{useAuth:()=>({user:{id:owner},state:'authenticated'})},
  '@/src/lib/analytics':{analyticsScreenName:path=>path.slice(1),trackScreenView:route=>analytics.push(route)},
  '@/src/lib/feed-video-playback':{isFeedRoutePath:()=>false,setFeedRoutePlaybackActive:()=>{}},
  '@/src/lib/telemetry':{recordActivity:(event,details)=>activity.push({event,details})},
 },{setTimeout:time.schedule,clearTimeout:time.cancel});
 host.render(()=>ScreenVisitTracker());await time.advance(1200);
 assert.deepEqual(analytics,['marketplace-checkout']);assert.equal(activity.length,1);assert.equal(activity[0].event,'screen_view');assert.equal(activity[0].details.screen,'marketplace-checkout');
});
