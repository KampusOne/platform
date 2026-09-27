import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { api, ApiError } from '@/src/lib/api';
import { useAppearance } from '@/src/lib/appearance';

/** Records only after a tap; transcription becomes an editable draft, never a sent chat. */
export function KiraVoiceInput({disabled,enabled,onTranscript}:{disabled:boolean;enabled:boolean;onTranscript:(text:string)=>void}){
  const {theme}=useAppearance();
  const recorder=useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state=useAudioRecorderState(recorder,250);
  const [uri,setUri]=useState<string>(),[working,setWorking]=useState(false),[error,setError]=useState('');
  const id=useRef(randomUUID()),alive=useRef(true),locked=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>{alive.current=true;const sub=AppState.addEventListener('change',value=>{if(value!=='active'&&recorder.isRecording)void recorder.stop().catch(()=>undefined);});return()=>{alive.current=false;sub.remove();if(timer.current)clearTimeout(timer.current);if(recorder.isRecording)void recorder.stop().catch(()=>undefined);void setAudioModeAsync({allowsRecording:false}).catch(()=>undefined);};},[recorder]);
  async function start(){
    if(locked.current||disabled)return;locked.current=true;setError('');
    try{
      const permission=await AudioModule.requestRecordingPermissionsAsync();
      if(!permission.granted)throw new Error('Allow microphone access in your phone settings to record a question.');
      await setAudioModeAsync({allowsRecording:true,playsInSilentMode:true});
      await recorder.prepareToRecordAsync();recorder.record();setUri(undefined);id.current=randomUUID();
      timer.current=setTimeout(()=>{void stop();},120000);
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Recording could not start.');}finally{locked.current=false;}
  }
  async function stop(){
    if(locked.current)return;locked.current=true;
    if(timer.current)clearTimeout(timer.current);
    try{await recorder.stop();await setAudioModeAsync({allowsRecording:false});if(alive.current){if(!recorder.uri)throw new Error('The recording could not be saved.');setUri(recorder.uri);}}
    catch(e){if(alive.current)setError(e instanceof Error?e.message:'Try recording again.');}finally{locked.current=false;}
  }
  async function transcribe(){
    if(!uri||locked.current||disabled)return;locked.current=true;setWorking(true);setError('');
    try{
      const body=Platform.OS==='web' ? await (await fetch(uri)).blob() : new File(uri) as unknown as Blob;
      const contentType=Platform.OS==='web' ? body.type||'audio/webm' : 'audio/mp4';
      const result=await api<{text:string}>(`/v1/ai/transcribe?idempotencyKey=${id.current}&consent=true`,{method:'POST',headers:{'Content-Type':contentType},body,timeoutMs: 45000});
      if(alive.current){onTranscript(result.text);setUri(undefined);id.current=randomUUID();}
    }catch(e){if(alive.current){setError(e instanceof Error?e.message:'Your recording is kept. Try again.');if(e instanceof ApiError&&e.details?.retryWithNewKey)id.current=randomUUID();}}
    finally{locked.current=false;if(alive.current)setWorking(false);}
  }
  const small={color:theme.textMuted,fontFamily:theme.font.body,fontSize:12,lineHeight:18};
  if(!enabled)return null;
  return <View style={{marginBottom:8}}>
    <View style={{flexDirection:'row',alignItems:'center',gap:10}}>
      <Pressable accessibilityRole="button" accessibilityLabel={state.isRecording?'Stop recording':'Record a question'} disabled={disabled||working} onPress={()=>void(state.isRecording?stop():start())} style={{padding:10,opacity:disabled||working?0.45:1}}><Ionicons name={state.isRecording?'stop-circle':'mic-outline'} size={24} color={theme.brand}/></Pressable>
      {state.isRecording?<Text accessibilityLiveRegion="polite" style={small}>Recording · {Math.floor(state.durationMillis/1000)}s / 120s</Text>:uri?<><Pressable accessibilityRole="button" disabled={working||disabled} onPress={()=>void transcribe()} style={{paddingVertical:10}}><Text style={{...small,color:theme.brand}}>{working?'Transcribing…':'Transcribe recording'}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Discard recording" disabled={working} onPress={()=>{setUri(undefined);setError('');}} style={{padding:10}}><Ionicons name="close" size={20} color={theme.text}/></Pressable></>:<Text style={small}>Speak your question · review the text before sending</Text>}
    </View>
    {error?<Text accessibilityRole="alert" style={{...small,color:theme.error}}>{error}</Text>:null}
  </View>;
}
