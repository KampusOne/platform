import {useEffect,useState} from 'react';
import {Platform,Pressable,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {router,useLocalSearchParams} from 'expo-router';
import * as Notifications from 'expo-notifications';
import {getRingingAlarm,nativeAlarms,type RingingAlarm} from '@/src/lib/native-alarms';
import {useAppearance} from '@/src/lib/appearance';
import {useToast} from '@/src/components/toast';
import {snoozeNotification} from '@/src/lib/alarms';
import {stopWebRinging,snoozeWebAlarm} from '@/src/lib/web-alarms';
export default function AlarmRing(){
 const params=useLocalSearchParams<{alarmId?:string;label?:string;snooze?:string;notificationId?:string}>();
 const {theme}=useAppearance(),toast=useToast();const [alarm,setAlarm]=useState<RingingAlarm|null>(null),[now,setNow]=useState(Date.now()),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(!nativeAlarms);
 useEffect(()=>{let active=true;async function refresh(){setNow(Date.now());if(nativeAlarms){try{const ringing=await getRingingAlarm();if(active){setAlarm(ringing?.id===params.alarmId?ringing:null);setLoaded(true);}}catch{if(active)setLoaded(true);}}}void refresh();const timer=setInterval(()=>void refresh(),1000);return()=>{active=false;clearInterval(timer);};},[params.alarmId]);
 const ringing=nativeAlarms?Boolean(alarm&&alarm.endsAt>now):true;
 async function finish(snooze:boolean){setBusy(true);try{
  if(nativeAlarms&&alarm){if(snooze)await nativeAlarms.snooze(alarm.id);else await nativeAlarms.dismiss(alarm.id);}
  else if(Platform.OS==='web'){if(snooze)snoozeWebAlarm(params.alarmId??'');else stopWebRinging();}
  else if(snooze)await snoozeNotification({title:params.label??'KampusOne alarm',body:'Your reminder',sound:'default',data:{alarmId:params.alarmId,snoozeMinutes:Number(params.snooze)||5}});
  if(params.notificationId&&Platform.OS!=='web')await Notifications.dismissNotificationAsync(params.notificationId);
  router.canGoBack()?router.back():router.replace('/alarms');
 }catch(error){toast(error instanceof Error?error.message:'Could not update alarm','error');}finally{setBusy(false);}}
 const time=new Date(now).toLocaleTimeString('en-NG',{hour:'2-digit',minute:'2-digit'});
 return <SafeAreaView style={[styles.page,{backgroundColor:theme.canvas}]}><View style={styles.content}><View style={[styles.mark,{backgroundColor:theme.surfaceMuted}]}><Ionicons name={ringing?'alarm-outline':'checkmark-circle-outline'} size={54} color={theme.accentText}/></View><Text style={[styles.eyebrow,{color:theme.textMuted}]}>KAMPUSONE ALARM</Text><Text style={[styles.clock,{color:theme.text}]}>{time}</Text><Text style={[styles.label,{color:theme.text}]}>{alarm?.label??params.label??'Your reminder'}</Text><Text style={[styles.detail,{color:theme.textMuted}]}>{!loaded?'Opening your alarm…':ringing?'Time to get ready.': 'This alarm has finished.'}</Text>{alarm&&ringing?<Text style={[styles.detail,{color:theme.textMuted}]}>Stops in {Math.ceil((alarm.endsAt-now)/60000)} min</Text>:null}</View><View style={styles.actions}>{ringing?<Pressable disabled={busy} onPress={()=>void finish(true)} style={[styles.button,{backgroundColor:theme.surfaceMuted}]} accessibilityRole="button"><Text style={[styles.buttonText,{color:theme.accentText}]}>Snooze {alarm?.snooze_minutes??(Number(params.snooze)||5)} min</Text></Pressable>:null}<Pressable disabled={busy} onPress={()=>void finish(false)} style={[styles.button,{backgroundColor:theme.deepBrand}]} accessibilityRole="button"><Text style={[styles.buttonText,{color:'#fff'}]}>{ringing?'Dismiss':'Back to alarms'}</Text></Pressable></View></SafeAreaView>;
}
const styles=StyleSheet.create({page:{flex:1,paddingHorizontal:28},content:{flex:1,justifyContent:'center',alignItems:'center',gap:18},mark:{width:112,height:112,borderRadius:56,alignItems:'center',justifyContent:'center',marginBottom:14},eyebrow:{fontFamily:'Inter_600SemiBold',fontSize:12,letterSpacing:2},clock:{fontFamily:'Lato_900Black',fontSize:60},label:{fontFamily:'Lato_700Bold',fontSize:26,textAlign:'center'},detail:{fontFamily:'Inter_400Regular',fontSize:14,textAlign:'center'},actions:{gap:12,paddingBottom:28},button:{minHeight:58,borderRadius:18,justifyContent:'center',alignItems:'center'},buttonText:{fontFamily:'Inter_600SemiBold',fontSize:16}});
