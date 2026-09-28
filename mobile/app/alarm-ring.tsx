import {Ionicons} from '@expo/vector-icons';
import {BlurView} from 'expo-blur';
import * as Notifications from 'expo-notifications';
import {router,useLocalSearchParams} from 'expo-router';
import {StatusBar} from 'expo-status-bar';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Animated,PanResponder,Platform,Pressable,StyleSheet,Text,useWindowDimensions,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {snoozeNotification} from '@/src/lib/alarms';
import {getRingingAlarm,nativeAlarms,type RingingAlarm} from '@/src/lib/native-alarms';
import {snoozeWebAlarm,stopWebRinging} from '@/src/lib/web-alarms';
import {useToast} from '@/src/components/toast';

const INK='#29231F',MIDNIGHT='#1E1917',DEEP='#A8462E',BRAND='#C35D38',SAND='#F1DFC8',CREAM='#FBF7F2',PEACH='#E9B18E';

function displayClock(value?:string|null){
 if(!value)return {clock:'',period:''};
 const parts=value.split(':');
 const hour=Number(parts[0]);
 const minute=Number(parts[1]);
 if(!Number.isFinite(hour)||!Number.isFinite(minute))return {clock:value,period:''};
 const period=hour>=12?'PM':'AM';
 const hour12=hour%12||12;
 return {clock:String(hour12).padStart(2,'0')+':'+String(minute).padStart(2,'0'),period};
}

