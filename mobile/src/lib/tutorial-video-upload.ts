import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {File,FileMode,type FileHandle} from 'expo-file-system';
import {Platform} from 'react-native';
import {api} from './api';
import {uploadMessageFile} from './message-upload';

type Authorization={endpoint:string;headers:Record<string,string>};
type Reservation={id:string;provider:'R2'|'BUNNY';status:string;mediaId?:string;authorization?:Authorization};
function location(value:string,base:string){const url=new URL(value,base);if(url.protocol!=='https:'||url.hostname!=='video.bunnycdn.com'||!url.pathname.startsWith('/tusupload'))throw new Error('The video provider returned an invalid upload address.');return url.toString();}
function base64(value:string){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',bytes=new TextEncoder().encode(value);let out='';for(let i=0;i<bytes.length;i+=3){const a=bytes[i]!,b=bytes[i+1],c=bytes[i+2];out+=alphabet[a>>2]!+alphabet[((a&3)<<4)|((b??0)>>4)]!+(b===undefined?'=':alphabet[((b&15)<<2)|((c??0)>>6)])+(c===undefined?'=':alphabet[c&63]);}return out;}
/** Bounded chunks and provider offsets make a lost response safe to retry. */
export async function uploadTutorialVideo(userId:string,file:{uri:string;name:string;mimeType:string},onProgress:(progress:number)=>void){
 const source=Platform.OS==='web'?await(await fetch(file.uri)).blob():new File(file.uri),size=source.size;
 if(!size||size>500*1024*1024)throw new Error('Choose an MP4 or WebM video up to 500 MB. Compress larger videos first.');
 const fingerprint=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,`${userId}:${file.uri}:${file.name}:${size}`),key=`k1.tutorial-upload.${fingerprint}`;
 let saved:{id:string;url?:string};try{saved=JSON.parse(await AsyncStorage.getItem(key)??'null')??{id:Crypto.randomUUID()};}catch{saved={id:Crypto.randomUUID()};}
 await AsyncStorage.setItem(key,JSON.stringify(saved));
 const reserve=()=>api<Reservation>('/v1/tutorial-storage/uploads',{method:'POST',body:JSON.stringify({uploadId:saved.id,name:file.name.slice(0,180),type:file.mimeType,size})});
 let reservation=await reserve();
 if(reservation.mediaId){onProgress(1);return reservation.mediaId;}
 if(reservation.provider==='R2')return uploadMessageFile(userId,file,onProgress,'tutorial',saved.id);
 let authorization=reservation.authorization!;if(!authorization)throw new Error('Video upload authorization was unavailable. Try again.');
 const headers=()=>({...authorization.headers,'Tus-Resumable':'1.0.0'});
 async function head(url:string){const r=await fetch(url,{method:'HEAD',headers:headers(),signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('The video upload could not resume. Please try again.');const offset=Number(r.headers.get('Upload-Offset'));if(!Number.isInteger(offset)||offset<0||offset>size)throw new Error('The upload progress could not be verified.');return offset;}
 if(saved.url){saved.url=location(saved.url,authorization.endpoint);const r=await fetch(saved.url,{method:'HEAD',headers:headers(),signal:AbortSignal.timeout(30000)});if(r.status===404||r.status===410)delete saved.url;else if(!r.ok)throw new Error('The video upload could not resume. Try again.');}
 if(!saved.url){const r=await fetch(location(authorization.endpoint,authorization.endpoint),{method:'POST',headers:{...headers(),'Upload-Length':String(size),'Upload-Metadata':`filetype ${base64(file.mimeType)},title ${base64(file.name.slice(0,180))}`},signal:AbortSignal.timeout(30000)});const address=r.headers.get('Location');if(!r.ok||!address)throw new Error('The video upload could not start. Try again.');saved.url=location(address,authorization.endpoint);await AsyncStorage.setItem(key,JSON.stringify(saved));}
 let handle:FileHandle|null=null;
 try{
  if(Platform.OS!=='web')handle=(source as File).open(FileMode.ReadOnly);
  let offset=await head(saved.url);onProgress(offset/size);
  while(offset<size){
   let completed=false;
   for(let attempt=0;attempt<3;attempt++){
    if(attempt){reservation=await reserve();authorization=reservation.authorization!;offset=await head(saved.url);if(offset===size){completed=true;break;}}
    const end=Math.min(size,offset+5*1024*1024);let body:ArrayBuffer;
    if(handle){handle.offset=offset;const bytes=handle.readBytes(end-offset);if(bytes.length!==end-offset)throw new Error('This video changed during upload. Choose it again.');body=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}else body=await(source as Blob).slice(offset,end).arrayBuffer();
    try{const r=await fetch(saved.url,{method:'PATCH',headers:{...headers(),'Content-Type':'application/offset+octet-stream','Upload-Offset':String(offset)},body,signal:AbortSignal.timeout(120000)});const next=Number(r.headers.get('Upload-Offset'));if(!r.ok||next!==end)throw new Error('The video upload paused. Retry to resume it.');offset=end;completed=true;onProgress(offset/size);break;}catch(error){if(attempt===2)throw error;}
   }
   if(!completed)throw new Error('The video upload paused. Retry to resume it.');
  }
  const result=await api<{id:string}>(`/v1/tutorial-storage/uploads/${saved.id}/complete`,{method:'POST',timeoutMs:30000});onProgress(1);return result.id;
 }finally{try{handle?.close();}catch{}}
}
