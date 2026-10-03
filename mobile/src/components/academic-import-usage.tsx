import {useCallback,useEffect,useState} from 'react';
import {Text,View} from 'react-native';
import {useFocusEffect} from 'expo-router';
import {useAppearance} from '@/src/lib/appearance';
import {api} from '@/src/lib/api';
type Usage={limit:number;used:number;remaining:number;calendar:{limit:number;used:number;remaining:number};resetsAt:string;available:boolean};
export function AcademicImportUsage({calendar=false,revision}:{calendar?:boolean;revision?:unknown}){
 const {theme}=useAppearance();const [usage,setUsage]=useState<Usage|null>(null);
 const load=useCallback(()=>{void api<{imports?:Usage}>('/v1/ai/status').then(result=>setUsage(result.imports??null)).catch(()=>undefined);},[]);
 useFocusEffect(useCallback(()=>{load();},[load]));
 useEffect(()=>{load();},[load,revision]);
 if(!usage||!usage.available)return null;
 return <View accessibilityLabel="Weekly import allowance" style={{padding:14,marginVertical:12,borderRadius:14,borderWidth:1,borderColor:theme.border,backgroundColor:theme.surfaceMuted,gap:5}}>
 <Text style={{fontFamily:theme.font.semibold,color:theme.text,fontSize:13}}>{usage.used} of {usage.limit} imports used this week · {usage.remaining} left</Text>
 {calendar?<Text style={{fontFamily:theme.font.body,color:theme.textMuted,fontSize:12}}>Calendars: {usage.calendar.used} of {usage.calendar.limit} · {usage.calendar.remaining} left</Text>:null}
 <Text style={{fontFamily:theme.font.body,color:theme.textMuted,fontSize:11,lineHeight:18}}>Resets {new Date(usage.resetsAt).toLocaleDateString('en-NG',{day:'numeric',month:'short',timeZone:'Africa/Lagos'})}. Timetables, calendars and image imports share this allowance. Manual entries and grades are free.</Text>
 </View>;
}
