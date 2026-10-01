import {useCallback,useRef,useState} from 'react';
import {Image,Platform,Text,View} from 'react-native';
import {useFocusEffect} from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import {randomUUID} from 'expo-crypto';
import {ToolPage,ToolField,ToolButton} from '@/src/components/toolkit';
import {ChoiceField} from '@/src/components/choice-field';
import {useAppearance} from '@/src/lib/appearance';
import {api} from '@/src/lib/api';
import {uploadCapturedMapPhoto} from '@/src/lib/uploads';
type Mission={id:string;title:string;kind:string;place_name:string;campus_name:string};
type Capture={id:string;uri:string;mediaId?:string;latitude:number;longitude:number;accuracyMetres:number;heading:number|null;capturedAt:string};
export default function CampusCapture(){
 const {theme}=useAppearance();const[missions,setMissions]=useState<Mission[]>([]),[missionId,setMissionId]=useState(''),[capture,setCapture]=useState<Capture|null>(null),[notes,setNotes]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');const locked=useRef(false);
 const load=useCallback(async()=>{const r=await api<{missions:Mission[]}>('/v1/map-capture/missions');setMissions(r.missions);setMissionId(id=>r.missions.some(m=>m.id===id)?id:r.missions[0]?.id??'');},[]);
 useFocusEffect(useCallback(()=>{void load().catch(e=>setError(e.message));},[load]));
 async function photograph(){if(locked.current)return;locked.current=true;setBusy(true);setError('');try{
  if(Platform.OS==='web')throw new Error('Use the Android app to capture a campus photo with camera and GPS evidence.');
  if(!(await ImagePicker.requestCameraPermissionsAsync()).granted)throw new Error('Allow camera access to capture the assigned place.');
  if(!(await Location.requestForegroundPermissionsAsync()).granted)throw new Error('Allow location access to verify the capture position.');
  const result=await ImagePicker.launchCameraAsync({mediaTypes:['images'],quality:.8,allowsEditing:false});if(result.canceled||!result.assets[0])return;
  const position=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High});if(position.coords.accuracy===null||position.coords.accuracy>50)throw new Error('GPS accuracy must be within 50 metres. Move outdoors and capture again.');
  setCapture({id:randomUUID(),uri:result.assets[0].uri,latitude:position.coords.latitude,longitude:position.coords.longitude,accuracyMetres:position.coords.accuracy,heading:position.coords.heading===null||position.coords.heading<0?null:position.coords.heading,capturedAt:new Date(position.timestamp).toISOString()});setNotice('Photo and GPS are ready for your review. Avoid faces, vehicle plates and private interiors.');
 }catch(e){setError(e instanceof Error?e.message:'Camera could not open.');}finally{locked.current=false;setBusy(false);}}
 async function submit(){if(!capture||!missionId||locked.current)return;locked.current=true;setBusy(true);setError('');try{const mediaId=capture.mediaId??(await uploadCapturedMapPhoto({uri:capture.uri,name:'Campus-capture.jpg',type:'image/jpeg'})).id;setCapture({...capture,mediaId});await api(`/v1/map-capture/missions/${missionId}/submissions`,{method:'POST',body:JSON.stringify({id:capture.id,mediaId,latitude:capture.latitude,longitude:capture.longitude,accuracyMetres:capture.accuracyMetres,heading:capture.heading,capturedAt:capture.capturedAt,notes})});setCapture(null);setNotes('');setNotice('Submitted for campus review. The photo will appear after approval.');await load();}catch(e){setError(e instanceof Error?e.message:'Submission failed. Retry with the same photo.');}finally{locked.current=false;setBusy(false);}}
 return <ToolPage title="Campus capture"><View style={{gap:18,paddingVertical:16}}>{error?<Text accessibilityRole="alert" style={{color:theme.error}}>{error}</Text>:null}{notice?<Text accessibilityLiveRegion="polite" style={{color:theme.textMuted}}>{notice}</Text>:null}{missions.length?<><ChoiceField label="Assigned mission" value={missionId} options={missions.map(m=>({value:m.id,label:`${m.campus_name} · ${m.place_name} · ${m.title}`}))} disabled={busy||Boolean(capture)} onChange={setMissionId}/><ToolButton label={capture?'Retake photo':'Capture photo and GPS'} disabled={busy} onPress={()=>void photograph()}/>{capture?<><Image source={{uri:capture.uri}} accessibilityLabel="Captured campus evidence" style={{width:'100%',height:260,borderRadius:16}}/><Text style={{color:theme.textMuted}}>GPS accuracy {Math.round(capture.accuracyMetres)} m · {new Date(capture.capturedAt).toLocaleTimeString()}</Text><ToolField label="Survey notes" value={notes} onChangeText={setNotes} maxLength={1000} multiline editable={!busy}/><ToolButton label={busy?'Submitting…':'Submit for review'} disabled={busy} onPress={()=>void submit()}/></>:null}</>:<Text style={{color:theme.textMuted}}>No open capture missions are assigned to this account.</Text>}</View></ToolPage>;
}
