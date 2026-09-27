import { useEffect, useState } from 'react';
import { AppState, Platform, Text, View } from 'react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { File } from 'expo-file-system';
import { ToolButton } from './toolkit';
import { api } from '@/src/lib/api';
import { useAppearance } from '@/src/lib/appearance';

export function MessageVoice({disabled,onReady}:{disabled:boolean;onReady:(id:string,name:string)=>void}) {
  const recorder=useAudioRecorder(RecordingPresets.HIGH_QUALITY),state=useAudioRecorderState(recorder,250);
  const [uri,setUri]=useState<string>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const {theme}=useAppearance();
  useEffect(()=>{
    const stop=async()=>{if(recorder.isRecording){await recorder.stop();setUri(recorder.uri??undefined);}await setAudioModeAsync({allowsRecording:false});};
    const sub=AppState.addEventListener('change',s=>{if(s!=='active')void stop().catch(()=>undefined);});
    return()=>{sub.remove();if(recorder.isRecording)void recorder.stop().catch(()=>undefined);void setAudioModeAsync({allowsRecording:false}).catch(()=>undefined);};
  },[recorder]);
  useEffect(()=>{if(state.isRecording&&state.durationMillis>=120000)void recorder.stop().then(()=>{setUri(recorder.uri??undefined);return setAudioModeAsync({allowsRecording:false});}).catch(()=>setError('Recording could not be saved.'));},[state.isRecording,state.durationMillis,recorder]);
  async function record(){setBusy(true);setError('');try{
    if(state.isRecording){await recorder.stop();setUri(recorder.uri??undefined);await setAudioModeAsync({allowsRecording:false});}
    else {if(!(await AudioModule.requestRecordingPermissionsAsync()).granted)throw new Error('Allow microphone access to record a voice note.');await setAudioModeAsync({allowsRecording:true,playsInSilentMode:true});await recorder.prepareToRecordAsync();recorder.record();setUri(undefined);}
  }catch(e){setError(e instanceof Error?e.message:'Recording failed.');}finally{setBusy(false);}}
  async function attach(){if(!uri)return;setBusy(true);setError('');try{
    const body=Platform.OS==='web'?await(await fetch(uri)).blob():new File(uri) as unknown as Blob;
    if(body.size>10*1024*1024)throw new Error('Record a shorter voice note.');
    const result=await api<{id:string}>('/v1/media?kind=message&name=Voice-note.m4a',{method:'POST',body,headers:{'Content-Type':Platform.OS==='web'?body.type||'audio/webm':'audio/mp4'}});
    onReady(result.id,'Voice note');setUri(undefined);
  }catch(e){setError(e instanceof Error?e.message:'Upload failed. Your recording is kept.');}finally{setBusy(false);}}
  return <View style={{gap:8}}>
    <ToolButton secondary disabled={disabled||busy} label={state.isRecording?`Stop recording · ${Math.floor(state.durationMillis/1000)}s`:'Record voice note'} onPress={()=>void record()}/>
    {uri?<><VoicePlayback uri={uri}/><ToolButton disabled={disabled||busy} secondary label={busy?'Uploading voice note…':'Attach voice note'} onPress={()=>void attach()}/><ToolButton secondary disabled={busy} label="Discard recording" onPress={()=>setUri(undefined)}/></>:null}
    {error?<Text accessibilityRole="alert" style={{color:theme.error}}>{error}</Text>:null}
  </View>;
}
export function VoicePlayback({uri}:{uri:string}) {
  const player=useAudioPlayer(uri),state=useAudioPlayerStatus(player);
  return <ToolButton secondary label={state.playing?'Pause audio':'Play audio'} onPress={()=>{if(state.playing)player.pause();else{if(state.didJustFinish)void player.seekTo(0);player.play();}}}/>;
}
