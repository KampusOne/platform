import { useCallback, useState, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
const listeners=new Set<()=>void>();
const visible=()=>AppState.currentState==='active'&&(Platform.OS!=='web'||typeof document==='undefined'||document.visibilityState==='visible');
let active=visible();
let remove:undefined|(()=>void);
function publish(){const next=visible();if(next===active)return;active=next;for(const listener of listeners)listener();}
function subscribe(listener:()=>void){
  listeners.add(listener);
  if(listeners.size===1){
    active=visible();const native=AppState.addEventListener('change',publish);
    if(Platform.OS==='web'&&typeof document!=='undefined')document.addEventListener('visibilitychange',publish);
    remove=()=>{native.remove();if(Platform.OS==='web'&&typeof document!=='undefined')document.removeEventListener('visibilitychange',publish);};
  }
  return()=>{listeners.delete(listener);if(!listeners.size){remove?.();remove=undefined;}};
}
/** Shared foreground observer for optional clocks; native alarms and active recordings own their lifecycles. */
export function useActiveScreen(){
  const foreground=useSyncExternalStore(subscribe,()=>active,()=>false);
  const [focused,setFocused]=useState(false);
  useFocusEffect(useCallback(()=>{setFocused(true);return()=>setFocused(false);},[]));
  return focused&&foreground;
}
