import {useSyncExternalStore} from 'react';
import {Pressable,Text,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {downloadSnapshot,downloadServerSnapshot,subscribeDownloads,dismissDownload} from '@/src/lib/media-downloads';
import {useAppearance} from '@/src/lib/appearance';
export function DownloadTray(){
  const jobs=useSyncExternalStore(subscribeDownloads,downloadSnapshot,downloadServerSnapshot);const {theme}=useAppearance();
  if(!jobs.length)return null;
  return <View pointerEvents="box-none" style={{position:'absolute',bottom:88,left:16,right:16,gap:8}}>{jobs.map(job=><View key={job.id} accessibilityLiveRegion="polite" style={{padding:12,borderRadius:14,borderWidth:1,borderColor:theme.border,backgroundColor:theme.surface,flexDirection:'row',alignItems:'center',gap:10}}>
    <Ionicons name={job.error?'alert-circle-outline':job.progress===1?'checkmark-circle-outline':'download-outline'} color={job.error?theme.error:theme.brand} size={22}/>
    <View style={{flex:1}}><Text numberOfLines={2} style={{color:theme.text,fontFamily:theme.font.semibold,fontSize:13}}>{job.error||(job.progress<1?`Downloading… ${Math.round(job.progress*100)}%`:job.stage)}</Text>{!job.error&&job.progress<1?<View style={{height:3,backgroundColor:theme.border,marginTop:7,borderRadius:2}}><View style={{height:3,width:`${Math.round(job.progress*100)}%`,backgroundColor:theme.brand}}/></View>:null}</View>
    {job.error||job.progress===1?<Pressable accessibilityRole="button" accessibilityLabel="Dismiss download status" onPress={()=>dismissDownload(job.id)} style={{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="close" size={20} color={theme.textMuted}/></Pressable>:null}
  </View>)}</View>;
}
