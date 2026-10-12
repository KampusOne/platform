import { api, ApiError, peekApiCache } from './api';
import { secureSnapshots } from './secure-snapshots.native-adapter';
import { useSyncExternalStore } from 'react';
import { getDeviceCacheRevision } from './device-cache';
const statuses = new Map<string,{savedAt:number;stale:boolean}>();
const listeners = new Set<()=>void>();
const subscribe = (listener:()=>void) => { listeners.add(listener);return()=>{listeners.delete(listener);}; };
export function useScreenSync(path:string) { return useSyncExternalStore(subscribe,()=>statuses.get(path),()=>undefined); }
function status(path:string,savedAt:number,stale:boolean) { statuses.set(path,{savedAt,stale});if(statuses.size>60)statuses.delete(statuses.keys().next().value!);for(const listener of listeners)listener(); }
export function clearScreenSync(){statuses.clear();for(const listener of listeners)listener();}
/** Start the network alongside disk hydration; a late snapshot can never replace the fresh read. */
export async function refreshScreenRead<T>(path: string, publish: (value: T) => void, onDenied?:()=>void): Promise<T> {
  const revision=getDeviceCacheRevision();
  let publishedFresh=false;let denied=false;
  const saved = peekApiCache<T>(path, { allowStale: true });
  if (saved !== undefined) publish(saved);
  const network=api<T>(path).then(value=>({ok:true as const,value}),error=>({ok:false as const,error}));
  const disk = secureSnapshots.read<T>('snapshot.'+path).then(record=>{
    if(record&&revision===getDeviceCacheRevision()&&!publishedFresh&&!denied){publish(record.data);status(path,record.savedAt,true);}
  }).catch(()=>undefined);
  const result=await network;
  if(revision!==getDeviceCacheRevision())throw new ApiError(409,'SESSION_CHANGED','Your session changed. Reopen this screen.');
  if(!result.ok){
    if(result.error instanceof ApiError&&result.error.code!=='API_GATEWAY_BLOCKED'&&[401,403,404].includes(result.error.status)){denied=true;onDenied?.();statuses.delete(path);for(const listener of listeners)listener();void secureSnapshots.remove('snapshot.'+path).catch(()=>undefined);}
    await disk;throw result.error;
  }
  publishedFresh=true;
  publish(result.value);status(path,Date.now(),false);
  void secureSnapshots.write('snapshot.'+path,result.value,/\/messages\//.test(path)?12*3600_000:7*86400_000).catch(()=>undefined);
  return result.value;
}
