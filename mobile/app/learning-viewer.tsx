import {useEffect,useState} from 'react';
import {Text,View,Pressable} from 'react-native';
import {useLocalSearchParams,router} from 'expo-router';
import {useAudioPlayer,useAudioPlayerStatus} from 'expo-audio';
import {api} from '@/src/lib/api';
import {ToolPage,ToolButton} from '@/src/components/toolkit';
import {LearningDocument} from '@/src/components/learning-document';
import {useAppearance} from '@/src/lib/appearance';
type Resource={id:string;title:string;resource_type:string;can_access:boolean;access_model:string;media_object_id:string;parts?:{mediaId:string;title:string}[]};
function Audio({url}:{url:string}){const player=useAudioPlayer(url),status=useAudioPlayerStatus(player);const{theme}=useAppearance();return <View style={{padding:24,gap:20}}><Text style={{color:theme.text}}>{Math.floor(status.currentTime/60)}:{String(Math.floor(status.currentTime%60)).padStart(2,'0')} / {Math.floor(status.duration/60)}:{String(Math.floor(status.duration%60)).padStart(2,'0')}</Text><ToolButton label={status.playing?'Pause':'Play'} onPress={()=>status.playing?player.pause():player.play()}/><ToolButton secondary label="Back 15 seconds" onPress={()=>void player.seekTo(Math.max(0,status.currentTime-15))}/><ToolButton secondary label="Forward 15 seconds" onPress={()=>void player.seekTo(Math.min(status.duration,status.currentTime+15))}/></View>;}
export default function LearningViewer(){
 const{id}=useLocalSearchParams<{id:string}>(),{theme}=useAppearance();const[resource,setResource]=useState<Resource|null>(null),[index,setIndex]=useState(0),[url,setUrl]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let active=true;void api<{resource:Resource}>('/v1/student/tutorial-resources/'+id,{cache:'no-store'}).then(result=>{if(active)setResource(result.resource);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[id]);
 const parts=resource?.parts?.length?resource.parts:resource?[{mediaId:resource.media_object_id,title:resource.title}]:[];
 const part=parts[index];
 useEffect(()=>{let active=true;setUrl('');if(resource&&(resource.can_access||resource.access_model==='FREE')&&part)void api<{url:string}>('/v1/media/'+part.mediaId+'/access',{method:'POST'}).then(result=>{if(active)setUrl(result.url);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[part?.mediaId,resource?.can_access,resource?.access_model]);
 return <ToolPage title={part?.title??resource?.title??'Learning material'}><View style={{gap:16,flex:1}}>
  {error?<Text accessibilityRole="alert" style={{color:theme.error}}>{error}</Text>:null}
  {resource&&resource.access_model!=='FREE'&&!resource.can_access?<ToolButton label="Get access" onPress={()=>router.push({pathname:'/learning-checkout',params:{resourceId:id}})}/>:null}
  {url?resource?.resource_type==='VIDEO'?<ToolButton label="Watch video" onPress={()=>router.push({pathname:'/tutorial-watch',params:{id:part!.mediaId,title:part!.title}})}/>:resource?.resource_type==='AUDIOBOOK'?<Audio key={url} url={url}/>:<LearningDocument key={part?.mediaId} url={url} title={part?.title??'Document'}/>:null}
  {parts.length>1?<View style={{gap:8}}><Text style={{color:theme.text,fontFamily:theme.font.semibold}}>Playlist · {parts.length} parts</Text>{parts.map((item,n)=><Pressable accessibilityRole="button" accessibilityState={{selected:index===n}} key={item.mediaId} onPress={()=>{setIndex(n);setError('');}} style={{padding:15,backgroundColor:n===index?theme.surfaceTint:theme.surface,borderRadius:12}}><Text style={{color:theme.text}}>{n+1}. {item.title}</Text></Pressable>)}</View>:null}
 </View></ToolPage>;
}
