import { Modal,Pressable,Text,View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAppearance } from "@/src/lib/appearance";
import { alarmCategories,type AlarmCategory } from "@/src/lib/alarm-groups";
export function AlarmSourceDialog({visible,onClose,onChoose}:{visible:boolean;onClose:()=>void;onChoose:(source:"timetable"|"exam"|"calendar")=>void}){
 const {theme}=useAppearance();
 return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={{flex:1,backgroundColor:"rgba(0,0,0,.5)",justifyContent:"center",padding:22}}><View style={{backgroundColor:theme.surface,borderRadius:24,padding:22,gap:14,maxWidth:460,width:"100%",alignSelf:"center"}}>
  <Text style={{fontFamily:theme.font.displayStrong,fontSize:23,color:theme.text}}>Where are your alarms coming from?</Text><Text style={{fontFamily:theme.font.body,fontSize:13,lineHeight:21,color:theme.textMuted}}>Choose a saved schedule, then review the reminders before importing.</Text>
  {([{source:"timetable",title:"Class timetable",icon:"book-outline"},{source:"exam",title:"Exam timetable",icon:"school-outline"},{source:"calendar",title:"Academic calendar",icon:"calendar-outline"}] as const).map(option=><Pressable key={option.source} accessibilityRole="button" onPress={()=>onChoose(option.source)} style={{minHeight:62,flexDirection:"row",gap:12,alignItems:"center",padding:14,borderRadius:14,backgroundColor:theme.surfaceMuted}}><Ionicons name={option.icon} size={22} color={theme.deepBrand}/><Text style={{flex:1,color:theme.text,fontFamily:theme.font.semibold}}>{option.title}</Text><Ionicons name="chevron-forward" size={17} color={theme.textMuted}/></Pressable>)}
  <Pressable accessibilityRole="button" onPress={onClose} style={{minHeight:44,alignItems:"center",justifyContent:"center"}}><Text style={{color:theme.textMuted,fontFamily:theme.font.semibold}}>Cancel</Text></Pressable>
 </View></View></Modal>;
}
export function ClearAlarmsDialog({category,busy,error,onClose,onConfirm,onAwareness}:{category:AlarmCategory|"ALL"|null;busy:boolean;error:string;onClose:()=>void;onConfirm:()=>void;onAwareness?:(()=>void)|undefined}){
 const {theme}=useAppearance();
 return <Modal visible={category!==null} transparent animationType="fade" onRequestClose={()=>!busy&&onClose()}><View style={{flex:1,backgroundColor:"rgba(0,0,0,.5)",justifyContent:"center",padding:22}}><View style={{backgroundColor:theme.surface,borderRadius:24,padding:22,gap:16,maxWidth:440,width:"100%",alignSelf:"center"}}>
  <Text style={{fontFamily:theme.font.displayStrong,fontSize:22,color:theme.text}}>Clear {category==="ALL"?"all alarms":alarmCategories.find(c=>c.id===category)?.title.toLowerCase()}?</Text>
  <Text style={{fontFamily:theme.font.body,lineHeight:22,color:theme.textMuted}}>This removes the reminders. Your classes, exam papers and calendar dates stay saved. You can import their alarms again.</Text>
  {error?<Text accessibilityRole="alert" style={{color:theme.error,fontFamily:theme.font.body,lineHeight:21}}>{error}</Text>:null}
  {error&&onAwareness?<Pressable accessibilityRole="button" onPress={onAwareness} style={{minHeight:44,justifyContent:"center"}}><Text style={{fontFamily:theme.font.semibold,color:theme.deepBrand}}>Open exam awareness</Text></Pressable>:null}
  <View style={{flexDirection:"row",justifyContent:"flex-end",gap:18}}><Pressable accessibilityRole="button" disabled={busy} onPress={onClose} style={{minHeight:44,justifyContent:"center"}}><Text style={{color:theme.text,fontFamily:theme.font.semibold}}>Keep alarms</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} onPress={onConfirm} style={{minHeight:44,justifyContent:"center"}}><Text style={{color:theme.deepBrand,fontFamily:theme.font.semibold}}>{busy?"Clearing…":"Clear alarms"}</Text></Pressable></View>
 </View></View></Modal>;
}
