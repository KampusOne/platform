import { useCallback,useEffect,useState } from 'react';
import { Text,View,Pressable,AppState } from 'react-native';
import { router,useFocusEffect } from 'expo-router';
import { ToolPage,ToolRow,ToolButton } from '@/src/components/toolkit';
import { api } from '@/src/lib/api';
import { useAppearance } from '@/src/lib/appearance';
import { useAuth } from '@/src/auth/auth-context';
type Thread={id:string;status:string;initiator_id:string;recipient_id:string;display_name:string;last_message:string;unread_count:number;roles:string[]};
export default function MessagesScreen(){
 const {theme}=useAppearance(),{user}=useAuth();const [threads,setThreads]=useState<Thread[]>([]),[filter,setFilter]=useState('All'),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const load=useCallback(async()=>{try{const r=await api<{threads:Thread[]}>('/v1/messages/inbox');setThreads(r.threads);setError('');}catch(e){setError(e instanceof Error?e.message:'Messages could not load.');}finally{setLoading(false);}},[]);
 useFocusEffect(useCallback(()=>{void load();const t=setInterval(()=>{if(AppState.currentState==='active')void load();},15000);return()=>clearInterval(t);},[load]));
 const visible=threads.filter(t=>filter==='All'||(filter==='Unread'&&t.unread_count>0)||(filter==='Requests'&&t.status==='REQUESTED'&&t.recipient_id===user?.id)||t.roles?.includes(filter.toUpperCase()));
 return <ToolPage title="Messages"><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{['All','Unread','Requests','Tutor','Vendor','Rider'].map(f=><Pressable key={f} accessibilityRole="button" accessibilityState={{selected:filter===f}} onPress={()=>setFilter(f)} style={{padding:10,borderRadius:10,backgroundColor:filter===f?theme.deepBrand:theme.surface}}><Text style={{color:filter===f?'white':theme.text}}>{f}</Text></Pressable>)}</View>{error?<><Text accessibilityRole="alert" style={{color:theme.error}}>{error}</Text><ToolButton label="Try again" onPress={()=>void load()}/></>:null}{loading?<Text style={{color:theme.textMuted}}>Loading conversations…</Text>:!visible.length?<Text style={{color:theme.textMuted}}>No {filter==='Requests'?'message requests':'conversations'} here yet. Open a profile to start a conversation.</Text>:visible.map(t=><ToolRow key={t.id} title={t.display_name} detail={t.last_message||'Start a conversation'} onPress={()=>router.push({pathname:'/conversation',params:{id:t.id}})} trailing={t.unread_count>0?<Text style={{color:theme.brand,fontWeight:'700'}}>{t.unread_count>99?'99+':t.unread_count}</Text>:undefined}/>)}</ToolPage>;
}
