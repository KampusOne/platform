import { useCallback, useEffect, useState } from 'react';
import { useLiveRefresh } from './live-updates';
import { useFocusEffect } from 'expo-router';
import { api } from './api';
import { useAuth } from '../auth/auth-context';
let count=0;
const listeners=new Set<(count:number)=>void>();
export function updateNotificationCount(value:number){count=Number.isFinite(value)?Math.max(0,Math.trunc(value)):0;for(const listener of listeners)listener(count);}
export function changeNotificationCount(delta:number){updateNotificationCount(count+delta);}
export function useNotificationCount(){
  const {user}=useAuth();
  useEffect(()=>updateNotificationCount(0),[user?.id]);
  const [unread,setUnread]=useState(count);
  const refresh=useCallback(async()=>{try{const result=await api<{unreadCount:number}>('/v1/notifications/inbox');updateNotificationCount(result.unreadCount);}catch{/* Keep the previous badge offline. */}},[]);
  useEffect(()=>{listeners.add(setUnread);return()=>{listeners.delete(setUnread);};},[]);
  useFocusEffect(useCallback(()=>{if(user?.id)void refresh();},[refresh,user?.id]));
  useLiveRefresh('/v1/notifications/inbox',refresh,90_000);

  return unread;
}
