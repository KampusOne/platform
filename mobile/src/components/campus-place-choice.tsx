import {useEffect,useState} from "react";
import {Pressable,Text,View} from "react-native";
import {api} from "@/src/lib/api";
import {useAppearance} from "@/src/lib/appearance";
import {ToolField} from "./toolkit";
import {RetryIconButton} from './retry-icon-button';
export type CampusPlace = {id:string;name:string;campus_id?:string;campus_name?:string;delivery_zone_id?:string|null};
export function CampusPlaceChoice({label,value,onChange,onSelect,endpoint='/v1/student/delivery-places',options,disabled=false}:{label:string;value:string|null;onChange:(id:string|null)=>void;onSelect?:(place:CampusPlace)=>void;endpoint?:string;options?:CampusPlace[];disabled?:boolean}){
  const {theme}=useAppearance();const [places,setPlaces]=useState<CampusPlace[]>([]),[query,setQuery]=useState(''),[error,setError]=useState(''),[revision,setRevision]=useState(0),[loading,setLoading]=useState(false);
  useEffect(()=>{if(options!==undefined)return;let mounted=true;const controller=new AbortController();setLoading(true);setError('');void api<{places?:CampusPlace[];pickupPoints?:CampusPlace[]}>(endpoint,{signal:controller.signal,cache:'reload'}).then(r=>{if(mounted)setPlaces(r.places??r.pickupPoints??[]);}).catch(error=>{if(mounted)setError(error instanceof Error?error.message:'Map points could not load.');}).finally(()=>{if(mounted)setLoading(false);});return()=>{mounted=false;controller.abort();};},[endpoint,revision,options]);
  const choices=options??places;
  useEffect(()=>{const selected=choices.find(p=>p.id===value);if(selected)setQuery(selected.name);else if(!value)setQuery('');},[value,choices]);
  return <View style={{gap:8,marginVertical:12}}><Text style={{color:theme.text,fontFamily:theme.font.semibold}}>{label}</Text><ToolField label="Find a campus location" value={query} onChangeText={setQuery} editable={!disabled}/>
    <Pressable accessibilityRole="radio" accessibilityState={{checked:!value}} disabled={disabled} onPress={()=>onChange(null)} style={{padding:14,minHeight:48}}><Text style={{color:theme.text}}>{!value?'✓ ':''}No map point selected</Text></Pressable>
    {choices.filter(p=>p.id===value||p.name.toLowerCase().includes(query.toLowerCase())).slice(0,20).map(p=><Pressable key={p.id} disabled={disabled} accessibilityRole="radio" accessibilityState={{checked:value===p.id}} onPress={()=>{setQuery(p.name);onChange(p.id);onSelect?.(p);}} style={{padding:14,minHeight:48,backgroundColor:value===p.id?theme.surfaceMuted:'transparent',borderRadius:8}}><Text style={{color:theme.text}}>{value===p.id?'✓ ':''}{p.name}</Text>{p.campus_name?<Text style={{color:theme.textMuted,fontSize:12}}>{p.campus_name}</Text>:null}</Pressable>)}
    {loading?<Text style={{color:theme.textMuted}}>Loading locations…</Text>:null}
    {error?<View style={{flexDirection:'row',alignItems:'center',gap:8}}><Text accessibilityRole="alert" style={{flex:1,color:theme.error}}>{error}</Text><RetryIconButton label="Retry campus locations" busy={loading} onPress={()=>setRevision(n=>n+1)}/></View>:null}
  </View>;
}
