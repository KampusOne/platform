import { Pressable,Text,TextInput,View } from "react-native";
import { BrandSwitch } from "./brand-switch";
import { useAppearance } from "@/src/lib/appearance";
export function AcademicAlarmFields({enabled,onEnabled,kind,onKind,date,onDate,end,onEnd}:{enabled:boolean;onEnabled:(v:boolean)=>void;kind:"TEST"|"EXAM";onKind:(v:"TEST"|"EXAM")=>void;date:string;onDate:(v:string)=>void;end:string;onEnd:(v:string)=>void}){
 const {theme}=useAppearance(),hint={color:theme.textMuted,fontFamily:theme.font.body,fontSize:12,lineHeight:20};
 return <View style={{padding:14,gap:12,borderRadius:16,backgroundColor:theme.surfaceMuted}}>
  <View style={{flexDirection:"row",alignItems:"center",gap:12}}><View style={{flex:1}}><Text style={{fontFamily:theme.font.semibold,color:theme.text}}>This is for a test or exam</Text><Text style={hint}>A real paper, with reminders to keep you ready.</Text></View><BrandSwitch label="Set an academic test or exam" value={enabled} onValueChange={onEnabled}/></View>
  {enabled?<><View style={{flexDirection:"row",gap:10}}>{(["TEST","EXAM"] as const).map(value=><Pressable key={value} accessibilityRole="radio" accessibilityState={{selected:kind===value}} onPress={()=>onKind(value)} style={{flex:1,padding:12,borderRadius:10,backgroundColor:kind===value?theme.deepBrand:theme.surface}}><Text style={{textAlign:"center",fontFamily:theme.font.semibold,color:kind===value?"#fff":theme.text}}>{value==="TEST"?"Class test":"Exam paper"}</Text></Pressable>)}</View>
   <Text style={hint}>Paper date (YYYY-MM-DD)</Text><TextInput accessibilityLabel="Test or exam date" value={date} onChangeText={onDate} placeholder="2026-10-26" placeholderTextColor={theme.textMuted} style={{color:theme.text,fontFamily:theme.font.body,padding:12,borderRadius:10,backgroundColor:theme.surface}}/>
   <Text style={hint}>End time (24-hour format)</Text><TextInput accessibilityLabel="Test or exam end time" value={end} onChangeText={onEnd} placeholder="10:00" placeholderTextColor={theme.textMuted} style={{color:theme.text,fontFamily:theme.font.body,padding:12,borderRadius:10,backgroundColor:theme.surface}}/>
   <Text style={hint}>The time wheel below is when your paper starts. Reminders ring 2 hours, 1 hour, 30 minutes and 15 minutes before it. Past reminder times are skipped.</Text>
  </>:null}
 </View>;
}
