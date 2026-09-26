import { useCallback, useState, useRef } from 'react';
import { AppState, Image, Linking, Platform, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { ToolPage, ToolButton, ToolField } from '@/src/components/toolkit';
import { MessageVoice, VoicePlayback } from '@/src/components/message-voice';
import { ProfileActions } from '@/src/components/profile-actions';
import { api } from '@/src/lib/api';
import { useAppearance } from '@/src/lib/appearance';
import { useAuth } from '@/src/auth/auth-context';
type Message={id:string;sender_id:string;body:string;read_at:string|null;created_at:string;media_id:string|null;media_type:string|null;media_name:string|null};
type Data={thread:{status:string;recipient_id:string;initiator_id:string};profile:{user_id:string;display_name:string};messages:Message[];nextCursor:string|null};
function Attachment({message}:{message:Message}) {
  const [url,setUrl]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const {theme}=useAppearance();
  async function open(){setBusy(true);setError('');try{
    const result=await api<{url:string}>(`/v1/media/${message.media_id}/access`,{method:'POST'});
    if(message.media_type?.startsWith('image/')||message.media_type?.startsWith('audio/'))setUrl(result.url);
    else await Linking.openURL(result.url);
  }catch(e){setError(e instanceof Error?e.message:'Attachment unavailable.');}finally{setBusy(false);}}
  return <View style={{gap:8}}>
    <ToolButton secondary disabled={busy} label={busy?'Opening…':message.media_name||'Open attachment'} onPress={()=>void open()}/>
    {url&&message.media_type?.startsWith('image/')?<Image accessibilityLabel={message.media_name||'Message image'} source={{uri:url}} resizeMode="contain" style={{width:240,height:240}} onError={()=>{setUrl('');setError('Image link expired or failed to load. Tap to open it again.');}}/>:null}
    {url&&message.media_type?.startsWith('audio/')?<VoicePlayback uri={url}/>:null}
    {error?<Text accessibilityRole="alert" style={{color:theme.error}}>{error}</Text>:null}
  </View>;
}
export default function ConversationScreen(){
  const {id}=useLocalSearchParams<{id:string}>(),{user}=useAuth(),{theme}=useAppearance();
  const [data,setData]=useState<Data|null>(null),[draft,setDraft]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [attachment,setAttachment]=useState<{id:string;name:string}|null>(null);
  const pending=useRef<{id:string;body:string;mediaId?:string}|null>(null);
  const load=useCallback(async(before?:string)=>{if(!id)return;try{
    const result=await api<Data>('/v1/messages/threads/'+id+(before?'?before='+before:''));
    setData(previous=>{
      const all=new Map((previous?.messages??[]).map(m=>[m.id,m]));for(const m of result.messages)all.set(m.id,m);
      return {...result,nextCursor:before||!previous?result.nextCursor:previous.nextCursor,messages:[...all.values()].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id))};
    });setError('');await api('/v1/messages/threads/'+id+'/read',{method:'PUT'});
  }catch(e){setError(e instanceof Error?e.message:'Conversation could not load.');}},[id]);
  useFocusEffect(useCallback(()=>{void load();const t=setInterval(()=>{if(AppState.currentState==='active')void load();},10000);return()=>clearInterval(t);},[load]));
  async function accept(value:boolean){setBusy(true);try{await api('/v1/messages/threads/'+id+'/accept',{method:'PUT',body:JSON.stringify({accept:value})});await load();}catch(e){setError(e instanceof Error?e.message:'Could not update request.');}finally{setBusy(false);}}
  async function chooseFile(){setBusy(true);setError('');try{
    const picked=await DocumentPicker.getDocumentAsync({type:['application/pdf','image/jpeg','image/png','image/webp','audio/mpeg','audio/mp4','audio/wav','video/mp4','video/webm'],multiple:false,copyToCacheDirectory:true});
    if(picked.canceled)return;const file=picked.assets[0];if(!file)return;
    if(!file.size||file.size>50*1024*1024)throw new Error('Choose a file smaller than 50 MB; images and PDFs must be smaller than 10 MB.');
    const body=Platform.OS==='web'?await(await fetch(file.uri)).blob():new (await import('expo-file-system')).File(file.uri) as unknown as Blob;
    const result=await api<{id:string}>('/v1/media?kind=message&name='+encodeURIComponent(file.name),{method:'POST',body,headers:{'Content-Type':file.mimeType||body.type||'application/octet-stream'},signal:AbortSignal.timeout(180000)});
    setAttachment({id:result.id,name:file.name});
  }catch(e){setError(e instanceof Error?e.message:'Attachment upload failed.');}finally{setBusy(false);}}
  async function send(){if((!draft.trim()&&!attachment)||busy)return;setBusy(true);setError('');
    const message=pending.current?.body===draft.trim()&&pending.current?.mediaId===attachment?.id?pending.current:{id:Crypto.randomUUID(),body:draft.trim(),...(attachment?{mediaId:attachment.id}:{})};
    pending.current=message;
    try{await api('/v1/messages/threads/'+id+'/messages',{method:'POST',body:JSON.stringify(message)});pending.current=null;setDraft('');setAttachment(null);await load();}
    catch(e){setError(e instanceof Error?e.message:'Message not sent. Your draft is kept.');}finally{setBusy(false);}
  }
  const incoming=data?.thread.status==='REQUESTED'&&data.thread.recipient_id===user?.id;
  const canSend=data?.thread.status==='ACCEPTED'||(data?.thread.status==='REQUESTED'&&!incoming&&data.messages.length===0);
  return <ToolPage title={data?.profile?.display_name||'Conversation'}>
    {data?.profile?<ProfileActions userId={data.profile.user_id} name={data.profile.display_name} onChanged={()=>void load()}/>:null}
    {error?<><Text accessibilityRole="alert" style={{color:theme.error}}>{error}</Text><ToolButton secondary label="Refresh" onPress={()=>void load()}/></>:null}
    {data?.nextCursor?<ToolButton secondary label="Load earlier messages" disabled={busy} onPress={()=>void load(data.nextCursor!)}/>:null}
    {data?.messages.map(m=><View key={m.id} style={{alignSelf:m.sender_id===user?.id?'flex-end':'flex-start',maxWidth:'90%',padding:14,borderRadius:16,backgroundColor:m.sender_id===user?.id?theme.deepBrand:theme.surface}}>
      <Text selectable style={{fontSize:16,lineHeight:23,color:m.sender_id===user?.id?'white':theme.text}}>{m.body}</Text>
      {m.media_id&&m.media_type?<Attachment message={m}/>:null}
      {m.sender_id===user?.id&&m.read_at?<Text style={{fontSize:12,color:'white',marginTop:4}}>Read</Text>:null}
    </View>)}
    {incoming?<><Text style={{color:theme.text}}>Accept this message request to reply.</Text><ToolButton label="Accept request" disabled={busy} onPress={()=>void accept(true)}/><ToolButton secondary label="Decline" disabled={busy} onPress={()=>void accept(false)}/></>:canSend?<>
      <ToolField label="Message" placeholder="Write a message…" multiline value={draft} onChangeText={setDraft} maxLength={5000}/>
      {data?.thread.status==='ACCEPTED'?<><ToolButton secondary disabled={busy} label={busy?'Working…':'Attach image, PDF, audio or video'} onPress={()=>void chooseFile()}/><MessageVoice disabled={busy} onReady={(id,name)=>setAttachment({id,name})}/></>:null}
      {attachment?<><Text style={{color:theme.text}}>{attachment.name} attached</Text><ToolButton secondary disabled={busy} label="Remove attachment" onPress={()=>setAttachment(null)}/></>:null}
      <ToolButton label={busy?'Sending…':'Send'} disabled={busy||(!draft.trim()&&!attachment)} onPress={()=>void send()}/>
    </>:data?<Text style={{color:theme.textMuted}}>{data.thread.status==='DECLINED'?'This request was declined.':'Your message request is waiting for acceptance.'}</Text>:null}
  </ToolPage>;
}
