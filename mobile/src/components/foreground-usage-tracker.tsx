import {useEffect} from 'react';
import {AppState,Platform} from 'react-native';
import {usePathname} from 'expo-router';
import {randomUUID} from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useAuth} from '../auth/auth-context';
import {api,ApiError} from '../lib/api';
import {analyticsScreenName} from '../lib/analytics';
type Sample={id:string,ownerUserId:string,platform:string,screen:string,startedAt:string,endedAt:string,seconds:number};
const writers=new Map<string,Promise<void>>();
export function ForegroundUsageTracker(){const {user}=useAuth(),path=usePathname();
 useEffect(()=>{if(!user?.id||!['android','ios','web'].includes(Platform.OS))return;const owner=user.id,key='k1-foreground-usage:'+owner,screen=analyticsScreenName(path),platform=Platform.OS;let active=true,foreground=AppState.currentState==='active'&&(Platform.OS!=='web'||document.visibilityState==='visible'),started=Date.now();
 function enqueue(sample?:Sample){const pending=(writers.get(owner)??Promise.resolve()).then(()=>save(sample)).catch(()=>{});writers.set(owner,pending);void pending.finally(()=>{if(writers.get(owner)===pending)writers.delete(owner);});}
 async function save(sample?:Sample){let queue:Sample[]=[];try{queue=JSON.parse(await AsyncStorage.getItem(key)??'[]');}catch{}queue=queue.filter(s=>s.ownerUserId===owner&&Date.parse(s.startedAt)>Date.now()-48*3600000);if(sample)queue.push(sample);queue=queue.slice(-300);while(active&&queue.length){try{await api('/v1/usage',{method:'POST',body:JSON.stringify(queue[0]),timeoutMs:12000});queue.shift();}catch(error){if(error instanceof ApiError&&error.status===400){queue.shift();continue;}break;}}await AsyncStorage.setItem(key,JSON.stringify(queue));}
 function flush(){const ended=Date.now(),milliseconds=ended-started;started=ended;if(!foreground||milliseconds<500)return;const seconds=Math.min(milliseconds/1000,60),sample={id:randomUUID(),ownerUserId:owner,platform,screen,startedAt:new Date(ended-seconds*1000).toISOString(),endedAt:new Date(ended).toISOString(),seconds};enqueue(sample);}
 const interval=setInterval(flush,30000),state=AppState.addEventListener('change',next=>{flush();foreground=next==='active'&&(Platform.OS!=='web'||document.visibilityState==='visible');started=Date.now();});
 const visibility=()=>{flush();foreground=document.visibilityState==='visible'&&AppState.currentState==='active';started=Date.now();};if(Platform.OS==='web')document.addEventListener('visibilitychange',visibility);
 enqueue();
 return()=>{flush();active=false;clearInterval(interval);state.remove();if(Platform.OS==='web')document.removeEventListener('visibilitychange',visibility);};
 },[user?.id,path]);return null;
}
