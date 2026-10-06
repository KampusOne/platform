import {useEffect,useState} from 'react';
import {router,useLocalSearchParams} from 'expo-router';
import {Pressable,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {api} from '@/src/lib/api';
import {useAuth} from '@/src/auth/auth-context';
import {validSharedId} from '@/src/lib/shared-links';
import {InlineLoading} from '@/src/components/skeleton';
import {TutorialPlayer} from '@/src/components/tutorial-player';
export default function TutorialWatch(){
 const {id,title}=useLocalSearchParams<{id:string;title?:string}>(),{user}=useAuth();
 const [playback,setPlayback]=useState<{url:string;kind:'file'|'embed'}|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let live=true;setPlayback(null);setError('');
  if(!validSharedId(id)){setError('This video link is invalid.');return;}
  void(async()=>{const r=await api<{kind:'file'|'embed';url?:string}>(`/v1/tutorial-storage/playback/${id}`,{method:'POST'});const url=r.kind==='embed'?r.url:(await api<{url:string}>(`/v1/media/${id}/access`,{method:'POST'})).url;if(!url||!/^https:\/\//.test(url))throw new Error('This video is unavailable.');if(live)setPlayback({url,kind:r.kind});})().catch(e=>{if(live)setError(e instanceof Error?e.message:'This video could not load.');});return()=>{live=false;};
 },[id,user?.id,retry]);
 return <SafeAreaView style={{flex:1,backgroundColor:'#14110f'}}><View style={{flexDirection:'row',alignItems:'center',padding:16,gap:12}}><Pressable accessibilityLabel="Close video" accessibilityRole="button" onPress={()=>router.back()} style={{padding:8}}><Ionicons name="close" size={26} color="#fff"/></Pressable><Text numberOfLines={2} style={{flex:1,color:'#fff',fontSize:17,fontWeight:'600'}}>{title||'Tutorial video'}</Text></View>{playback?<TutorialPlayer {...playback} label={title||'Tutorial video'}/>:<View style={{flex:1,alignItems:'center',justifyContent:'center',padding:24,gap:18}}>{error?<><Text accessibilityRole="alert" style={{color:'#fff',textAlign:'center'}}>{error}</Text><Pressable accessibilityRole="button" onPress={()=>setRetry(n=>n+1)} style={{backgroundColor:'#A8462E',padding:16,borderRadius:14}}><Text style={{color:'#fff',fontWeight:'600'}}>Try again</Text></Pressable></>:<InlineLoading color="#E9B18E"/>}</View>}<Text style={{color:'#b8a79b',textAlign:'center',padding:14,fontSize:12}}>Access is linked to your KampusOne account.</Text></SafeAreaView>;
}
