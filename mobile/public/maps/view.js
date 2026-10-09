import * as maplibregl from './maplibre-gl.mjs';
import {createDefaultMapSources} from './providers.js';
maplibregl.setWorkerUrl(new URL('./maplibre-gl-worker.mjs',import.meta.url).href);
const post=value=>{const text=JSON.stringify(value);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(text);else parent.postMessage(text,location.origin);};
const empty={type:'FeatureCollection',features:[]};
const collection=features=>({type:'FeatureCollection',features});
const point=(coordinate,properties)=>({type:'Feature',geometry:{type:'Point',coordinates:coordinate},properties});
const validPoint=coordinate=>Array.isArray(coordinate)&&coordinate.length===2&&coordinate.every(Number.isFinite)&&Math.abs(coordinate[0])<=180&&Math.abs(coordinate[1])<=90;
const pointDistanceMetres=(a,b)=>{const rad=Math.PI/180,dy=(a[1]-b[1])*rad,dx=(a[0]-b[0])*rad*Math.cos((a[1]+b[1])*rad/2);return 6371000*Math.hypot(dx,dy);};
let catalog=createDefaultMapSources(),campusId='',focusNonce=0,lastLayer='osm',failures=0,loaded=false,lastRoute='',latest=null,lastTiles=JSON.stringify(catalog.sources[0].tiles),renderedFeatures=null,lastPlaces=null,lastSelection='',lastPadding='',lastThreeD=false;
const map=new maplibregl.Map({container:'map',style:{version:8,glyphs:'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',sources:{base:{type:'raster',tiles:catalog.sources[0].tiles,tileSize:256,attribution:catalog.sources[0].attribution}},layers:[{id:'base',type:'raster',source:'base',paint:{'raster-saturation':-.35,'raster-contrast':-.1}}]},center:[5.618838,6.398255],zoom:15,minZoom:2,maxZoom:20,dragRotate:true,touchZoomRotate:true,attributionControl:false});
map.addControl(new maplibregl.AttributionControl({compact:true}),'top-left');
map.addControl(new maplibregl.NavigationControl({showCompass:true}),'top-right');
const colours=['match',['get','category'],'ACADEMIC','#4b6599','HOSTEL','#8d6042','FOOD','#cc8449','HEALTH','#428872','TRANSPORT','#605694','SPORT','#4a827a','#6f6253'];
const buildingFilter=['all',['==',['geometry-type'],'Polygon'],['any',['has','building'],['==',['get','kind'],'BUILDING']]];
const walkFilter=['all',['==',['geometry-type'],'LineString'],['match',['get','highway'],['footway','path','steps'],true,false]];
const roadFilter=['all',['==',['geometry-type'],'LineString'],['!',walkFilter]];
function routeArrow(){
  const size=24,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const diagonal=Math.abs(y-11.5);
    if(x>=14-diagonal*.7&&x<=18-diagonal*.7){const i=(y*size+x)*4;data[i]=data[i+1]=data[i+2]=data[i+3]=255;}
  }
  return {width:size,height:size,data};
}
const duration=()=>latest?.reducedMotion?0:420;
function safePadding(padding={top:110,bottom:260,left:24,right:50}){
  const height=map.getContainer().clientHeight,width=map.getContainer().clientWidth;
  const top=Math.min(Math.max(padding.top??110,8),height*.3),bottom=Math.min(Math.max(padding.bottom??260,8),Math.max(8,height-top-140));
  return {top,bottom,left:Math.min(padding.left??24,width*.15),right:Math.min(padding.right??50,width*.2)};
}
map.on('load',()=>{
  loaded=true;
  map.addImage('walking-direction',routeArrow(),{sdf:true});
  map.addSource('places',{type:'geojson',data:empty,cluster:true,clusterRadius:34,clusterMaxZoom:15});
  for(const name of ['chosen','features','route','approach','position','endpoints','pins'])map.addSource(name,{type:'geojson',data:empty});
  map.addLayer({id:'campus-land',type:'fill',source:'features',filter:['all',['==',['geometry-type'],'Polygon'],['==',['get','kind'],'BOUNDARY']],paint:{'fill-color':'#e3dccd','fill-opacity':.1}});
  map.addLayer({id:'building-shadows',type:'fill',source:'features',filter:buildingFilter,minzoom:15,paint:{'fill-color':'#796959','fill-opacity':.16,'fill-translate':[2,3]}});
  map.addLayer({id:'buildings',type:'fill',source:'features',filter:buildingFilter,paint:{'fill-color':['match',['get','amenity'],'hospital','#c9d9d0','clinic','#c9d9d0','university','#d8cabb','school','#d8cabb','#d2c0ad'],'fill-opacity':.68,'fill-outline-color':'#a28d76'}});
  map.addLayer({id:'mapped-path-casing',type:'line',source:'features',filter:roadFilter,paint:{'line-color':'#fffaf4','line-width':['interpolate',['linear'],['zoom'],13,2.5,16,6,19,15]},layout:{'line-cap':'round','line-join':'round'}});
  map.addLayer({id:'mapped-paths',type:'line',source:'features',filter:roadFilter,paint:{'line-color':'#c5bdad','line-width':['interpolate',['linear'],['zoom'],13,1,16,3.5,19,9]},layout:{'line-cap':'round','line-join':'round'}});
  map.addLayer({id:'campus-walkways',type:'line',source:'features',filter:walkFilter,minzoom:15,paint:{'line-color':['case',['==',['get','highway'],'steps'],'#9c846b','#ac9a7e'],'line-width':['interpolate',['linear'],['zoom'],15,1.2,18,2.5],'line-dasharray':[2,1.5]},layout:{'line-cap':'round','line-join':'round'}});
  map.addLayer({id:'building-height',type:'fill-extrusion',source:'features',filter:buildingFilter,minzoom:15,layout:{visibility:'none'},paint:{'fill-extrusion-color':'#b9a390','fill-extrusion-height':['to-number',['get','heightMetres'],0],'fill-extrusion-base':0,'fill-extrusion-opacity':.8}});
  map.addLayer({id:'route-casing',type:'line',source:'route',paint:{'line-color':'#fffaf4','line-width':['interpolate',['linear'],['zoom'],13,8,18,11],'line-opacity':.95},layout:{'line-cap':'round','line-join':'round'}});
  map.addLayer({id:'route-line',type:'line',source:'route',paint:{'line-color':'#825533','line-width':['interpolate',['linear'],['zoom'],13,4,18,6]},layout:{'line-cap':'round','line-join':'round'}});
  map.addLayer({id:'walking-direction',type:'symbol',source:'route',minzoom:14,layout:{'symbol-placement':'line','symbol-spacing':64,'icon-image':'walking-direction','icon-size':.6,'icon-rotation-alignment':'map','icon-keep-upright':false,'icon-allow-overlap':true},paint:{'icon-color':'#fffaf4','icon-opacity':.9}});
  // Dashed approach is not a verified campus walkway: it links the actual GPS fix to the closest mapped path.
  map.addLayer({id:'route-approach',type:'line',source:'approach',paint:{'line-color':'#428872','line-width':3,'line-dasharray':[1.5,1.5]},layout:{'line-cap':'round','line-join':'round'}});
  map.addLayer({id:'clusters',type:'circle',source:'places',filter:['has','point_count'],paint:{'circle-radius':['step',['get','point_count'],15,15,19,40,23],'circle-color':'#7b614b','circle-stroke-width':2,'circle-stroke-color':'#fffaf4','circle-opacity':.94}});
  map.addLayer({id:'cluster-count',type:'symbol',source:'places',filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-size':11},paint:{'text-color':'#ffffff'}});
  map.addLayer({id:'poi',type:'circle',source:'places',filter:['!', ['has','point_count']],paint:{'circle-radius':['interpolate',['linear'],['zoom'],13,3,17,5.5],'circle-color':colours,'circle-stroke-width':1.5,'circle-stroke-color':'#fff'}});
  map.addLayer({id:'poi-label',type:'symbol',source:'places',filter:['!', ['has','point_count']],minzoom:15.7,layout:{'text-field':['get','name'],'text-size':['interpolate',['linear'],['zoom'],15.7,10,18,12],'text-anchor':'top','text-offset':[0,.8],'text-max-width':9,'text-allow-overlap':false,'text-ignore-placement':false,'text-padding':6,'text-variable-anchor':['top','bottom','left','right']},paint:{'text-color':'#332821','text-halo-color':'#fffaf4','text-halo-width':2}});
  map.addLayer({id:'chosen-poi',type:'circle',source:'chosen',paint:{'circle-radius':8,'circle-color':colours,'circle-stroke-width':3,'circle-stroke-color':'#fffaf4'}});
  map.addLayer({id:'chosen-label',type:'symbol',source:'chosen',layout:{'text-field':['get','name'],'text-size':12,'text-anchor':'top','text-offset':[0,1.1],'text-max-width':10,'text-padding':8,'text-allow-overlap':false,'text-ignore-placement':false,'symbol-sort-key':['case',['get','selected'],0,1]},paint:{'text-color':'#332821','text-halo-color':'#fffaf4','text-halo-width':2.5}});
  map.addLayer({id:'manual-pins',type:'circle',source:'pins',paint:{'circle-radius':6,'circle-color':'#fffaf4','circle-stroke-color':['match',['get','role'],'origin','#428872','#825533'],'circle-stroke-width':2}});
  map.addLayer({id:'my-position-halo',type:'circle',source:'position',paint:{'circle-radius':15,'circle-color':'#367cca','circle-opacity':.15}});
  map.addLayer({id:'my-position',type:'circle',source:'position',paint:{'circle-radius':6,'circle-color':'#367cca','circle-stroke-width':2.5,'circle-stroke-color':'#fff'}});
  map.addLayer({id:'route-endpoints',type:'circle',source:'endpoints',paint:{'circle-radius':11,'circle-color':['match',['get','role'],'origin','#428872','#825533'],'circle-stroke-width':3,'circle-stroke-color':'#fffaf4'}});
  map.addLayer({id:'route-endpoint-labels',type:'symbol',source:'endpoints',layout:{'text-field':['get','label'],'text-size':10,'text-allow-overlap':true},paint:{'text-color':'#fff'}});
  const placeLayers=['poi','poi-label','chosen-poi','chosen-label'];
  for(const layer of placeLayers){
    map.on('click',layer,event=>{const id=event.features?.[0]?.properties?.id;if(id)post({type:'pick',id:String(id)});});
    map.on('mouseenter',layer,()=>{map.getCanvas().style.cursor='pointer';});
    map.on('mouseleave',layer,()=>{map.getCanvas().style.cursor=latest?.pickMode?'crosshair':'';});
  }
  map.on('click','clusters',async event=>{
    const feature=event.features?.[0];if(!feature)return;
    try{const zoom=await map.getSource('places').getClusterExpansionZoom(Number(feature.properties.cluster_id));map.easeTo({center:feature.geometry.coordinates,zoom,duration:duration()});}catch{}
  });
  map.on('click',event=>{
    if(!latest?.pickMode)return;
    if(map.queryRenderedFeatures(event.point,{layers:[...placeLayers,'clusters','cluster-count']}).length)return;
    post({type:'point',coordinate:[event.lngLat.lng,event.lngLat.lat]});
  });
  post({type:'ready'});
  if(latest)apply(latest);
});
function apply(incoming){
  const payload={...latest,...incoming};latest=payload;if(!loaded)return;
  catalog=createDefaultMapSources(payload.satellite);
  if(payload.preview)document.documentElement.classList.add('preview');
  const padding=safePadding(payload.padding??(payload.preview?{top:16,bottom:16,left:16,right:16}:undefined));
  document.documentElement.style.setProperty('--map-controls-top',`${Math.max(padding.top+42,90)}px`);
  document.documentElement.style.setProperty('--map-attribution-top',`${padding.top}px`);
  // setPadding stops an in-flight camera animation. Unchanged bridge updates
  // must leave it running; a drawer resize must restore the intended framing.
  const paddingKey=JSON.stringify(padding),paddingChanged=paddingKey!==lastPadding;
  if(paddingChanged){map.setPadding(padding);lastPadding=paddingKey;}
  if(campusId!==payload.campusId){campusId=payload.campusId;lastRoute='';map.jumpTo({center:payload.centre,zoom:15.5,pitch:0,bearing:0});}
  const selection=`${payload.selectedId??''}.${payload.originId??''}`;
  if(lastPlaces!==payload.places||lastSelection!==selection){
    const places=(Array.isArray(payload.places)?payload.places:[]).filter(place=>place&&place.latitude!==null&&place.longitude!==null&&validPoint([Number(place.longitude),Number(place.latitude)])).map(place=>point([Number(place.longitude),Number(place.latitude)],{id:place.id,name:place.name,category:place.category,selected:place.id===payload.selectedId,chosen:place.id===payload.selectedId||place.id===payload.originId}));
    map.getSource('places').setData(collection(places.filter(place=>!place.properties.chosen)));
    map.getSource('chosen').setData(collection(places.filter(place=>place.properties.chosen)));
    lastPlaces=payload.places;lastSelection=selection;
  }
  if(renderedFeatures!==payload.features){
    map.getSource('features').setData(payload.features?.type==='FeatureCollection'?payload.features:empty);
    renderedFeatures=payload.features;
  }
  const route=payload.route?.type==='LineString'&&Array.isArray(payload.route.coordinates)?payload.route:null;
  const coords=route?route.coordinates.filter(validPoint):[];
  map.getSource('route').setData(coords.length>=2?collection([{type:'Feature',geometry:{type:'LineString',coordinates:coords},properties:{}}]):empty);
  map.getSource('position').setData(validPoint(payload.location)?collection([point(payload.location,{})]):empty);
  const liveOrigin=coords.length>=2&&payload.originIsLive&&validPoint(payload.origin);
  const endpointFeatures=coords.length>=2?[point(liveOrigin?payload.origin:coords[0],{role:'origin',label:'A'}),point(coords.at(-1),{role:'destination',label:'B'})]:[];
  map.getSource('endpoints').setData(collection(endpointFeatures));
  const approach=liveOrigin&&pointDistanceMetres(payload.origin,coords[0])>8?collection([{type:'Feature',geometry:{type:'LineString',coordinates:[payload.origin,coords[0]]},properties:{}}]):empty;
  map.getSource('approach').setData(approach);
  const pins=[];
  if(validPoint(payload.origin)&&!payload.originId&&!payload.originIsLive)pins.push(point(payload.origin,{role:'origin'}));
  if(validPoint(payload.destination)&&!payload.selectedId)pins.push(point(payload.destination,{role:'destination'}));
  map.getSource('pins').setData(collection(pins));
  const routeKey=payload.routeKey??JSON.stringify(route??null);
  const frameRoute=coords.length>=2&&(routeKey!==lastRoute||paddingChanged);
  lastRoute=routeKey;
  const layer=payload.layer==='satellite'&&catalog.sources.some(source=>source.id==='satellite')?'satellite':'osm';
  const provider=catalog.sources.find(source=>source.id===layer),tiles=JSON.stringify(provider.tiles);
  if(lastLayer!==layer||lastTiles!==tiles){
    map.getSource('base').setTiles(provider.tiles);map.getSource('base').attribution=provider.attribution;
    map.fire('sourcedata',{sourceId:'base',sourceDataType:'metadata',isSourceLoaded:true});lastLayer=layer;lastTiles=tiles;failures=0;
  }
  const threeD=payload.layer==='3d',pitchChanged=threeD!==lastThreeD;lastThreeD=threeD;
  map.setLayoutProperty('building-height','visibility',threeD?'visible':'none');
  map.getCanvas().style.cursor=payload.pickMode?'crosshair':'';
  // One camera intent per bridge patch: an explicit selection, route framing,
  // then a layer change. Pitch updates must not interrupt a pending place pan.
  if(payload.focus&&(payload.focus.nonce!==focusNonce||(paddingChanged&&coords.length<2))&&validPoint(payload.focus.coordinate)){
    focusNonce=payload.focus.nonce;map.easeTo({center:payload.focus.coordinate,zoom:payload.focus.zoom??17,padding,pitch:threeD?55:0,duration:duration()});
  }else if(frameRoute){
    const bounds=coords.reduce((bounds,coordinate)=>bounds.extend(coordinate),new maplibregl.LngLatBounds(coords[0],coords[0]));
    map.fitBounds(bounds,{padding,maxZoom:17,pitch:threeD?55:0,duration:duration()});
  }else if(pitchChanged)map.easeTo({pitch:threeD?55:0,duration:duration()});
}
const receive=event=>{
  if(event.origin&&event.origin!==location.origin)return;
  try{const data=typeof event.data==='string'?JSON.parse(event.data):event.data;if(data.type==='kampusone-map')apply(data.payload);}catch{}
};
window.addEventListener('message',receive);document.addEventListener('message',receive);
map.on('error',event=>{
  if(event.sourceId!=='base')return;
  failures++;
  if(failures>=2&&lastLayer==='satellite'){
    const provider=catalog.sources[0];map.getSource('base').setTiles(provider.tiles);lastLayer='osm';lastTiles=JSON.stringify(provider.tiles);
    post({type:'error',message:'Satellite imagery could not load. Street map is shown.'});
  }else if(failures===3)post({type:'error',message:'Street map tiles could not load. Saved campus paths and places are still available.'});
});
