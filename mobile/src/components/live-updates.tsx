import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Network from 'expo-network';
import { useAuth } from '../auth/auth-context';
import { api } from '../lib/api';
import { LiveConnection,type LiveTicket } from '../lib/live-connection';
import { liveReads } from '../lib/live-updates';
import { cacheScopeForUser } from '../lib/request-policy';
import {TextRetryCoordinator} from '../lib/text-retry-coordinator';
import {queuedTextMessages,acknowledgePendingText,updatePendingTextRetry,onPendingTextChange,onTextDelivered} from '../lib/message-drafts';
import {transferTextOnce} from '../lib/text-transfer';
import {getDeviceCacheRevision} from '../lib/device-cache';
export function LiveUpdates() {
  const { state,user } = useAuth();
  const scope=user?cacheScopeForUser(user):null;
  const revision=getDeviceCacheRevision();
  useEffect(()=>{
    if(state!=='authenticated'||!user)return;
    let online=true,alive=true;
    const checkCurrent=()=>{if(!alive||revision!==getDeviceCacheRevision()){const error=new Error('Your session changed.') as Error&{code:string};error.code='SESSION_CHANGED';throw error;}};
    const texts=new TextRetryCoordinator(async()=>{checkCurrent();const values=await queuedTextMessages(user.id);checkCurrent();return values;},(value,signal)=>transferTextOnce(user.id,value.threadId,value.message,async checkScope=>{
      const {id,body,replyToMessageId}=value.message;
      checkCurrent();checkScope();
      const receipt=await api<{message:{id:string}}>(`/v1/messages/threads/${value.threadId}/messages`,{method:'POST',signal,body:JSON.stringify({id,body,...(replyToMessageId?{replyToMessageId}:{})})});
      if(receipt?.message?.id!==id)throw new Error('Message confirmation was incomplete. Your pending text is kept.');
    }),value=>{checkCurrent();return acknowledgePendingText(user.id,value.threadId,value.message.id);},
    (value,retry)=>{checkCurrent();return updatePendingTextRetry(user.id,value.threadId,value.message.id,retry);});
    const pending=onPendingTextChange(account=>{if(account===user.id)texts.wake();});
    const delivered=onTextDelivered((account,thread)=>{if(account===user.id)liveReads.event(['/v1/messages/inbox','/v1/messages/threads/'+thread]);});
    const stream=new LiveConnection(signal=>api<LiveTicket>('/v1/live/ticket',{method:'POST',signal,timeoutMs:10_000}),
      (url,protocols)=>new WebSocket(url,protocols),()=>liveReads.reconcile(),paths=>liveReads.event(paths),ready=>liveReads.setRealtime(ready));
    const active=()=>AppState.currentState==='active'&&(Platform.OS!=='web'||typeof document==='undefined'||document.visibilityState==='visible');
    const publish=()=>{const enabled=active()&&online;liveReads.setAvailable(active(),online);stream.setAvailable(enabled);texts.setAvailable(enabled);};
    const network=(value:Network.NetworkState)=>{if(!alive)return;online=value.isConnected!==false&&value.isInternetReachable!==false;publish();};
    const app=AppState.addEventListener('change',publish), net=Network.addNetworkStateListener(network);
    void Network.getNetworkStateAsync().then(network).catch(()=>undefined);
    if(Platform.OS==='web'&&typeof document!=='undefined')document.addEventListener('visibilitychange',publish);
    publish();
    return()=>{alive=false;texts.stop();pending();delivered();stream.stop();app.remove();net.remove();if(Platform.OS==='web'&&typeof document!=='undefined')document.removeEventListener('visibilitychange',publish);liveReads.setAvailable(false,false);};
  },[state,scope,revision]);
  return null;
}
