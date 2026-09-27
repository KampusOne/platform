import {setWebAlarmSound} from '@/src/lib/web-alarms';
import {useEffect} from 'react';
import {AppState,Platform} from 'react-native';
import {router} from 'expo-router';
import {useAuth} from '@/src/auth/auth-context';
import {api} from '@/src/lib/api';
import {syncAlarms,type Alarm} from '@/src/lib/alarms';
import {getAlarmEvents,getRingingAlarm,nativeAlarms} from '@/src/lib/native-alarms';
export function AlarmSync(){
 const {user}=useAuth();
 useEffect(()=>{
  if(!user)return;let active=true,lastRing='',syncing=false;
  async function transferEvents(){if(!nativeAlarms)return;const events=await getAlarmEvents();if(events.length){const result=await api<{acknowledged:string[]}>('/v1/notifications/alarm-events',{method:'POST',body:JSON.stringify({events})});await nativeAlarms.acknowledge(JSON.stringify(result.acknowledged));}}
  async function restore(){
   if(syncing)return;syncing=true;
   try{const result=await api<{alarms:Alarm[]}>('/v1/learning/alarms');if(!active)return;
    const hasEnabledAlarm=result.alarms.some(alarm=>alarm.enabled);
    const requestExact=Boolean(hasEnabledAlarm&&Platform.OS==='android'&&nativeAlarms&&!(await nativeAlarms.status()));
    await syncAlarms(result.alarms,requestExact);
    try{
      if(Platform.OS==='web'){
        const {sound}=await api<{sound:{url:string}|null}>('/v1/notifications/sounds/default');
        if(active)setWebAlarmSound(sound?.url);
      }else if(nativeAlarms){
        // Android alarms deliberately use the device's built-in alarm tone.
        // Clear any previously cached admin/custom tone so a broken download can never silence ringing.
        await nativeAlarms.cacheSound('');
      }
    }catch{/* Keep the built-in device alarm tone offline. */}
    await transferEvents();
   }catch{/* Native schedules and pending events survive a network interruption. */}finally{syncing=false;}
  }
  async function observe(){if(!active||AppState.currentState!=='active'||!nativeAlarms)return;try{const ringing=await getRingingAlarm();if(ringing&&ringing.endsAt>Date.now()){const key=ringing.id+':'+ringing.firedAt;if(key!==lastRing){lastRing=key;void transferEvents().catch(()=>undefined);router.push({pathname:'/alarm-ring',params:{alarmId:ringing.id}});}}}catch{/* Never crash navigation when the native service is unavailable. */}}
  void restore();const timer=nativeAlarms?setInterval(()=>void observe(),1500):null;
  const sub=AppState.addEventListener('change',state=>{if(state==='active'){void restore();void observe();}});
  const ring=(event:Event)=>{const detail=(event as CustomEvent<{label:string;alarmId:string}>).detail;router.push({pathname:'/alarm-ring',params:{alarmId:detail.alarmId,label:detail.label}});};
  if(Platform.OS==='web')window.addEventListener('k1-alarm',ring);
  return()=>{active=false;sub.remove();if(timer)clearInterval(timer);if(Platform.OS==='web')window.removeEventListener('k1-alarm',ring);};
 },[user?.id]);
 return null;
}
