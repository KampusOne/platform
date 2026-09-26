import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { ToolPage,ToolRow,ToolButton } from '@/src/components/toolkit';
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
 return <ToolPage title="Notification settings"><Text style={{fontFamily:theme.font.body,color:theme.textMuted,lineHeight:22,marginBottom:14}}>Choose what appears in your inbox and what can notify your phone. Social activity stays in the app by default. Set ringing alarms on the alarm screen.</Text>{error?<><Text accessibilityRole="alert" style={{color:theme.error}}>{error}</Text><ToolButton label="Retry" onPress={()=>void load()}/></>:!channels?<ScreenSkeleton variant="list" compact/>:choices.map(([key,title])=><View key={key} style={{marginBottom:14}}><Text accessibilityRole="header" style={{fontFamily:theme.font.display,color:theme.text,fontSize:17}}>{title}</Text><ToolRow title="In-app notifications" trailing={<BrandSwitch label={title+': in-app'} value={channels[key].in_app_enabled} disabled={busy} onValueChange={value=>void save(key,'in_app_enabled',value)}/>}/>{key!=='profilePosts'?<ToolRow title="Phone push" trailing={<BrandSwitch label={title+': phone push'} value={channels[key].push_enabled} disabled={busy} onValueChange={value=>void save(key,'push_enabled',value)}/>}/>:null}</View>)}<Text style={{color:theme.textMuted,lineHeight:22}}>Account security notices are always enabled. Phone push also needs permission on this device.</Text></ToolPage>;
}
