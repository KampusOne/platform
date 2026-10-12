import {useCallback,useEffect,useState} from 'react';
import {useFocusEffect} from 'expo-router';
import {useLiveRefresh} from './live-updates';
import {api} from './api';
import {useAuth} from '../auth/auth-context';
import {cacheScopeForUser} from './request-policy';
import {getDeviceCacheRevision} from './device-cache';
import {unreadCount,unreadRead,updateUnreadCount,changeUnreadCount,onUnreadCountChange,type UnreadKind} from './unread-counts';
export function updateNotificationCount(value:number,revision?:number){return updateUnreadCount('notifications',value,revision);}
export function changeNotificationCount(delta:number,revision?:number){return changeUnreadCount('notifications',delta,revision);}
export function updateMessageCount(value:number,revision?:number){return updateUnreadCount('messages',value,revision);}
function useUnreadCount(kind:UnreadKind,path:string){
  const {user}=useAuth(),scope=user?cacheScopeForUser(user):null;
  const snapshot=()=>({revision:getDeviceCacheRevision(),count:unreadCount(kind)});
  const [value,setValue]=useState(snapshot);
  useEffect(()=>{setValue(snapshot());return onUnreadCountChange(()=>setValue(snapshot()));},[scope,kind]);
  const refresh=useCallback(async()=>{
    if(!user?.id)return;
    const lease=unreadRead(kind);
    try{const result=await api<{unreadCount:number}>(path,{cache:'no-store',timeoutMs:8000});updateUnreadCount(kind,result.unreadCount,lease.revision,lease.version);}catch{/* Retain the last owned badge while offline. */}
  },[kind,path,scope,user?.id]);
  useFocusEffect(useCallback(()=>{void refresh();},[refresh]));
  useLiveRefresh(path,refresh,90_000,Boolean(user?.id));
  return user&&value.revision===getDeviceCacheRevision()?value.count:0;
}
export const useNotificationCount=()=>useUnreadCount('notifications','/v1/notifications/inbox');
export const useMessageCount=()=>useUnreadCount('messages','/v1/messages/inbox');
