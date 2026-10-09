import {Ionicons} from "@expo/vector-icons";
import {router,useLocalSearchParams} from "expo-router";
import {useCallback,useEffect,useMemo,useState} from "react";
import {ActivityIndicator,Pressable,StyleSheet,Text,View} from "react-native";
import {ToolPage} from "@/src/components/toolkit";
import {api} from "@/src/lib/api";
import {alarmFollowupKind,campusDateKey} from "@/src/lib/alarm-followup";
import {normalizeAlarms,syncAlarms,type Alarm} from "@/src/lib/alarms";
import {useThemeStyles,type Theme} from "@/src/lib/appearance";

function isTodayClass(alarm:Alarm,day:number,date:string){
 if(!alarm.enabled||!alarm.timetable_entry_id||alarm.exam_id)return false;
 return alarm.days.includes(day)||Boolean(alarm.fires_at&&campusDateKey(Date.parse(alarm.fires_at))===date);
}

export default function ClassAlarmDay(){
 const {alarmId}=useLocalSearchParams<{alarmId?:string}>();
 const {theme,styles}=useThemeStyles(createStyles);
 const [alarms,setAlarms]=useState<Alarm[]>([]);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const today=campusDateKey(),day=new Date(Date.now()+3_600_000).getUTCDay();
 const source=useMemo(()=>alarms.find(alarm=>alarm.id===alarmId),[alarms,alarmId]);
 const todayAlarms=useMemo(()=>alarms.filter(alarm=>isTodayClass(alarm,day,today)),[alarms,day,today]);
 const isClass=Boolean(source&&alarmFollowupKind({timetableEntryId:source.timetable_entry_id,examId:source.exam_id})==="CLASS");
 const allMuted=todayAlarms.length>0&&todayAlarms.every(alarm=>alarm.muted_on===today);
 const refresh=useCallback(async()=>{
  setLoading(true);setError("");
  try{
   const response=await api<{alarms:Alarm[]}>("/v1/learning/alarms");
   setAlarms(normalizeAlarms(response?.alarms));
  }catch(e){setError(e instanceof Error?e.message:"Could not check today's class reminders.");}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{void refresh();},[refresh]);

 async function muteToday(){
  if(busy||!isClass)return;
  setBusy(true);setError("");
  try{
   await api("/v1/learning/alarms/class-today",{method:"POST",body:JSON.stringify({muted:true})});
   const response=await api<{alarms:Alarm[]}>("/v1/learning/alarms");
   const next=normalizeAlarms(response.alarms);
   setAlarms(next);
   if(!await syncAlarms(next)){
    setError("Today's class reminders were muted on your account, but this device could not update its scheduled alarms. Check alarm permissions and try again.");
    return;
   }
   router.replace("/alarms");
  }catch(e){setError(e instanceof Error?e.message:"Could not mute today's class reminders. Your alarms have not been changed.");}
  finally{setBusy(false);}
 }
 const back=()=>router.replace("/alarms");
 const course=source?.course_code||source?.course_title||source?.label||"Your class";
 return <ToolPage title="Class reminders">
  {loading?<View style={styles.loading}><ActivityIndicator color={theme.deepBrand}/><Text style={styles.description}>Checking your class reminders…</Text></View>
  :!isClass?<View style={styles.card}><View style={styles.icon}><Ionicons name="calendar-outline" size={26} color={theme.deepBrand}/></View><Text style={styles.heading}>This is not a class alarm</Text><Text style={styles.description}>{error||"Open your timetable alarms to manage today's reminders."}</Text><Pressable accessibilityRole="button" style={styles.primary} onPress={back}><Text style={styles.primaryText}>Back to alarms</Text></Pressable></View>
  :<View style={styles.card}>
   <View style={styles.topRow}><View style={styles.icon}><Ionicons name="notifications-off-outline" size={26} color={theme.deepBrand}/></View><View style={styles.todayPill}><View style={styles.todayDot}/><Text style={styles.todayText}>TODAY ONLY</Text></View></View>
   <Text style={styles.eyebrow}>AFTER YOUR FIRST CLASS REMINDER</Text>
   <Text style={styles.heading}>{allMuted?"Quiet for today.":"Already up for class?"}</Text>
   <Text style={styles.description}>{allMuted?"Your class reminders are muted for the rest of today. They'll return automatically tomorrow.":"You've had your first reminder. Want the rest of today's class alarms to stay quiet?"}</Text>
   <View style={styles.courseRow}><Ionicons name="book-outline" color={theme.deepBrand} size={19}/><View style={{flex:1}}><Text style={styles.courseLabel}>CLASS REMINDER</Text><Text numberOfLines={2} style={styles.courseTitle}>{course}</Text></View></View>
   <View style={styles.rule}/>
   <View style={styles.protection}><Ionicons name="shield-checkmark-outline" size={20} color={theme.success}/><Text style={styles.protectionText}>Exam, test, personal and calendar alarms will keep working. Your recurring class alarms return tomorrow.</Text></View>
   {todayAlarms.length===0?<Text style={styles.hint}>No more class reminders are scheduled for today.</Text>:null}
   {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
   <Pressable accessibilityRole="button" accessibilityState={{disabled:busy||allMuted||todayAlarms.length===0}} disabled={busy||allMuted||todayAlarms.length===0} onPress={()=>void muteToday()} style={({pressed})=>[styles.primary,(busy||allMuted||todayAlarms.length===0)&&styles.primaryDisabled,pressed&&styles.pressed]}>
    {busy?<ActivityIndicator color="#FFFFFF"/>:<Ionicons name={allMuted?"checkmark-circle-outline":"notifications-off-outline"} size={20} color="#FFFFFF"/>}
    <Text style={styles.primaryText}>{busy?"Updating your alarms…":allMuted?"Class reminders muted":"Mute class alarms for today"}</Text>
   </Pressable>
   <Pressable accessibilityRole="button" disabled={busy} style={({pressed})=>[styles.secondary,pressed&&styles.pressed]} onPress={back}><Text style={styles.secondaryText}>{allMuted?"Back to alarms":"Keep my reminders"}</Text></Pressable>
  </View>}
 </ToolPage>;
}

const createStyles=(theme:Theme)=>StyleSheet.create({
 card:{marginTop:12,backgroundColor:theme.surface,borderRadius:24,borderWidth:1,borderColor:theme.border,padding:24,gap:16},
 loading:{alignItems:"center",justifyContent:"center",gap:16,paddingVertical:70},
 topRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:2},
 icon:{width:58,height:58,borderRadius:18,backgroundColor:theme.surfaceMuted,alignItems:"center",justifyContent:"center"},
 todayPill:{flexDirection:"row",alignItems:"center",gap:7,paddingVertical:8,paddingHorizontal:10,borderRadius:10,backgroundColor:theme.surfaceMuted},
 todayDot:{width:7,height:7,borderRadius:4,backgroundColor:theme.deepBrand},
 todayText:{fontFamily:theme.font.bold,fontSize:10,letterSpacing:1.1,color:theme.deepBrand},
 eyebrow:{fontFamily:theme.font.bold,fontSize:10,letterSpacing:1.55,color:theme.deepBrand,marginTop:4},
 heading:{fontFamily:theme.font.displayStrong,fontSize:28,lineHeight:34,letterSpacing:-0.7,color:theme.text},
 description:{fontFamily:theme.font.body,fontSize:15,lineHeight:24,color:theme.textMuted},
 courseRow:{flexDirection:"row",gap:12,alignItems:"center",backgroundColor:theme.surfaceMuted,borderRadius:14,paddingVertical:15,paddingHorizontal:14},
 courseLabel:{fontFamily:theme.font.semibold,fontSize:10,color:theme.textMuted,letterSpacing:1.0,marginBottom:3},
 courseTitle:{fontFamily:theme.font.semibold,fontSize:15,color:theme.text,lineHeight:21},
 rule:{height:1,backgroundColor:theme.border},
 protection:{flexDirection:"row",gap:10,alignItems:"flex-start"},
 protectionText:{flex:1,fontFamily:theme.font.body,fontSize:12,lineHeight:19,color:theme.textMuted},
 hint:{fontFamily:theme.font.medium,fontSize:13,color:theme.textMuted,textAlign:"center"},
 error:{fontFamily:theme.font.medium,fontSize:13,color:theme.error,lineHeight:20},
 primary:{minHeight:54,backgroundColor:theme.deepBrand,borderRadius:14,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:9,paddingHorizontal:12,marginTop:4},
 primaryDisabled:{opacity:0.58},
 primaryText:{fontFamily:theme.font.bold,fontSize:14,color:"#FFFFFF",textAlign:"center"},
 secondary:{minHeight:51,borderRadius:14,backgroundColor:theme.surfaceMuted,alignItems:"center",justifyContent:"center",paddingHorizontal:12},
 secondaryText:{fontFamily:theme.font.semibold,fontSize:14,color:theme.deepBrand,textAlign:"center"},
 pressed:{opacity:0.78},
});
