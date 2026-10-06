import {useCallback,useState} from 'react';
import {router,useFocusEffect,useLocalSearchParams} from 'expo-router';
import {Ionicons} from '@expo/vector-icons';
import {Pressable,Text,View} from 'react-native';
import {ToolPage,ToolButton,ToolField} from '@/src/components/toolkit';
import {ScreenSkeleton} from '@/src/components/skeleton';
import {api} from '@/src/lib/api';
import {syncAlarms,type Alarm} from '@/src/lib/alarms';
import {useAppearance} from '@/src/lib/appearance';
import {formatExamDate} from '@/src/lib/exam-period';
type Row={id:string;title:string;detail:string;available:boolean};
type ClassEntry={id:string;title:string;course_code:string|null;day_of_week:number;starts_at:string};
type ExamEntry={id:string;title:string;course_code:string;date:string;starts_at:string;alarms_disabled:boolean;assessment_kind?:string};
type CalendarEntry={id:string;title:string;starts_on:string;ends_on:string};
const sourceLabels={timetable:'Class timetable',exam:'Exams & tests',calendar:'Academic calendar'} as const;
export default function AlarmImport(){
 const {source:query}=useLocalSearchParams<{source?:string}>(),source=query==='exam'||query==='calendar'?query:'timetable';
 const {theme}=useAppearance();
 const [rows,setRows]=useState<Row[]>([]),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[ready,setReady]=useState(false),[time,setTime]=useState('08:00');
 const load=useCallback(async()=>{setReady(false);setError('');setMessage('');try{
  let next:Row[];
  if(source==='timetable'){const d=await api<{entries:ClassEntry[]}>('/v1/student/timetable');next=d.entries.map(e=>({id:e.id,title:e.course_code?e.course_code+' · '+e.title:e.title,detail:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][e.day_of_week]+' · '+e.starts_at.slice(0,5),available:true}));}
  else if(source==='exam'){const d=await api<{exams:ExamEntry[]}>('/v1/exams');next=d.exams.map(e=>({id:e.id,title:e.course_code?e.course_code+' · '+e.title:e.title,detail:formatExamDate(e.date)+' · '+e.starts_at+(e.assessment_kind==='TEST'?' · Class test':'')+(e.alarms_disabled?' · Awareness confirmed':''),available:!e.alarms_disabled&&Date.parse(e.date+'T'+e.starts_at+':00+01:00')>Date.now()}));}
  else {const d=await api<{events:CalendarEntry[]}>('/v1/calendar');next=d.events.map(e=>({id:e.id,title:e.title,detail:formatExamDate(e.starts_on),available:Date.parse(e.starts_on+'T23:59:59+01:00')>Date.now()}));}
  setRows(next);setSelected(next.filter(e=>e.available).slice(0,100).map(e=>e.id));
 }catch(e){setError(e instanceof Error?e.message:'This schedule could not load.');}finally{setReady(true);}},[source]);
 useFocusEffect(useCallback(()=>{void load();},[load]));
 async function save(){if(busy)return;setBusy(true);setError('');setMessage('');try{
  const path=source==='timetable'?'/v1/notifications/alarms/import-timetable':source==='exam'?'/v1/exams/import-alarms':'/v1/calendar/import-alarms';
  const body=source==='timetable'?{entryIds:selected,reminderMinutes:15}:source==='exam'?{entryIds:selected}:{entryIds:selected,time};
  const result=await api<{imported:number}>(path,{method:'POST',body:JSON.stringify(body)});
  const {alarms}=await api<{alarms:Alarm[]}>('/v1/learning/alarms'),enabled=await syncAlarms(alarms,true);
  setMessage(result.imported+' '+(source==='exam'?'papers':'reminders')+' saved.'+(enabled?'':' Allow alarm and notification permissions on this device to hear them.'));
 }catch(e){setError(e instanceof Error?e.message:'The import failed. Your selection is kept.');}finally{setBusy(false);}}
 const available=rows.filter(r=>r.available).slice(0,100),all=available.length>0&&available.every(e=>selected.includes(e.id));
 return <ToolPage title={'Import '+sourceLabels[source].toLowerCase()}>
  <Text style={{fontFamily:theme.font.body,color:theme.textMuted,lineHeight:22}}>Review your saved schedule. Importing again updates the same reminders and keeps your personal alarms.</Text>
  {!ready?<ScreenSkeleton compact variant="list"/>:error&&!rows.length?<ToolButton label="Try again" onPress={()=>void load()}/>:!rows.length?<View style={{paddingVertical:26,gap:16}}><Ionicons name="calendar-outline" color={theme.deepBrand} size={36}/><Text style={{fontFamily:theme.font.semibold,color:theme.text}}>There is nothing to import yet.</Text><ToolButton label={'Open '+sourceLabels[source].toLowerCase()} onPress={()=>router.push(source==='timetable'?'/timetable':source==='exam'?'/exam-timetable':'/academic-calendar')}/></View>:<>
   <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10}}><Text style={{fontFamily:theme.font.semibold,color:theme.text}}>{selected.length} selected</Text><ToolButton secondary disabled={busy||!available.length} label={all?'Deselect all':'Select upcoming'} onPress={()=>setSelected(all?[]:available.map(e=>e.id))}/></View>
   {rows.map(e=><Pressable key={e.id} accessibilityRole="checkbox" accessibilityState={{checked:selected.includes(e.id),disabled:busy||!e.available}} disabled={busy||!e.available} onPress={()=>setSelected(v=>v.includes(e.id)?v.filter(id=>id!==e.id):v.length<100?[...v,e.id]:v)} style={{minHeight:72,padding:15,borderWidth:1,borderColor:selected.includes(e.id)?theme.brand:theme.border,borderRadius:14,backgroundColor:theme.surface,flexDirection:'row',gap:13,alignItems:'center',opacity:e.available?1:0.55}}><Ionicons name={selected.includes(e.id)?'checkbox':'square-outline'} color={selected.includes(e.id)?theme.brand:theme.textMuted} size={22}/><View style={{flex:1,minWidth:0,gap:5}}><Text style={{color:theme.text,fontFamily:theme.font.semibold}}>{e.title}</Text><Text style={{color:theme.textMuted,fontFamily:theme.font.body,fontSize:12}}>{e.detail}</Text></View></Pressable>)}
   {source==='calendar'?<ToolField label="Reminder time in Nigeria (24-hour)" value={time} onChangeText={setTime} placeholder="08:00"/>:null}
   <Text style={{fontFamily:theme.font.body,color:theme.textMuted,lineHeight:21,paddingVertical:10}}>{source==='timetable'?'Classes ring 15 minutes before they start.':source==='exam'?'Your first timetable paper each day, and each personal test or exam, gets reminders 2 hours, 1 hour, 30 minutes and 15 minutes before it starts.':'Calendar reminders ring once, on the first day of each selected event. Past dates are skipped.'}</Text>
   <ToolButton disabled={busy||!selected.length||(source==='calendar'&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))} label={busy?'Importing…':'Import selected alarms'} onPress={()=>void save()}/>
  </>}
  {message?<View style={{gap:12}}><Text accessibilityLiveRegion="polite" style={{fontFamily:theme.font.body,color:theme.success,lineHeight:22}}>{message}</Text><ToolButton secondary label="View my alarms" onPress={()=>router.replace('/alarms')}/></View>:null}
  {error?<Text accessibilityRole="alert" style={{fontFamily:theme.font.body,color:theme.error}}>{error}</Text>:null}
 </ToolPage>;
}
