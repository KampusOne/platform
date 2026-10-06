import {useCallback,useState} from 'react';
import {router,useFocusEffect,useLocalSearchParams} from 'expo-router';
import {Text,View} from 'react-native';
import {ToolPage,ToolButton} from '@/src/components/toolkit';
import {ScreenSkeleton} from '@/src/components/skeleton';
import {useAppearance} from '@/src/lib/appearance';
import {api} from '@/src/lib/api';
export default function SharedMessage(){
 const {id}=useLocalSearchParams<{id:string}>(),{theme}=useAppearance(),[error,setError]=useState('');
 const load=useCallback(async()=>{setError('');try{const data=await api<{threadId:string}>('/v1/messages/shared/'+encodeURIComponent(id));router.replace({pathname:'/conversation',params:{id:data.threadId,message:id}});}catch(e){setError(e instanceof Error?e.message:'This message is unavailable.');}},[id]);
 useFocusEffect(useCallback(()=>{void load();},[load]));
 return <ToolPage title="Shared message">{error?<View style={{gap:18}}><Text style={{color:theme.text,fontFamily:theme.font.body,lineHeight:22}}>{error}</Text><Text style={{color:theme.textMuted,fontFamily:theme.font.body,lineHeight:22}}>Private conversations are available to their participants. Sign in with the account that belongs to this conversation.</Text><ToolButton label="Try again" onPress={()=>void load()}/></View>:<ScreenSkeleton compact variant="list"/>}</ToolPage>;
}
