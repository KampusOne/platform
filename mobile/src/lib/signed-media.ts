import {useEffect,useState} from 'react';
import {useAuth} from '../auth/auth-context';
import {api} from './api';
const cache=new Map<string,{url:string;until:number}>(),pending=new Map<string,Promise<string>>();
let viewer='';
export function internalMediaId(value:string){try{return /^\/(?:api\/)?v1\/media\/([0-9a-f-]{36})$/i.exec(new URL(value,'https://media.invalid').pathname)?.[1]??null;}catch{return null;}}
async function playback(id:string,userId:string){
 const key=userId+':'+id,saved=cache.get(key);
 if(saved&&saved.until>Date.now())return saved.url;
 if(pending.has(key))return pending.get(key)!;
 const request=api<{url:string;expiresIn:number}>('/v1/media/'+id+'/playback',{method:'POST'}).then(data=>{
  if(!data.url||!Number.isFinite(data.expiresIn))throw new Error('This media could not load.');
  cache.set(key,{url:data.url,until:Date.now()+Math.max(30,data.expiresIn-60)*1000});
  while(cache.size>128)cache.delete(cache.keys().next().value!);
  return data.url;
 }).finally(()=>pending.delete(key));
 pending.set(key,request);return request;
}
/** Keep file bytes out of the API when signed bucket playback is enabled. */
export function useSignedMedia(value:string,enabled=true){
 const {user}=useAuth(),id=enabled?internalMediaId(value):null,[source,setSource]=useState<{original:string;url:string}>({original:value,url:id?'':value}),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  let live=true,timer:ReturnType<typeof setTimeout>|undefined;
  if(viewer!==user?.id){cache.clear();pending.clear();viewer=user?.id??'';}
  if(!id||!user?.id){setSource({original:value,url:value});return;}
  const key=user.id+':'+id;
  // Retain the source during an ordinary re-render; a changed object resets it.
  void playback(id,user.id).then(url=>{
   if(!live)return;
   setSource({original:value,url});
   const saved=cache.get(key);
   // Re-authorize before the signed bearer URL ages out. Timers paused while
   // Android is backgrounded fire on resume and immediately refresh the source.
   const delay=Math.max(1000,(saved?.until??Date.now()+30000)-Date.now()+50);
   timer=setTimeout(()=>{if(!live)return;cache.delete(key);setRefresh(value=>value+1);},delay);
  }).catch(()=>{if(live)setSource({original:value,url:value});});
  return()=>{live=false;if(timer)clearTimeout(timer);};
 },[value,id,user?.id,refresh]);
 return source.original===value?source.url:(id?'':value);
}
