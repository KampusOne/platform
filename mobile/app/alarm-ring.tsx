import {useEffect,useState} from 'react';
import {Platform,Pressable,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {StatusBar} from 'expo-status-bar';
import {router,useLocalSearchParams} from 'expo-router';
import * as Notifications from 'expo-notifications';
import {getRingingAlarm,nativeAlarms,type RingingAlarm} from '@/src/lib/native-alarms';
import {useToast} from '@/src/components/toast';
import {snoozeNotification} from '@/src/lib/alarms';
import {stopWebRinging,snoozeWebAlarm} from '@/src/lib/web-alarms';

const INK='#29231F',DEEP='#A8462E',BRAND='#C35D38',SAND='#F1DFC8',CREAM='#FBF7F2',PEACH='#E9B18E';

function formatCampusTime(value?:string|null){
 if(!value)return '';
 const [hour,minute]=value.split(':').map(Number);
 if(!Number.isFinite(hour)||!Number.isFinite(minute))return value;
 return new Date(2026,0,1,hour,minute).toLocaleTimeString('en-NG',{hour:'numeric',minute:'2-digit'});
}

export default function AlarmRing(){
 const params=useLocalSearchParams<{
  alarmId?:string;label?:string;snooze?:string;notificationId?:string;
  courseCode?:string;classTitle?:string;classStartsAt?:string;classEndsAt?:string;
  venue?:string;lecturer?:string;leadMinutes?:string;
 }>();
 const toast=useToast();
 const [alarm,setAlarm]=useState<RingingAlarm|null>(null);
 const [now,setNow]=useState(Date.now());
 const [busy,setBusy]=useState(false);
 const [loaded,setLoaded]=useState(!nativeAlarms);
 const [snoozeMinutes,setSnoozeMinutes]=useState(Math.max(1,Math.min(30,Number(params.snooze)||5)));
 const [snoozeTouched,setSnoozeTouched]=useState(false);

 useEffect(()=>{
  let active=true;
  async function refresh(){
   setNow(Date.now());
   if(nativeAlarms){
    try{
     const ringing=await getRingingAlarm();
     if(active){setAlarm(ringing?.id===params.alarmId?ringing:null);setLoaded(true);}
    }catch{if(active)setLoaded(true);}
   }
  }
  void refresh();
  const timer=setInterval(()=>void refresh(),1000);
  return()=>{active=false;clearInterval(timer);};
 },[params.alarmId]);

 useEffect(()=>{
  if(!snoozeTouched&&alarm?.snooze_minutes)setSnoozeMinutes(Math.max(1,Math.min(30,alarm.snooze_minutes)));
 },[alarm?.snooze_minutes,snoozeTouched]);

 const ringing=nativeAlarms?Boolean(alarm&&alarm.endsAt>now):true;
 const isClass=Boolean(alarm?.timetable_entry_id||params.courseCode||params.classStartsAt);
 const label=alarm?.label??params.label??'Your reminder';
 const courseCode=alarm?.course_code??params.courseCode??'';
 const classTitle=alarm?.course_title??params.classTitle??'';
 const classStartsAt=alarm?.class_starts_at??params.classStartsAt??'';
 const classEndsAt=alarm?.class_ends_at??params.classEndsAt??'';
 const venue=alarm?.venue??params.venue??'';
 const lecturer=alarm?.lecturer??params.lecturer??'';
 const leadMinutes=alarm?.reminder_minutes??(Number(params.leadMinutes)||15);
 const courseDisplay=courseCode||label;
 const showTitle=Boolean(classTitle&&classTitle.toLowerCase()!==courseDisplay.toLowerCase()&&classTitle.toLowerCase()!==label.toLowerCase());
 const start=formatCampusTime(classStartsAt),end=formatCampusTime(classEndsAt);
 const classTime=start?(end?`${start}  –  ${end}`:start):'';
 const secondsLeft=alarm?Math.max(0,Math.ceil((alarm.endsAt-now)/1000)):null;
 const ringingText=secondsLeft===null?'Ringing':`Ringing · ${Math.floor(secondsLeft/60)}:${String(secondsLeft%60).padStart(2,'0')} left`;

 async function finish(snooze:boolean){
  setBusy(true);
  try{
   if(nativeAlarms&&alarm){
    if(snooze)await nativeAlarms.snoozeFor(alarm.id,snoozeMinutes);
    else await nativeAlarms.dismiss(alarm.id);
   }else if(Platform.OS==='web'){
    if(snooze)snoozeWebAlarm(params.alarmId??'');else stopWebRinging();
   }else if(snooze){
    await snoozeNotification({
     title:isClass?courseDisplay:label,
     body:isClass?`Class in ${leadMinutes} minutes`:'Your reminder',
     sound:'default',
     data:{alarmId:params.alarmId,snoozeMinutes},
    });
   }
   if(params.notificationId&&Platform.OS!=='web')await Notifications.dismissNotificationAsync(params.notificationId);
   router.canGoBack()?router.back():router.replace('/alarms');
  }catch(error){
   toast(error instanceof Error?error.message:'Could not update alarm','error');
  }finally{setBusy(false);}
 }

 function changeSnooze(delta:number){
  setSnoozeTouched(true);
  setSnoozeMinutes(value=>Math.max(1,Math.min(30,value+delta)));
 }

 return <SafeAreaView style={styles.page}>
  <StatusBar style="light" backgroundColor={INK}/>
  <View pointerEvents="none" style={styles.glowOne}/>
  <View pointerEvents="none" style={styles.glowTwo}/>

  <View style={styles.topbar}>
   <Text style={styles.brand}>KampusOne</Text>
   <Text style={styles.topMeta}>{isClass?'CLASS ALERT':'REMINDER'}</Text>
  </View>

  <View style={styles.content}>
   <Text style={styles.headline}>{!loaded?'Opening your alarm…':isClass?`Class in ${leadMinutes} minutes`:ringing?'Reminder':'Alarm finished'}</Text>
   <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.72} style={styles.course}>{courseDisplay}</Text>
   {showTitle?<Text numberOfLines={2} style={styles.classTitle}>{classTitle}</Text>:null}
   {classTime?<Text style={styles.classTime}>{classTime}</Text>:null}

   {(venue||lecturer)?<View style={styles.details}>
    {venue?<View style={styles.detailRow}><Text style={styles.detailLabel}>Venue</Text><Text numberOfLines={2} style={styles.detailValue}>{venue}</Text></View>:null}
    {venue&&lecturer?<View style={styles.divider}/>:null}
    {lecturer?<View style={styles.detailRow}><Text style={styles.detailLabel}>Lecturer</Text><Text numberOfLines={2} style={styles.detailValue}>{lecturer}</Text></View>:null}
   </View>:null}
   {ringing?<Text style={styles.remaining}>{ringingText}</Text>:null}
  </View>

  <View style={styles.actions}>
   {ringing?<View style={styles.snoozeRow}>
    <Pressable accessibilityLabel="Decrease snooze time" accessibilityRole="button" disabled={busy||snoozeMinutes<=1} onPress={()=>changeSnooze(-1)} style={({pressed})=>[styles.roundControl,pressed&&styles.pressed]}>
     <Text style={styles.roundControlText}>−</Text>
    </Pressable>
    <Pressable accessibilityLabel={`Snooze for ${snoozeMinutes} minutes`} accessibilityRole="button" disabled={busy} onPress={()=>void finish(true)} style={({pressed})=>[styles.snoozeButton,pressed&&styles.pressed]}>
     <Text style={styles.snoozeText}>Snooze {snoozeMinutes} min</Text>
    </Pressable>
    <Pressable accessibilityLabel="Increase snooze time" accessibilityRole="button" disabled={busy||snoozeMinutes>=30} onPress={()=>changeSnooze(1)} style={({pressed})=>[styles.roundControl,pressed&&styles.pressed]}>
     <Text style={styles.roundControlText}>+</Text>
    </Pressable>
   </View>:null}

   <Pressable accessibilityLabel={ringing?'Dismiss alarm':'Back to alarms'} accessibilityRole="button" disabled={busy} onPress={()=>void finish(false)} style={({pressed})=>[styles.dismissOuter,pressed&&styles.dismissPressed]}>
    <View style={styles.dismissInner}><Text style={styles.dismissText}>{ringing?'Dismiss':'Back'}</Text></View>
   </Pressable>
  </View>
 </SafeAreaView>;
}

