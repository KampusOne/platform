import { useEffect,useState } from 'react';
import { Text } from 'react-native';
import { ToolPage,ToolRow,ToolButton } from '@/src/components/toolkit';
import { api } from '@/src/lib/api';
import { useAppearance } from '@/src/lib/appearance';
import { useToast } from '@/src/components/toast';
type Profile={user_id:string;display_name:string;username:string};
export default function BlockedScreen(){
 const {theme}=useAppearance(),toast=useToast();const [profiles,setProfiles]=useState<Profile[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState('');
 async function load(){setError('');try{setProfiles((await api<{profiles:Profile[]}>('/v1/account/blocked')).profiles);}catch(e){setError(e instanceof Error?e.message:'Could not load blocked accounts.');}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 async function unblock(id:string){setBusy(id);try{await api('/v1/people/'+id+'/block',{method:'DELETE'});setProfiles(p=>p.filter(v=>v.user_id!==id));toast('Account unblocked','success');}catch(e){toast(e instanceof Error?e.message:'Could not unblock this account.','error');}finally{setBusy('');}}
 return <ToolPage title="Blocked accounts">{loading?<Text style={{color:theme.textMuted}}>Loading your blocked accounts…</Text>:error?<><Text accessibilityRole="alert" style={{color:theme.error}}>{error}</Text><ToolButton label="Try again" onPress={()=>void load()}/></>:profiles.length?profiles.map(p=><ToolRow key={p.user_id} title={p.display_name} detail={'@'+p.username} trailing={<ToolButton secondary label={busy===p.user_id?'Unblocking…':'Unblock'} disabled={!!busy} onPress={()=>void unblock(p.user_id)}/>}/>):<Text style={{color:theme.textMuted}}>You haven’t blocked anyone.</Text>}</ToolPage>;
}
