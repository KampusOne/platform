import {useRef,useState} from 'react';
import {Image,Text,View} from 'react-native';
import {router} from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import {randomUUID} from 'expo-crypto';
import {useAuth} from '@/src/auth/auth-context';
import {useAppearance} from '@/src/lib/appearance';
import {ToolPage,ToolField,ToolButton} from '@/src/components/toolkit';
import {ChoiceField} from '@/src/components/choice-field';
import {api} from '@/src/lib/api';
import {uploadMessageFile} from '@/src/lib/message-upload';
import {uploadTutorialVideo} from '@/src/lib/tutorial-video-upload';
import {pickAndUpload} from '@/src/lib/uploads';
import {nairaToKobo} from '@/src/lib/money-input';
import {DraftRecovery} from '@/src/components/draft-recovery';
import {useOwnedDraftRestore} from '@/src/lib/use-owned-draft-restore';
import {useOwnedDraftSave} from '@/src/lib/use-owned-draft-save';
import {draftRecord,draftString,draftRows,draftIdentifier,draftFormatError} from '@/src/lib/draft-fields';
import {getDeviceCacheRevision} from '@/src/lib/device-cache';

const subjects=['General studies','Mathematics','Physics','Chemistry','Biology','Computer engineering','Computer science','Engineering','Medicine','Law','Business','Orientation','Motivation','Study skills'];
type Part={mediaId:string;title:string};
export default function LearningPublish(){
 const{user}=useAuth(),{theme}=useAppearance();
 const[title,setTitle]=useState(''),[description,setDescription]=useState(''),[courseCode,setCourseCode]=useState('');
 const[kind,setKind]=useState('VIDEO'),[subject,setSubject]=useState(subjects[0]!),[access,setAccess]=useState('FREE'),[price,setPrice]=useState(''),[cover,setCover]=useState<string|null>(null);
 const[parts,setParts]=useState<Part[]>([]),[uploading,setUploading]=useState(false),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState('');
 const request=useRef({key:randomUUID(),signature:''}),lock=useRef(false);
 const draftKey='learning-publish.'+(user?.id??'anonymous');
 function restore(value:unknown){const r=draftRecord(value),key=draftIdentifier(draftRecord(r.request),'key');if(!['VIDEO','PDF','NOTE','PAST_QUESTION','AUDIOBOOK'].includes(String(r.kind))||!['FREE','PAID'].includes(String(r.access))||!key)throw draftFormatError();return{title:draftString(r,'title','',180),description:draftString(r,'description','',2000),courseCode:draftString(r,'courseCode','',24),kind:String(r.kind),subject:draftString(r,'subject','',80),access:String(r.access),price:draftString(r,'price','',20),cover:r.cover===null?null:draftString(r,'cover','',4096),parts:draftRows(r,'parts',30,value=>{const part=draftRecord(value),mediaId=draftIdentifier(part,'mediaId');if(!mediaId)throw draftFormatError();return{mediaId,title:draftString(part,'title','',180)};}),request:{key,signature:draftString(draftRecord(r.request),'signature','',24000)}};}
 const restored=useOwnedDraftRestore<unknown>(draftKey,value=>{if(value===null)return;const d=restore(value);setTitle(d.title);setDescription(d.description);setCourseCode(d.courseCode);setKind(d.kind);setSubject(d.subject);setAccess(d.access);setPrice(d.price);setCover(d.cover);setParts(d.parts);request.current=d.request;},Boolean(user));
 const saved=useOwnedDraftSave(draftKey,{title,description,courseCode,kind,subject,access,price,cover,parts,request:request.current},restored.ready);
 async function choose(){
  if(uploading||busy||!user||!restored.ready)return;
  const result=await DocumentPicker.getDocumentAsync({type:kind==='VIDEO'?['video/mp4','video/webm']:kind==='AUDIOBOOK'?['audio/mpeg','audio/mp4','audio/wav']:['application/pdf'],copyToCacheDirectory:true,multiple:true});
  if(result.canceled)return;
  if(parts.length+result.assets.length>30){setError('A playlist can contain up to 30 files.');return;}
  const revision=getDeviceCacheRevision(),selectedKind=kind;setUploading(true);setError('');
  try{
   for(let n=0;n<result.assets.length;n++){
    const file=result.assets[n]!;if((file.size??0)>(selectedKind==='VIDEO'?500:100)*1024*1024)throw new Error('Choose videos up to 500 MB and documents or audio up to 100 MB. Completed uploads are kept.');
    const source={uri:file.uri,name:file.name,mimeType:file.mimeType??(selectedKind==='VIDEO'?'video/mp4':selectedKind==='AUDIOBOOK'?'audio/mpeg':'application/pdf')};
    const update=(value:number)=>setProgress(`File ${n+1} of ${result.assets.length} · ${Math.round(value*100)}%`);
    const id=selectedKind==='VIDEO'?await uploadTutorialVideo(user.id,source,update):await uploadMessageFile(user.id,source,update,'resource');
    if(revision!==getDeviceCacheRevision())return;
    setParts(current=>[...current,{mediaId:id,title:file.name.replace(/\.[^.]+$/,'')}]);
   }
  }catch(caught){setError(caught instanceof Error?caught.message:'Upload failed. Your completed files are kept.');}
  finally{if(revision===getDeviceCacheRevision()){setUploading(false);setProgress('');}}
 }
 async function photo(){if(uploading||busy)return;setUploading(true);try{const image=await pickAndUpload('product');if(image)setCover(image.url);}catch(caught){setError(caught instanceof Error?caught.message:'Cover upload failed.');}finally{setUploading(false);}}
 async function publish(){
  if(lock.current||uploading||!parts.length||!restored.ready)return;lock.current=true;setBusy(true);setError('');
  try{
   const body={title,description,courseCode:courseCode.trim()||'GENERAL',subject,resourceType:kind,accessModel:access,priceKobo:access==='FREE'?0:nairaToKobo(price),coverUrl:cover,parts};
   const signature=JSON.stringify(body);if(request.current.signature!==signature)request.current={key:randomUUID(),signature};
   await saved.persist({title,description,courseCode,kind,subject,access,price,cover,parts,request:request.current});
   const result=await api<{id:string}>('/v1/agents/learning-publish',{method:'POST',body:JSON.stringify({...body,requestId:request.current.key})});
   saved.discard();await saved.persist(null);
   router.replace({pathname:'/learning-preview',params:{id:result.id}});
  }catch(caught){setError(caught instanceof Error?caught.message:'Your material could not publish. Your uploaded files are kept.');}
  finally{lock.current=false;setBusy(false);}
 }
 const text={color:theme.text,fontFamily:theme.font.body};
 return <ToolPage title="Publish learning material"><DraftRecovery loading={restored.loading} error={restored.error} onRetry={restored.retry}/><View style={{gap:18}}>{saved.warning?<Text accessibilityRole="alert" style={{color:theme.error}}>{saved.warning}</Text>:null}
  <ChoiceField label="Material type" value={kind} disabled={busy||uploading||parts.length>0} options={[{value:'VIDEO',label:'Video'},{value:'PDF',label:'PDF / book'},{value:'PAST_QUESTION',label:'Past questions'},{value:'NOTE',label:'Notes'},{value:'AUDIOBOOK',label:'Audiobook'}]} onChange={setKind}/>
  <ToolField label={parts.length>1?'Playlist title':'Title'} value={title} onChangeText={setTitle} editable={!busy} maxLength={180}/>
  <ToolField label="Description" value={description} onChangeText={setDescription} editable={!busy} multiline maxLength={2000}/>
  <ChoiceField label="Subject" value={subject} disabled={busy} options={subjects.map(value=>({value,label:value}))} onChange={setSubject}/>
  <ToolField label="Course code (optional)" value={courseCode} onChangeText={setCourseCode} editable={!busy} autoCapitalize="characters" maxLength={24}/>
  <ChoiceField label="Access" value={access} disabled={busy} options={[{value:'FREE',label:'Free'},{value:'PAID',label:'Paid'}]} onChange={setAccess}/>
  {access==='PAID'?<ToolField label="Price for the whole material / playlist (₦)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" editable={!busy}/>:null}
  {cover?<Image source={{uri:cover}} style={{width:'100%',aspectRatio:16/9,borderRadius:14}}/>:null}
  <ToolButton secondary label={cover?'Change cover':'Add cover photo (optional)'} disabled={busy||uploading} onPress={()=>void photo()}/>
  <ToolButton secondary label={uploading?(progress||'Uploading…'):'Choose files / upload a playlist'} disabled={busy||uploading} onPress={()=>void choose()}/>
  {uploading?<Text accessibilityLiveRegion="polite" style={text}>You can keep writing while your files upload.</Text>:null}
  {parts.map((part,index)=><View key={part.mediaId} style={{padding:14,borderWidth:1,borderColor:theme.border,borderRadius:12,gap:8}}><ToolField label={`Part ${index+1}`} value={part.title} editable={!busy} onChangeText={value=>setParts(current=>current.map(p=>p.mediaId===part.mediaId?{...p,title:value}:p))}/><ToolButton secondary label="Remove file" disabled={busy||uploading} onPress={()=>setParts(current=>current.filter(p=>p.mediaId!==part.mediaId))}/></View>)}
  {error?<Text accessibilityRole="alert" style={{...text,color:theme.error}}>{error}</Text>:null}
  <ToolButton label={busy?'Publishing…':'Publish'} disabled={busy||uploading||!parts.length||title.trim().length<3||description.trim().length<10} onPress={()=>void publish()}/>
 </View></ToolPage>;
}
