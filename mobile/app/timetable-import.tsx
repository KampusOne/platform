import { useEffect, useRef, useState } from "react";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { Image, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ToolPage, ToolButton, ToolField } from "@/src/components/toolkit";
import { useToast } from "@/src/components/toast";
import { useAuth } from "@/src/auth/auth-context";
import { useAppearance } from "@/src/lib/appearance";
import { api, ApiError } from "@/src/lib/api";
import { pickAttachment, uploadAttachment, type StagedAttachment } from "@/src/lib/uploads";
import { readCache, writeCache } from "@/src/lib/device-cache";
import { syncAlarms, type Alarm } from "@/src/lib/alarms";
type Entry = { title: string; courseCode: string; venue: string; lecturer: string; dayOfWeek: number; startsAt: string; endsAt: string; reminderMinutes: number; reminderEnabled: boolean };
type Event = {title:string;startsOn:string;endsOn:string;semester:string};
type Draft = { entries: Entry[]; events?:Event[]; documentType?:string; text: string; attachment?:StagedAttachment; warnings?: string[]; key?: string; saveKey?:string };
const days=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
export default function ImportTimetable() {
  const {user}=useAuth(), {theme}=useAppearance(), toast=useToast();
  const [entries,setEntries]=useState<Entry[]>([]),[events,setEvents]=useState<Event[]>([]),[documentType,setDocumentType]=useState("");
  const [text,setText]=useState(""),[attachment,setAttachment]=useState<StagedAttachment>(),[paste,setPaste]=useState(false);
  const [warnings,setWarnings]=useState<string[]>([]),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState(""),[expanded,setExpanded]=useState<number|null>(null);
  const key=useRef(randomUUID()), saveKey=useRef(randomUUID()), locked=useRef(false), generation=useRef(0), account=useRef(user?.id);account.current=user?.id;
  const body={fontFamily:theme.font.body,color:theme.text,fontSize:14,lineHeight:21};
  const muted={...body,color:theme.textMuted,fontSize:12,lineHeight:18};
  useEffect(()=>{let active=true;generation.current++;locked.current=false;setBusy(false);setLoaded(false);setEntries([]);setEvents([]);setAttachment(undefined);setText("");setDocumentType("");setWarnings([]);setError("");key.current=randomUUID();saveKey.current=randomUUID();
    if(user?.id) void readCache<Draft>("timetable-draft."+user.id).then(d=>{if(!active||!d)return;setEntries(d.entries??[]);setEvents(d.events??[]);setDocumentType(d.documentType??"");setText(d.text??"");setPaste(Boolean(d.text));setAttachment(d.attachment);setWarnings(d.warnings??[]);key.current=d.key??randomUUID();saveKey.current=d.saveKey??randomUUID();}).catch(()=>undefined).finally(()=>{if(active)setLoaded(true);});
    return()=>{active=false;generation.current++;};
  },[user?.id]);
  const draft=()=>({entries,events,documentType,text,attachment,warnings,key:key.current,saveKey:saveKey.current});
  useEffect(()=>{if(!loaded||!user?.id)return;const timer=setTimeout(()=>{void writeCache("timetable-draft."+user.id,draft()).catch(()=>undefined);},250);return()=>clearTimeout(timer);},[entries,events,documentType,text,attachment,warnings,loaded,user?.id]);
  function changed(){key.current=randomUUID();saveKey.current=randomUUID();setError("");}
  async function attach(){if(locked.current)return;const version=generation.current;locked.current=true;setBusy(true);try{const f=await pickAttachment();if(f&&version===generation.current){setAttachment(f);changed();}}catch(e){if(version===generation.current)setError(e instanceof Error?e.message:"Choose your file again.");}finally{if(version===generation.current){locked.current=false;setBusy(false);}}}
  async function scan(){if(locked.current)return;const version=generation.current,owner=account.current;locked.current=true;setBusy(true);setError("");try{
    const file=attachment?await uploadAttachment(attachment):undefined;if(version!==generation.current)return;setAttachment(file);
    await writeCache("timetable-draft."+owner,{...draft(),attachment:file}).catch(()=>undefined);
    const r=await api<{entries:Entry[];events?:Event[];documentType?:string;warnings?:string[]}>("/v1/ai",{method:"POST",signal:AbortSignal.timeout(45000),body:JSON.stringify({mode:"timetable",prompt:text,mediaId:file?.mediaId,idempotencyKey:key.current,consent:true})});
    if(version!==generation.current)return;setEntries(r.entries);setEvents(r.events??[]);setDocumentType(r.documentType??"class_timetable");setWarnings(r.warnings??[]);setExpanded(null);saveKey.current=randomUUID();
  }catch(e){if(version!==generation.current)return;if(e instanceof ApiError&&e.details?.retryWithNewKey===true)key.current=randomUUID();setError(e instanceof Error?e.message:"Could not read the file. Your draft is kept.");}finally{if(version===generation.current){locked.current=false;setBusy(false);}}}
  const calendar=documentType==="academic_calendar";
  async function save(){if(locked.current)return;const version=generation.current,owner=account.current;
    const clock=/^([01]\d|2[0-3]):[0-5]\d$/;
    if(!calendar&&entries.some(e=>!e.title.trim()||!clock.test(e.startsAt)||!clock.test(e.endsAt)||e.endsAt<=e.startsAt)){setError("Check each class title, day and time.");return;}
    locked.current=true;setBusy(true);setError("");try{
      await api(calendar?"/v1/calendar/import":"/v1/learning/timetable/import",{method:"POST",body:JSON.stringify({requestId:saveKey.current,...(calendar?{events}:{entries})})});
      if(version!==generation.current)return;setLoaded(false);setEntries([]);setEvents([]);setText("");setAttachment(undefined);setWarnings([]);
      await writeCache("timetable-draft."+owner,{entries:[],text:"",key:randomUUID(),saveKey:randomUUID()}).catch(()=>undefined);
      if(!calendar){try{const r=await api<{alarms:Alarm[]}>("/v1/learning/alarms");const enabled=await syncAlarms(r.alarms,true);if(!enabled)toast("Classes saved. Enable device reminders in Alarms.");}catch{toast("Classes saved. Check device reminders in Alarms.");}}
      if(version===generation.current){toast(calendar?"Calendar saved":"Timetable saved","success");router.replace(calendar?"/academic-calendar":"/timetable");}
    }catch(e){if(version===generation.current)setError(e instanceof Error?e.message:"Could not save. Your reviewed draft is kept.");}finally{if(version===generation.current){locked.current=false;setBusy(false);}}}
  function edit(i:number,field:keyof Entry,value:string|number){setEntries(rows=>rows.map((e,n)=>n===i?{...e,[field]:value}:e));saveKey.current=randomUUID();}
  return <ToolPage title="Upload timetable" action={<Ionicons name="sparkles-outline" size={22} color={theme.brand}/> }>
    <View style={{padding:20,borderRadius:18,backgroundColor:theme.surfaceMuted,alignItems:"center",gap:10,marginBottom:16}}>
      <Ionicons name="calendar-outline" size={34} color={theme.brand}/>
      <Text style={{...body,fontFamily:theme.font.semibold,fontSize:18}}>Your week, organised</Text>
      <Text style={muted}>Photo, PDF or text · up to 8 MB</Text>
      <ToolButton secondary label={attachment?"Replace file":"Choose timetable"} disabled={!loaded||busy} onPress={()=>void attach()}/>
    </View>
    {attachment?<View style={{borderWidth:1,borderColor:theme.border,borderRadius:12,padding:12,marginBottom:12,gap:8}}>
      {attachment.uri&&attachment.type.startsWith("image/")?<Image accessibilityLabel="Selected timetable preview" source={{uri:attachment.uri}} resizeMode="contain" style={{height:150,width:"100%"}}/>:null}
      <View style={{flexDirection:"row",alignItems:"center",gap:12}}><Ionicons name="document-outline" size={22} color={theme.brand}/><Text numberOfLines={2} style={{...body,flex:1}}>{attachment.name}</Text><Pressable accessibilityRole="button" accessibilityLabel="Remove attachment" disabled={busy} onPress={()=>{setAttachment(undefined);changed();}} style={{padding:10}}><Ionicons name="close" size={22} color={theme.text}/></Pressable></View>
    </View>:null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={()=>setPaste(v=>!v)} style={{paddingVertical:12}}><Text style={{...body,color:theme.deepBrand}}>{paste?"Hide text":"Paste timetable text"}</Text></Pressable>
    {paste?<ToolField label="Timetable text" multiline value={text} maxLength={20000} editable={!busy} onChangeText={v=>{setText(v);changed();}} placeholder="Paste here…"/>:null}
    <Text style={{...muted,marginBottom:12}}>Processed privately by AI. Review before saving.</Text>
    <ToolButton label={busy?"Working…":"Read timetable"} disabled={!loaded||busy||(!attachment&&!text.trim())} onPress={()=>void scan()}/>
    {error?<Text accessibilityRole="alert" style={{...body,color:theme.error,marginVertical:12}}>{error}</Text>:null}
    {calendar?<View style={{paddingVertical:14,gap:5}}><Text style={{...body,fontFamily:theme.font.semibold}}>Academic calendar · {events.length} events</Text><Text style={muted}>This file lists dates, not class times. Review and save these events to your calendar.</Text></View>:null}
    {warnings.length?<Text style={{...muted,marginVertical:12}}>{warnings.join("\n")}</Text>:null}
    {calendar?events.map((e,i)=><View key={i} style={{paddingVertical:12,borderBottomWidth:1,borderColor:theme.border}}><Pressable accessibilityRole="button" accessibilityState={{expanded:expanded===i}} onPress={()=>setExpanded(expanded===i?null:i)}><Text style={{...body,fontFamily:theme.font.semibold}}>{e.title}</Text><Text style={muted}>{e.startsOn}{e.endsOn!==e.startsOn?` → ${e.endsOn}`:""} · {e.semester}</Text></Pressable>{expanded===i?<View style={{paddingTop:12}}>{([['title','Activity'],['startsOn','From (YYYY-MM-DD)'],['endsOn','To (YYYY-MM-DD)'],['semester','Semester']] as const).map(([field,label])=><ToolField key={field} label={label} value={e[field]} editable={!busy} onChangeText={value=>{setEvents(rows=>rows.map((r,n)=>n===i?{...r,[field]:value}:r));saveKey.current=randomUUID();}}/>)}<ToolButton secondary label="Remove event" disabled={busy} onPress={()=>{setEvents(rows=>rows.filter((_,n)=>n!==i));saveKey.current=randomUUID();}}/></View>:null}</View>):entries.map((e,i)=><View key={i} style={{paddingVertical:14,borderBottomWidth:1,borderColor:theme.border}}>
      <Pressable accessibilityRole="button" accessibilityState={{expanded:expanded===i}} onPress={()=>setExpanded(expanded===i?null:i)}><Text style={{...body,fontFamily:theme.font.semibold}}>{e.title||`Class ${i+1}`}</Text><Text style={muted}>{days[e.dayOfWeek]} · {e.startsAt||"Start"}–{e.endsAt||"End"}{e.venue?` · ${e.venue}`:""}</Text></Pressable>
      {expanded===i?<View style={{paddingTop:12}}><ToolField label="Course title" value={e.title} editable={!busy} onChangeText={v=>edit(i,"title",v)}/><View style={{flexDirection:"row",flexWrap:"wrap",gap:4,marginBottom:14}}>{days.map((day,n)=><Pressable key={day} accessibilityRole="radio" accessibilityState={{checked:e.dayOfWeek===n}} disabled={busy} onPress={()=>edit(i,"dayOfWeek",n)} style={{minHeight:42,minWidth:40,padding:9,borderRadius:8,backgroundColor:e.dayOfWeek===n?theme.deepBrand:theme.surfaceMuted}}><Text style={{...muted,color:e.dayOfWeek===n?"#fff":theme.text}}>{day}</Text></Pressable>)}</View><View style={{flexDirection:"row",gap:12}}>{([['startsAt','Start · 24h'],['endsAt','End · 24h']] as const).map(([field,label])=><View key={field} style={{flex:1}}><ToolField label={label} placeholder="09:00" value={e[field]} editable={!busy} onChangeText={v=>edit(i,field,v)}/></View>)}</View>{([['courseCode','Course code'],['venue','Venue'],['lecturer','Lecturer']] as const).map(([field,label])=><ToolField key={field} label={label} value={e[field]} editable={!busy} onChangeText={v=>edit(i,field,v)}/>)}<ToolButton secondary label="Remove class" disabled={busy} onPress={()=>{setEntries(rows=>rows.filter((_,n)=>n!==i));saveKey.current=randomUUID();}}/></View>:null}
    </View>)}
    {!calendar?<ToolButton secondary label="Add class manually" disabled={!loaded||busy||entries.length>=40} onPress={()=>{setEntries(rows=>[...rows,{title:"",courseCode:"",venue:"",lecturer:"",dayOfWeek:1,startsAt:"",endsAt:"",reminderMinutes:15,reminderEnabled:true}]);setExpanded(entries.length);saveKey.current=randomUUID();}}/>:null}
    {(calendar?events.length:entries.length)>0?<ToolButton label={calendar?"Save calendar":"Save reviewed classes"} disabled={busy} onPress={()=>void save()}/>:null}
  </ToolPage>;
}
