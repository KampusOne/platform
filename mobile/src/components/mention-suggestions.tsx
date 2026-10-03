import {useEffect,useState} from 'react';
import {Pressable,Text,View} from 'react-native';
import {api} from '@/src/lib/api';
import {useAppearance} from '@/src/lib/appearance';
import {ProfileAvatar} from './profile-avatar';
import {VerifiedBadge} from './verified-badge';
type SuggestedProfile={user_id:string;username:string;display_name:string;profile_image_url?:string|null;verified?:boolean};
export function MentionSuggestions({text,cursor,onSelect}:{text:string;cursor:number;onSelect:(value:string)=>void}){
 const {theme}=useAppearance(),[profiles,setProfiles]=useState<SuggestedProfile[]>([]),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false),[revision,setRevision]=useState(0);
 const match=/(?:^|\s)@([a-zA-Z0-9_]{0,30})$/.exec(text.slice(0,cursor)),query=match?.[1];
 useEffect(()=>{setProfiles([]);setFailed(false);if(query===undefined)return;const controller=new AbortController();setLoading(true);
  const timer=setTimeout(()=>{void api<{profiles:SuggestedProfile[]}>(`/v1/student/feed/mentions?q=${encodeURIComponent(query)}`,{signal:controller.signal}).then(r=>{if(!controller.signal.aborted)setProfiles(r.profiles);}).catch(()=>{if(!controller.signal.aborted)setFailed(true);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});},160);
  return()=>{controller.abort();clearTimeout(timer);};
 },[query,revision]);
 if(query===undefined)return null;const start=cursor-query.length-1;
 return <View accessibilityLiveRegion="polite" style={{borderWidth:1,borderColor:theme.border,borderRadius:14,backgroundColor:theme.surface,marginBottom:12,overflow:'hidden'}}>
  {profiles.slice(0,6).map(profile=><Pressable key={profile.user_id} accessibilityRole="button" accessibilityLabel={`Mention ${profile.display_name}, @${profile.username}`} onPress={()=>onSelect(text.slice(0,start)+'@'+profile.username+' '+text.slice(cursor))} style={{minHeight:60,padding:10,flexDirection:'row',alignItems:'center',gap:10}}>
   <ProfileAvatar name={profile.display_name} imageUrl={profile.profile_image_url} size={36}/>
   <View style={{flex:1}}><View style={{flexDirection:'row',alignItems:'center',gap:5}}><Text numberOfLines={1} style={{fontFamily:theme.font.semibold,color:theme.text}}>{profile.display_name}</Text>{profile.verified?<VerifiedBadge size={13}/>:null}</View><Text style={{color:theme.textMuted,fontFamily:theme.font.body,fontSize:12}}>@{profile.username}</Text></View>
  </Pressable>)}
  {failed?<Pressable accessibilityRole="button" accessibilityLabel="Retry loading mention suggestions" onPress={()=>setRevision(value=>value+1)} style={{minHeight:44,padding:14}}><Text style={{color:theme.deepBrand,fontFamily:theme.font.body,fontSize:12}}>Couldn’t load people. Tap to retry.</Text></Pressable>:!profiles.length?<Text style={{padding:14,color:theme.textMuted,fontFamily:theme.font.body,fontSize:12}}>{loading?'Finding people…':query?'No matching username':'Type a username to mention someone'}</Text>:null}
 </View>;
}
