import {createDefaultMapSources} from './providers.js';
const post=(value)=>{const text=JSON.stringify(value);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(text);else parent.postMessage(text,location.origin);};
const catalog=createDefaultMapSources();let campusId='',focusNonce=0,lastLayer='osm',failures=0,loaded=false;
const map=new maplibregl.Map({container:'map',style:{version:8,sources:{base:{type:'raster',tiles:catalog.sources[0].tiles,tileSize:256,attribution:catalog.sources[0].attribution}},layers:[{id:'base',type:'raster',source:'base'}]},center:[5.618838,6.398255],zoom:15,minZoom:2,maxZoom:20,dragRotate:true,touchZoomRotate:true,attributionControl:{compact:true}});
map.addControl(new maplibregl.NavigationControl({showCompass:true}),'top-right');
const empty={type:'FeatureCollection',features:[]};
const collection=(features)=>({type:'FeatureCollection',features});
const colours=['match',['get','category'],'ACADEMIC','#4b6599','HOSTEL','#8d6042','FOOD','#cc8449','HEALTH','#428872','TRANSPORT','#605694','SPORT','#4a827a','#6f6253'];
map.on('load',()=>{
 loaded=true;map.addSource('places',{type:'geojson',data:empty,cluster:true,clusterMaxZoom:15,clusterRadius:42});
 map.addSource('features',{type:'geojson',data:empty});map.addSource('route',{type:'geojson',data:empty});map.addSource('position',{type:'geojson',data:empty});
 map.addLayer({id:'buildings',type:'fill',source:'features',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#ac9783','fill-opacity':.3,'fill-outline-color':'#8d7560'}});
 map.addLayer({id:'building-height',type:'fill-extrusion',source:'features',filter:['==',['geometry-type'],'Polygon'],minzoom:15,layout:{visibility:'none'},paint:{'fill-extrusion-color':'#b9a390','fill-extrusion-height':['to-number',['get','height'],10],'fill-extrusion-base':0,'fill-extrusion-opacity':.8}});
 map.addLayer({id:'route-line',type:'line',source:'route',paint:{'line-color':'#825533','line-width':6},layout:{'line-cap':'round','line-join':'round'}});
 map.addLayer({id:'clusters',type:'circle',source:'places',filter:['has','point_count'],paint:{'circle-color':'#815532','circle-radius':19,'circle-stroke-width':3,'circle-stroke-color':'#fff'}});
 map.addLayer({id:'cluster-count',type:'symbol',source:'places',filter:['has','point_count'],layout:{'text-field':['get','point_count_abbreviated'],'text-size':12},paint:{'text-color':'#fff'}});
 map.addLayer({id:'poi',type:'circle',source:'places',filter:['!', ['has','point_count']],paint:{'circle-radius':['case',['get','selected'],10,6],'circle-color':colours,'circle-stroke-width':2,'circle-stroke-color':'#fff'}});
 map.addLayer({id:'poi-label',type:'symbol',source:'places',minzoom:16,filter:['!', ['has','point_count']],layout:{'text-field':['get','name'],'text-size':12,'text-anchor':'top','text-offset':[0,1],'text-max-width':12,'text-allow-overlap':false},paint:{'text-color':'#332821','text-halo-color':'#fff','text-halo-width':2}});
 // MapLibre needs glyphs for cluster labels; use its documented public font endpoint.
 map.setGlyphs('https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf');
 map.addLayer({id:'my-position',type:'circle',source:'position',paint:{'circle-radius':7,'circle-color':'#367cca','circle-stroke-width':3,'circle-stroke-color':'#fff'}});
 map.on('click','clusters',async e=>{const feature=e.features[0];try{const zoom=await map.getSource('places').getClusterExpansionZoom(feature.properties.cluster_id);map.easeTo({center:feature.geometry.coordinates,zoom});}catch{}});
 map.on('click','poi',e=>post({type:'pick',id:String(e.features[0].properties.id)}));post({type:'ready'});
});
function apply(payload){if(!loaded)return;if(campusId!==payload.campusId){campusId=payload.campusId;map.jumpTo({center:payload.centre,zoom:15.5,pitch:0,bearing:0});}
 const places=payload.places.filter(p=>p.latitude!==null&&p.longitude!==null&&Number.isFinite(Number(p.latitude))&&Number.isFinite(Number(p.longitude))).map(p=>({type:'Feature',geometry:{type:'Point',coordinates:[Number(p.longitude),Number(p.latitude)]},properties:{id:p.id,name:p.name,category:p.category,selected:p.id===payload.selectedId}}));
 map.getSource('places').setData(collection(places));map.getSource('features').setData(payload.features||empty);map.getSource('route').setData(payload.route?collection([{type:'Feature',geometry:payload.route,properties:{}}]):empty);map.getSource('position').setData(payload.location?collection([{type:'Feature',geometry:{type:'Point',coordinates:payload.location},properties:{}}]):empty);
 const layer=payload.layer==='satellite'?'satellite':'osm';if(lastLayer!==layer){const provider=catalog.sources.find(s=>s.id===layer);map.getSource('base').setTiles(provider.tiles);map.getSource('base').attribution=provider.attribution;lastLayer=layer;failures=0;}
 const threeD=payload.layer==='3d';map.setLayoutProperty('building-height','visibility',threeD?'visible':'none');if(threeD&&map.getPitch()<20)map.easeTo({pitch:60});else if(!threeD&&map.getPitch()>0)map.easeTo({pitch:0});
 if(payload.focus&&payload.focus.nonce!==focusNonce){focusNonce=payload.focus.nonce;map.easeTo({center:payload.focus.coordinate,zoom:17,padding:{top:120,bottom:190,left:30,right:30}});}
}
const receive=e=>{if(e.origin&&e.origin!==location.origin)return;try{const data=typeof e.data==='string'?JSON.parse(e.data):e.data;if(data.type==='kampusone-map')apply(data.payload);}catch{}};
window.addEventListener('message',receive);document.addEventListener('message',receive);
map.on('error',event=>{if(event.sourceId==='base'&&++failures>=2&&lastLayer==='satellite'){const provider=catalog.sources[0];map.getSource('base').setTiles(provider.tiles);lastLayer='osm';post({type:'error',message:'Satellite imagery could not load. Street map is shown.'});}else if(event.sourceId==='base'&&failures===3)post({type:'error',message:'Map tiles could not load. Check your connection. The directory is still available.'});});
