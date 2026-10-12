import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@/src/auth/auth-context';
import { api } from '@/src/lib/api';
import { readCache,writeCache } from '@/src/lib/device-cache';
const pending=new Set<string>();
export function AutoStreak(){
 const {user}=useAuth();
 useEffect(()=>{
  if(!user?.id)return;let live=true;const userId=user.id;
  async function record(){
   const day=new Date(Date.now()+3600000).toISOString().slice(0,10),key='streak.open.'+userId;
   if(pending.has(userId))return;pending.add(userId);
   try{if(await readCache<string>(key)===day||!live)return;await api('/v1/account/streak',{method:'POST'});if(live)await writeCache(key,day);}catch{/* Retry next foreground; never invent a saved day. */}finally{pending.delete(userId);}
  }
  const initialRecord=setTimeout(()=>void record(),1800);
  const listener=AppState.addEventListener('change',state=>{if(state==='active')void record();});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleMidnight=()=>{if(timer)clearTimeout(timer);if(AppState.currentState!=='active')return;const midnight=(Math.floor((Date.now()+3600000)/86400000)+1)*86400000-3600000;timer=setTimeout(()=>{void record();scheduleMidnight();},Math.max(1000,midnight-Date.now()+100));};
  scheduleMidnight();
  const clock=AppState.addEventListener('change',()=>scheduleMidnight());
  return()=>{live=false;clearTimeout(initialRecord);listener.remove();clock.remove();if(timer)clearTimeout(timer);};
 },[user?.id]);return null;
}
