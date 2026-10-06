import * as DocumentPicker from "expo-document-picker";
import {uploadMessageFile} from './message-upload';
import {uploadTutorialVideo} from './tutorial-video-upload';
import type { UploadedFile } from "./uploads";
/** Keep lecture media private; the Worker verifies ownership and download access. */
export async function pickLearningResource(type:"PDF"|"NOTE"|"PAST_QUESTION"|"AUDIOBOOK"|"VIDEO",userId:string,onProgress:(value:number)=>void=()=>undefined):Promise<UploadedFile|null>{
 const media=type==="AUDIOBOOK"||type==="VIDEO";
 const choice=await DocumentPicker.getDocumentAsync({type:type==="AUDIOBOOK"?["audio/mpeg","audio/wav"]:type==="VIDEO"?["video/mp4","video/webm"]:["application/pdf","image/jpeg","image/png","image/webp"],copyToCacheDirectory:true,multiple:false});
 if(choice.canceled)return null;const file=choice.assets[0];if(!file)return null;
 const limit=type==='VIDEO'?500:100;
 if((file.size??0)>limit*1024*1024)throw new Error(`Choose a file up to ${limit} MB. Compress larger files first.`);
 const ext=file.name.split(".").pop()?.toLowerCase();
 const mime=file.mimeType??({mp3:"audio/mpeg",wav:"audio/wav",mp4:"video/mp4",webm:"video/webm",pdf:"application/pdf",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp"}[ext??""]??"application/octet-stream");
 const source={uri:file.uri,name:file.name,mimeType:mime};
 const id=type==='VIDEO'?await uploadTutorialVideo(userId,source,onProgress):await uploadMessageFile(userId,source,onProgress,'resource');
 return {id,url:'',kind:'resource',private:true};
}
