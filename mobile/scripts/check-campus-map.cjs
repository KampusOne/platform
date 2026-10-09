const fs=require('node:fs');
const vm=require('node:vm');
const nodePath=require('node:path');
const assert=require('node:assert/strict');
const styleSpec=require('@maplibre/maplibre-gl-style-spec');
const typescript=require('typescript');
const root=nodePath.resolve(__dirname,'../..');
const events=[],messages=[],sources=new Map(),canvas={style:{}};
let capturedStyle,mapInstance;
class FakeMap{
  constructor(options){capturedStyle=structuredClone(options.style);mapInstance=this;this.options=options;this.pitch=0;this.fits=[];this.eases=[];this.paddingUpdates=0;this.cameraTarget=null;}
  addControl(){}
  addImage(id,image){assert.ok(image.width>0&&image.height>0);assert.equal(image.data.length,image.width*image.height*4);this.images??=new Map();this.images.set(id,image);}
  on(event,layer,handler){events.push({event,layer:typeof layer==='string'?layer:null,handler:handler??layer});}
  addSource(id,source){capturedStyle.sources[id]=structuredClone(source);sources.set(id,{...source,setData(data){this.data=data;},setTiles(tiles){this.tiles=tiles;},async getClusterExpansionZoom(){return 16;}});}
  addLayer(layer){capturedStyle.layers.push(structuredClone(layer));}
  getSource(id){return sources.get(id)??{setTiles(){}};}
  getCanvas(){return canvas;}
  getContainer(){return {clientWidth:390,clientHeight:844};}
  // MapLibre implements setPadding through jumpTo, which stops active easing.
  setPadding(value){this.padding=value;this.paddingUpdates++;this.cameraTarget=null;}
  jumpTo(value){this.jump=value;}
  easeTo(value){this.eases.push(value);this.cameraTarget=value;}
  fitBounds(bounds,value){this.fits.push(value);this.cameraTarget={bounds};}
  setLayoutProperty(){}
  getPitch(){return this.pitch;}
  fire(){}
  queryRenderedFeatures(){return [];}
}
class Bounds{extend(){return this;}}
const context={maplibregl:{Map:FakeMap,LngLatBounds:Bounds,AttributionControl:class{},NavigationControl:class{}},URL,location:{origin:'http://localhost:8765'},window:{ReactNativeWebView:{postMessage(raw){messages.push(JSON.parse(raw));}},addEventListener(){}},document:{addEventListener(){},documentElement:{classList:{add(){}},style:{setProperty(){}}}},console};
vm.createContext(context);
vm.runInContext(fs.readFileSync(`${root}/mobile/public/maps/providers.js`,'utf8').replace('export function','function'),context);
const script=fs.readFileSync(`${root}/mobile/public/maps/view.js`,'utf8').split('\n').filter(line=>!line.startsWith('import ')&&!line.startsWith('maplibregl.setWorkerUrl')).join('\n');
vm.runInContext(script,context);
events.find(event=>event.event==='load').handler();
const errors=styleSpec.validateStyleMin(capturedStyle);
assert.deepEqual(errors.map(error=>error.message),[],'MapLibre style must accept every generated layer/filter');
const tsContext={exports:{}};vm.createContext(tsContext);
vm.runInContext(typescript.transpileModule(fs.readFileSync(`${root}/mobile/src/lib/campus-data.ts`,'utf8'),{compilerOptions:{module:typescript.ModuleKind.CommonJS,target:typescript.ScriptTarget.ES2022}}).outputText,tsContext);
const data=JSON.parse(fs.readFileSync(`${root}/database/imports/uniben-osm-2026-10-01.json`,'utf8'));
const sourceFeatures=data.features.filter(feature=>feature.slug==='ugbowo').map(feature=>({type:'Feature',geometry:feature.geometry,properties:{kind:feature.kind,...feature.tags,heightMetres:0}}));
const path=sourceFeatures.find(feature=>feature.properties.kind==='PATH');
const payload={campusId:'ugbowo',centre:[5.618838,6.398255],places:tsContext.exports.UNIBEN_UGBOWO_FALLBACK,features:{type:'FeatureCollection',features:sourceFeatures},selectedId:null,location:null,route:null,layer:'osm',padding:{top:120,bottom:350,left:24,right:58},reducedMotion:true};
context.payload=payload;vm.runInContext('apply(payload)',context);
assert.equal(sources.get('places').cluster,true);
assert.equal(sources.get('places').data.features.length,payload.places.length);
assert.equal(sources.get('features').data.features.length,sourceFeatures.length);
assert.equal(mapInstance.padding.top,120);assert.equal(mapInstance.padding.bottom,350);
context.payload={...payload,pickMode:'origin'};vm.runInContext('apply(payload)',context);
events.find(event=>event.event==='click'&&event.layer===null).handler({point:{x:10,y:10},lngLat:{lng:5.615,lat:6.4}});
assert.equal(messages.at(-1).type,'point');assert.deepEqual(messages.at(-1).coordinate,[5.615,6.4]);
context.payload={...payload,selectedId:payload.places[0].id,originId:payload.places[1].id,route:path.geometry};vm.runInContext('apply(payload)',context);
assert.equal(sources.get('chosen').data.features.length,2);
assert.equal(sources.get('places').data.features.length,payload.places.length-2);
assert.equal(sources.get('endpoints').data.features.length,2);
assert.equal(mapInstance.fits.at(-1).duration,0);
// A route computed on snapped campus paths must still start visually at the device's actual GPS dot.
const liveStart=[path.geometry.coordinates[0][0]+0.0002,path.geometry.coordinates[0][1]];
context.payload={...payload,selectedId:null,originId:null,origin:liveStart,originIsLive:true,location:liveStart,route:path.geometry,routeKey:'live-gps-route'};
vm.runInContext('apply(payload)',context);
assert.deepEqual(Array.from(sources.get('endpoints').data.features[0].geometry.coordinates),liveStart,'A marker must follow current GPS, not the snapped path');
assert.equal(sources.get('approach').data.features.length,1,'Show the gap between GPS and a sourced campus walkway');
assert.equal(sources.get('pins').data.features.length,0,'Do not duplicate the current-location A marker with a manual origin pin');
context.payload={...context.payload,route:null,origin:null,routeKey:'gps-fix-expired'};
vm.runInContext('apply(payload)',context);
assert.equal(sources.get('route').data.features.length,0,'An invalidated route must not remain on the map');
assert.equal(sources.get('endpoints').data.features.length,0,'Stale A/B markers must disappear when the GPS fix expires');
assert.equal(sources.get('approach').data.features.length,0,'The dashed approach must disappear with an invalidated route');
const fits=mapInstance.fits.length;vm.runInContext('apply({location:[5.62,6.4]})',context);
assert.equal(mapInstance.fits.length,fits,'A location-only patch must not reset route framing');
assert.equal(sources.get('features').data.features.length,sourceFeatures.length,'A small bridge patch must preserve sourced map geometry');
// Route readiness is stricter than drawing the approximate blue location dot.
const gpsContext={exports:{}};vm.createContext(gpsContext);
vm.runInContext(typescript.transpileModule(fs.readFileSync(`${root}/mobile/src/lib/campus-route-location.ts`,'utf8'),{compilerOptions:{module:typescript.ModuleKind.CommonJS,target:typescript.ScriptTarget.ES2022}}).outputText,gpsContext);
const now=Date.now(),fix={latitude:6.398255,longitude:5.618838,timestamp:now-1000,accuracy:10};
assert.equal(gpsContext.exports.usableRouteGpsFix(fix,now),true);
assert.equal(gpsContext.exports.usableRouteGpsFix({...fix,accuracy:120},now),false,'Inaccurate cached GPS must not start navigation');
assert.equal(gpsContext.exports.usableRouteGpsFix({...fix,timestamp:now-61000},now),false,'Old GPS must invalidate an already displayed route');
assert.equal(gpsContext.exports.usableRouteGpsFix({...fix,latitude:NaN},now),false);
const petroleum=payload.places.find(place=>place.name==='Department of Petroleum Engineering');
assert.ok(petroleum,'Use a newly reviewed landmark for camera verification');
const focus={coordinate:[Number(petroleum.longitude),Number(petroleum.latitude)],nonce:101,zoom:17};
context.payload={...payload,selectedId:petroleum.id,focus,route:null,routeKey:'none',reducedMotion:false};vm.runInContext('apply(payload)',context);
assert.deepEqual(mapInstance.cameraTarget.center,focus.coordinate);
assert.equal(mapInstance.cameraTarget.duration,420);
const paddingUpdates=mapInstance.paddingUpdates;
vm.runInContext('apply({location:[5.62,6.4]})',context);
assert.equal(mapInstance.paddingUpdates,paddingUpdates,'A location patch must not cancel the pending landmark pan');
assert.deepEqual(mapInstance.cameraTarget.center,focus.coordinate);
vm.runInContext('apply({padding:{top:120,bottom:600,left:24,right:58}})',context);
assert.deepEqual(mapInstance.cameraTarget.center,focus.coordinate,'Resizing the drawer must retain the selected landmark framing');
context.payload={route:path.geometry,routeKey:'new-walk'};vm.runInContext('apply(payload)',context);
assert.ok(mapInstance.cameraTarget.bounds,'A completed route must take precedence over the earlier landmark focus');
const framedRoutes=mapInstance.fits.length;
vm.runInContext('apply({padding:{top:120,bottom:300,left:24,right:58}})',context);
assert.equal(mapInstance.fits.length,framedRoutes+1,'The route must fit the resized visible viewport');
assert.ok(mapInstance.cameraTarget.bounds,'Drawer resizing must not replace route framing with a stale endpoint focus');
const eased=mapInstance.eases.length;
context.payload={layer:'3d',route:null,routeKey:'none',focus:{...focus,nonce:102}};vm.runInContext('apply(payload)',context);
assert.equal(mapInstance.eases.length,eased+1,'Selecting in 3D must use one combined pan and pitch transition');
assert.deepEqual(mapInstance.cameraTarget.center,focus.coordinate);assert.equal(mapInstance.cameraTarget.pitch,55);
vm.runInContext('apply({location:[5.621,6.4]})',context);
assert.equal(mapInstance.eases.length,eased+1,'A 3D location update must not interrupt the pending landmark pan');
async function verifyGeometryCache(){
  const storage=new Map();
  const asyncStorage={
    async getItem(key){return storage.get(key)??null;},
    async setItem(key,value){assert.ok(value.length<=240000,'Geometry entries must fit the bounded native storage window');storage.set(key,value);},
    async removeItem(key){storage.delete(key);},
  };
  const cacheContext={exports:{},require(name){assert.equal(name,'@react-native-async-storage/async-storage');return {__esModule:true,default:asyncStorage};},console};
  vm.createContext(cacheContext);
  vm.runInContext(typescript.transpileModule(fs.readFileSync(`${root}/mobile/src/lib/campus-map-cache.ts`,'utf8'),{compilerOptions:{module:typescript.ModuleKind.CommonJS,target:typescript.ScriptTarget.ES2022}}).outputText,cacheContext);
  const cache=cacheContext.exports,key='map-verification',value={places:payload.places,info:{campus:'ugbowo'},features:payload.features};
  await cache.writeCampusMapCache(key,value);
  const saved=await cache.readCampusMapCache(key);
  assert.deepEqual(JSON.parse(JSON.stringify(saved)),JSON.parse(JSON.stringify(value)),'Real sourced geometry must survive bounded-page native storage');
  const oldPages=Array.from(storage.keys()).filter(name=>name.includes('.geometry.'));
  assert.ok(oldPages.length>1,'The regression fixture must exceed one native storage entry');
  await Promise.all([
    cache.writeCampusMapCache(key,{...value,info:{campus:'ugbowo',revision:2}}),
    cache.writeCampusMapCache(key,{...value,info:{campus:'ugbowo',revision:3}}),
  ]);
  assert.equal((await cache.readCampusMapCache(key)).info.revision,3,'Concurrent writes must publish in order');
  assert.ok(oldPages.every(name=>!storage.has(name)),'Superseded geometry pages must be removed');
  storage.set(key,'{corrupt cache');
  assert.equal(await cache.readCampusMapCache(key),null,'Invalid cache metadata must fall back safely');
  await cache.writeCampusMapCache(key,value);
  const metadata=JSON.parse(storage.get(key));
  storage.delete(`${key}.geometry.${metadata.geometryRevision}.0`);
  const partial=await cache.readCampusMapCache(key);
  assert.equal(partial.features,null,'Missing geometry must not become invented map data');
  assert.equal(partial.places.length,payload.places.length,'Places remain available when a geometry page is unavailable');
}
verifyGeometryCache().then(()=>console.log(JSON.stringify({status:'PASS',validatedLayers:capturedStyle.layers.length,sourcedFeatures:sourceFeatures.length,places:payload.places.length,checks:['official MapLibre style validation','clustered dense directory','unclustered selected start/end','manual point bridge','sourced path display','safe viewport padding','distinct route endpoints','live GPS A marker and path approach','stale route removal','GPS freshness and accuracy','reduced motion','stable camera on same route','landmark pan survives bridge updates and drawer resizing','route framing takes precedence over stale focus','bounded native geometry cache','ordered cache writes and corrupt/missing cache recovery']}))).catch(error=>{console.error(error);process.exitCode=1;});
