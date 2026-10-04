import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import type { StagedAttachment } from "@/src/lib/uploads";
import { MediaImage } from "./media-image";
import { SkeletonBlock } from "./skeleton";
export function AttachmentPreview({file,uploading=false,variant="composer",onRemove,onOpen}:{file:StagedAttachment;uploading?:boolean;variant?:"composer"|"message";onRemove?:()=>void;onOpen?:()=>void}) {
  const {theme}=useAppearance();
  const fileName=typeof file?.name==="string"&&file.name?file.name:"Document";
  const fileType=typeof file?.type==="string"?file.type:"application/octet-stream";
  const fileUri=typeof file?.uri==="string"?file.uri:undefined;
  const mediaId=typeof file?.mediaId==="string"?file.mediaId:undefined;
  const fileSize=Number(file?.size);
  const image=fileType.startsWith("image/");
  const expanded=image&&variant==="message";
  const [privatePreview,setPrivatePreview]=useState<{id:string;uri:string}>();
  const [previewUnavailable,setPreviewUnavailable]=useState(false);
  const uri=fileUri??(privatePreview&&privatePreview.id===mediaId?privatePreview.uri:undefined);
  useEffect(()=>{
    if(!image||fileUri||!mediaId)return;
    const controller=new AbortController();
    setPreviewUnavailable(false);
    void api<{url:string}>(`/v1/media/${mediaId}/access`,{method:"POST",signal:controller.signal})
      .then(result=>{if(!controller.signal.aborted&&typeof result?.url==="string")setPrivatePreview({id:mediaId,uri:result.url});})
      .catch(()=>{if(!controller.signal.aborted)setPreviewUnavailable(true);});
    return()=>controller.abort();
  },[image,fileUri,mediaId]);
  const label=image?"Photo":fileType==="application/pdf"||/\.pdf$/i.test(fileName)?"PDF document":fileType==="text/plain"||/\.txt$/i.test(fileName)?"Text document":"Document";
  const size=Number.isFinite(fileSize)&&fileSize>0?fileSize<1024*1024?`${Math.ceil(fileSize/1024)} KB`:`${(fileSize/1024/1024).toFixed(1)} MB`:undefined;
  const state=uploading?"Uploading…":variant==="message"?"Sent to Kira":mediaId?"Attached":"Ready to send";
  return <View style={{width:"100%",minHeight:expanded?190:88,marginBottom:10,borderRadius:14,borderWidth:1,borderColor:theme.border,backgroundColor:theme.surface,overflow:"hidden",maxWidth:360}}>
    {expanded?<Pressable accessibilityRole={onOpen?"button":undefined} accessibilityLabel={`View ${fileName}`} disabled={!onOpen||uploading} onPress={onOpen} style={{width:"100%",height:230,backgroundColor:theme.surfaceMuted}}>
      {uri?<MediaImage uri={uri} accessibilityLabel={fileName} resizeMode="contain" style={{width:"100%",height:230}}/>:previewUnavailable?<View style={{flex:1,alignItems:"center",justifyContent:"center",gap:8,padding:15}}><Ionicons name="image-outline" size={36} color={theme.brand}/><Text style={{color:theme.textMuted,fontFamily:theme.font.body}}>Tap to open your photo</Text></View>:<SkeletonBlock height={230} radius={0}/>}
    </Pressable>:null}
    <View style={{flexDirection:"row",alignItems:"center",padding:12,gap:10}}>
      <Pressable accessibilityRole={onOpen?"button":undefined} accessibilityLabel={`Open ${fileName}`} disabled={!onOpen||uploading} onPress={onOpen} style={{flexDirection:"row",alignItems:"center",gap:12,flex:1,minWidth:0}}>
        {!expanded?(image&&uri?<MediaImage uri={uri} accessibilityLabel={fileName} resizeMode="cover" style={{width:64,height:64,borderRadius:9}}/>:<View style={{width:50,height:62,backgroundColor:theme.surfaceMuted,borderRadius:8,alignItems:"center",justifyContent:"center"}}><Ionicons name={image?"image-outline":"document-text-outline"} size={27} color={theme.brand}/></View>):null}
        <View style={{flex:1,minWidth:0}}><Text numberOfLines={2} style={{color:theme.text,fontFamily:theme.font.medium,fontSize:14,lineHeight:20}}>{fileName}</Text><Text style={{color:theme.textMuted,fontFamily:theme.font.body,fontSize:12,lineHeight:18,marginTop:4}}>{[label,size,state].filter(Boolean).join(" · ")}</Text></View>
        {!onRemove&&!uploading?<Ionicons name="open-outline" size={18} color={theme.textMuted}/>:null}
      </Pressable>
      {onRemove?<Pressable accessibilityRole="button" accessibilityLabel={`Remove ${fileName}`} disabled={uploading} onPress={onRemove} style={{minWidth:36,minHeight:44,alignItems:"center",justifyContent:"center"}}><Ionicons name="close" size={22} color={theme.textMuted}/></Pressable>:null}
    </View>
    {uploading?<SkeletonBlock height={3} radius={0}/>:null}
  </View>;
}