const styles=StyleSheet.create({
 page:{backgroundColor:INK,flex:1,overflow:'hidden',paddingHorizontal:24},
 glowOne:{backgroundColor:'rgba(195,93,56,0.34)',borderRadius:260,height:520,position:'absolute',right:-250,top:-130,width:520},
 glowTwo:{backgroundColor:'rgba(168,70,46,0.28)',borderRadius:230,bottom:150,height:460,left:-280,position:'absolute',width:460},
 topbar:{alignItems:'center',flexDirection:'row',justifyContent:'space-between',minHeight:54},
 brand:{color:CREAM,fontFamily:'Lato_700Bold',fontSize:18,letterSpacing:-0.2},
 topMeta:{color:PEACH,fontFamily:'Inter_600SemiBold',fontSize:10,letterSpacing:1.5},
 content:{alignItems:'center',flex:1,justifyContent:'center',paddingBottom:12},
 headline:{color:SAND,fontFamily:'Inter_600SemiBold',fontSize:20,lineHeight:26,marginBottom:14,textAlign:'center'},
 course:{color:'#FFFFFF',fontFamily:'Lato_900Black',fontSize:44,letterSpacing:-1.1,lineHeight:48,maxWidth:350,textAlign:'center'},
 classTitle:{color:CREAM,fontFamily:'Inter_400Regular',fontSize:17,lineHeight:23,marginTop:8,maxWidth:330,textAlign:'center'},
 classTime:{color:'#FFFFFF',fontFamily:'Lato_700Bold',fontSize:42,letterSpacing:-0.8,lineHeight:50,marginTop:24,textAlign:'center'},
 details:{backgroundColor:'rgba(255,255,255,0.08)',borderColor:'rgba(255,255,255,0.16)',borderRadius:20,borderWidth:1,marginTop:24,paddingHorizontal:18,paddingVertical:13,width:'100%'},
 detailRow:{alignItems:'flex-start',flexDirection:'row',gap:12,paddingVertical:3},
 detailLabel:{color:PEACH,fontFamily:'Inter_600SemiBold',fontSize:12,minWidth:58},
 detailValue:{color:CREAM,flex:1,fontFamily:'Inter_500Medium',fontSize:14,lineHeight:19},
 divider:{backgroundColor:'rgba(255,255,255,0.12)',height:1,marginVertical:8},
 remaining:{color:PEACH,fontFamily:'Inter_600SemiBold',fontSize:13,marginTop:16},
 actions:{alignItems:'center',paddingBottom:20},
 snoozeRow:{alignItems:'center',flexDirection:'row',gap:12,marginBottom:24,width:'100%'},
 roundControl:{alignItems:'center',backgroundColor:'rgba(255,255,255,0.08)',borderColor:'rgba(255,255,255,0.18)',borderRadius:29,borderWidth:1,height:58,justifyContent:'center',width:58},
 roundControlText:{color:'#FFFFFF',fontFamily:'Inter_400Regular',fontSize:29,lineHeight:34},
 snoozeButton:{alignItems:'center',backgroundColor:'rgba(255,255,255,0.12)',borderRadius:22,flex:1,height:58,justifyContent:'center'},
 snoozeText:{color:'#FFFFFF',fontFamily:'Inter_600SemiBold',fontSize:17},
 dismissOuter:{alignItems:'center',borderColor:PEACH,borderRadius:78,borderWidth:2,height:156,justifyContent:'center',width:156},
 dismissInner:{alignItems:'center',backgroundColor:'rgba(0,0,0,0.16)',borderRadius:66,height:132,justifyContent:'center',width:132},
 dismissText:{color:'#FFFFFF',fontFamily:'Inter_600SemiBold',fontSize:19},
 pressed:{opacity:0.78,transform:[{scale:0.98}]},
 dismissPressed:{opacity:0.82,transform:[{scale:0.97}]},
});