function campusClock(now:number){
 const date=new Date(now+60*60*1000);
 const hour=date.getUTCHours();
 const minute=date.getUTCMinutes();
 return displayClock(String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0'));
}

function campusDate(now:number){
 return new Date(now+60*60*1000).toLocaleDateString('en-NG',{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'});
}

export default function AlarmRing(){
 const params=useLocalSearchParams<{
  alarmId?:string;alarmTime?:string;label?:string;snooze?:string;notificationId?:string;
  courseCode?:string;classTitle?:string;classStartsAt?:string;classEndsAt?:string;
  venue?:string;lecturer?:string;leadMinutes?:string;
 }>();
 const toast=useToast();
 const {height,width}=useWindowDimensions();
 const compact=height<720;
 const [alarm,setAlarm]=useState<RingingAlarm|null>(null);
 const [now,setNow]=useState(Date.now());
 const [busy,setBusy]=useState(false);
 const [loaded,setLoaded]=useState(!nativeAlarms);
 const [snoozeMinutes,setSnoozeMinutes]=useState(Math.max(1,Math.min(30,Number(params.snooze)||5)));
 const [snoozeTouched,setSnoozeTouched]=useState(false);
 const dragX=useRef(new Animated.Value(0)).current;

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
 const label=alarm?.label??params.label??'Alarm';
 const courseCode=alarm?.course_code??params.courseCode??'';
 const classTitle=alarm?.course_title??params.classTitle??'';
 const classStartsAt=alarm?.class_starts_at??params.classStartsAt??'';
 const venue=alarm?.venue??params.venue??'';
 const lecturer=alarm?.lecturer??params.lecturer??'';
 const leadMinutes=alarm?.reminder_minutes??(Number(params.leadMinutes)||15);
 const courseDisplay=courseCode||label;
 const showTitle=Boolean(classTitle&&classTitle.toLowerCase()!==courseDisplay.toLowerCase()&&classTitle.toLowerCase()!==label.toLowerCase());
 const alarmClock=displayClock(alarm?.time??params.alarmTime??(isClass?classStartsAt:''));
 const shownClock=alarmClock.clock?alarmClock:campusClock(now);
 const quote=isClass?'Get ready for class':'It’s time. Do your thing.';
 const secondsLeft=alarm?Math.max(0,Math.ceil((alarm.endsAt-now)/1000)):null;
 const ringingText=secondsLeft===null?'Ringing':Math.floor(secondsLeft/60)+':'+String(secondsLeft%60).padStart(2,'0')+' remaining';
 const railWidth=Math.min(Math.max(260,width-48),360);
 const handleSize=compact?58:66;
 const railPadding=8;
 const maxTravel=Math.max(120,railWidth-handleSize-(railPadding*2));
 const threshold=-Math.min(110,maxTravel*0.48);

 async function finish(snooze:boolean){
  if(busy)return;
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
     body:isClass?'Class in '+leadMinutes+' minutes':'Your reminder',
     sound:'default',
     data:{alarmId:params.alarmId,alarmTime:alarm?.time??params.alarmTime,snoozeMinutes},
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

 function resetDrag(){
  Animated.spring(dragX,{toValue:0,useNativeDriver:true,damping:17,stiffness:210,mass:0.7}).start();
 }

 const snoozeGesture=useMemo(()=>PanResponder.create({
  onStartShouldSetPanResponder:()=>ringing&&!busy,
  onMoveShouldSetPanResponder:(_,gesture)=>ringing&&!busy&&Math.abs(gesture.dx)>3,
  onPanResponderMove:(_,gesture)=>{
   dragX.setValue(Math.max(-maxTravel,Math.min(0,gesture.dx)));
  },
  onPanResponderRelease:(_,gesture)=>{
   if(gesture.dx<=threshold){
    Animated.timing(dragX,{toValue:-maxTravel,duration:150,useNativeDriver:true}).start(()=>{
     dragX.setValue(0);
     void finish(true);
    });
    return;
   }
   resetDrag();
  },
  onPanResponderTerminate:resetDrag,
 }),[busy,dragX,maxTravel,ringing,threshold,snoozeMinutes,alarm?.id,params.alarmId]);

 const details=[venue,lecturer].filter(Boolean).join('  •  ');

 return <SafeAreaView edges={['top','bottom']} style={styles.page}>
  <StatusBar style="light"/>
  <View pointerEvents="none" style={styles.backgroundBase}/>
  <View pointerEvents="none" style={styles.gradientTop}/>
  <View pointerEvents="none" style={styles.gradientMiddle}/>
  <View pointerEvents="none" style={styles.gradientBottom}/>
  <View pointerEvents="none" style={styles.vignette}/>

  <View style={[styles.shell,compact&&styles.shellCompact]}>
   <View style={styles.topbar}>
    <View style={styles.topBrandRow}>
     <View style={styles.brandDot}/>
     <Text style={styles.brand}>KampusOne</Text>
    </View>
    <Text style={styles.topMeta}>{isClass?'CLASS ALARM':'ALARM'}</Text>
   </View>

   <View style={[styles.hero,compact&&styles.heroCompact]}>
    <BlurView intensity={28} tint="dark" style={[styles.iconHalo,compact&&styles.iconHaloCompact]}>
     <View style={styles.iconCore}>
      <Ionicons name="alarm-outline" size={compact?32:38} color={CREAM}/>
     </View>
    </BlurView>

    <Text style={styles.kicker}>{!loaded?'Opening alarm…':ringing?'Ringing now':'Alarm finished'}</Text>
    <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.72} style={[styles.label,compact&&styles.labelCompact]}>{courseDisplay}</Text>
    {showTitle?<Text numberOfLines={1} style={styles.classTitle}>{classTitle}</Text>:null}
    <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.quote,compact&&styles.quoteCompact]}>{quote}</Text>

    <View style={styles.timeRow}>
     <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.time,compact&&styles.timeCompact]}>{shownClock.clock}</Text>
     {shownClock.period?<Text style={[styles.period,compact&&styles.periodCompact]}>{shownClock.period}</Text>:null}
    </View>
    <Text style={styles.date}>{campusDate(now)}</Text>

    {details?<Text numberOfLines={1} style={styles.details}>{details}</Text>:null}
    {ringing?<View style={styles.ringingPill}><View style={styles.ringingDot}/><Text style={styles.ringingText}>{ringingText}</Text></View>:null}
   </View>

   <View style={[styles.actions,compact&&styles.actionsCompact]}>
    {ringing?<>
     <View style={styles.snoozeDurationRow}>
      <Pressable accessibilityLabel="Decrease snooze time" accessibilityRole="button" disabled={busy||snoozeMinutes<=1} onPress={()=>changeSnooze(-1)} style={({pressed})=>[styles.miniControl,(busy||snoozeMinutes<=1)&&styles.disabled,pressed&&styles.pressed]}>
       <Ionicons name="remove" size={19} color={CREAM}/>
      </Pressable>
      <Text style={styles.snoozeDuration}>{snoozeMinutes} min snooze</Text>
      <Pressable accessibilityLabel="Increase snooze time" accessibilityRole="button" disabled={busy||snoozeMinutes>=30} onPress={()=>changeSnooze(1)} style={({pressed})=>[styles.miniControl,(busy||snoozeMinutes>=30)&&styles.disabled,pressed&&styles.pressed]}>
       <Ionicons name="add" size={19} color={CREAM}/>
      </Pressable>
     </View>

     <View accessibilityLabel={'Swipe left to snooze for '+snoozeMinutes+' minutes'} accessibilityRole="adjustable" style={[styles.snoozeRail,{width:railWidth}]} {...snoozeGesture.panHandlers}>
      <View style={styles.snoozeTarget}>
       <Ionicons name="chevron-back" size={18} color={PEACH}/>
       <Ionicons name="chevron-back" size={18} color={PEACH} style={styles.chevronTight}/>
       <Text style={styles.swipeText}>Swipe left to snooze</Text>
      </View>
      <Animated.View style={[styles.snoozeHandle,{height:handleSize,width:handleSize,transform:[{translateX:dragX}]}]}>
       <Ionicons name="bed-outline" size={25} color={INK}/>
      </Animated.View>
     </View>
    </>:null}

    <Pressable accessibilityLabel={ringing?'Dismiss alarm':'Back to alarms'} accessibilityRole="button" disabled={busy} onPress={()=>void finish(false)} style={({pressed})=>[styles.dismissOuter,compact&&styles.dismissOuterCompact,busy&&styles.disabled,pressed&&styles.dismissPressed]}>
     <View style={[styles.dismissInner,compact&&styles.dismissInnerCompact]}>
      <Ionicons name={ringing?'close':'arrow-back'} size={compact?30:34} color={CREAM}/>
     </View>
    </Pressable>
    <Text style={styles.dismissLabel}>{ringing?'Tap to dismiss':'Back to alarms'}</Text>
   </View>
  </View>
 </SafeAreaView>;
}

