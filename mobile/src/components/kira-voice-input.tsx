import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { api, ApiError } from '@/src/lib/api';
import { useAppearance } from '@/src/lib/appearance';

const MAX_RECORDING_MS = 120000;
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
  sendDisabled: boolean;
  sendBusy?: boolean;
  onAttach: () => void;
  onInfo: () => void;
  onSend: () => void;
  onTranscript: (text: string) => void;
  onSendTranscript: (text: string) => Promise<void> | void;
  onActiveChange?: (active: boolean) => void;
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
export function KiraVoiceInput({disabled,enabled,sendDisabled,sendBusy=false,onAttach,onInfo,onSend,onTranscript,onSendTranscript,onActiveChange}:Props){
  const {theme}=useAppearance();
  const recorder=useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const state=useAudioRecorderState(recorder,100);
  const [uri,setUri]=useState<string>(),[savedDuration,setSavedDuration]=useState(0),[working,setWorking]=useState(false),[error,setError]=useState('');
  const [meters,setMeters]=useState<number[]>(()=>Array(WAVE_BARS).fill(-60));
  const id=useRef(randomUUID()),alive=useRef(true),locked=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const active=state.isRecording||Boolean(uri)||working;

  useEffect(()=>{onActiveChange?.(active);},[active,onActiveChange]);
  useEffect(()=>{if(state.isRecording)setMeters(values=>[...values.slice(-(WAVE_BARS-1)),state.metering??-60]);},[state.durationMillis,state.isRecording,state.metering]);
  useEffect(()=>{
    alive.current=true;
    const sub=AppState.addEventListener('change',value=>{if(value!=='active'&&recorder.isRecording)void stopAndKeep();});
    return()=>{alive.current=false;sub.remove();if(timer.current)clearTimeout(timer.current);if(recorder.isRecording)void recorder.stop().catch(()=>undefined);void setAudioModeAsync({allowsRecording:false}).catch(()=>undefined);};
  },[recorder]);

  async function start(){
    if(locked.current||disabled)return;
    if(!enabled){setError('Voice input is temporarily unavailable.');return;}
    locked.current=true;setError('');
    try{
      const permission=await AudioModule.requestRecordingPermissionsAsync();
      if(!permission.granted)throw new Error('Allow microphone access in your phone settings to record a question.');
      await setAudioModeAsync({allowsRecording:true,playsInSilentMode:true});
      await recorder.prepareToRecordAsync();recorder.record();
      setUri(undefined);setSavedDuration(0);setMeters(Array(WAVE_BARS).fill(-60));id.current=randomUUID();
      timer.current=setTimeout(()=>{void finishVoice('draft');},MAX_RECORDING_MS);
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Recording could not start.');}
    finally{locked.current=false;}
  }
  async function stopAndKeep(){
    if(locked.current)return uri;
    locked.current=true;if(timer.current){clearTimeout(timer.current);timer.current=undefined;}
    try{
      const duration=state.durationMillis;
      if(recorder.isRecording)await recorder.stop();
      await setAudioModeAsync({allowsRecording:false});
      const saved=recorder.uri??undefined;
      if(!saved)throw new Error('The recording could not be saved.');
      if(alive.current){setSavedDuration(duration);setUri(saved);}return saved;
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Try recording again.');return undefined;}
    finally{locked.current=false;}
  }
  async function cancel(){
    if(working||locked.current)return;
    locked.current=true;if(timer.current){clearTimeout(timer.current);timer.current=undefined;}
    try{if(recorder.isRecording)await recorder.stop();await setAudioModeAsync({allowsRecording:false});}catch{}
    finally{if(alive.current){setUri(undefined);setSavedDuration(0);setMeters(Array(WAVE_BARS).fill(-60));setError('');}id.current=randomUUID();locked.current=false;}
  }
  function clearRecording(){
    if(!alive.current)return;
    setUri(undefined);setSavedDuration(0);setMeters(Array(WAVE_BARS).fill(-60));id.current=randomUUID();
  }
  async function transcribe(recordingUri:string){
    if(locked.current||disabled)return undefined;
    locked.current=true;setWorking(true);setError('');
    try{
      const body=Platform.OS==='web'?await(await fetch(recordingUri)).blob():new File(recordingUri) as unknown as Blob;
      if(body.size>8*1024*1024)throw new Error('Record a shorter voice message.');
      const contentType=Platform.OS==='web'?body.type||'audio/webm':'audio/mp4';
      const result=await api<{text:string}>('/v1/ai/transcribe?idempotencyKey='+encodeURIComponent(id.current)+'&consent=true',{method:'POST',headers:{'Content-Type':contentType},body,timeoutMs:75000});
      const transcript=result.text.trim();
      if(!transcript)throw new Error('No speech was detected. Try recording again.');
      return transcript;
    }catch(e){
      if(alive.current){setError(e instanceof Error?e.message:'Your recording is kept. Try again.');if(e instanceof ApiError&&e.details?.retryWithNewKey)id.current=randomUUID();}
      return undefined;
    }finally{locked.current=false;if(alive.current)setWorking(false);}
  }
  async function finishVoice(intent:'draft'|'send'){
    if(working||disabled)return;
    const saved=state.isRecording?await stopAndKeep():uri;
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
      {!working?<Text style={{color:theme.textMuted,fontFamily:theme.font.semibold,fontSize:12,minWidth:34}}>{durationLabel(duration)}</Text>:null}
      <View style={{flex:1,height:32,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:2,overflow:'hidden'}}>
        {working?<View style={{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8}}><ActivityIndicator size="small" color={theme.textMuted}/><Text style={{color:theme.text,fontFamily:theme.font.semibold,fontSize:15}}>Transcribing…</Text></View>:waveform}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={working?'Transcribing voice message':state.isRecording?'Stop and transcribe recording':'Retry transcription'} disabled={working||(!state.isRecording&&!uri)} onPress={()=>void finishVoice('draft')} style={{width:44,height:44,borderRadius:22,backgroundColor:theme.surfaceMuted,alignItems:'center',justifyContent:'center',opacity:working||(!state.isRecording&&!uri)?0.5:1}}>
        {working||state.isRecording?<View style={{width:13,height:13,borderRadius:3,backgroundColor:theme.textMuted}}/>:<Ionicons name="refresh" size={20} color={theme.textMuted}/>}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={working?'Transcribing voice message':'Transcribe and send voice message'} disabled={working||disabled} onPress={()=>void finishVoice('send')} style={{width:44,height:44,borderRadius:22,backgroundColor:theme.deepBrand,alignItems:'center',justifyContent:'center',opacity:working||disabled?0.5:1}}><Ionicons name="arrow-up" size={24} color="#FFFFFF"/></Pressable>
    </View>
    {error?<Text accessibilityRole="alert" style={{color:theme.error,fontFamily:theme.font.body,fontSize:12,lineHeight:18,paddingHorizontal:7,paddingBottom:5}}>{error}</Text>:null}
  </View>;
}
