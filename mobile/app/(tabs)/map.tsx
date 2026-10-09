import { KeyboardScrollView as ScrollView } from '@/src/components/keyboard-viewport';
import { KeyboardModal as Modal } from '@/src/components/keyboard-viewport';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {useAuth} from '@/src/auth/auth-context';
import {api} from '@/src/lib/api';
import {useThemeStyles,type Theme} from '@/src/lib/appearance';
import {UNIBEN_UGBOWO_FALLBACK,type CampusPlace} from '@/src/lib/campus-data';
import {insideCampusBoundary,type CampusBoundary} from '@/src/lib/map-boundary';
import {useCampusLocation} from '@/src/lib/campus-location';
import {routeGpsProblem,usableRouteGpsFix} from '@/src/lib/campus-route-location';
import {readCampusMapCache,writeCampusMapCache} from '@/src/lib/campus-map-cache';
import {CampusMapSurface,type MapCoordinate,type MapPayload} from '@/src/components/campus-map-surface';
import {CampusMapDrawer} from '@/src/components/campus-map-drawer';
import {useReducedMotionPreference} from '@/src/components/visual-system';
import {routeProgress} from '@/src/lib/route-progress';
import {readCampusRoute,validMapCoordinate,type CampusRouteResponse} from '@/src/lib/map-response';

