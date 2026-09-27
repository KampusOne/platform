import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native';
type Job = {id:string;stage:string;progress:number;error?:string};
const native=Platform.OS==='android'?NativeModules.KampusMedia:null;
let jobs:Job[]=[];const listeners=new Set<()=>void>();let connected=false;
const emit=()=>listeners.forEach(fn=>fn());
export const downloadSnapshot=()=>jobs;
const empty:Job[]=[];
export const downloadServerSnapshot=()=>empty;
export function subscribeDownloads(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
export function dismissDownload(id:string){jobs=jobs.filter(job=>job.id!==id);emit();}
export async function downloadPostMedia(url:string,video=false,username?:string|null){
  if(!native)throw new Error('Downloads are available in the updated Android app.');
  if(Platform.OS==='android'&&Number(Platform.Version)<29){const permission=await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);if(permission!==PermissionsAndroid.RESULTS.GRANTED)throw new Error('Allow storage access to save to your gallery.');}
  if(jobs.filter(job=>job.progress<1&&!job.error).length>=2)throw new Error('Two downloads are already running.');
  if(!connected){connected=true;new NativeEventEmitter(native).addListener('KampusMediaProgress',(event:Job)=>{jobs=jobs.map(job=>job.id===event.id?{...job,...event}:job);emit();});}
  const id=`download-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  jobs=[...jobs.filter(job=>job.progress<1&&!job.error),{id,stage:'Starting download',progress:0}];emit();
  // The global queue owns this work, so leaving the post does not cancel it.
  void native.download(url,video,id,username?.trim()??"").then(()=>{jobs=jobs.map(job=>job.id===id?{...job,stage:'Saved to gallery',progress:1}:job);emit();}).catch((error:Error)=>{jobs=jobs.map(job=>job.id===id?{...job,stage:'Download failed',error:error.message}:job);emit();});
}
export async function videoDimensions(uri:string,fallback?:{width?:number|undefined;height?:number|undefined}):Promise<{width?:number|undefined;height?:number|undefined}>{
  try{return native?await native.videoSize(uri):fallback??{};}catch{return fallback??{};}
}
