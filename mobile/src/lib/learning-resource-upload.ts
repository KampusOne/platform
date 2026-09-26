import * as DocumentPicker from "expo-document-picker";
import { Platform } from "react-native";
import { api } from "./api";
import type { UploadedFile } from "./uploads";
/** Keep lecture media private; the Worker verifies ownership and download access. */
export async function pickLearningResource(type:"PDF"|"NOTE"|"PAST_QUESTION"|"AUDIOBOOK"|"VIDEO"):Promise<UploadedFile|null>{
 const media=type==="AUDIOBOOK"||type==="VIDEO";
 const choice=await DocumentPicker.getDocumentAsync({type:type==="AUDIOBOOK"?["audio/mpeg","audio/wav"]:type==="VIDEO"?["video/mp4","video/webm"]:["application/pdf","image/jpeg","image/png","image/webp"],copyToCacheDirectory:true,multiple:false});
 if(choice.canceled)return null;const file=choice.assets[0];if(!file)return null;
 if((file.size??0)>(media?50:10)*1024*1024)throw new Error(`Choose a file smaller than ${media?50:10} MB.`);
 const ext=file.name.split(".").pop()?.toLowerCase();
 const mime=file.mimeType??({mp3:"audio/mpeg",wav:"audio/wav",mp4:"video/mp4",webm:"video/webm",pdf:"application/pdf",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp"}[ext??""]??"application/octet-stream");
 const body:BodyInit=Platform.OS==="web"?await (await fetch(file.uri)).blob():new (await import("expo-file-system")).File(file.uri) as unknown as BodyInit;
 return api<UploadedFile>(`/v1/media?kind=resource&name=${encodeURIComponent(file.name)}`,{method:"POST",headers:{"Content-Type":mime},body});
}
