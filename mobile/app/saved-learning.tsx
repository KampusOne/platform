import {useCallback,useState} from 'react';
import {useFocusEffect,router} from 'expo-router';
import {Text,View} from 'react-native';
import {ToolPage,ToolRow} from '@/src/components/toolkit';
import {api} from '@/src/lib/api';
export default function SavedLearning(){const[items,setItems]=useState<{id:string;title:string;publisher_name:string;resource_type:string}[]>([]),[error,setError]=useState('');useFocusEffect(useCallback(()=>{let active=true;void api<{resources:typeof items}>('/v1/student/learning-saved').then(result=>{if(active)setItems(result.resources);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]));return <ToolPage title="Saved learning"><View>{error?<Text>{error}</Text>:null}{items.map(item=><ToolRow key={item.id} title={item.title} detail={item.publisher_name+' · '+item.resource_type.toLowerCase()} icon="bookmark-outline" onPress={()=>router.push({pathname:'/learning-preview',params:{id:item.id}})}/>)}{!items.length&&!error?<Text>Your saved videos, documents and playlists appear here.</Text>:null}</View></ToolPage>;}
