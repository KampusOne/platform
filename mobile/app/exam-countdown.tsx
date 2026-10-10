import { useCallback,useState } from "react";
import { useFocusEffect,useLocalSearchParams,router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable,Text,View } from "react-native";
import { ToolPage,ToolButton } from "@/src/components/toolkit";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { useAppearance } from "@/src/lib/appearance";
import { useToast } from "@/src/components/toast";
import { api } from "@/src/lib/api";
import { shareContent } from "@/src/lib/share-content";
import { sharedExamPeriodLink,validPeriodDates } from "@/src/lib/shared-links";
import { countdownParts,currentExamPeriod,examPeriodStart,examPeriodEnd,formatExamDate,type ExamPeriod } from "@/src/lib/exam-period";
export default function ExamCountdown(){
 const {startsOn,endsOn}=useLocalSearchParams<{startsOn?:string;endsOn?:string}>();
 const shared=typeof startsOn==='string'&&typeof endsOn==='string'&&validPeriodDates(startsOn,endsOn);
 const {theme}=useAppearance(),toast=useToast();
 const [period,setPeriod]=useState<ExamPeriod|null>(null),[ready,setReady]=useState(false),[error,setError]=useState(""),[sharing,setSharing]=useState(false),[now,setNow]=useState(Date.now());
 const load=useCallback(async()=>{setError("");try{if(shared){setPeriod({startsOn:startsOn!,endsOn:endsOn!,semester:'Shared exam period',status:'upcoming'});return;}const r=await api<{examPeriods:ExamPeriod[]}>("/v1/calendar/exam-periods");setPeriod(currentExamPeriod(r.examPeriods));}catch(e){setError(e instanceof Error?e.message:"Your academic calendar could not load.");}finally{setReady(true);}},[shared,startsOn,endsOn]);
 useFocusEffect(useCallback(()=>{void load();setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[load]));
 const started=period?now>=examPeriodStart(period):false,finished=period?now>examPeriodEnd(period):false;
 const parts=countdownParts(period?examPeriodStart(period):now,now);
 async function share(){if(!period)return;setSharing(true);try{const p=countdownParts(examPeriodStart(period)),message=["Our exam period",formatExamDate(period.startsOn)+" to "+formatExamDate(period.endsOn),Date.now()>=examPeriodStart(period)?"The exam period has started.":p.days+" days, "+p.hours+" hours, "+p.minutes+" minutes and "+p.seconds+" seconds to go.","Countdown at the time of sharing. Get ready with KampusOne."].join("\n");await shareContent({title:"KampusOne exam period",message,url:sharedExamPeriodLink(period.startsOn,period.endsOn)});}catch(e){toast(e instanceof Error?e.message:"The countdown could not be shared.","error");}finally{setSharing(false);}}
 return <ToolPage title="Exam countdown" action={<Pressable accessibilityRole="button" accessibilityLabel="Share exam countdown" disabled={!period||sharing} onPress={()=>void share()} style={{minWidth:44,minHeight:44,justifyContent:"center",alignItems:"center",opacity:!period||sharing?0.4:1}}><Ionicons name="share-outline" size={22} color={theme.deepBrand}/></Pressable>}>
  {!ready?<ScreenSkeleton variant="list" compact/>:error?<View style={{gap:12}}><Text accessibilityRole="alert" style={{color:theme.error}}>{error}</Text><ToolButton label="Try again" onPress={()=>void load()}/></View>:!period?<View style={{paddingVertical:40,gap:18,alignItems:"center"}}><Ionicons name="calendar-outline" size={42} color={theme.deepBrand}/><Text style={{fontFamily:theme.font.display,color:theme.text,fontSize:22,textAlign:"center"}}>Your exam period is not set yet.</Text><Text style={{fontFamily:theme.font.body,color:theme.textMuted,lineHeight:22,textAlign:"center"}}>Add or import your academic calendar. The countdown uses the exam period in that calendar.</Text><ToolButton label="Open academic calendar" onPress={()=>router.push("/academic-calendar")}/></View>:<View style={{paddingVertical:12,gap:20}}>
   <View style={{gap:8}}><Text style={{fontFamily:theme.font.semibold,color:theme.deepBrand,fontSize:13}}>{shared?"Shared exam period":period.semester}</Text><Text style={{fontFamily:theme.font.displayStrong,color:theme.text,fontSize:26,lineHeight:34}}>{finished?"Exam period completed":started?"Exams are underway":"Your exams are approaching"}</Text><Text style={{color:theme.textMuted,fontFamily:theme.font.body,lineHeight:22}}>{formatExamDate(period.startsOn)} – {formatExamDate(period.endsOn)}</Text></View>
   <View accessibilityLabel={started?"Exam period has started":parts.days+" days "+parts.hours+" hours "+parts.minutes+" minutes "+parts.seconds+" seconds until the exam period"} style={{padding:24,borderRadius:20,backgroundColor:theme.surfaceMuted,borderWidth:1,borderColor:theme.border,gap:20}}>
    <View style={{flexDirection:"row",alignItems:"baseline",gap:10}}><Text style={{fontFamily:theme.font.displayStrong,color:theme.text,fontSize:64,lineHeight:76,fontVariant:["tabular-nums"]}}>{parts.days}</Text><Text style={{color:theme.textMuted,fontFamily:theme.font.body,fontSize:16}}>days to go</Text></View>
    <View style={{flexDirection:"row",gap:12}}>{(["hours","minutes","seconds"] as const).map(label=><View key={label} style={{flex:1,gap:5}}><Text style={{fontFamily:theme.font.semibold,color:theme.text,fontSize:24,fontVariant:["tabular-nums"]}}>{String(parts[label]).padStart(2,"0")}</Text><Text style={{color:theme.textMuted,fontFamily:theme.font.body,fontSize:12}}>{label[0]!.toUpperCase()+label.slice(1)}</Text></View>)}</View>
   </View>
   <Text style={{color:theme.textMuted,fontFamily:theme.font.body,fontSize:13,lineHeight:21}}>Starts at midnight in Nigeria. Your paper times and reminders are in your exam timetable.</Text>
   <ToolButton label="View my exam timetable" onPress={()=>router.push("/exam-timetable")}/><ToolButton secondary label="Academic calendar" onPress={()=>router.push("/academic-calendar")}/>
  </View>}
 </ToolPage>;
}
