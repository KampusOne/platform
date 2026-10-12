import { refreshScreenRead } from "@/src/lib/screen-read";
import {useCallback,useRef,useState} from 'react';
import {ImportProgress,useImportProgress} from '@/src/components/import-progress';
import {ApiError} from '@/src/lib/api';
import {useFocusEffect,router} from 'expo-router';
import {randomUUID} from 'expo-crypto';
import {Ionicons} from '@expo/vector-icons';
import {Pressable,Text,View} from 'react-native';
import {ToolPage,ToolButton,ToolField} from '@/src/components/toolkit';
import {useAuth} from '@/src/auth/auth-context';
import {useAppearance} from '@/src/lib/appearance';
import {api} from '@/src/lib/api';
import {pickAttachment,uploadAttachment,type StagedAttachment} from '@/src/lib/uploads';
import {syncAlarms,type Alarm} from '@/src/lib/alarms';
import {writeCache} from '@/src/lib/device-cache';
import {useOwnedDraftSave} from '@/src/lib/use-owned-draft-save';
import {useOwnedDraftRestore} from '@/src/lib/use-owned-draft-restore';
import {restoreExamDraft} from '@/src/lib/form-drafts';
import {cacheScopeForUser} from '@/src/lib/request-policy';
import {DraftRecovery} from '@/src/components/draft-recovery';
import {useToast} from '@/src/components/toast';
type Paper={title:string;courseCode:string;date:string;startsAt:string;endsAt:string;venue:string};
type SavedPaper={id:string;title:string;course_code:string;date:string;starts_at:string;ends_at:string;venue:string;alarms_disabled:boolean};
type Schedule={exams:SavedPaper[];period:{active:boolean;starts_on:string;ends_on:string}};
type Draft={papers:Paper[];text:string;notes:string;file?:StagedAttachment|undefined;requestId:string;saveId:string};
const empty:Paper={title:'',courseCode:'',date:'',startsAt:'',endsAt:'',venue:''};
export default function ExamTimetable({onViewClasses}:{onViewClasses?:()=>void}={}){
 const{user}=useAuth();return <ExamTimetableForm key={user?cacheScopeForUser(user):'signed-out'} {...(onViewClasses?{onViewClasses}:{})}/>;
}
function ExamTimetableForm({onViewClasses}:{onViewClasses?:()=>void}){
 const{user}=useAuth(),{theme}=useAppearance(),toast=useToast();
 const[schedule,setSchedule]=useState<Schedule|null>(null),[papers,setPapers]=useState<Paper[]>([]),[text,setText]=useState(''),[notes,setNotes]=useState(''),[file,setFile]=useState<StagedAttachment>();
 const[busy,setBusy]=useState(false),[editing,setEditing]=useState(false),[error,setError]=useState(''),[warnings,setWarnings]=useState<string[]>([]),[expanded,setExpanded]=useState<number|null>(null);
 const {stage,setStage,failureStage}=useImportProgress();const [uploadFraction,setUploadFraction]=useState(0);
 const[scheduleLoading,setScheduleLoading]=useState(false),[scheduleError,setScheduleError]=useState('');
 const controller=useRef<AbortController|null>(null);
 const request=useRef(randomUUID()),saveId=useRef(randomUUID()),lock=useRef(false),generation=useRef(0);
 const scheduleRequest=useRef(0);
 const body={fontFamily:theme.font.body,color:theme.text,lineHeight:22,fontSize:14};
 const loadSchedule=useCallback(async()=>{const turn=++scheduleRequest.current;setScheduleLoading(true);setScheduleError('');try{await refreshScreenRead<Schedule>('/v1/exams',r=>{if(turn===scheduleRequest.current)setSchedule(r);});}catch(e){if(turn===scheduleRequest.current)setScheduleError(e instanceof Error?e.message:'Your saved exams could not load.');}finally{if(turn===scheduleRequest.current)setScheduleLoading(false);}},[]);
 useFocusEffect(useCallback(()=>{generation.current++;lock.current=false;setBusy(false);void loadSchedule();
  return()=>{generation.current++;scheduleRequest.current++;controller.current?.abort();};},[user?.id,loadSchedule]));
 const draftKey='exam-draft.'+user?.id;
 const restored=useOwnedDraftRestore<unknown>(draftKey,value=>{
  if(value===null)return;
  const d=restoreExamDraft(value);setPapers(d.papers);setText(d.text);setNotes(d.notes);setFile(d.file);request.current=d.requestId??randomUUID();saveId.current=d.saveId??randomUUID();setEditing(Boolean(d.papers.length||d.file||d.text||d.notes));
 },Boolean(user?.id));
 const draft=()=>({papers,text,notes,file,requestId:request.current,saveId:saveId.current});
 const draftSave=useOwnedDraftSave(draftKey,draft(),restored.ready&&editing,300);
 const persist=(next:Partial<Draft>={})=>draftSave.persist({...draft(),...next});
 function changed(){request.current=randomUUID();saveId.current=randomUUID();setError('');}
 async function attach(){if(lock.current||!restored.ready)return;const version=generation.current;lock.current=true;setBusy(true);setStage('selecting');try{const attachment=await pickAttachment();if(attachment&&version===generation.current){setFile(attachment);setStage("selected");changed();await persist({file:attachment});}}catch(e){if(version===generation.current){setStage("failed");setError(e instanceof Error?e.message:'Choose your file again.');}}finally{if(version===generation.current){lock.current=false;setBusy(false);}}}
 async function read(){if(!user||lock.current||!restored.ready)return;const requestController=new AbortController();controller.current=requestController;lock.current=true;setBusy(true);setError('');const version=generation.current;
  setStage(file&&!file.mediaId?'uploading':'reading');setUploadFraction(0);
  try{await persist();if(version!==generation.current)return;const uploaded=file?await uploadAttachment(file,user.id,text+' '+notes,'standard',fraction=>{if(version===generation.current)setUploadFraction(fraction);},{signal:requestController.signal,onStage:next=>{if(version===generation.current)setStage(next);},onUploaded:uploaded=>{if(version===generation.current)setFile(uploaded);}}):undefined;if(version!==generation.current)return;setFile(uploaded);setStage('analysing');await persist({file:uploaded});
   const result=await api<{entries:Paper[];warnings:string[]}>('/v1/ai',{method:'POST',signal:requestController.signal,timeoutMs:75000,body:JSON.stringify({mode:'timetable',documentKind:'exam',prompt:text,notes,mediaId:uploaded?.mediaId,extractedText:uploaded?.sourceText,idempotencyKey:request.current,consent:true})});
   if(version!==generation.current)return;
   if(!result||!Array.isArray(result.entries))throw new Error('The AI response was incomplete. Your uploaded exam timetable is kept for retry.');
   setPapers(result.entries);setWarnings(Array.isArray(result.warnings)?result.warnings:[]);saveId.current=randomUUID();await persist({file:uploaded,papers:result.entries});setStage("review");
  }catch(e){if(version===generation.current){if(e instanceof ApiError&&e.details?.retryWithNewKey===true)request.current=randomUUID();setStage('failed');setError(e instanceof Error?e.message:'Your draft is kept. Try again.');}}finally{if(version===generation.current){lock.current=false;setBusy(false);}}}
 async function save(){if(!user||lock.current||!restored.ready)return;const version=generation.current,transfer=new AbortController();controller.current=transfer;lock.current=true;setBusy(true);setStage('saving');setError('');
  try{await persist();if(version!==generation.current)return;const receipt=await api<{imported?:number}>('/v1/exams/import',{method:'POST',signal:transfer.signal,body:JSON.stringify({requestId:saveId.current,entries:papers})});
   if(version!==generation.current)return;draftSave.discard();setStage('completed');setEditing(false);setPapers([]);setFile(undefined);setText('');setNotes('');request.current=randomUUID();saveId.current=randomUUID();await writeCache(draftKey,null);
   try { const alarms=await api<{alarms:Alarm[]}>('/v1/learning/alarms');if(version!==generation.current)return;const enabled=await syncAlarms(alarms.alarms,true);if(!enabled&&version===generation.current)toast('Schedule saved. Enable alarm access in your device settings.'); } catch { if(version===generation.current)toast('Exams saved. Check device reminders in Alarms.'); }
   if(version!==generation.current)return;await loadSchedule();if(version===generation.current)toast(Number.isSafeInteger(receipt?.imported)?`${receipt.imported} exam papers saved`:'Exam timetable saved','success');
  }catch(e){if(version===generation.current){setStage('failed');setError(e instanceof Error?e.message:'Check the paper dates and hours. Your draft is kept.');}}finally{if(version===generation.current){lock.current=false;setBusy(false);}}}
 async function closeEditor(){if(lock.current||!restored.ready)return;const version=generation.current;lock.current=true;setBusy(true);try{await persist();if(version===generation.current)setEditing(false);}catch{/* The visible draft warning keeps the editor open. */}finally{if(version===generation.current){lock.current=false;setBusy(false);}}}
 function edit(index:number,field:keyof Paper,value:string){setPapers(rows=>rows.map((p,i)=>i===index?{...p,[field]:value}:p));saveId.current=randomUUID();}
 return <ToolPage status={stage?<ImportProgress failureStage={failureStage} stage={stage} uploadFraction={uploadFraction} fileReceived={Boolean(file?.mediaId)} filename={file?.name} fileType={file?.type} error={stage==="failed"?error:undefined} subject="exam timetable"/>:null} syncPath="/v1/exams" title="Exam timetable" refreshing={scheduleLoading} onRefresh={()=>void loadSchedule()}>
  <DraftRecovery error={restored.error} loading={restored.loading} onRetry={restored.retry}/>
  {draftSave.warning?<Text accessibilityRole="alert" style={{...body,color:theme.error,marginBottom:12}}>{draftSave.warning}</Text>:null}
  {!editing&&scheduleLoading&&!schedule?<Text style={{...body,color:theme.textMuted,marginBottom:12}}>Loading your saved exams…</Text>:null}
  {!editing&&scheduleError?<View style={{padding:16,gap:8,borderRadius:16,backgroundColor:theme.surfaceMuted,marginBottom:16}}><Text accessibilityRole="alert" style={{...body,color:theme.error}}>Your saved exams could not load. {scheduleError}</Text><ToolButton secondary label="Retry saved exams" disabled={scheduleLoading} onPress={()=>void loadSchedule()}/></View>:null}
  <View style={{padding:22,borderRadius:24,backgroundColor:theme.surfaceTint,gap:12,marginBottom:20}}><View style={{flexDirection:'row',alignItems:'center',gap:12}}><View style={{padding:12,borderRadius:18,backgroundColor:theme.surface}}><Ionicons name="school-outline" size={28} color={theme.deepBrand}/></View><Text style={{...body,fontFamily:theme.font.displayStrong,fontSize:24,lineHeight:30,flex:1,minWidth:0,color:theme.text}}>Your papers, in order</Text></View><Text style={{...body,color:theme.textMuted}}>During your exam period, this schedule replaces classes. Your first paper each day gets alarms 2 hours, 1 hour, 30 minutes and 15 minutes before it starts.</Text></View>
  {!editing?<><ToolButton label={schedule?.exams.length?'Replace exam timetable':'Upload exam timetable'} disabled={!restored.ready||busy} onPress={()=>{draftSave.begin();setStage(null);setError('');setEditing(true);}}/>{schedule?.exams.map((paper,index)=><View key={paper.id} style={{marginTop:14,padding:20,borderRadius:20,borderWidth:1,borderColor:theme.border,backgroundColor:theme.surface,gap:7}}><Text style={{...body,color:theme.deepBrand,fontFamily:theme.font.semibold}}>{paper.date} · {paper.starts_at}–{paper.ends_at}</Text><Text style={{...body,fontFamily:theme.font.displayStrong,fontSize:20}}>{paper.course_code||paper.title}</Text>{paper.course_code?<Text style={body}>{paper.title}</Text>:null}{paper.venue?<Text style={{...body,color:theme.textMuted}}>{paper.venue}</Text>:null}{index===0||schedule.exams[index-1]?.date!==paper.date?<View style={{flexDirection:'row',gap:6,alignItems:'center'}}><Ionicons name={paper.alarms_disabled?'checkmark-circle-outline':'alarm-outline'} size={17} color={theme.deepBrand}/><Text style={{...body,fontSize:12,color:theme.deepBrand}}>{paper.alarms_disabled?'Awareness confirmed · alarms off today':'First paper · four exam alarms'}</Text></View>:null}</View>)}<ToolButton secondary label="View class timetable" onPress={()=>onViewClasses?onViewClasses():router.push('/timetable')}/></>:<>
   <ToolButton secondary label={file?file.name:'Choose photo, PDF or text'} disabled={busy||!restored.ready} onPress={()=>void attach()}/><Text style={{...body,fontSize:12,color:theme.textMuted,marginVertical:10}}>PDF or text up to 100 MB · photos up to 8 MB</Text>
   <ToolField label="Timetable text" editable={!busy&&restored.ready} multiline value={text} onChangeText={value=>{setText(value);changed();}} maxLength={20000} placeholder="CSC 201 · 2026-11-05 · 09:00–11:00 · Main hall"/>
   <ToolField label="Courses and instructions (optional)" editable={!busy&&restored.ready} multiline value={notes} onChangeText={value=>{setNotes(value);changed();}} maxLength={2000} placeholder="Exclude courses I do not offer. Add MTH 201 on 6 November 2026, 09:00–11:00."/>
   <ToolButton label={busy?'Reading…':'Read exam timetable'} disabled={busy||!restored.ready||(!file&&!text.trim())} onPress={()=>void read()}/>
   {busy&&stage!=="selecting"&&stage!=="saving"?<ToolButton secondary label="Stop reading" onPress={()=>controller.current?.abort()}/>:null}
   {warnings.length?<Text style={{...body,color:theme.textMuted,marginVertical:12}}>{warnings.join('\n')}</Text>:null}
   {papers.map((paper,index)=><View key={index} style={{padding:18,borderRadius:20,borderWidth:1,borderColor:theme.border,marginVertical:8,backgroundColor:theme.surface}}><Pressable accessibilityRole="button" accessibilityState={{expanded:expanded===index}} onPress={()=>setExpanded(expanded===index?null:index)}><Text style={{...body,fontFamily:theme.font.semibold}}>{paper.courseCode||paper.title||`Paper ${index+1}`}</Text><Text style={{...body,color:theme.textMuted}}>{paper.date||'Choose date'} · {paper.startsAt||'Start'}–{paper.endsAt||'End'}</Text></Pressable>{expanded===index?<View style={{paddingTop:14}}>{([['title','Course title'],['courseCode','Course code'],['date','Date · YYYY-MM-DD'],['venue','Venue']] as const).map(([field,label])=><ToolField key={field} label={label} value={paper[field]} editable={!busy&&restored.ready} onChangeText={value=>edit(index,field,value)}/>)}<View style={{flexDirection:'row',gap:12}}>{([['startsAt','Start · 24h'],['endsAt','End · 24h']] as const).map(([field,label])=><View key={field} style={{flex:1}}><ToolField label={label} value={paper[field]} editable={!busy&&restored.ready} onChangeText={value=>edit(index,field,value)}/></View>)}</View><ToolButton secondary label="Remove paper" disabled={busy||!restored.ready} onPress={()=>{setPapers(rows=>rows.filter((_,i)=>i!==index));saveId.current=randomUUID();}}/></View>:null}</View>)}
   <ToolButton secondary label="Add a paper manually" disabled={busy||!restored.ready||papers.length>=80} onPress={()=>{setPapers(rows=>[...rows,{...empty}]);setExpanded(papers.length);changed();}}/>
   {papers.length?<ToolButton label={busy?'Saving…':'Save exam timetable'} disabled={busy||!restored.ready} onPress={()=>void save()}/>:null}<ToolButton secondary label="Back to my exams" disabled={busy||!restored.ready} onPress={()=>void closeEditor()}/>
  </>}{error?<Text accessibilityRole="alert" style={{...body,color:theme.error,marginVertical:12}}>{error}</Text>:null}
 </ToolPage>;
}
