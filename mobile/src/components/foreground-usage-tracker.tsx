import {useEffect} from 'react';
import {AppState,Platform} from 'react-native';
import {usePathname} from 'expo-router';
import {randomUUID} from 'expo-crypto';
import * as Network from 'expo-network';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useAuth} from '../auth/auth-context';
import {api,ApiError} from '../lib/api';
import {recordActivityEvent} from '../lib/activity-events';
import {analyticsScreenName} from '../lib/analytics';
import {cacheScopeForUser} from '../lib/request-policy';
import {getDeviceCacheRevision,isDeviceCacheOwner,readCache,writeCache} from '../lib/device-cache';
import {ForegroundUsageSampler,validUsageSample,type UsageSample} from '../lib/foreground-usage';
const writers=new Map<string,Promise<void>>();
export function ForegroundUsageTracker(){
 const {user}=useAuth(),path=usePathname(),scope=user?cacheScopeForUser(user):null;
 useEffect(()=>{
  if(!user?.id||!['android','ios','web'].includes(Platform.OS))return;
  const owner=user.id,key='telemetry.'+owner,revision=getDeviceCacheRevision(),screen=analyticsScreenName(path),platform=Platform.OS;
  let active=true,online=true,queued=false,controller:AbortController|null=null;
  const pendingSamples:UsageSample[]=[];
  const foreground=()=>AppState.currentState==='active'&&(Platform.OS!=='web'||typeof document==='undefined'||document.visibilityState==='visible');
  const owned=()=>revision===getDeviceCacheRevision()&&isDeviceCacheOwner(owner);
  function enqueue(sample?:UsageSample){
   if(sample){pendingSamples.push(sample);if(pendingSamples.length>300)pendingSamples.shift();}
   if(queued)return;queued=true;
   const pending=(writers.get(key)??Promise.resolve()).then(()=>save(pendingSamples.splice(0))).catch(()=>{});
   writers.set(key,pending);void pending.finally(()=>{if(writers.get(key)===pending)writers.delete(key);});
   void pending.finally(()=>{queued=false;if(pendingSamples.length)enqueue();});
  }
  async function save(samples:UsageSample[]){
   if(!owned())return;
   const stored=await readCache<unknown>(key);
   if(!owned())return;
   const queue=(Array.isArray(stored)?stored:[]).filter(value=>validUsageSample(value,owner));
   queue.push(...samples);
   const retained=queue.slice(-300);
   // A short telemetry batch cannot monopolize transport during startup or replay a whole backlog.
   for(let count=0;active&&online&&foreground()&&owned()&&retained.length&&count<3;count++){
    const transfer=new AbortController();controller=transfer;
    try{await api('/v1/usage',{method:'POST',body:JSON.stringify(retained[0]),timeoutMs:12000,signal:transfer.signal});if(!owned()||transfer.signal.aborted)break;retained.shift();}
    catch(error){if(error instanceof ApiError&&error.status===400){retained.shift();continue;}break;}
    finally{if(controller===transfer)controller=null;}
   }
   if(owned())await writeCache(key,retained,48*3600000);
  }
  const sampler=new ForegroundUsageSampler((start,end,seconds)=>enqueue({id:randomUUID(),ownerUserId:owner,platform,screen,startedAt:new Date(start).toISOString(),endedAt:new Date(end).toISOString(),seconds}),undefined,undefined,undefined,()=>recordActivityEvent('feature_failed',{screen,feature:'foreground_usage',errorCode:'USAGE_INVALID_CLOCK'}));
  let previousForeground=foreground();
  const visibility=()=>{const visible=foreground();if(visible===previousForeground)return;previousForeground=visible;if(!visible)controller?.abort();sampler.setForeground(visible);if(visible&&online)enqueue();};
  const state=AppState.addEventListener('change',visibility);
  const network=Network.addNetworkStateListener(value=>{if(!active)return;const next=value.isConnected!==false&&value.isInternetReachable!==false;if(next===online)return;online=next;if(!online)controller?.abort();else if(foreground())enqueue();});
  void Network.getNetworkStateAsync().then(value=>{if(active)online=value.isConnected!==false&&value.isInternetReachable!==false;}).catch(()=>{});
  if(Platform.OS==='web'&&typeof document!=='undefined')document.addEventListener('visibilitychange',visibility);
  sampler.setForeground(foreground());
  // Old plaintext usage samples have no verified institution scope; discard optional telemetry safely.
  void AsyncStorage.removeItem('k1-foreground-usage:'+owner).catch(()=>{});
  const initial=setTimeout(()=>{if(active&&foreground())enqueue();},2500);
  return()=>{active=false;controller?.abort();sampler.stop();clearTimeout(initial);state.remove();network.remove();if(Platform.OS==='web'&&typeof document!=='undefined')document.removeEventListener('visibilitychange',visibility);};
 },[scope,path]);return null;
}
