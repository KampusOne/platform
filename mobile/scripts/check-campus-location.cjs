const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const assert=require('node:assert/strict');
const ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};

// Execute the production hook with deterministic native promises, sensor callbacks and clock.
function harness(){
  let clock=Date.now(),cursor=0,focus,cleanup,appState;
  const slots=[],timers=new Map(),watches=[],snapshots=[],settings=[];
  let timerId=0;
  const react={
    useState(initial){const slot=cursor++;if(!(slot in slots))slots[slot]=initial;return [slots[slot],next=>{slots[slot]=typeof next==='function'?next(slots[slot]):next;snapshots.push(slots[slot]);}];},
    useRef(initial){const slot=cursor++;return slots[slot]??=( {current:initial} );},
    useCallback(callback,deps){const slot=cursor++,previous=slots[slot];if(previous&&deps.length===previous.deps.length&&deps.every((dep,i)=>Object.is(dep,previous.deps[i])))return previous.callback;slots[slot]={callback,deps};return callback;},
  };
  const native={
    permission:{status:'granted',canAskAgain:true,android:{accuracy:'fine'}},services:true,
    cache:deferred(),oneShot:deferred(),registration:null,
    PermissionStatus:{GRANTED:'granted',DENIED:'denied',UNDETERMINED:'undetermined'},Accuracy:{High:4},
    async getForegroundPermissionsAsync(){return native.permission;},
    async requestForegroundPermissionsAsync(){return native.permission;},
    async hasServicesEnabledAsync(){return native.services;},
    getLastKnownPositionAsync(){return native.cache.promise;},
    getCurrentPositionAsync(){return native.oneShot.promise;},
    watchPositionAsync(options,callback,error){const subscription={options,callback,error,removed:false,remove(){this.removed=true;}};watches.push(subscription);return native.registration?native.registration.promise:Promise.resolve(subscription);},
  };
  const date=class extends Date{static now(){return clock;}};
  const context={exports:{},Date:date,setTimeout(callback,delay){const id=++timerId;timers.set(id,{callback,at:clock+delay});return id;},clearTimeout(id){timers.delete(id);},require(name){
    if(name==='react')return react;
    if(name==='expo-router')return {useFocusEffect(callback){focus=callback;}};
    if(name==='expo-location')return native;
    if(name==='react-native')return {Platform:{OS:'android'},AppState:{addEventListener(event,callback){assert.equal(event,'change');appState=callback;return {remove(){appState=null;}};}},Linking:{async openSettings(){settings.push('app');},async sendIntent(intent){settings.push(intent);}}};
    if(name==='./campus-route-location')return gps;
    throw Error(`Unexpected dependency: ${name}`);
  }};
  const gpsContext={exports:{},Date:date};vm.createContext(gpsContext);
  const compile=file=>ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInContext(compile('mobile/src/lib/campus-route-location.ts'),gpsContext);
  const gps=gpsContext.exports;
  vm.createContext(context);vm.runInContext(compile('mobile/src/lib/campus-location.ts'),context);
  const render=()=>{cursor=0;return context.exports.useCampusLocation();};
  const location=(accuracy=10,offset=0)=>({coords:{latitude:6.398255+offset,longitude:5.618838,accuracy},timestamp:clock});
  render();cleanup=focus();
  return {native,watches,timers,settings,gps,location,render,get state(){return slots[0];},async advance(ms){clock+=ms;for(const [id,timer] of timers)if(timer.at<=clock){timers.delete(id);timer.callback();}await flush();},blur(){cleanup();},focus(){render();cleanup=focus();},resume(){appState('active');},background(){appState('background');}};
}

