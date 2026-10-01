import {useEffect,useState} from "react";
import {Pressable,Text,View} from "react-native";
import {api} from "@/src/lib/api";
import {useAppearance} from "@/src/lib/appearance";
import {ToolField} from "./toolkit";
export function CampusPlaceChoice({label,value,onChange,endpoint='/v1/student/delivery-places'}:{label:string;value:string|null;onChange:(id:string|null)=>void;endpoint?:string}){
  const {theme}=useAppearance();const [places,setPlaces]=useState<{id:string;name:string}[]>([]),[query,setQuery]=useState(''),[error,setError]=useState('');
  useEffect(()=>{let mounted=true;void api<{places?:{id:string;name:string}[];pickupPoints?:{id:string;name:string}[]}>(endpoint).then(r=>{if(mounted)setPlaces(r.places??r.pickupPoints??[]);}).catch(()=>{if(mounted)setError('Map points are unavailable. Choose pickup or retry before reviewing a rider fare.');});return()=>{mounted=false;};},[endpoint]);
  return <View style={{gap:8,marginVertical:12}}><Text style={{color:theme.text,fontFamily:theme.font.semibold}}>{label}</Text><ToolField label="Find a sourced campus map point" value={query} onChangeText={setQuery}/>
    <Pressable accessibilityRole="radio" accessibilityState={{checked:!value}} onPress={()=>onChange(null)} style={{padding:14,minHeight:48}}><Text style={{color:theme.text}}>{!value?'✓ ':''}No map point selected</Text></Pressable>
    {places.filter(p=>p.id===value||p.name.toLowerCase().includes(query.toLowerCase())).slice(0,20).map(p=><Pressable key={p.id} accessibilityRole="radio" accessibilityState={{checked:value===p.id}} onPress={()=>onChange(p.id)} style={{padding:14,minHeight:48,backgroundColor:value===p.id?theme.surfaceMuted:'transparent',borderRadius:8}}><Text style={{color:theme.text}}>{value===p.id?'✓ ':''}{p.name}</Text></Pressable>)}
    {error?<Text style={{color:theme.textMuted}}>{error}</Text>:null}
  </View>;
}