const styles=StyleSheet.create({
 page:{backgroundColor:MIDNIGHT,flex:1,overflow:'hidden'},
 backgroundBase:{position:'absolute',top:0,right:0,bottom:0,left:0,backgroundColor:MIDNIGHT},
 gradientTop:{backgroundColor:DEEP,borderRadius:360,height:560,left:-230,opacity:0.72,position:'absolute',top:-250,transform:[{rotate:'18deg'}],width:680},
 gradientMiddle:{backgroundColor:BRAND,borderRadius:260,height:430,opacity:0.34,position:'absolute',right:-280,top:150,transform:[{rotate:'-12deg'}],width:560},
 gradientBottom:{backgroundColor:PEACH,borderRadius:320,bottom:-360,height:540,left:-120,opacity:0.18,position:'absolute',transform:[{rotate:'-8deg'}],width:660},
 vignette:{position:'absolute',top:0,right:0,bottom:0,left:0,backgroundColor:'rgba(20,15,13,0.18)'},
 shell:{flex:1,paddingHorizontal:24,paddingBottom:8},
 shellCompact:{paddingHorizontal:20},
 topbar:{alignItems:'center',flexDirection:'row',justifyContent:'space-between',minHeight:52},
 topBrandRow:{alignItems:'center',flexDirection:'row',gap:8},
 brandDot:{backgroundColor:SAND,borderRadius:5,height:10,width:10},
 brand:{color:CREAM,fontFamily:'Lato_700Bold',fontSize:17,letterSpacing:-0.15},
 topMeta:{color:PEACH,fontFamily:'Inter_600SemiBold',fontSize:10,letterSpacing:1.45},
 hero:{alignItems:'center',flex:1,justifyContent:'center',paddingBottom:10},
 heroCompact:{paddingBottom:0},
 iconHalo:{alignItems:'center',backgroundColor:'rgba(241,223,200,0.08)',borderColor:'rgba(241,223,200,0.18)',borderRadius:48,borderWidth:1,height:90,justifyContent:'center',marginBottom:16,overflow:'hidden',width:90},
 iconHaloCompact:{height:76,marginBottom:10,width:76},
 iconCore:{alignItems:'center',backgroundColor:'rgba(195,93,56,0.28)',borderRadius:31,height:62,justifyContent:'center',width:62},
 kicker:{color:SAND,fontFamily:'Inter_600SemiBold',fontSize:12,letterSpacing:1.1,marginBottom:7,textTransform:'uppercase'},
 label:{color:CREAM,fontFamily:'Lato_900Black',fontSize:31,letterSpacing:-0.65,lineHeight:36,maxWidth:350,textAlign:'center'},
 labelCompact:{fontSize:26,lineHeight:31},
 classTitle:{color:'rgba(251,247,242,0.72)',fontFamily:'Inter_400Regular',fontSize:14,marginTop:5,maxWidth:330,textAlign:'center'},
 quote:{color:PEACH,fontFamily:'Caveat_600SemiBold',fontSize:33,lineHeight:40,marginTop:9,maxWidth:350,textAlign:'center'},
 quoteCompact:{fontSize:29,lineHeight:34,marginTop:5},
 timeRow:{alignItems:'flex-end',flexDirection:'row',justifyContent:'center',marginTop:14},
 time:{color:'#FFFFFF',fontFamily:'Inter_400Regular',fontSize:72,letterSpacing:-3,lineHeight:78},
 timeCompact:{fontSize:60,lineHeight:65},
 period:{color:SAND,fontFamily:'Inter_600SemiBold',fontSize:16,lineHeight:28,marginBottom:8,marginLeft:8},
 periodCompact:{fontSize:14,marginBottom:6},
 date:{color:'rgba(251,247,242,0.62)',fontFamily:'Inter_500Medium',fontSize:14,marginTop:0},
 details:{color:'rgba(251,247,242,0.76)',fontFamily:'Inter_500Medium',fontSize:13,marginTop:12,maxWidth:340,textAlign:'center'},
 ringingPill:{alignItems:'center',backgroundColor:'rgba(241,223,200,0.08)',borderColor:'rgba(241,223,200,0.12)',borderRadius:18,borderWidth:1,flexDirection:'row',gap:7,marginTop:13,paddingHorizontal:12,paddingVertical:7},
 ringingDot:{backgroundColor:PEACH,borderRadius:4,height:7,width:7},
 ringingText:{color:SAND,fontFamily:'Inter_600SemiBold',fontSize:11,letterSpacing:0.2},
 actions:{alignItems:'center',paddingBottom:10},
 actionsCompact:{paddingBottom:4},
 snoozeDurationRow:{alignItems:'center',flexDirection:'row',gap:13,marginBottom:10},
 miniControl:{alignItems:'center',backgroundColor:'rgba(255,255,255,0.08)',borderColor:'rgba(241,223,200,0.15)',borderRadius:18,borderWidth:1,height:36,justifyContent:'center',width:36},
 snoozeDuration:{color:CREAM,fontFamily:'Inter_600SemiBold',fontSize:13,minWidth:88,textAlign:'center'},
 snoozeRail:{alignItems:'center',backgroundColor:'rgba(251,247,242,0.08)',borderColor:'rgba(241,223,200,0.18)',borderRadius:38,borderWidth:1,flexDirection:'row',height:76,justifyContent:'space-between',overflow:'hidden',paddingHorizontal:8},
 snoozeTarget:{alignItems:'center',flex:1,flexDirection:'row',justifyContent:'flex-start',paddingLeft:8},
 chevronTight:{marginLeft:-10},
 swipeText:{color:'rgba(251,247,242,0.78)',fontFamily:'Inter_500Medium',fontSize:13,marginLeft:4},
 snoozeHandle:{alignItems:'center',backgroundColor:SAND,borderRadius:34,justifyContent:'center',shadowColor:'#000',shadowOffset:{width:0,height:6},shadowOpacity:0.22,shadowRadius:12},
 dismissOuter:{alignItems:'center',borderColor:'rgba(241,223,200,0.42)',borderRadius:62,borderWidth:1.5,height:124,justifyContent:'center',marginTop:18,width:124},
 dismissOuterCompact:{height:108,marginTop:13,width:108},
 dismissInner:{alignItems:'center',backgroundColor:'rgba(41,35,31,0.56)',borderColor:'rgba(251,247,242,0.12)',borderRadius:50,borderWidth:1,height:100,justifyContent:'center',width:100},
 dismissInnerCompact:{height:86,width:86},
 dismissLabel:{color:'rgba(251,247,242,0.72)',fontFamily:'Inter_500Medium',fontSize:12,marginTop:7},
 pressed:{opacity:0.75,transform:[{scale:0.96}]},
 dismissPressed:{opacity:0.8,transform:[{scale:0.97}]},
 disabled:{opacity:0.48},
});
