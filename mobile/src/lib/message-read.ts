import {api} from './api';
import {getDeviceCacheRevision} from './device-cache';
import {updateUnreadCount,unreadRead} from './unread-counts';
import {liveReads} from './live-updates';
const pending=new Map<string,Promise<void>>();
/** Display is independent of bookkeeping; a confirmed read immediately updates shared badges. */
export function markConversationRead(threadId:string,lastReadMessageId?:string){
  const revision=getDeviceCacheRevision(),key=`${revision}:${threadId}:${lastReadMessageId??'legacy'}`;
  const existing=pending.get(key);if(existing)return existing;
  const operation=(async()=>{
    const lease=unreadRead('messages');
    const result=await api<{unreadCount?:number}>(`/v1/messages/threads/${threadId}/read`,{method:'PUT',timeoutMs:8000,...(lastReadMessageId?{body:JSON.stringify({lastReadMessageId})}:{})});
    if(revision!==getDeviceCacheRevision())return;
    if(typeof result.unreadCount!=='number'||!updateUnreadCount('messages',result.unreadCount,revision,lease.version)){
      const freshLease=unreadRead('messages');
      const fresh=await api<{unreadCount:number}>('/v1/messages/inbox',{cache:'no-store',timeoutMs:8000});
      updateUnreadCount('messages',fresh.unreadCount,revision,freshLease.version);
    }
    liveReads.event(['/v1/messages/inbox']);
  })().finally(()=>pending.delete(key));
  pending.set(key,operation);return operation;
}
