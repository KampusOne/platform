import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, Text, View } from 'react-native';
import { InlineLoading } from './skeleton';
import { Ionicons } from '@expo/vector-icons';
import { AudioModule, RecordingPresets, setAudioModeAsync, type AudioRecorder, type RecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { api, ApiError } from '@/src/lib/api';
import { useAppearance } from '@/src/lib/appearance';
import { createNativeMediaLifetime } from '@/src/lib/native-media-lifetime';
import { nativeKiraVoiceBody, MAX_KIRA_VOICE_BYTES } from '@/src/lib/kira-voice-upload';

const WAVE_BARS = 34;
const VOICE_RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  isMeteringEnabled: true,
  android: { ...RecordingPresets.HIGH_QUALITY.android, audioSource: 'voice_recognition' as const },
};

type Props = {
  disabled: boolean;
  enabled: boolean;
  maxRecordingMs: number;
  sendDisabled: boolean;
  sendBusy?: boolean;
  onAttach: () => void;
  onInfo: () => void;
  onSend: () => void;
  onTranscript: (text: string) => void;
  onSendTranscript: (text: string) => Promise<void> | void;
  onActiveChange?: (active: boolean) => void;
  onRecordingChange?: (recording: boolean) => void;
};

function durationLabel(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function barHeight(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 5;
  return 5 + Math.round(Math.max(0, Math.min(1, (value + 60) / 60)) * 22);
}

/** Stop transcribes into an editable draft; the arrow transcribes and sends without an extra tap. */
export function KiraVoiceInput({disabled,enabled,maxRecordingMs,sendDisabled,sendBusy=false,onAttach,onInfo,onSend,onTranscript,onSendTranscript,onActiveChange,onRecordingChange}:Props){
  const {theme}=useAppearance();
  // Allocate native recording only after a mic tap. Opening Kira, attaching a
  // PDF or typing must not create or poll an AudioRecorder SharedObject.
  const recorder=useRef<{value:AudioRecorder;lifetime:ReturnType<typeof createNativeMediaLifetime>}|undefined>(undefined);
  const [recorderEpoch,setRecorderEpoch]=useState(0);
  const [state,setState]=useState<RecorderState>({isRecording:false,durationMillis:0,canRecord:false,mediaServicesDidReset:false,url:null});
  const stateRef=useRef(state);stateRef.current=state;
  const [uri,setUri]=useState<string>(),[savedDuration,setSavedDuration]=useState(0),[working,setWorking]=useState(false),[error,setError]=useState('');
  const [meters,setMeters]=useState<number[]>(()=>Array(WAVE_BARS).fill(-60));
  const id=useRef(randomUUID()),alive=useRef(true),locked=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),durationRef=useRef(0);
  const active=state.isRecording||Boolean(uri)||working;
  const recordingLimit=Math.max(1000,maxRecordingMs);

  useEffect(()=>{onActiveChange?.(active);},[active,onActiveChange]);
  useEffect(()=>{onRecordingChange?.(state.isRecording);},[state.isRecording,onRecordingChange]);
  useEffect(()=>{if(state.isRecording)setMeters(values=>[...values.slice(-(WAVE_BARS-1)),state.metering??-60]);},[state.durationMillis,state.isRecording,state.metering]);
  function releaseRecording(session:NonNullable<typeof recorder.current>){
    session.lifetime.dispose();
    if(recorder.current===session)recorder.current=undefined;
    try{session.value.release();}catch{/* Already released native resources have no work left. */}
    if(alive.current)setRecorderEpoch(value=>value+1);
  }
  useLayoutEffect(()=>{
    alive.current=true;
    return()=>{
      alive.current=false;if(timer.current)clearTimeout(timer.current);
      const session=recorder.current;recorder.current=undefined;
      if(session){session.lifetime.dispose();try{void session.value.stop().catch(()=>undefined).finally(()=>{try{session.value.release();}catch{}});}catch{try{session.value.release();}catch{}}}
      void setAudioModeAsync({allowsRecording:false}).catch(()=>undefined);
    };
  },[]);
  useEffect(()=>{
    const sub=AppState.addEventListener('change',value=>{if(value!=='active'&&alive.current&&stateRef.current.isRecording)void stopAndKeep();});
    return()=>sub.remove();
  },[]);
  useEffect(()=>{
    const session=recorder.current;if(!session)return;
    const poll=setInterval(()=>{
      if(!alive.current||!session.lifetime.isActive()||recorder.current!==session)return;
      try{setState(session.value.getStatus());}
      catch{releaseRecording(session);setState(current=>({...current,isRecording:false}));setError('Voice recording became unavailable. Tap the microphone to try again.');}
    },100);
    return()=>clearInterval(poll);
  },[recorderEpoch]);

  async function start(){
    if(locked.current||disabled||recorder.current?.lifetime.isActive())return;
    if(!enabled){setError('Voice input is temporarily unavailable.');return;}
    locked.current=true;setError('');
    try{
      const permission=await AudioModule.requestRecordingPermissionsAsync();
      if(!alive.current)return;
      if(!permission.granted)throw new Error('Allow microphone access in your phone settings to record a question.');
      await setAudioModeAsync({allowsRecording:true,playsInSilentMode:true});
      if(!alive.current)return;
      const {android,ios,web,...common}=VOICE_RECORDING_OPTIONS;
      const value=new AudioModule.AudioRecorder({...common,...(Platform.OS==='android'?android:Platform.OS==='ios'?ios:web)});
      const session={value,lifetime:createNativeMediaLifetime()};recorder.current=session;setRecorderEpoch(epoch=>epoch+1);
      await value.prepareToRecordAsync();
      if(!alive.current||!session.lifetime.isActive()||recorder.current!==session)return;
      value.record();setState(value.getStatus());onRecordingChange?.(true);
      durationRef.current=0;setUri(undefined);setSavedDuration(0);setMeters(Array(WAVE_BARS).fill(-60));id.current=randomUUID();
      timer.current=setTimeout(()=>{void finishVoice('draft');},recordingLimit);
    }catch(e){const session=recorder.current;if(session)releaseRecording(session);if(alive.current){setState(current=>({...current,isRecording:false}));setError(e instanceof Error?e.message:'Recording could not start.');}}
    finally{locked.current=false;}
  }
  async function stopAndKeep(){
    if(locked.current)return uri;
    locked.current=true;if(timer.current){clearTimeout(timer.current);timer.current=undefined;}onRecordingChange?.(false);
    try{
      const duration=stateRef.current.durationMillis;
      const session=recorder.current;
      if(!session||!session.lifetime.isActive())return uri;
      await session.value.stop();
      if(!alive.current||!session.lifetime.isActive()||recorder.current!==session)return undefined;
      const saved=session.value.uri??undefined;
      releaseRecording(session);
      setState(current=>({...current,isRecording:false,durationMillis:duration}));
      await setAudioModeAsync({allowsRecording:false});
      if(!saved)throw new Error('The recording could not be saved.');
      durationRef.current=duration;
      if(alive.current){setSavedDuration(duration);setUri(saved);}return saved;
    }catch(e){const session=recorder.current;if(session)releaseRecording(session);if(alive.current){setState(current=>({...current,isRecording:false}));setError(e instanceof Error?e.message:'Try recording again.');}return undefined;}
    finally{locked.current=false;}
  }
  async function cancel(){
    if(working||locked.current)return;
    locked.current=true;if(timer.current){clearTimeout(timer.current);timer.current=undefined;}onRecordingChange?.(false);
    const session=recorder.current;
    try{if(session&&session.lifetime.isActive())await session.value.stop();await setAudioModeAsync({allowsRecording:false});}catch{}
    finally{if(session&&session.lifetime.isActive())releaseRecording(session);durationRef.current=0;if(alive.current){setState(current=>({...current,isRecording:false,durationMillis:0}));setUri(undefined);setSavedDuration(0);setMeters(Array(WAVE_BARS).fill(-60));setError('');}id.current=randomUUID();locked.current=false;}
  }
  function clearRecording(){
    if(!alive.current)return;
    durationRef.current=0;setUri(undefined);setSavedDuration(0);setMeters(Array(WAVE_BARS).fill(-60));id.current=randomUUID();
  }
  async function transcribe(recordingUri:string){
    if(locked.current||disabled)return undefined;
    locked.current=true;setWorking(true);setError('');
    try{
      let body:Blob|ArrayBuffer;
      if(Platform.OS==='web'){
        const response=await fetch(recordingUri);if(!response.ok)throw new Error('The recording could not be read. Record it again.');body=await response.blob();
      }else{
        // Expo File is a native host object, not a React Native fetch Blob.
        // Send raw bytes just like image/document uploads.
        body=await nativeKiraVoiceBody(new File(recordingUri));
      }
      const bytes=body instanceof ArrayBuffer?body.byteLength:body.size;
      if(!bytes)throw new Error('This recording is empty. Record it again.');
      if(bytes>MAX_KIRA_VOICE_BYTES)throw new Error('Record a shorter voice message.');
      if(!alive.current)return undefined;
      const contentType=body instanceof ArrayBuffer?'audio/mp4':body.type||'audio/webm';
      const durationMs=Math.max(1,durationRef.current||savedDuration||state.durationMillis);
      const path='/v1/ai/transcribe?idempotencyKey='+encodeURIComponent(id.current)+'&consent=true&durationMs='+encodeURIComponent(String(durationMs));
      const timeoutMs=Math.max(90000,Math.min(180000,Math.ceil(recordingLimit/2)));
      let result:{text:string};
      try{
        result=await api<{text:string}>(path,{method:'POST',headers:{'Content-Type':contentType},body,timeoutMs});
      }catch(e){
        const retryMultipart=e instanceof ApiError&&e.details?.retryMultipart===true;
        if(!retryMultipart)throw e;
        const form=new FormData();
        if(Platform.OS==='web')form.append('file',body as Blob,'Kira-voice.webm');
        else form.append('file',{uri:recordingUri,name:'Kira-voice.m4a',type:contentType} as unknown as Blob);
        result=await api<{text:string}>(path,{method:'POST',body:form,timeoutMs});
      }
      const transcript=typeof result?.text==='string'?result.text.trim():'';
      if(!transcript)throw new Error('No speech was detected. Try recording again.');
      return transcript;
    }catch(e){
      if(alive.current){
        const message=e instanceof ApiError&&e.status===500&&e.code==='INTERNAL_ERROR'
          ? 'Voice transcription hit a temporary server error. Your recording is kept — tap retry.'
          : e instanceof Error?e.message:'Your recording is kept. Try again.';
        setError(message);
        if(e instanceof ApiError&&e.details?.retryWithNewKey)id.current=randomUUID();
      }
      return undefined;
    }finally{locked.current=false;if(alive.current)setWorking(false);}
  }
  async function finishVoice(intent:'draft'|'send'){
    if(working||disabled)return;
    const saved=stateRef.current.isRecording?await stopAndKeep():uri;
    if(!saved)return;
    const transcript=await transcribe(saved);
    if(!transcript||!alive.current)return;
    clearRecording();
    if(intent==='send')await onSendTranscript(transcript);
    else onTranscript(transcript);
  }

  const waveform=useMemo(()=>meters.map((value,index)=><View key={index} style={{width:3,height:barHeight(value),borderRadius:2,backgroundColor:theme.textMuted,opacity:index<meters.length-1?0.72:1}}/>),[meters,theme.textMuted]);
  const duration=state.isRecording?state.durationMillis:savedDuration;
  if(!active)return <View>
    <View style={{flexDirection:'row',alignItems:'center'}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Attach image or document" disabled={disabled} onPress={onAttach} style={{width:44,height:44,alignItems:'center',justifyContent:'center',opacity:disabled?0.42:1}}><Ionicons name="add" size={26} color={theme.text}/></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="AI privacy and help" disabled={disabled} onPress={onInfo} style={{width:44,height:44,alignItems:'center',justifyContent:'center',opacity:disabled?0.42:1}}><Ionicons name="information-circle-outline" size={22} color={theme.text}/></Pressable>
      <View style={{flex:1}}/>
      <Pressable accessibilityRole="button" accessibilityLabel="Record a voice message" accessibilityState={{disabled:disabled||!enabled}} disabled={disabled} onPress={()=>void start()} style={{width:44,height:44,alignItems:'center',justifyContent:'center',opacity:enabled&&!disabled?1:0.5}}><Ionicons name="mic-outline" size={24} color={theme.text}/></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={sendBusy?'Kira is working':'Send message'} accessibilityState={{disabled:sendDisabled,busy:sendBusy}} disabled={sendDisabled} onPress={onSend} style={{width:44,height:44,borderRadius:22,alignItems:'center',justifyContent:'center',backgroundColor:theme.deepBrand,opacity:sendDisabled?0.5:1}}><Ionicons name="arrow-up" size={24} color="#FFFFFF"/></Pressable>
    </View>
    {error?<Text accessibilityRole="alert" style={{color:theme.error,fontFamily:theme.font.body,fontSize:12,lineHeight:18,paddingHorizontal:7,paddingBottom:5}}>{error}</Text>:null}
  </View>;

  return <View>
    <View accessibilityLiveRegion="polite" accessibilityLabel={working?'Transcribing voice message':state.isRecording?'Recording voice message':'Voice recording saved'} style={{minHeight:64,flexDirection:'row',alignItems:'center',gap:9}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel voice recording" disabled={working} onPress={()=>void cancel()} style={{width:44,height:44,alignItems:'center',justifyContent:'center',opacity:working?0.4:1}}><Ionicons name="close" size={28} color={theme.text}/></Pressable>
      {!working?<Text style={{color:theme.textMuted,fontFamily:theme.font.semibold,fontSize:12,minWidth:72}}>{durationLabel(duration)} / {durationLabel(recordingLimit)}</Text>:null}
      <View style={{flex:1,height:32,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:2,overflow:'hidden'}}>
        {working?<View style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8}}><InlineLoading color={theme.textMuted} size={34} style={{marginVertical:0}}/><Text style={{color:theme.text,fontFamily:theme.font.semibold,fontSize:15}}>Transcribing…</Text></View>:waveform}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={working?'Transcribing voice message':state.isRecording?'Stop and transcribe recording':'Retry transcription'} disabled={working||(!state.isRecording&&!uri)} onPress={()=>void finishVoice('draft')} style={{width:44,height:44,borderRadius:22,backgroundColor:theme.surfaceMuted,alignItems:'center',justifyContent:'center',opacity:working||(!state.isRecording&&!uri)?0.5:1}}>
        {working||state.isRecording?<View style={{width:13,height:13,borderRadius:3,backgroundColor:theme.textMuted}}/>:<Ionicons name="refresh" size={20} color={theme.textMuted}/>}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={working?'Transcribing voice message':'Transcribe and send voice message'} disabled={working||disabled} onPress={()=>void finishVoice('send')} style={{width:44,height:44,borderRadius:22,backgroundColor:theme.deepBrand,alignItems:'center',justifyContent:'center',opacity:working||disabled?0.5:1}}><Ionicons name="arrow-up" size={24} color="#FFFFFF"/></Pressable>
    </View>
    {error?<Text accessibilityRole="alert" style={{color:theme.error,fontFamily:theme.font.body,fontSize:12,lineHeight:18,paddingHorizontal:7,paddingBottom:5}}>{error}</Text>:null}
  </View>;
}
