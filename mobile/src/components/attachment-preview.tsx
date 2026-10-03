import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { useAppearance } from "@/src/lib/appearance";
import type { StagedAttachment } from "@/src/lib/uploads";
import { MediaImage } from "./media-image";
import { SkeletonBlock } from "./skeleton";
export function AttachmentPreview({file,uploading=false,onRemove,onOpen}:{file:StagedAttachment;uploading?:boolean;onRemove?:()=>void;onOpen?:()=>void}) {
  const {theme}=useAppearance();
  const fileName=typeof file?.name==="string"&&fileName?fileName:"Attachment";
  const fileType=typeof file?.type==="string"?file.type:"application/octet-stream";
  const fileUri=typeof file?.uri==="string"?file.uri:undefined;
  const fileSize=Number(file?.size);
  return <View style={{marginBottom:10,borderRadius:14,borderWidth:1,borderColor:theme.border,backgroundColor:theme.surface,overflow:"hidden",maxWidth:360}}>
    <View style={{flexDirection:"row",alignItems:"center",padding:10,gap:10}}>
      <Pressable accessibilityRole={onOpen?"button":undefined} accessibilityLabel={`Open ${fileName}`} disabled={!onOpen || uploading} onPress={onOpen} style={{flexDirection:"row",alignItems:"center",gap:10,flex:1,minWidth:0}}>
        {fileType.startsWith("image/") && fileUri ? <MediaImage uri={fileUri} accessibilityLabel="Attached image preview" resizeMode="cover" style={{width:58,height:58,borderRadius:9}}/> : <View style={{width:46,height:54,backgroundColor:theme.surfaceMuted,borderRadius:8,alignItems:"center",justifyContent:"center"}}><Ionicons name={fileType.startsWith("image/")?"image-outline":"document-text-outline"} size={24} color={theme.brand}/></View>}
        <View style={{flex:1}}><Text numberOfLines={2} style={{color:theme.text,fontFamily:theme.font.medium,fontSize:13}}>{fileName}</Text><Text style={{color:theme.textMuted,fontFamily:theme.font.body,fontSize:11,marginTop:4}}>{uploading?"Uploading…":file.mediaId?"Attached":Number.isFinite(fileSize)&&fileSize>0?`${(fileSize/1024/1024).toFixed(1)} MB · Ready to send`:"Ready to send"}</Text></View>
      </Pressable>
      {onRemove?<Pressable accessibilityRole="button" accessibilityLabel={`Remove ${fileName}`} disabled={uploading} onPress={onRemove} style={{padding:10}}><Ionicons name="close" size={20} color={theme.textMuted}/></Pressable>:null}
    </View>
    {uploading?<SkeletonBlock height={3} radius={0}/>:null}
  </View>;
}
