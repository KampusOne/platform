import {useCallback,useEffect,useMemo,useState} from 'react';
import {router,useLocalSearchParams} from 'expo-router';
import {Pressable,Text,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {CampusMapSurface,type MapPayload} from '@/src/components/campus-map-surface';
import {api} from '@/src/lib/api';
import {useAppearance} from '@/src/lib/appearance';
type Route={campusId:string;centre:[number,number];distanceMetres:number;geometry:unknown;quotedDeliveryRoute:{distanceMetres:number;geometry:unknown}|null;pickupName:string;pricingNote:string};
export default function DeliveryRoute(){
 const {jobId}=useLocalSearchParams<{jobId:string}>(),{theme}=useAppearance(),insets=useSafeAreaInsets();
 const [route,setRoute]=useState<Route|null>(null),[error,setError]=useState(''),[leg,setLeg]=useState<'pickup'|'customer'>('pickup'),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let active=true;void api<{route:Route}>(`/v1/agents/deliveries/${jobId}/route`).then(r=>{if(active){setRoute(r.route);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[jobId,attempt]);
 const onError=useCallback((message:string)=>setError(message),[]);
 const selected=leg==='customer'?route?.quotedDeliveryRoute:route;
 const payload=useMemo<MapPayload|null>(()=>route?{campusId:route.campusId,centre:route.centre,places:[],features:{type:'FeatureCollection',features:[]},selectedId:null,location:null,route:selected?.geometry??null,layer:'osm',focus:null,satellite:null}:null,[route,selected]);
 return <View style={{flex:1,backgroundColor:theme.surface}}>{payload?<CampusMapSurface payload={payload} onPick={()=>{}} onError={onError}/>:null}
  <View style={{position:'absolute',bottom:insets.bottom+16,left:16,right:16,backgroundColor:theme.surface,padding:16,borderRadius:18,gap:12}}>
   <Pressable accessibilityRole="button" onPress={()=>router.back()}><Text style={{color:theme.deepBrand,fontFamily:theme.font.semibold}}>Back to deliveries</Text></Pressable>
   <Text style={{color:theme.text,fontFamily:theme.font.display,fontSize:20}}>{leg==='pickup'?`Route to ${route?.pickupName??'pickup'}`:'Quoted route to customer'}</Text>
   {route?.quotedDeliveryRoute?<View style={{flexDirection:'row',gap:20}}>{(['pickup','customer']as const).map(l=><Pressable key={l} accessibilityRole="tab" accessibilityState={{selected:leg===l}} onPress={()=>setLeg(l)}><Text style={{color:leg===l?theme.deepBrand:theme.textMuted,fontFamily:theme.font.semibold}}>{l==='pickup'?'To pickup':'To customer'}</Text></Pressable>)}</View>:null}
   <Text style={{color:theme.textMuted,fontFamily:theme.font.body}}>{selected?`${(selected.distanceMetres/1000).toFixed(2)} km along the mapped route`:'Loading your route…'}</Text>
   {route?<Text style={{color:theme.textMuted,fontFamily:theme.font.body,fontSize:12}}>{route.pricingNote}</Text>:null}
   {error?<><Text accessibilityRole="alert" style={{color:theme.error}}>{error}</Text><Pressable onPress={()=>setAttempt(n=>n+1)}><Text style={{color:theme.deepBrand}}>Try again</Text></Pressable></>:null}
  </View>
 </View>;
}
