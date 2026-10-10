import {Ionicons} from "@expo/vector-icons";
import {router,useLocalSearchParams} from "expo-router";
import {useCallback,useEffect,useState} from "react";
import {Pressable,StyleSheet,Text,View} from "react-native";
import {ToolField,ToolPage} from "@/src/components/toolkit";
import {ScreenSkeleton,InlineLoading} from "@/src/components/skeleton";
import {api} from "@/src/lib/api";
import {normalizeAlarms,syncAlarms,type Alarm} from "@/src/lib/alarms";
import {useThemeStyles,type Theme} from "@/src/lib/appearance";

type Exam={title:string;course_code:string;starts_at:string;date:string;disabled:boolean;assessment_kind?:"TEST"|"EXAM";venue?:string};

function untilPaper(start:string,now:number){
 const remaining=Date.parse(start)-now;
 if(!Number.isFinite(remaining))return "Time not available";
 if(remaining<-60_000)return "Paper already started";
 if(remaining<60_000)return "Starting now";
 const minutes=Math.ceil(remaining/60_000);
 if(minutes>=60){const hours=Math.floor(minutes/60);const rest=minutes%60;return `${hours}h${rest?" "+rest+"m":""} remaining`;}
 return `${minutes} min remaining`;
}

export default function ExamAwareness(){
 const {alarmId}=useLocalSearchParams<{alarmId?:string}>();
 const {theme,styles}=useThemeStyles(createStyles);
 const [exam,setExam]=useState<Exam|null>(null),[loading,setLoading]=useState(true);
 const [challenge,setChallenge]=useState(""),[code,setCode]=useState("");
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[now,setNow]=useState(Date.now());
 const load=useCallback(async()=>{
  setLoading(true);setError("");setExam(null);
  try{
   if(!alarmId)throw Error("This exam alarm link is missing.");
   const result=await api<{exam:Exam}>("/v1/exams/alarms/"+alarmId);
   if(!result?.exam||!result.exam.starts_at)throw Error("This is not a saved exam reminder.");
   setExam(result.exam);
  }catch(e){setError(e instanceof Error?e.message:"This is not a saved exam reminder.");}
  finally{setLoading(false);}
 },[alarmId]);
 useEffect(()=>{void load();const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[load]);
 async function disable(){
  if(!exam||exam.disabled||busy)return;
  setBusy(true);setError("");
  try{
   if(!challenge){
    const result=await api<{challengeId:string}>("/v1/exams/disable/request",{method:"POST",body:JSON.stringify({alarmId})});
    setChallenge(result.challengeId);
   }else{
    await api("/v1/exams/disable/confirm",{method:"POST",body:JSON.stringify({challengeId:challenge,code})});
    const response=await api<{alarms:Alarm[]}>("/v1/learning/alarms");
    const synced=await syncAlarms(normalizeAlarms(response.alarms));
    if(!synced){setExam({...exam,disabled:true});setError("Today's exam reminders were muted in your account, but this device needs alarm permission to update its scheduled alarms.");return;}
    router.replace("/exam-timetable");
   }
  }catch(e){
   const message=e instanceof Error?e.message:"Your remaining exam reminders are still on.";
   if(/expired|request another code/i.test(message)){setChallenge("");setCode("");}
   setError(message);
  }finally{setBusy(false);}
 }
 const kind=exam?.assessment_kind==="TEST"?"Class test":"Exam";
 return <ToolPage title="Exam reminders">
  {loading?<ScreenSkeleton variant="list" compact/>
  :!exam?<View style={styles.card}>
    <View style={styles.icon}><Ionicons name="alert-circle-outline" color={theme.deepBrand} size={27}/></View>
    <Text style={styles.heading}>Not an exam reminder</Text>
    <Text style={styles.description}>Only saved exam and class-test reminders appear here. Regular class alarms shouldn't open this screen.</Text>
    {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
    <Pressable accessibilityRole="button" onPress={()=>router.replace("/alarms")} style={styles.primary}><Text style={styles.primaryText}>Back to alarms</Text></Pressable>
   </View>
  :<View style={styles.card}>
    <View style={styles.topRow}><View style={styles.icon}><Ionicons name={exam.disabled?"checkmark-circle-outline":"school-outline"} color={theme.deepBrand} size={27}/></View><View style={styles.todayPill}><View style={styles.todayDot}/><Text style={styles.todayText}>{kind} REMINDER</Text></View></View>
    <Text style={styles.eyebrow}>PREPARED FOR YOUR PAPER</Text>
    <Text style={styles.heading}>{exam.disabled?"You're all set.":"Awake and ready?"}</Text>
    <Text style={styles.description}>{exam.disabled?"The remaining exam reminders for today are already off.":"Got the reminder? You can mute the remaining alerts for today's papers once you're sure you're awake."}</Text>
    <View style={styles.paper}>
     <Text style={styles.paperLabel}>{kind} • {untilPaper(exam.starts_at,now)}</Text>
     <Text style={styles.paperTitle}>{exam.course_code||exam.title}</Text>
     {exam.venue?<Text numberOfLines={2} style={styles.venue}><Ionicons name="location-outline" size={13} color={theme.textMuted}/>  {exam.venue}</Text>:null}
    </View>
    <View style={styles.protection}><Ionicons name="shield-checkmark-outline" color={theme.success} size={21}/><Text style={styles.protectionText}>Only today's exam and test reminders are affected. Your class, personal and calendar alarms stay on.</Text></View>
    {challenge&&!exam.disabled?<View style={styles.verify}>
       <Text style={styles.verifyTitle}>Check your email</Text>
       <Text style={styles.description}>Enter the 6-digit code we sent you. Remaining exam reminders stay on until you confirm.</Text>
       <ToolField label="6-digit email code" keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} value={code} onChangeText={setCode}/>
       <Pressable accessibilityRole="button" disabled={busy} onPress={()=>{setChallenge("");setCode("");setError("");}}><Text style={styles.retryText}>Request another code</Text></Pressable>
     </View>:null}
    {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
    {!exam.disabled?<Pressable accessibilityRole="button" accessibilityState={{disabled:busy||(Boolean(challenge)&&code.length!==6)}} disabled={busy||(Boolean(challenge)&&code.length!==6)} onPress={()=>void disable()} style={({pressed})=>[styles.primary,(busy||(Boolean(challenge)&&code.length!==6))&&styles.primaryDisabled,pressed&&styles.pressed]}>
      {busy?<InlineLoading color="#FFFFFF" size={20}/>:<Ionicons name={challenge?"checkmark-circle-outline":"notifications-off-outline"} color="#FFFFFF" size={20}/>}
      <Text style={styles.primaryText}>{busy?"Updating exam reminders…":challenge?"Confirm and mute today's exams":"Mute today's remaining exam alarms"}</Text>
    </Pressable>:null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={()=>router.replace("/exam-timetable")} style={({pressed})=>[styles.secondary,pressed&&styles.pressed]}><Text style={styles.secondaryText}>{exam.disabled?"Back to exam timetable":"Keep exam reminders on"}</Text></Pressable>
   </View>}
 </ToolPage>;
}

const createStyles=(theme:Theme)=>StyleSheet.create({
 loading:{alignItems:"center",gap:14,paddingVertical:70},
 card:{marginTop:12,padding:24,borderRadius:24,borderWidth:1,borderColor:theme.border,backgroundColor:theme.surface,gap:15},
 topRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:3},
 icon:{height:58,width:58,borderRadius:18,backgroundColor:theme.surfaceMuted,justifyContent:"center",alignItems:"center"},
 todayPill:{backgroundColor:theme.surfaceMuted,flexDirection:"row",alignItems:"center",gap:7,paddingVertical:8,paddingHorizontal:10,borderRadius:10},
 todayDot:{width:7,height:7,borderRadius:4,backgroundColor:theme.deepBrand},
 todayText:{color:theme.deepBrand,fontFamily:theme.font.bold,fontSize:10,letterSpacing:1.15},
 eyebrow:{fontFamily:theme.font.bold,fontSize:10,letterSpacing:1.4,color:theme.deepBrand,marginTop:3},
 heading:{fontFamily:theme.font.displayStrong,fontSize:29,lineHeight:36,letterSpacing:-0.7,color:theme.text},
 description:{fontFamily:theme.font.body,fontSize:14,lineHeight:22,color:theme.textMuted},
 paper:{borderRadius:14,backgroundColor:theme.surfaceMuted,padding:17,gap:6},
 paperLabel:{fontFamily:theme.font.semibold,color:theme.deepBrand,fontSize:11,letterSpacing:0.6},
 paperTitle:{fontFamily:theme.font.bold,fontSize:18,lineHeight:24,color:theme.text},
 venue:{fontFamily:theme.font.body,fontSize:13,color:theme.textMuted,lineHeight:20},
 protection:{flexDirection:"row",alignItems:"flex-start",gap:10},
 protectionText:{flex:1,fontFamily:theme.font.body,fontSize:12,lineHeight:19,color:theme.textMuted},
 verify:{backgroundColor:theme.canvas,borderRadius:16,padding:16,gap:10},
 verifyTitle:{fontFamily:theme.font.bold,fontSize:16,color:theme.text},
 retryText:{fontFamily:theme.font.semibold,fontSize:13,color:theme.deepBrand,paddingVertical:8},
 error:{fontFamily:theme.font.medium,fontSize:13,color:theme.error,lineHeight:20},
 primary:{flexDirection:"row",gap:9,alignItems:"center",justifyContent:"center",minHeight:54,paddingHorizontal:12,backgroundColor:theme.deepBrand,borderRadius:14,marginTop:3},
 primaryDisabled:{opacity:0.55},
 primaryText:{color:"#FFFFFF",fontFamily:theme.font.bold,fontSize:14,textAlign:"center"},
 secondary:{alignItems:"center",justifyContent:"center",minHeight:51,borderRadius:14,backgroundColor:theme.surfaceMuted},
 secondaryText:{fontFamily:theme.font.semibold,fontSize:14,color:theme.deepBrand},
 pressed:{opacity:0.8},
});