type Campus={id:string;name:string;slug:string;latitude:string;longitude:string};
type MapInfo={boundary:CampusBoundary|null;capabilities:{satellite:boolean;threeD:boolean};satellite:{url:string;attribution:string}|null};
type Route=CampusRouteResponse;
type Endpoint={coordinate:MapCoordinate;name:string;placeId?:string};
type Detail={media:{id:string;url:string;media_id?:string|null;attribution:string}[]};
const unibenCampuses:Campus[]=[{id:'1d60dcae-760d-4de7-8443-6a870d9bbe1a',name:'Ugbowo',slug:'ugbowo',latitude:'6.398255',longitude:'5.618838'},{id:'111aadbe-d71e-4062-9daa-26374d8e5d9d',name:'Ekehuan',slug:'ekehuan',latitude:'6.3337',longitude:'5.60015'}];
const emptyFeatures={type:'FeatureCollection',features:[]};
function distance(a:MapCoordinate,b:MapCoordinate){const rad=Math.PI/180,h=Math.sin((a[1]-b[1])*rad/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin((a[0]-b[0])*rad/2)**2;return 12742000*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));}
function coordinates(place:CampusPlace):MapCoordinate|null{
  if(place.latitude===null||place.longitude===null)return null;
  const point:MapCoordinate=[Number(place.longitude),Number(place.latitude)];
  return point.every(Number.isFinite)&&Math.abs(point[0])<=180&&Math.abs(point[1])<=90?point:null;
}
export default function CampusMap(){
  const {profile}=useAuth(),{theme,styles}=useThemeStyles(makeStyles),insets=useSafeAreaInsets(),location=useCampusLocation(),reducedMotion=useReducedMotionPreference();
  const [universityId,setUniversityId]=useState(profile?.university_id??''),[schools,setSchools]=useState<{id:string;name:string}[]>([]),[schoolPicker,setSchoolPicker]=useState(false),[schoolQuery,setSchoolQuery]=useState('');
  const isUniben=universityId===profile?.university_id&&profile?.university_name?.toLowerCase()==='university of benin';
  useEffect(()=>{void api<{universities:{id:string;name:string}[]}>('/v1/student/catalog?institutionsOnly=true').then(r=>setSchools(r.universities)).catch(()=>{});},[]);
  const [campuses,setCampuses]=useState<Campus[]>(isUniben?unibenCampuses:[]),[campusId,setCampusId]=useState(isUniben?unibenCampuses[0]!.id:'');
  const [places,setPlaces]=useState<CampusPlace[]>([]),[features,setFeatures]=useState<unknown>(emptyFeatures),[mapInfo,setMapInfo]=useState<MapInfo|null>(null);
  const [start,setStart]=useState<Endpoint|null>(null),[destination,setDestination]=useState<Endpoint|null>(null),[useCurrent,setUseCurrent]=useState(false),[picker,setPicker]=useState<'origin'|'destination'|null>(null),[query,setQuery]=useState('');
  const [loading,setLoading]=useState(true),[dataError,setDataError]=useState(''),[routeError,setRouteError]=useState(''),[route,setRoute]=useState<Route|null>(null),[routeBusy,setRouteBusy]=useState(false),[detail,setDetail]=useState<Detail|null>(null);
  const [layer,setLayer]=useState('osm'),[focus,setFocus]=useState<MapPayload['focus']>(null),[offCampusDismissed,setOffCampusDismissed]=useState(false),[attempt,setAttempt]=useState(0),[reload,setReload]=useState(0),[sheetHeight,setSheetHeight]=useState(166),[topHeight,setTopHeight]=useState(48);
  const activePath=useRef<Route|null>(null),activeOrigin=useRef<MapCoordinate|null>(null),progress=useRef(0),offPathTicks=useRef(0),lastReroute=useRef(0);
  const latestGps=useRef<{position:MapCoordinate|null;ready:boolean}>({position:null,ready:false});
  const locationSelection=useRef(0);
  const [routeRevision,setRouteRevision]=useState(0);
  const [routeChoices,setRouteChoices]=useState<Route[]>([]),[routeChoice,setRouteChoice]=useState(0);
  const campus=campuses.find(item=>item.id===campusId);
  const centre=useMemo<MapCoordinate>(()=>campus?[Number(campus.longitude),Number(campus.latitude)]:[5.618838,6.398255],[campus]);
  const current=location.position;
  const live=useMemo<MapCoordinate|null>(()=>current?[current.longitude,current.latitude]:null,[current]);
  // A previously good fix can expire while the phone is stationary; invalidate its route even without new GPS events.
  const [locationClock,setLocationClock]=useState(Date.now());
  useEffect(()=>{if(!useCurrent)return;const interval=setInterval(()=>setLocationClock(Date.now()),10000);return()=>clearInterval(interval);},[useCurrent]);
  const locationReady=location.permission==='granted'&&location.servicesEnabled&&location.preciseAllowed&&usableRouteGpsFix(current,Math.max(locationClock,Date.now()));
  latestGps.current={position:live,ready:locationReady};
  const origin=useMemo<Endpoint|null>(()=>useCurrent?(live?{coordinate:live,name:'My current location'}:null):start,[useCurrent,live,start]);
  const outside=Boolean(locationReady&&live&&(mapInfo?.boundary?!insideCampusBoundary(live,mapInfo.boundary):distance(live,centre)>1800));
  const bottomInset=Math.max(insets.bottom,8)+80;
  const onHeightChange=useCallback((height:number)=>setSheetHeight(height),[]);
  useEffect(()=>{
    let active=true;
    void api<{campuses:Campus[]}>(`/v1/maps/campuses?universityId=${encodeURIComponent(universityId)}`).then(result=>{
      if(!active)return;
      const next=Array.isArray(result?.campuses)?result.campuses.filter(item=>Boolean(item&&typeof item.id==='string'&&typeof item.name==='string'&&validMapCoordinate([Number(item.longitude),Number(item.latitude)]))):[];
      const available=next.length?next:isUniben?unibenCampuses:[];
      setCampuses(available);setCampusId(id=>available.some(item=>item.id===id)?id:available[0]?.id??'');
      if(!available.length)setLoading(false);
    }).catch(error=>{if(active){setDataError(error instanceof Error?error.message:'Campus map could not be loaded.');setLoading(false);}});
    return()=>{active=false;};
  },[isUniben,universityId,reload]);
  useEffect(()=>{
    locationSelection.current++;
    setStart(null);setDestination(null);setUseCurrent(false);setPicker(null);setQuery('');setRoute(null);setRouteError('');setLayer('osm');setFocus(null);setOffCampusDismissed(false);
  },[campusId]);
  useEffect(()=>{
    if(!campusId)return;
    let active=true,networkSettled=false;
    const cacheKey=`k1.map.v3.${profile?.university_id}.${campusId}`;
    setLoading(true);setDataError('');setPlaces([]);setFeatures(emptyFeatures);setMapInfo(null);
    void readCampusMapCache<MapInfo>(cacheKey).then(saved=>{
      if(!active||networkSettled||!saved)return;
      setPlaces(saved.places);if(saved.features)setFeatures(saved.features);if(saved.info)setMapInfo(saved.info);
    });
    void Promise.allSettled([
      api<{places:CampusPlace[]}>(`/v1/maps/campuses/${campusId}/places`),
      api<MapInfo>(`/v1/maps/campuses/${campusId}`),
      api<unknown>(`/v1/maps/campuses/${campusId}/features`),
    ]).then(results=>{
      if(!active)return;networkSettled=true;
      const [directory,info,geometry]=results;
      let nextPlaces:CampusPlace[]=[];
      if(directory.status==='fulfilled'){
        nextPlaces=Array.isArray(directory.value?.places)?directory.value.places.filter(place=>Boolean(place&&typeof place.id==='string'&&typeof place.name==='string')):[];
        setPlaces(nextPlaces);
      }else{
        setDataError('Campus updates could not load. Saved places are still available.');
        if(isUniben&&campusId===unibenCampuses[0]!.id)setPlaces(saved=>saved.length?saved:UNIBEN_UGBOWO_FALLBACK);
      }
      const nextInfo=info.status==='fulfilled'?{boundary:info.value?.boundary??null,capabilities:{satellite:Boolean(info.value?.capabilities?.satellite),threeD:Boolean(info.value?.capabilities?.threeD)},satellite:info.value?.satellite??null}:null;
      if(nextInfo)setMapInfo(nextInfo);
      const nextFeatures=geometry.status==='fulfilled'?geometry.value:emptyFeatures;
      if(geometry.status==='fulfilled')setFeatures(nextFeatures);
      if(directory.status==='fulfilled')void writeCampusMapCache(cacheKey,{places:nextPlaces,info:nextInfo,features:nextFeatures}).catch(()=>{});
      setLoading(false);
    });
    return()=>{active=false;};
  },[campusId,profile?.university_id,isUniben,reload]);
  useEffect(()=>{
    let active=true;setDetail(null);
    if(destination?.placeId)void api<Detail>(`/v1/maps/places/${destination.placeId}`).then(async result=>{
      const media=await Promise.all((Array.isArray(result?.media)?result.media:[]).map(async item=>item.media_id?{...item,url:(await api<{url:string}>(`/v1/media/${item.media_id}/access`,{method:'POST'})).url}:item));
      if(active)setDetail({media});
    }).catch(()=>{});
    return()=>{active=false;};
  },[destination?.placeId]);
  // Ignore tiny GPS changes. Selecting a campus start never depends on GPS permission.
  const originBucket=useCurrent?'current':origin?`${origin.coordinate[0].toFixed(4)},${origin.coordinate[1].toFixed(4)}`:'';
  const destinationBucket=destination?`${destination.coordinate[0]},${destination.coordinate[1]},${destination.placeId??''}`:'';
  useEffect(()=>{
    let active=true;
    // Never leave a route or A/B markers visible after a start, campus, GPS-validity or destination change.
    activePath.current=null;activeOrigin.current=null;progress.current=0;offPathTicks.current=0;
    setRoute(null);setRouteChoices([]);setRouteChoice(0);setRouteBusy(false);setRouteError('');
    if(!destination||(!origin&&!useCurrent))return()=>{active=false;};
    if(useCurrent&&!locationReady)return()=>{active=false;};
    if(!origin)return()=>{active=false;};
    if(useCurrent&&outside){
      setRouteError('Your current location is outside this campus. Choose a campus starting point.');
      return()=>{active=false;};
    }
    const requestedOrigin=origin.coordinate;
    setRouteBusy(true);
    void api<unknown>('/v1/maps/route',{method:'POST',body:JSON.stringify({campusId,origin:requestedOrigin,...(start?.placeId&&!useCurrent?{originPlaceId:start.placeId}:{}),...(destination.placeId?{destinationId:destination.placeId}:{destination:destination.coordinate})})}).then(readCampusRoute).then(result=>{
      if(!active)return;
      // A slow response must not revive directions calculated from an older device position.
      const gps=latestGps.current;
      if(useCurrent&&(!gps.ready||!gps.position||distance(requestedOrigin,gps.position)>70)){
        setRouteError('Your GPS position changed while directions were loading. Recalculating…');
        setAttempt(value=>value+1);
        return;
      }
      setRouteChoices([result,...(result.alternatives??[])]);
      setRouteChoice(0);activePath.current=result;activeOrigin.current=requestedOrigin;
      progress.current=0;offPathTicks.current=0;setRoute(result);setRouteRevision(v=>v+1);setRouteError('');
    }).catch(error=>{if(active)setRouteError(error instanceof Error?error.message:'Directions could not load. Try another mapped point.');}).finally(()=>{if(active)setRouteBusy(false);});
    return()=>{active=false;};
  },[campusId,originBucket,start?.placeId,destinationBucket,useCurrent,locationReady,outside,attempt]);
  // A stationary device may stop delivering measurements. Refresh once instead of leaving an expired fix stranded.
  useEffect(()=>{
    if(useCurrent&&destinationBucket&&!locationReady&&!location.loading&&!location.error&&current?.source==='live')void location.retryLocation();
  },[useCurrent,destinationBucket,locationReady,location.loading,location.error,current?.source,location.retryLocation]);
  useEffect(()=>{
    if(!useCurrent||!live||!activePath.current||!current||!locationReady)return;
    const update=routeProgress(activePath.current,live,progress.current),accuracy=current.accuracy??999;
    // Ignore GPS jitter around the original path snap. Re-route only after real displacement and repeated off-path fixes.
    const displacement=activeOrigin.current?distance(activeOrigin.current,live):0;
    if(update.offPathMetres>Math.max(45,accuracy*2.5)&&displacement>Math.max(60,accuracy*2.5)){
      // A single confirmed relocation hundreds of metres away must clear the old A/B route immediately.
      if(displacement>180&&update.offPathMetres>150||++offPathTicks.current>=2){
        activePath.current=null;activeOrigin.current=null;offPathTicks.current=0;
        setRoute(null);setRouteChoices([]);setRouteChoice(0);
        if(Date.now()-lastReroute.current>10000){
          lastReroute.current=Date.now();setRouteError('Recalculating directions from your new position…');setAttempt(v=>v+1);
        }else setRouteError('Your location changed. Tap Retry to recalculate directions.');
      }
      return;
    }
    offPathTicks.current=0;
    if(update.route&&update.progressMetres>=progress.current){progress.current=update.progressMetres;setRoute(update.route);}
  },[live,useCurrent,locationReady]);
  const choose=useCallback((kind:'origin'|'destination')=>{setPicker(kind);setQuery('');setRouteError('');},[]);
  const setEndpoint=useCallback((endpoint:Endpoint)=>{
    if(picker==='origin'){locationSelection.current++;setStart(endpoint);setUseCurrent(false);}else setDestination(endpoint);
    setPicker(null);setQuery('');setAttempt(value=>value+1);
    setFocus({coordinate:endpoint.coordinate,nonce:Date.now(),zoom:17});
  },[picker]);
  const pick=useCallback((id:string)=>{
    const place=places.find(item=>item.id===id);if(!place)return;
    const coordinate=coordinates(place);if(!coordinate){setRouteError('This place has not had its position mapped yet. Try a nearby mapped entrance.');return;}
    setEndpoint({coordinate,name:place.name,placeId:place.id});
  },[places,setEndpoint]);
  const pickPoint=useCallback((coordinate:MapCoordinate)=>{
    if(!picker)return;
    if(mapInfo?.boundary?!insideCampusBoundary(coordinate,mapInfo.boundary):distance(coordinate,centre)>4000){setRouteError('Choose a point within this campus, or switch campuses above.');return;}
    setEndpoint({coordinate,name:picker==='origin'?'Map starting point':'Destination pin'});
  },[picker,mapInfo,centre,setEndpoint]);
  const locate=async()=>{
    const selection=++locationSelection.current;
    setPicker(null);setQuery('');setUseCurrent(true);setStart(null);
    const position=await location.requestLocation();
    if(selection!==locationSelection.current)return;
    if(position&&usableRouteGpsFix(position,Date.now())){
      setFocus({coordinate:[position.longitude,position.latitude],nonce:Date.now(),zoom:18});
    }
  };
  const clear=()=>{locationSelection.current++;activePath.current=null;activeOrigin.current=null;setRoute(null);setDestination(null);setStart(null);setUseCurrent(false);setPicker(null);setQuery('');setRouteError('');};
  const swap=()=>{if(!origin||!destination)return;locationSelection.current++;setStart(destination);setDestination(origin);setUseCurrent(false);setPicker(null);setAttempt(value=>value+1);};
  const retry=()=>{
    if(useCurrent&&!locationReady){if(!location.loading)void locate();return;}
    setAttempt(value=>value+1);
    if(dataError)setReload(value=>value+1);
  };
  const mapError=useCallback((message:string)=>setDataError(message),[]);
  const visibleRoute=useCurrent&&(!locationReady||outside)?null:route;
  const needsLocation=useCurrent&&Boolean(destination)&&!locationReady;
  const gpsBusy=needsLocation&&location.loading&&!location.error;
  const directionsError=needsLocation?(location.error||(!location.loading?routeGpsProblem(current):'')):routeError||dataError;
  const locationSettingsNeeded=location.permission==='denied'||!location.servicesEnabled||!location.preciseAllowed;
  const payload=useMemo<MapPayload>(()=>({campusId,centre,places,features,selectedId:destination?.placeId??null,originId:start?.placeId??null,origin:useCurrent?(visibleRoute?live:null):origin?.coordinate??null,originIsLive:useCurrent,destination:destination?.coordinate??null,location:live,route:visibleRoute?.geometry??null,routeKey:String(routeRevision),layer,focus,pickMode:picker,satellite:mapInfo?.satellite??null,reducedMotion,padding:{top:topHeight+24+(picker||(outside&&!offCampusDismissed)?48:0),bottom:bottomInset+sheetHeight+12-insets.bottom,left:24,right:58}}),[campusId,centre,places,features,destination,start,origin,live,useCurrent,visibleRoute,routeRevision,layer,focus,picker,mapInfo,reducedMotion,insets.bottom,topHeight,bottomInset,sheetHeight,outside,offCampusDismissed]);
  return <View style={styles.page}>
    <Modal visible={schoolPicker} animationType="slide" onRequestClose={()=>setSchoolPicker(false)}><View style={{flex:1,padding:22,paddingTop:insets.top+22,backgroundColor:theme.canvas}}><View style={{flexDirection:'row',alignItems:'center',marginBottom:20}}><Text style={{flex:1,fontFamily:theme.font.displayStrong,fontSize:25,color:theme.text}}>Choose your university</Text><Pressable accessibilityLabel="Close university picker" onPress={()=>setSchoolPicker(false)} style={styles.icon}><Ionicons name="close" size={24} color={theme.text}/></Pressable></View><TextInput value={schoolQuery} onChangeText={setSchoolQuery} placeholder="Find a university" placeholderTextColor={theme.textMuted} style={{padding:16,borderRadius:16,backgroundColor:theme.surfaceMuted,fontFamily:theme.font.body,color:theme.text}}/><ScrollView keyboardShouldPersistTaps="handled">{schools.filter(s=>s.name.toLowerCase().includes(schoolQuery.toLowerCase())).map(s=><Pressable key={s.id} accessibilityRole="button" onPress={()=>{setUniversityId(s.id);setSchoolPicker(false);setSchoolQuery('');}} style={{paddingVertical:19,borderBottomWidth:1,borderColor:theme.border}}><Text style={{fontFamily:theme.font.medium,color:theme.text}}>{s.name}</Text></Pressable>)}</ScrollView></View></Modal>

    {campus?<CampusMapSurface key={reload} payload={payload} safeInsets={insets} onPick={pick} onPoint={pickPoint} onError={mapError}/>:<View style={styles.empty}><Text style={styles.emptyText}>{loading?'Loading your campus…':'Your campus map is awaiting publication'}</Text><Pressable onPress={retry}><Text style={styles.link}>Try again</Text></Pressable></View>}
    <View onLayout={event=>setTopHeight(event.nativeEvent.layout.height)} style={[styles.top,{top:insets.top+8}]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Choose university map" onPress={()=>setSchoolPicker(true)} style={[styles.campus,{backgroundColor:theme.surface,flexDirection:'row',alignItems:'center',gap:6,maxWidth:'100%'}]}><Ionicons name="school-outline" size={16} color={theme.deepBrand}/><Text numberOfLines={1} style={[styles.campusText,{flexShrink:1}]}>{schools.find(s=>s.id===universityId)?.name??profile?.university_name??'Choose university'}</Text><Ionicons name="chevron-down" size={16} color={theme.text}/></Pressable>
      <View style={styles.campuses}>{campuses.map(item=><Pressable accessibilityRole="button" accessibilityState={{selected:item.id===campusId}} key={item.id} style={[styles.campus,item.id===campusId&&styles.campusSelected]} onPress={()=>setCampusId(item.id)}><Text style={[styles.campusText,item.id===campusId&&styles.selectedText]}>{item.name.replace(/ campus/i,'')}</Text></Pressable>)}</View>
      <View style={styles.layers}>{[{id:'osm',label:'Map',icon:'map-outline',enabled:true},{id:'satellite',label:'Satellite',icon:'planet-outline',enabled:mapInfo?.capabilities.satellite},{id:'3d',label:'Buildings',icon:'cube-outline',enabled:mapInfo?.capabilities.threeD}].filter(item=>item.enabled).map(item=><Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.id==='3d'?'Show campus buildings in 3D':item.label} accessibilityState={{selected:layer===item.id}} onPress={()=>setLayer(item.id)} style={[styles.layer,layer===item.id&&styles.campusSelected]}><Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={16} color={layer===item.id?'#fff':theme.deepBrand}/><Text style={[styles.layerText,layer===item.id&&styles.selectedText]}>{item.label}</Text></Pressable>)}</View>
    </View>
    {layer==='3d'?<View pointerEvents="none" style={[styles.notice,{top:insets.top+topHeight+16}]}><Text style={styles.noticeText}>Building footprints are sourced; missing heights are approximate.</Text></View>:null}
    {picker?<View style={[styles.notice,{top:insets.top+topHeight+16}]}><Ionicons name="pin-outline" size={18} color={theme.deepBrand}/><Text style={styles.noticeText}>Tap a place or path for your {picker==='origin'?'starting point':'destination'}.</Text><Pressable accessibilityLabel="Cancel map point selection" onPress={()=>setPicker(null)} style={styles.cancel}><Ionicons name="close" size={19} color={theme.text}/></Pressable></View>:outside&&!offCampusDismissed?<View style={[styles.notice,{top:insets.top+topHeight+16}]}><Text style={styles.noticeText}>Outside campus? Plan your walk using From and To below.</Text><Pressable accessibilityLabel="Dismiss campus notice" onPress={()=>setOffCampusDismissed(true)} style={styles.cancel}><Ionicons name="close" size={19} color={theme.text}/></Pressable></View>:null}
    <View style={[styles.controls,{bottom:bottomInset+sheetHeight+18}]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Return to campus overview" style={styles.icon} onPress={()=>setFocus({coordinate:centre,nonce:Date.now(),zoom:15.5})}><Ionicons name="school-outline" size={21} color={theme.deepBrand}/></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Use my current location as a starting point" disabled={location.loading} style={[styles.icon,location.loading&&{opacity:.5}]} onPress={()=>void locate()}><Ionicons name="locate-outline" size={21} color={theme.deepBrand}/></Pressable>
    </View>
    <CampusMapDrawer campusId={campusId} bottomInset={bottomInset} topInset={insets.top} picker={picker} originName={useCurrent?'My current location':origin?.name??null} destinationName={destination?.name??null} destinationApproximate={Boolean(destination?.placeId&&places.find(place=>place.id===destination.placeId)?.verified_at===null)} error={directionsError} loading={loading} routeBusy={routeBusy||gpsBusy} busyMessage={gpsBusy?'Getting your current location…':''} locationRecovery={needsLocation&&!gpsBusy} locationSettingsNeeded={locationSettingsNeeded} onLocationSettings={()=>void location.openLocationSettings()} places={places} query={query} route={visibleRoute} alternatives={visibleRoute?routeChoices:[]} selectedRoute={routeChoice} onSelectRoute={index=>{const chosen=routeChoices[index];if(chosen){activePath.current=chosen;progress.current=0;offPathTicks.current=0;setRouteChoice(index);setRoute(chosen);setRouteRevision(v=>v+1);}}} photo={detail?.media[0]??null} locationError={location.error} locationLoading={location.loading} onClearRoute={clear} onPickPlace={pick} onChoose={choose} onPickOnMap={()=>{if(!picker)setPicker('destination');setQuery('');}} onQueryChange={setQuery} onUseCurrentLocation={()=>void locate()} onSwap={swap} onRetry={retry} onHeightChange={onHeightChange}/>
  </View>;
}
const makeStyles=(theme:Theme)=>StyleSheet.create({
  page:{flex:1,backgroundColor:theme.surfaceMuted},top:{position:'absolute',left:10,right:10,flexDirection:'row',gap:6,justifyContent:'space-between',flexWrap:'wrap'},campuses:{flexDirection:'row',gap:2,padding:3,borderRadius:18,backgroundColor:theme.surface,elevation:3},campus:{paddingVertical:11,paddingHorizontal:12,borderRadius:15},campusSelected:{backgroundColor:theme.deepBrand},campusText:{fontFamily:theme.font.semibold,color:theme.text,fontSize:12},selectedText:{color:'#fff'},layers:{flexDirection:'row',gap:3,padding:3,borderRadius:17,backgroundColor:theme.surface,elevation:3},layer:{minHeight:40,paddingHorizontal:9,borderRadius:14,alignItems:'center',justifyContent:'center',gap:2},layerText:{fontFamily:theme.font.medium,fontSize:9,color:theme.text},icon:{width:42,height:42,borderRadius:15,backgroundColor:theme.surface,alignItems:'center',justifyContent:'center',elevation:3},controls:{position:'absolute',right:12,gap:8},notice:{position:'absolute',left:10,right:10,backgroundColor:theme.surface,borderRadius:12,paddingHorizontal:12,minHeight:44,flexDirection:'row',gap:8,alignItems:'center',elevation:3},noticeText:{flex:1,fontFamily:theme.font.body,fontSize:11.5,lineHeight:17,color:theme.textMuted},cancel:{minHeight:40,width:30,alignItems:'center',justifyContent:'center'},link:{fontFamily:theme.font.semibold,fontSize:13,color:theme.deepBrand,padding:12},empty:{flex:1,alignItems:'center',justifyContent:'center',padding:24},emptyText:{fontFamily:theme.font.semibold,color:theme.text,fontSize:14},
});
