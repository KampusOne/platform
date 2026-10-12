import {getDeviceCacheRevision} from './device-cache';
export type UnreadKind='messages'|'notifications';
const counts={messages:0,notifications:0},versions={messages:0,notifications:0};
let owner=-1;
const listeners=new Set<()=>void>();
function current(){const revision=getDeviceCacheRevision();if(revision!==owner){owner=revision;counts.messages=0;counts.notifications=0;versions.messages++;versions.notifications++;}return revision;}
export function unreadCount(kind:UnreadKind){current();return counts[kind];}
export function onUnreadCountChange(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function unreadRead(kind:UnreadKind){return{revision:current(),version:versions[kind]};}
export function updateUnreadCount(kind:UnreadKind,value:number,revision=getDeviceCacheRevision(),version?:number){
  if(revision!==current()||(version!==undefined&&version!==versions[kind])||!Number.isFinite(value))return false;
  counts[kind]=Math.max(0,Math.trunc(value));versions[kind]++;for(const listener of listeners)listener();return true;
}
export function changeUnreadCount(kind:UnreadKind,delta:number,revision=getDeviceCacheRevision()){return updateUnreadCount(kind,unreadCount(kind)+delta,revision);}
