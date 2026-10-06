import AsyncStorage from '@react-native-async-storage/async-storage';
import {Ionicons} from '@expo/vector-icons';
import * as Haptics from '@/src/lib/haptics';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Animated,Image,Keyboard,PanResponder,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,useWindowDimensions,View} from 'react-native';
import {useReducedMotionPreference} from '@/src/components/visual-system';
import {useThemeStyles,type Theme} from '@/src/lib/appearance';

type IconName=keyof typeof Ionicons.glyphMap;
export type CampusMapDrawerPlace={id:string;name:string;category:string;description:string|null;verified_at?:string|null;search_aliases?:readonly string[]|null};
type RouteSummary={distanceMetres:number;durationSeconds:number;notice:string|null;instructions:string[]};
type Props={
  campusId:string;bottomInset:number;topInset:number;error:string;loading:boolean;routeBusy:boolean;
  places:CampusMapDrawerPlace[];query:string;picker:'origin'|'destination'|null;
  originName:string|null;destinationName:string|null;destinationApproximate?:boolean;route:RouteSummary|null;
  alternatives:RouteSummary[];selectedRoute:number;onSelectRoute:(index:number)=>void;
  locationError:string;locationLoading:boolean;photo:{url:string;attribution:string}|null;
  onQueryChange:(value:string)=>void;onPickPlace:(id:string)=>void;
  onChoose:(kind:'origin'|'destination')=>void;onPickOnMap:()=>void;
  onUseCurrentLocation:()=>void;onClearRoute:()=>void;onSwap:()=>void;
  onRetry:()=>void;onHeightChange:(height:number)=>void;
};
const RECENTS_KEY='k1.campus-map.recent-destinations.v1';
const categoryIcons:Record<string,IconName>={ACADEMIC:'school-outline',FOOD:'restaurant-outline',HEALTH:'medkit-outline',HOSTEL:'bed-outline',SERVICE:'help-buoy-outline',SPORT:'football-outline',TRANSPORT:'bus-outline'};
export function formatMapDistance(metres:number){return metres<1000?`${Math.round(metres)} m`:`${(metres/1000).toFixed(1)} km`;}
export function CampusMapDrawer({campusId,bottomInset,topInset,error,loading,routeBusy,places,query,picker,originName,destinationName,destinationApproximate=false,route,alternatives,selectedRoute,onSelectRoute,locationError,locationLoading,photo,onQueryChange,onPickPlace,onChoose,onPickOnMap,onUseCurrentLocation,onClearRoute,onSwap,onRetry,onHeightChange}:Props){
  const {theme,styles}=useThemeStyles(makeStyles),{height}=useWindowDimensions(),reducedMotion=useReducedMotionPreference();
  const [expanded,setExpanded]=useState(false),[recentIds,setRecentIds]=useState<string[]>([]),[keyboard,setKeyboard]=useState(0);
  const collapsedHeight=route||routeBusy||error?202:166;
  const sheetBottom=keyboard>0?(Platform.OS==='ios'?keyboard+8:bottomInset):bottomInset;
  const maximumHeight=Math.max(collapsedHeight,Math.min(520,height-sheetBottom-topInset-82));
  const targetHeight=expanded?maximumHeight:collapsedHeight;
  const sheetHeight=useRef(new Animated.Value(targetHeight)).current,dragStart=useRef(targetHeight),previousPicker=useRef(picker);
  useEffect(()=>{
    const show=Keyboard.addListener('keyboardDidShow',event=>setKeyboard(event.endCoordinates.height));
    const hide=Keyboard.addListener('keyboardDidHide',()=>setKeyboard(0));
    return()=>{show.remove();hide.remove();};
  },[]);
  useEffect(()=>{
    let active=true;setRecentIds([]);
    void AsyncStorage.getItem(`${RECENTS_KEY}.${campusId}`).then(value=>{
      if(!active||!value)return;const parsed:unknown=JSON.parse(value);
      if(Array.isArray(parsed))setRecentIds(parsed.filter((item):item is string=>typeof item==='string').slice(0,5));
    }).catch(()=>{});
    return()=>{active=false;};
  },[campusId]);
  useEffect(()=>{
    onHeightChange(targetHeight);
    if(reducedMotion){sheetHeight.setValue(targetHeight);return;}
    const animation=Animated.spring(sheetHeight,{toValue:targetHeight,useNativeDriver:false,damping:23,stiffness:210,mass:.75});
    animation.start();return()=>animation.stop();
  },[targetHeight,reducedMotion,sheetHeight,onHeightChange]);
  useEffect(()=>{if(previousPicker.current&&!picker)setExpanded(false);previousPicker.current=picker;},[picker]);
  const pan=useMemo(()=>PanResponder.create({
    onStartShouldSetPanResponder:()=>true,onMoveShouldSetPanResponder:(_,gesture)=>Math.abs(gesture.dy)>3,
    onPanResponderGrant:()=>sheetHeight.stopAnimation(value=>{dragStart.current=value;}),
    onPanResponderMove:(_,gesture)=>sheetHeight.setValue(Math.max(collapsedHeight,Math.min(maximumHeight,dragStart.current-gesture.dy))),
    onPanResponderRelease:(_,gesture)=>{setExpanded(gesture.vy<-.35||(gesture.vy<=.35&&dragStart.current-gesture.dy>(collapsedHeight+maximumHeight)/2));void Haptics.selectionAsync();},
    onPanResponderTerminate:()=>sheetHeight.setValue(targetHeight),
  }),[sheetHeight,collapsedHeight,maximumHeight,targetHeight]);
  const results=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    if(needle)return places.filter(place=>`${place.name} ${place.description??''} ${place.search_aliases?.join(' ')??''}`.toLowerCase().includes(needle)).sort((a,b)=>Number(b.name.toLowerCase()===needle)-Number(a.name.toLowerCase()===needle)||Number(b.name.toLowerCase().startsWith(needle))-Number(a.name.toLowerCase().startsWith(needle))||a.name.localeCompare(b.name)).slice(0,30);
    const recent=recentIds.map(id=>places.find(place=>place.id===id)).filter((place):place is CampusMapDrawerPlace=>Boolean(place));
    return [...recent,...places.filter(place=>!recentIds.includes(place.id))].slice(0,24);
  },[query,places,recentIds]);
  const pick=(place:CampusMapDrawerPlace)=>{
    if(picker!=='origin'){
      const next=[place.id,...recentIds.filter(id=>id!==place.id)].slice(0,5);setRecentIds(next);
      void AsyncStorage.setItem(`${RECENTS_KEY}.${campusId}`,JSON.stringify(next)).catch(()=>{});
    }
    Keyboard.dismiss();setExpanded(false);onPickPlace(place.id);void Haptics.selectionAsync();
  };
  const choose=(kind:'origin'|'destination')=>{onChoose(kind);setExpanded(true);};
  return <Animated.View style={[styles.sheet,{height:sheetHeight,bottom:sheetBottom}]}>
    <View {...pan.panHandlers} style={styles.handleArea}><View style={styles.handle}/></View>
    <View style={styles.header}>
      <Text style={styles.title}>{picker==='origin'?'Choose a starting point':picker==='destination'?'Choose a destination':'Campus directions'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={expanded?'Collapse directions':'Expand directions'} accessibilityState={{expanded}} onPress={()=>setExpanded(value=>!value)} style={styles.smallButton}><Ionicons name={expanded?'chevron-down':'chevron-up'} size={19} color={theme.text}/></Pressable>
      {destinationName||originName?<Pressable accessibilityRole="button" accessibilityLabel="Clear directions" onPress={onClearRoute} style={styles.smallButton}><Ionicons name="close" size={20} color={theme.text}/></Pressable>:null}
    </View>
    <View style={styles.endpoints}>
      <View style={styles.endpointFields}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Starting point: ${originName??'Choose on campus'}`} onPress={()=>choose('origin')} style={styles.endpoint}>
          <View style={[styles.dot,{backgroundColor:'#428872'}]}/><Text style={styles.fieldLabel}>From</Text><Text numberOfLines={1} style={styles.endpointName}>{originName??'Choose a campus start'}</Text><Ionicons name="chevron-forward" size={14} color={theme.textMuted}/>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Destination: ${destinationName??'Choose on campus'}`} onPress={()=>choose('destination')} style={styles.endpoint}>
          <Ionicons name="location" size={13} color={theme.deepBrand}/><Text style={styles.fieldLabel}>To</Text><Text numberOfLines={1} style={styles.endpointName}>{destinationName??'Where on campus?'}</Text><Ionicons name="chevron-forward" size={14} color={theme.textMuted}/>
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Swap starting point and destination" disabled={!originName||!destinationName} onPress={onSwap} style={[styles.swap,(!originName||!destinationName)&&{opacity:.35}]}><Ionicons name="swap-vertical" size={21} color={theme.deepBrand}/></Pressable>
    </View>
    {route||routeBusy||error?<View style={styles.summary}>
      <Ionicons name={error?'alert-circle-outline':'walk-outline'} size={17} color={error?theme.error:theme.deepBrand}/>
      <Text numberOfLines={1} style={styles.summaryText}>{error|| (routeBusy?'Finding a mapped walking route…':route?`${Math.max(1,Math.ceil(route.durationSeconds/60))} min walk · ${formatMapDistance(route.distanceMetres)}`:'')}</Text>
      {error?<Pressable accessibilityRole="button" accessibilityLabel="Retry map request" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable>:null}
    </View>:null}
    {expanded?<ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      {picker||!destinationName?<>
        <View style={styles.searchBox}><Ionicons name="search" size={19} color={theme.textMuted}/><TextInput accessibilityLabel={picker==='origin'?'Search starting places':'Search campus destinations'} value={query} onChangeText={onQueryChange} placeholder="Search places, halls or lecture theatres" placeholderTextColor={theme.textMuted} style={styles.searchInput} autoCorrect={false} returnKeyType="search"/></View>
        <Pressable accessibilityRole="button" onPress={()=>{Keyboard.dismiss();setExpanded(false);onPickOnMap();}} style={styles.actionRow}><Ionicons name="pin-outline" size={20} color={theme.deepBrand}/><Text style={styles.actionText}>Choose a point on the map</Text><Ionicons name="chevron-forward" size={16} color={theme.textMuted}/></Pressable>
        {picker==='origin'?<Pressable accessibilityRole="button" disabled={locationLoading} onPress={()=>{Keyboard.dismiss();setExpanded(false);onUseCurrentLocation();}} style={styles.actionRow}><Ionicons name="locate-outline" size={20} color={theme.deepBrand}/><View style={{flex:1}}><Text style={styles.actionText}>{locationLoading?'Getting your location…':'Use my current location'}</Text><Text style={styles.helper}>{locationError||'Optional. You can plan from anywhere on campus.'}</Text></View></Pressable>:null}
        {loading?<Text style={styles.helper}>Loading campus places…</Text>:null}
        <Text style={styles.section}>{query.trim()?'Matching places':'Campus places'}</Text>
        {results.map(place=><Pressable accessibilityRole="button" key={place.id} onPress={()=>pick(place)} style={styles.place}><View style={styles.placeIcon}><Ionicons name={categoryIcons[place.category]??'location-outline'} size={20} color={theme.deepBrand}/></View><View style={{flex:1,minWidth:0}}><Text numberOfLines={1} style={styles.placeName}>{place.name}</Text><Text numberOfLines={1} style={styles.helper}>{place.category.toLowerCase().replace(/_/g,' ')}{place.verified_at===null?' · Approximate location':''}</Text></View><Ionicons name="chevron-forward" size={16} color={theme.textMuted}/></Pressable>)}
        {!loading&&!results.length?<Text style={styles.helper}>{query?'No matching place. Try an alias or select a point on the map.':'This campus directory is awaiting mapped places.'}</Text>:null}
      </>:<>
        {destinationApproximate?<View style={styles.routeNotice}><Ionicons name="information-circle-outline" size={18} color={theme.deepBrand}/><Text style={[styles.helper,{flex:1}]}>Approximate location. Follow local signs for the entrance.</Text></View>:null}
        {!originName?<Pressable accessibilityRole="button" onPress={()=>choose('origin')} style={styles.actionRow}><Ionicons name="navigate-outline" size={20} color={theme.deepBrand}/><Text style={styles.actionText}>Choose where your walk starts</Text><Ionicons name="chevron-forward" size={16} color={theme.textMuted}/></Pressable>:null}
        {photo?<View style={styles.photoRow}><Image source={{uri:photo.url}} style={styles.photo}/><Text style={[styles.helper,{flex:1}]}>{photo.attribution}</Text></View>:null}
        {alternatives.length>1?<><Text style={styles.section}>Choose a walking route</Text><View style={{flexDirection:'row',gap:8}}>{alternatives.map((option,index)=><Pressable key={index} accessibilityRole="button" accessibilityState={{selected:selectedRoute===index}} onPress={()=>onSelectRoute(index)} style={{flex:1,padding:12,borderRadius:14,borderWidth:1,borderColor:selectedRoute===index?theme.deepBrand:theme.border,backgroundColor:selectedRoute===index?theme.surfaceTint:theme.surface}}><Text style={{color:theme.text,fontFamily:theme.font.semibold,fontSize:12}}>{Math.max(1,Math.ceil(option.durationSeconds/60))} min</Text><Text style={styles.helper}>{index===0?'Shortest':`Route ${index+1}`} · {formatMapDistance(option.distanceMetres)}</Text></Pressable>)}</View></>:null}
        {route?.notice?<View style={styles.routeNotice}><Ionicons name="information-circle-outline" size={18} color={theme.deepBrand}/><Text style={[styles.helper,{flex:1}]}>{route.notice}</Text></View>:null}
        {route?.instructions.length?<><Text style={styles.section}>Mapped paths</Text>{route.instructions.map((instruction,index)=><View key={`${index}.${instruction}`} style={styles.instruction}><Text style={styles.step}>{index+1}</Text><Text style={styles.actionText}>{instruction}</Text></View>)}</>:null}
        <Text style={styles.helper}>Walking routes follow mapped campus paths. Check signs and local access conditions as you go.</Text>
      </>}
    </ScrollView>:null}
  </Animated.View>;
}
const makeStyles=(theme:Theme)=>StyleSheet.create({
  sheet:{position:'absolute',left:8,right:8,backgroundColor:theme.surfaceRaised,borderWidth:1,borderColor:theme.border,borderRadius:22,overflow:'hidden',...theme.shadow},
  handleArea:{height:20,alignItems:'center',justifyContent:'center'},handle:{height:4,width:44,borderRadius:4,backgroundColor:theme.border},
  header:{height:34,paddingLeft:16,paddingRight:8,flexDirection:'row',alignItems:'center'},title:{flex:1,color:theme.text,fontFamily:theme.font.semibold,fontSize:14},smallButton:{width:36,height:34,alignItems:'center',justifyContent:'center'},
  endpoints:{flexDirection:'row',paddingHorizontal:12,gap:6},endpointFields:{flex:1,backgroundColor:theme.surfaceMuted,borderRadius:12,paddingHorizontal:10},endpoint:{height:44,flexDirection:'row',alignItems:'center',gap:7},fieldLabel:{width:31,color:theme.textMuted,fontFamily:theme.font.body,fontSize:11},endpointName:{flex:1,color:theme.text,fontFamily:theme.font.medium,fontSize:12.5},dot:{width:9,height:9,borderRadius:6,marginHorizontal:2},swap:{width:38,alignItems:'center',justifyContent:'center'},
  summary:{height:40,flexDirection:'row',alignItems:'center',gap:7,paddingHorizontal:16},summaryText:{flex:1,color:theme.text,fontFamily:theme.font.medium,fontSize:12},retry:{padding:8},retryText:{color:theme.deepBrand,fontFamily:theme.font.semibold,fontSize:11},
  content:{paddingHorizontal:16,paddingTop:10,paddingBottom:22,gap:8},searchBox:{minHeight:48,backgroundColor:theme.surfaceMuted,borderRadius:12,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:8},searchInput:{flex:1,color:theme.text,fontFamily:theme.font.body,fontSize:12,paddingVertical:10},
  actionRow:{minHeight:48,flexDirection:'row',alignItems:'center',gap:10},actionText:{flex:1,color:theme.text,fontFamily:theme.font.medium,fontSize:12.5},helper:{color:theme.textMuted,fontFamily:theme.font.body,fontSize:11.5,lineHeight:17},section:{color:theme.textMuted,fontFamily:theme.font.semibold,fontSize:11,marginTop:5},place:{minHeight:58,flexDirection:'row',alignItems:'center',gap:11},placeIcon:{width:38,height:38,borderRadius:12,backgroundColor:theme.surfaceMuted,alignItems:'center',justifyContent:'center'},placeName:{color:theme.text,fontFamily:theme.font.semibold,fontSize:12.5},
  routeNotice:{flexDirection:'row',alignItems:'flex-start',gap:8,padding:12,backgroundColor:theme.surfaceMuted,borderRadius:12},photoRow:{flexDirection:'row',gap:12,alignItems:'center'},photo:{width:62,height:62,borderRadius:10},instruction:{flexDirection:'row',alignItems:'center',gap:10,minHeight:40},step:{color:theme.deepBrand,fontFamily:theme.font.semibold,width:24,fontSize:12},
});
