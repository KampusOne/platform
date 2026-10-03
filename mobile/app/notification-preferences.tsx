import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { ToolPage,ToolButton } from '@/src/components/toolkit';
import { BrandSwitch } from '@/src/components/brand-switch';
import { ScreenSkeleton } from '@/src/components/skeleton';
import { api } from '@/src/lib/api';
import { useAppearance } from '@/src/lib/appearance';
import { useToast } from '@/src/components/toast';
import { useAuth } from '@/src/auth/auth-context';
import { getRegisteredPushDevice, pushSetupAvailability, registerPushDevice } from '@/src/lib/push-registration';
const choices=[['likes','Post likes'],['commentLikes','Comment likes'],['comments','Comments on your posts'],['replies','Replies to your comments'],['reposts','Reposts'],['quotes','Quote posts'],['mentions','Tags and mentions'],['follows','New followers'],['messages','Messages'],['profilePosts','Profile subscriptions'],['classReminders','Classes and reminders'],['announcements','Community announcements'],['newsletter','KampusOne Newsletter'],['campusUpdates','Important campus updates']] as const;
type DeliveryStatus = { devices: { active: number; registered: number } | null; queue: { state: string; last_error_code: string | null; count: number }[]; policy: { push_enabled: boolean } };
type Category=(typeof choices)[number][0]|'security';
type Channels=Record<Category,{in_app_enabled:boolean;push_enabled:boolean}>;
function normalizeChannels(value: unknown): Channels {
 const raw=value&&typeof value==="object"?value as Record<string,unknown>:{};
 const output={} as Channels;
 for(const key of [...choices.map(([name])=>name),"security"] as Category[]){
  const row=raw[key]&&typeof raw[key]==="object"?raw[key] as Record<string,unknown>:{};
  output[key]={in_app_enabled:row.in_app_enabled===true,push_enabled:row.push_enabled===true};
 }
 return output;
}
export default function NotificationPreferences(){
 const {theme}=useAppearance(),toast=useToast();const {user}=useAuth();const [channels,setChannels]=useState<Channels|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [pushState,setPushState]=useState<'checking'|'registered'|'available'|'unavailable'|'error'>(Platform.OS==='web'?'unavailable':'checking');
 const [pushMessage,setPushMessage]=useState('');
 const [pushBusy,setPushBusy]=useState(false);
 const [delivery,setDelivery]=useState<DeliveryStatus|null>(null);
 const load=()=>api<{channels:Channels}>('/v1/notifications/preferences').then(r=>{setChannels(normalizeChannels(r?.channels));setError('');}).catch(e=>setError(e instanceof Error?e.message:'Notification settings could not load.'));
 async function checkPush(){
  void api<DeliveryStatus>('/v1/notifications/delivery-status').then(setDelivery).catch(()=>setDelivery(null));
  if(Platform.OS==='web'||!user?.id){setPushState('unavailable');setPushMessage('Phone push is available in the installed KampusOne app.');return;}
  const availability=pushSetupAvailability();
  if(!availability.available){setPushState('unavailable');setPushMessage(availability.message);return;}
  try{const registered=await getRegisteredPushDevice(user.id);setPushState(registered?'registered':'available');setPushMessage(registered?'This phone is registered for KampusOne push notifications.':'Push is available in this build, but this phone is not registered yet.');}
  catch(e){setPushState('error');setPushMessage(e instanceof Error?e.message:'Could not check this phone.');}
 }
 async function enablePush(){
  if(!user?.id||pushBusy)return;setPushBusy(true);
  try{await registerPushDevice(user.id);await checkPush();toast('Phone notifications enabled','success');}
  catch(e){setPushState('error');setPushMessage(e instanceof Error?e.message:'Could not enable phone notifications.');toast(e instanceof Error?e.message:'Could not enable phone notifications','error');}
  finally{setPushBusy(false);}
 }
 useEffect(()=>{void load();void checkPush();},[user?.id]);
 async function save(key:Category,channel:'in_app_enabled'|'push_enabled',value:boolean){if(!channels||busy)return;const previous=channels,next={...channels,[key]:{...channels[key],[channel]:value}};setChannels(next);setBusy(true);try{await api('/v1/notifications/preferences',{method:'PUT',body:JSON.stringify({channels:next})});}catch(e){setChannels(previous);toast(e instanceof Error?e.message:'Could not save preferences','error');}finally{setBusy(false);}}
 return <ToolPage title="Notification settings"><Text style={{fontFamily:theme.font.body,color:theme.textMuted,lineHeight:22,marginBottom:14}}>Choose where you get updates.</Text>
 {Platform.OS!=='web'?<View style={{borderWidth:1,borderColor:theme.border,borderRadius:16,padding:14,marginBottom:16,backgroundColor:theme.surface}}>
  <Text style={{fontFamily:theme.font.semibold,color:theme.text,fontSize:15}}>Phone push on this device</Text>
  <Text style={{fontFamily:theme.font.body,color:theme.textMuted,lineHeight:20,marginTop:5}}>{pushState==='checking'?'Checking this phone…':pushMessage}</Text>
  {delivery&&!delivery.policy.push_enabled?<Text style={{fontFamily:theme.font.body,color:theme.textMuted,lineHeight:20,marginTop:6}}>Phone alerts are currently paused by KampusOne.</Text>:null}
  {delivery&&delivery.queue.some(row=>row.state==='PENDING'||row.state==='PROCESSING')?<Text style={{fontFamily:theme.font.body,color:theme.textMuted,lineHeight:20,marginTop:6}}>Some updates are waiting for delivery. Keep phone notifications enabled.</Text>:null}
  {pushState==='available'||pushState==='error'?<ToolButton secondary disabled={pushBusy} label={pushBusy?'Enabling…':'Enable phone notifications'} onPress={()=>void enablePush()}/>:null}
  {pushState!=='checking'?<ToolButton secondary disabled={pushBusy} label="Check notification status" onPress={()=>void checkPush()}/>:null}
 </View>:null}
 {error?<><Text accessibilityRole="alert" style={{color:theme.error}}>{error}</Text><ToolButton label="Retry" onPress={()=>void load()}/></>:!channels?<ScreenSkeleton variant="list" compact/>:<>
 <View style={{flexDirection:'row',alignItems:'center',gap:12,marginBottom:4}}><Text style={{flex:1,color:theme.textMuted}}>Activity</Text><Text style={{width:52,color:theme.textMuted,textAlign:'center'}}>In app</Text><Text style={{width:52,color:theme.textMuted,textAlign:'center'}}>Phone</Text></View>
 {choices.filter(([key])=>key!=='messages').map(([key,title])=><View key={key} style={{flexDirection:'row',alignItems:'center',gap:12,minHeight:64,paddingVertical:8,borderBottomWidth:1,borderBottomColor:theme.border}}><Text style={{flex:1,fontFamily:theme.font.medium,color:theme.text,fontSize:15}}>{title}</Text><BrandSwitch label={title+': in-app'} value={channels[key].in_app_enabled} disabled={busy} onValueChange={value=>void save(key,'in_app_enabled',value)}/>{key!=='profilePosts'?<BrandSwitch label={title+': phone push'} value={channels[key].push_enabled} disabled={busy} onValueChange={value=>void save(key,'push_enabled',value)}/>:<Text accessibilityLabel="Profile phone alerts are managed by account policy" style={{width:52,textAlign:'center',color:theme.textMuted}}>—</Text>}</View>)}
 </>}<Text style={{color:theme.textMuted,lineHeight:22,marginTop:14}}>Security notices stay on. Phone alerts need device permission.</Text></ToolPage>;
}
