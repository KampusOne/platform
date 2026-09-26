import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api } from './api';
import { useAuth } from '../auth/auth-context';
let count=0;
const listeners=new Set<(count:number)=>void>();
export function updateNotificationCount(value:number){count=Math.max(0,value);for(const listener of listeners)listener(count);}
export function changeNotificationCount(delta:number){updateNotificationCount(count+delta);}
export function useNotificationCount(){
  const {user}=useAuth();
  useEffect(()=>updateNotificationCount(0),[user?.id]);
  const [unread,setUnread]=useState(count);
  const refresh=useCallback(async()=>{try{const result=await api<{unreadCount:number}>('/v1/notifications/inbox');updateNotificationCount(result.unreadCount);}catch{/* Keep the previous badge offline. */}},[]);
  useEffect(()=>{listeners.add(setUnread);return()=>{listeners.delete(setUnread);};},[]);
  useFocusEffect(useCallback(()=>{void refresh();const timer=setInterval(()=>void refresh(),20000);return()=>clearInterval(timer);},[refresh]));
  useEffect(()=>{const sub=AppState.addEventListener('change',state=>{if(state==='active')void refresh();});return()=>sub.remove();},[refresh]);
  return unread;
}
