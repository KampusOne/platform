import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { ToolPage,ToolButton } from '@/src/components/toolkit';
import { BrandSwitch } from '@/src/components/brand-switch';
import { ScreenSkeleton } from '@/src/components/skeleton';
import { api } from '@/src/lib/api';
import { useAppearance } from '@/src/lib/appearance';
import { useToast } from '@/src/components/toast';
const choices=[['likes','Post likes'],['commentLikes','Comment likes'],['comments','Comments on your posts'],['replies','Replies to your comments'],['reposts','Reposts'],['quotes','Quote posts'],['follows','New followers'],['messages','Messages'],['profilePosts','Profile subscriptions'],['classReminders','Classes and reminders'],['announcements','Community announcements'],['campusUpdates','Important campus updates']] as const;
type Category=(typeof choices)[number][0]|'security';
type Channels=Record<Category,{in_app_enabled:boolean;push_enabled:boolean}>;
export default function NotificationPreferences(){
 const {theme}=useAppearance(),toast=useToast();const [channels,setChannels]=useState<Channels|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=()=>api<{channels:Channels}>('/v1/notifications/preferences').then(r=>{setChannels(r.channels);setError('');}).catch(e=>setError(e.message));
 useEffect(()=>{void load();},[]);
 async function save(key:Category,channel:'in_app_enabled'|'push_enabled',value:boolean){if(!channels||busy)return;const previous=channels,next={...channels,[key]:{...channels[key],[channel]:value}};setChannels(next);setBusy(true);try{await api('/v1/notifications/preferences',{method:'PUT',body:JSON.stringify({channels:next})});}catch(e){setChannels(previous);toast(e instanceof Error?e.message:'Could not save preferences','error');}finally{setBusy(false);}}
 return <ToolPage title="Notification settings"><Text style={{fontFamily:theme.font.body,color:theme.textMuted,lineHeight:22,marginBottom:14}}>Choose where you get updates.</Text>{error?<><Text accessibilityRole="alert" style={{color:theme.error}}>{error}</Text><ToolButton label="Retry" onPress={()=>void load()}/></>:!channels?<ScreenSkeleton variant="list" compact/>:<>
 <View style={{flexDirection:'row',alignItems:'center',gap:12,marginBottom:4}}><Text style={{flex:1,color:theme.textMuted}}>Activity</Text><Text style={{width:52,color:theme.textMuted,textAlign:'center'}}>In app</Text><Text style={{width:52,color:theme.textMuted,textAlign:'center'}}>Phone</Text></View>
 {choices.map(([key,title])=><View key={key} style={{flexDirection:'row',alignItems:'center',gap:12,minHeight:64,paddingVertical:8,borderBottomWidth:1,borderBottomColor:theme.border}}><Text style={{flex:1,fontFamily:theme.font.medium,color:theme.text,fontSize:15}}>{title}</Text><BrandSwitch label={title+': in-app'} value={channels[key].in_app_enabled} disabled={busy} onValueChange={value=>void save(key,'in_app_enabled',value)}/>{key!=='profilePosts'?<BrandSwitch label={title+': phone push'} value={channels[key].push_enabled} disabled={busy} onValueChange={value=>void save(key,'push_enabled',value)}/>:<Text accessibilityLabel="Profile phone alerts are managed by account policy" style={{width:52,textAlign:'center',color:theme.textMuted}}>—</Text>}</View>)}
 </>}<Text style={{color:theme.textMuted,lineHeight:22,marginTop:14}}>Security notices stay on. Phone alerts need device permission.</Text></ToolPage>;
}
