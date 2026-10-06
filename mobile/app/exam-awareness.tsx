import {useEffect,useState} from 'react';
import {router,useLocalSearchParams} from 'expo-router';
import {Ionicons} from '@expo/vector-icons';
import {Text,View} from 'react-native';
import {ToolPage,ToolField,ToolButton} from '@/src/components/toolkit';
import {useAppearance} from '@/src/lib/appearance';
import {api} from '@/src/lib/api';
import {syncAlarms,type Alarm} from '@/src/lib/alarms';
type Exam={title:string;course_code:string;starts_at:string;date:string;disabled:boolean;assessment_kind?:"TEST"|"EXAM"};
export default function ExamAwareness(){
 const{alarmId}=useLocalSearchParams<{alarmId:string}>(),{theme}=useAppearance();
 const[exam,setExam]=useState<Exam|null>(null),[challenge,setChallenge]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[now,setNow]=useState(Date.now());
 useEffect(()=>{let live=true;void api<{exam:Exam}>('/v1/exams/alarms/'+alarmId).then(r=>{if(live)setExam(r.exam);}).catch(e=>{if(live)setError(e.message);});const timer=setInterval(()=>setNow(Date.now()),30000);return()=>{live=false;clearInterval(timer);};},[alarmId]);
 const minutes=exam?Math.max(0,Math.ceil((Date.parse(exam.starts_at)-now)/60000)):0;
 const interval=minutes===120?'2 hours':minutes===60?'1 hour':`${minutes} minutes`;
 async function disable(){setBusy(true);setError('');try{if(!challenge){const r=await api<{challengeId:string}>('/v1/exams/disable/request',{method:'POST',body:JSON.stringify({alarmId})});setChallenge(r.challengeId);}else{await api('/v1/exams/disable/confirm',{method:'POST',body:JSON.stringify({challengeId:challenge,code})});const r=await api<{alarms:Alarm[]}>('/v1/learning/alarms');await syncAlarms(r.alarms);router.replace('/exam-timetable');}}catch(e){setError(e instanceof Error?e.message:'Your remaining alarms are still enabled.');}finally{setBusy(false);}}
 return <ToolPage title="Exam awareness"><View style={{alignItems:'center',padding:28,gap:18,borderRadius:28,backgroundColor:theme.surfaceTint,marginVertical:22}}><View style={{padding:22,borderRadius:32,backgroundColor:theme.surface}}><Ionicons name="alarm-outline" size={48} color={theme.deepBrand}/></View><Text style={{fontFamily:theme.font.displayStrong,color:theme.text,fontSize:28,textAlign:'center'}}>Awake and ready?</Text><Text style={{fontFamily:theme.font.semibold,color:theme.text,fontSize:18}}>{exam?.course_code||exam?.title||'Your first paper'}</Text><Text style={{fontFamily:theme.font.body,color:theme.textMuted,fontSize:15,lineHeight:24,textAlign:'center'}}>Disabling these alarms confirms you are awake and aware your {exam?.assessment_kind==='TEST'?'class test':'exam'} starts in {interval}. Keep them enabled if you might fall asleep again.</Text></View>{challenge?<><Text style={{color:theme.textMuted,fontFamily:theme.font.body,lineHeight:22,marginBottom:16}}>Enter the code sent to your email. The remaining exam alarms for today stay enabled until you confirm.</Text><ToolField label="Email code" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode}/></>:null}<ToolButton label={busy?'Please wait…':challenge?'Confirm and disable today’s alarms':'Disable alarm'} disabled={busy||!exam||exam.disabled||(Boolean(challenge)&&code.length!==6)} onPress={()=>void disable()}/><ToolButton secondary label="Keep remaining alarms" disabled={busy} onPress={()=>router.replace('/exam-timetable')}/>{error?<Text accessibilityRole="alert" style={{color:theme.error,fontFamily:theme.font.body,marginTop:16}}>{error}</Text>:null}</ToolPage>;
}
