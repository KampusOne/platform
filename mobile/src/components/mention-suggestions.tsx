import {useEffect,useState} from 'react';
import {Pressable,Text,View} from 'react-native';
import {api} from '@/src/lib/api';
import {useAppearance} from '@/src/lib/appearance';
export function MentionSuggestions({text,cursor,onSelect}:{text:string;cursor:number;onSelect:(value:string)=>void}){
 const {theme}=useAppearance(),[profiles,setProfiles]=useState<{user_id:string;username:string;display_name:string}[]>([]),match=/(?:^|\s)@([a-zA-Z0-9_]{0,30})$/.exec(text.slice(0,cursor)),query=match?.[1];
 useEffect(()=>{setProfiles([]);if(query===undefined)return;const controller=new AbortController(),timer=setTimeout(()=>{void api<{profiles:{user_id:string;username:string;display_name:string}[]}>(`/v1/student/feed/mentions?q=${encodeURIComponent(query)}`,{signal:controller.signal}).then(r=>{if(!controller.signal.aborted)setProfiles(r.profiles);}).catch(()=>{});},220);return()=>{controller.abort();clearTimeout(timer);};},[query]);
 if(query===undefined||!profiles.length)return null;const start=cursor-query.length-1;
 return <View style={{borderTopWidth:1,borderColor:theme.border,marginBottom:12}}>{profiles.slice(0,5).map(profile=><Pressable key={profile.user_id} accessibilityLabel={`Mention ${profile.display_name}`} onPress={()=>onSelect(text.slice(0,start)+'@'+profile.username+' '+text.slice(cursor))} style={{minHeight:44,padding:10}}><Text style={{fontFamily:theme.font.semibold,color:theme.accentText}}>@{profile.username} <Text style={{color:theme.textMuted,fontFamily:theme.font.body}}>· {profile.display_name}</Text></Text></Pressable>)}</View>;
}
