import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {Platform} from 'react-native';
import {api} from './api';
export async function uploadMessageFile(userId:string,file:{uri:string;name:string;mimeType:string},onProgress:(value:number)=>void){
 const blob=Platform.OS==='web'?await(await fetch(file.uri)).blob():new(await import('expo-file-system')).File(file.uri) as unknown as Blob;
 if(!blob.size||blob.size>500*1024*1024)throw new Error('Choose a file up to 500 MB.');
 const fingerprint=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,`${userId}:${file.uri}:${file.name}:${blob.size}`),key=`k1.message-upload.${userId}.${fingerprint}`;
 let uploadId=await AsyncStorage.getItem(key);if(!uploadId){uploadId=Crypto.randomUUID();await AsyncStorage.setItem(key,uploadId);}
 const session=await api<{id:string;parts:Record<string,{size:number}>;status:string;mediaId:string|null;chunkBytes:number}>('/v1/media/message-uploads',{method:'POST',body:JSON.stringify({uploadId,name:file.name.slice(0,180),type:file.mimeType,size:blob.size})});
 if(session.status==='COMPLETE'&&session.mediaId){onProgress(1);return session.mediaId;}
 let sent=0;const count=Math.ceil(blob.size/session.chunkBytes);
 for(let part=1;part<=count;part++){const start=(part-1)*session.chunkBytes,end=Math.min(blob.size,start+session.chunkBytes),size=end-start;if(session.parts[String(part)]?.size===size){sent+=size;onProgress(sent/blob.size);continue;}
  // Convert only one chunk to a standard ArrayBuffer; native fetch never receives
  // an Expo File/Blob handle or a 500 MB allocation.
  const bytes=await blob.slice(start,end).arrayBuffer();let completed=false;
  for(let attempt=0;attempt<3&&!completed;attempt++){try{await api(`/v1/media/message-uploads/${session.id}/parts/${part}`,{method:'PUT',body:bytes,headers:{'Content-Type':'application/octet-stream'},timeoutMs:120000});completed=true;}catch(error){if(attempt===2)throw error;}}
  sent+=size;onProgress(sent/blob.size);
 }
 const result=await api<{id:string}>(`/v1/media/message-uploads/${session.id}/complete`,{method:'POST',timeoutMs:60000});onProgress(1);await AsyncStorage.removeItem(key);return result.id;
}