async function verifyCampusLocation(){
  const checks=[];
  {
    const h=harness(); await flush();
    const request=h.render().requestLocation(); await flush();
    h.native.cache.resolve(h.location(12)); await flush();
    const fix=await request; assert.equal(fix.source,'cached');
    assert.equal(h.state.loading,false);assert.equal(h.gps.usableRouteGpsFix(fix),true);
    await h.advance(15001);assert.equal(h.gps.usableRouteGpsFix(fix),false,'Cached routing coordinates expire after fifteen seconds');
    h.watches.at(-1).callback(h.location(8));await flush();
    assert.equal(h.state.position.source,'live');h.blur();checks.push('fresh accurate cache starts routing while live sensor refreshes');
  }
  {
    const h=harness();await flush();
    assert.equal(h.watches.length,1,'Live watching must start while cache and one-shot requests are both hung');
    assert.equal(h.watches[0].options.distanceInterval,0,'Stationary Android phones must receive fresh fixes');
    const request=h.render().requestLocation();await flush();
    assert.equal(h.watches[0].removed,true,'Retry removes the superseded subscription');
    h.watches[1].callback(h.location());
    const fix=await request;
    assert.equal(fix.source,'live');assert.equal(h.state.loading,false);assert.equal(h.state.error,'');
    assert.equal(h.gps.usableRouteGpsFix(h.state.position),true);
    const accepted=h.state.position;
    h.native.cache.resolve(h.location(20));await flush();
    assert.equal(h.state.position,accepted,'A late cache must not overwrite the live position');
    await h.advance(1000);h.watches[1].callback(h.location(120));
    assert.equal(h.state.position,accepted,'An inaccurate sensor reading must preserve a recent good fix');
    h.native.oneShot.resolve({...h.location(10),timestamp:accepted.timestamp-1000});await flush();
    assert.equal(h.state.position,accepted,'A delayed old one-shot must not move the map backwards');
    h.blur();checks.push('watch starts before hung native requests','stationary live updates','good fix survives cache, jitter and old one-shot');
  }
  {
    const h=harness();await flush();const request=h.render().requestLocation();await flush();
    await h.advance(12000);
    assert.equal(await request,null,'The first-fix request must end after a bounded wait');
    assert.equal(h.state.loading,false);assert.match(h.state.error,/not available/);
    assert.equal(h.watches.at(-1).removed,false,'A timeout must retain live recovery');
    h.watches.at(-1).callback(h.location());
    assert.equal(h.state.error,'');assert.equal(h.gps.usableRouteGpsFix(h.state.position),true,'A later fix must restore route readiness without another Retry');
    h.blur();checks.push('bounded wait and automatic late GPS recovery');
  }
  {
    const h=harness();await flush();h.watches[0].callback(h.location(140));await h.advance(12000);
    assert.equal(h.state.loading,false);assert.match(h.state.error,/140 m/);assert.equal(h.gps.usableRouteGpsFix(h.state.position),false);
    h.watches[0].callback(h.location(15));assert.equal(h.state.error,'');assert.equal(h.gps.usableRouteGpsFix(h.state.position),true);
    await h.advance(61000);assert.equal(h.gps.usableRouteGpsFix(h.state.position),false,'Old coordinates still cannot start navigation');
    h.blur();checks.push('honest accuracy message and unchanged GPS freshness gate');
  }
  {
    const h=harness();await flush();const stalePermission=deferred();
    h.native.requestForegroundPermissionsAsync=()=>stalePermission.promise;
    const stale=h.render().requestLocation();await flush();
    const fresh=h.render().retryLocation();await flush();
    const count=h.watches.length;
    stalePermission.resolve(h.native.permission);await flush();
    assert.equal(await stale,null);assert.equal(h.watches.length,count,'An old permission response must not create a second live watcher');
    h.watches.at(-1).callback(h.location());assert.ok(await fresh);h.blur();
    checks.push('out-of-order permission and Retry responses');
  }
  {
    const h=harness();await flush();const registration=deferred();h.native.registration=registration;
    const request=h.render().requestLocation();await flush();const old=h.watches.at(-1);
    h.blur();assert.equal(await request,null);assert.equal(h.timers.size,0,'Blur cancels pending deadlines');
    h.native.registration=null;h.focus();await flush();const current=h.watches.at(-1);
    registration.resolve(old);await flush();assert.equal(old.removed,true,'Late subscriptions from an earlier focus must be removed');
    current.callback(h.location());const position=h.state.position;
    old.callback(h.location(10,.02));assert.equal(h.state.position,position,'The old sensor callback cannot mutate a refocused screen');
    h.blur();checks.push('blur, refocus and late subscription cleanup');
  }
  {
    const h=harness();await flush();h.native.permission={status:'granted',canAskAgain:true,android:{accuracy:'coarse'}};
    assert.equal(await h.render().requestLocation(),null);await flush();
    assert.equal(h.state.preciseAllowed,false);assert.equal(h.state.loading,false);assert.match(h.state.error,/Precise location is off/);
    await h.render().openLocationSettings();assert.equal(h.settings.at(-1),'app');
    h.native.permission={status:'granted',canAskAgain:true,android:{accuracy:'fine'}};h.resume();await flush();
    h.watches.at(-1).callback(h.location());assert.equal(h.state.preciseAllowed,true);assert.equal(h.state.error,'');
    h.blur();checks.push('approximate permission and return from Settings');
  }
  {
    const h=harness();await flush();h.native.services=false;const count=h.watches.length;
    assert.equal(await h.render().retryLocation(),null);assert.equal(h.state.servicesEnabled,false);assert.equal(h.state.loading,false);assert.equal(h.watches.length,count);
    await h.render().openLocationSettings();assert.equal(h.settings.at(-1),'android.settings.LOCATION_SOURCE_SETTINGS');
    h.native.services=true;h.resume();await flush();h.watches.at(-1).callback(h.location());assert.equal(h.state.error,'');
    h.background();assert.equal(h.watches.at(-1).removed,true);h.blur();checks.push('device location Settings and background cleanup');
  }
  {
    const h=harness();await flush();h.native.permission={status:'denied',canAskAgain:false};const count=h.watches.length;
    assert.equal(await h.render().requestLocation(),null);assert.equal(h.watches.length,count);assert.equal(h.state.loading,false);assert.match(h.state.error,/permission is off/);
    await h.render().openLocationSettings();assert.equal(h.settings.at(-1),'app');h.blur();checks.push('denied permission stays actionable');
  }
  console.log(JSON.stringify({status:'PASS',suite:'campus location recovery',checks}));
}
module.exports={verifyCampusLocation};
if(require.main===module)verifyCampusLocation().catch(error=>{console.error(error);process.exitCode=1;});
