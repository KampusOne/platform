import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ToolPage, ToolButton, ToolField } from '@/src/components/toolkit';
import { api } from '@/src/lib/api';
import { syncAlarms, type Alarm } from '@/src/lib/alarms';
import { useAppearance } from '@/src/lib/appearance';
type Entry={id:string;title:string;course_code:string|null;day_of_week:number;starts_at:string;reminder_enabled:boolean};
export default function AlarmImport(){
 const {theme}=useAppearance();const [entries,setEntries]=useState<Entry[]>([]),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[ready,setReady]=useState(false);
 async function load(){setError('');try{const d=await api<{entries:Entry[]}>('/v1/student/timetable');setEntries(d.entries);setSelected(d.entries.map(e=>e.id));setReady(true);}catch(e){setError(e instanceof Error?e.message:'Timetable could not load.');}}
 useEffect(()=>{void load();},[]);
 async function save(){const offset=15;setBusy(true);setError('');setMessage('');try{
  const result=await api<{imported:number}>('/v1/notifications/alarms/import-timetable',{method:'POST',body:JSON.stringify({entryIds:selected,reminderMinutes:offset})});
  setMessage(`${result.imported} class reminders saved.`);
  const {alarms}=await api<{alarms:Alarm[]}>('/v1/learning/alarms');const enabled=await syncAlarms(alarms,true);
  if(!enabled)setMessage(`${result.imported} class reminders saved. Allow alarm and notification permissions on this device to hear them.`);
 }catch(e){setError(e instanceof Error?e.message:'The update failed. Your selection is kept.');}finally{setBusy(false);}}
 return <ToolPage title="Import class alarms"><Text style={{color:theme.textMuted}}>Choose the classes to enable. Repeating this import updates each class reminder without adding duplicates.</Text>
 {!ready?<ToolButton secondary label="Load timetable" onPress={()=>void load()}/>:entries.length===0?<Text style={{color:theme.text}}>Add courses or activities to your timetable first.</Text>:<>
 <ToolButton secondary disabled={busy} label={selected.length===entries.length?'Deselect all':'Select all'} onPress={()=>setSelected(selected.length===entries.length?[]:entries.map(e=>e.id))}/>
 {entries.map(e=><Pressable key={e.id} accessibilityRole="checkbox" accessibilityState={{checked:selected.includes(e.id)}} disabled={busy} onPress={()=>setSelected(v=>v.includes(e.id)?v.filter(id=>id!==e.id):[...v,e.id])} style={{minHeight:60,padding:12,borderWidth:1,borderColor:selected.includes(e.id)?theme.brand:theme.border,borderRadius:12,backgroundColor:theme.surface}}><Text style={{color:theme.text,fontFamily:theme.font.bold}}>{selected.includes(e.id)?'✓  ':''}{e.course_code||e.title}</Text><Text style={{color:theme.textMuted}}>{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][e.day_of_week]} · {e.starts_at.slice(0,5)}</Text></Pressable>)}
 <Text style={{color:theme.textMuted,paddingVertical:14}}>Class reminders ring 15 minutes before class.</Text><ToolButton disabled={busy||!selected.length} label={busy?'Saving…':`Import ${selected.length} class alarms`} onPress={()=>void save()}/></>}
 {message?<Text accessibilityLiveRegion="polite" style={{color:theme.success}}>{message}</Text>:null}{error?<View><Text accessibilityRole="alert" style={{color:theme.error}}>{error}</Text></View>:null}
 </ToolPage>;
}
