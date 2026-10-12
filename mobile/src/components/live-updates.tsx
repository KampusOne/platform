import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Network from 'expo-network';
import { useAuth } from '../auth/auth-context';
import { api } from '../lib/api';
import { LiveConnection,type LiveTicket } from '../lib/live-connection';
import { liveReads } from '../lib/live-updates';
import { cacheScopeForUser } from '../lib/request-policy';
export function LiveUpdates() {
  const { state,user } = useAuth();
  const scope=user?cacheScopeForUser(user):null;
  useEffect(()=>{
    if(state!=='authenticated'||!user)return;
    let online=true,alive=true;
    const stream=new LiveConnection(signal=>api<LiveTicket>('/v1/live/ticket',{method:'POST',signal,timeoutMs:10_000}),
      (url,protocols)=>new WebSocket(url,protocols),()=>liveReads.reconcile(),paths=>liveReads.event(paths),ready=>liveReads.setRealtime(ready));
    const active=()=>AppState.currentState==='active'&&(Platform.OS!=='web'||typeof document==='undefined'||document.visibilityState==='visible');
    const publish=()=>{const enabled=active()&&online;liveReads.setAvailable(active(),online);stream.setAvailable(enabled);};
    const network=(value:Network.NetworkState)=>{if(!alive)return;online=value.isConnected!==false&&value.isInternetReachable!==false;publish();};
    const app=AppState.addEventListener('change',publish), net=Network.addNetworkStateListener(network);
    void Network.getNetworkStateAsync().then(network).catch(()=>undefined);
    if(Platform.OS==='web'&&typeof document!=='undefined')document.addEventListener('visibilitychange',publish);
    publish();
    return()=>{alive=false;stream.stop();app.remove();net.remove();if(Platform.OS==='web'&&typeof document!=='undefined')document.removeEventListener('visibilitychange',publish);liveReads.setAvailable(false,false);};
  },[state,scope]);
  return null;
}
