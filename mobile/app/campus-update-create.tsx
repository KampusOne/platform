import {useRef,useState} from 'react';
import {Image,Pressable,Text,View} from 'react-native';
import {router,useLocalSearchParams} from 'expo-router';
import {Ionicons} from '@expo/vector-icons';
import {randomUUID} from 'expo-crypto';
import {ToolPage,ToolField,ToolButton} from '@/src/components/toolkit';
import {ChoiceField} from '@/src/components/choice-field';
import {ActivityDatePicker} from '@/src/components/activity-date-picker';
import {selectedActivityDate} from '@/src/lib/campus-activity-date';
import {useAuth} from '@/src/auth/auth-context';
import {useAppearance} from '@/src/lib/appearance';
import {api} from '@/src/lib/api';
import {pickAndUpload,type UploadedFile} from '@/src/lib/uploads';
import {writeCache} from '@/src/lib/device-cache';
import {getDeviceCacheRevision,isDeviceCacheOwner} from '@/src/lib/device-cache';
import {useOwnedDraftSave} from '@/src/lib/use-owned-draft-save';
import {useOwnedDraftRestore} from '@/src/lib/use-owned-draft-restore';
import {restoreCampusDraft} from '@/src/lib/form-drafts';
import {DraftRecovery} from '@/src/components/draft-recovery';
import {cacheScopeForUser} from '@/src/lib/request-policy';
type Kind='EVENT'|'SPORTS'|'OPPORTUNITY';
type Draft={kind:Kind;title:string;description:string;venue:string;date:string;time:string;link:string;images:UploadedFile[];requestId:string};
export default function CampusUpdateCreate(){
 const {user}=useAuth();return <UpdateForm key={user?cacheScopeForUser(user):'signed-out'} owner={user?.id??''}/>;
}
function UpdateForm({owner}:{owner:string}){
 const {kind:requested}=useLocalSearchParams<{kind?:string}>(),{theme}=useAppearance();
 const [draft,setDraft]=useState<Draft>({kind:'EVENT',title:'',description:'',venue:'',date:'',time:'',link:'',images:[],requestId:randomUUID()});
 const [busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),key='campus-activity-draft.'+owner;
 const restored=useOwnedDraftRestore<unknown>(key,value=>{
  const saved=value===null?null:restoreCampusDraft(value);
  setDraft(current=>{const next=saved?{...saved,requestId:saved.requestId??randomUUID()}:current;return ['EVENT','SPORTS','OPPORTUNITY'].includes(requested??'')&&next.kind!==requested?{...next,kind:requested as Kind,requestId:randomUUID()}:next;});
 },Boolean(owner));
 const ready=restored.ready;
 const draftSave=useOwnedDraftSave(key,draft,ready&&Boolean(owner));
 function update(next:Partial<Draft>){setDraft(current=>({...current,...next,requestId:randomUUID()}));setError('');}
 async function photo(){if(!ready||uploading||busy||draft.images.length>=5)return;setUploading(true);setError('');try{const image=await pickAndUpload('post');if(image)setDraft(current=>({...current,images:current.images.some(value=>value.id===image.id)?current.images:[...current.images,image].slice(0,5),requestId:randomUUID()}));}catch(e){setError(e instanceof Error?e.message:'This photo could not upload. Try again.');}finally{setUploading(false);}}
 async function publish(){
  if(lock.current||!owner||!ready)return;const revision=getDeviceCacheRevision();lock.current=true;setBusy(true);setError('');
  try{
   const when=selectedActivityDate(draft.date,draft.kind==='OPPORTUNITY'?'23:59':draft.time);
   if(!when)throw new Error(draft.date?'Choose the start time before publishing.':'Choose a date before publishing.');
   await draftSave.persist(draft);
   if(revision!==getDeviceCacheRevision()||!isDeviceCacheOwner(owner))return;
   const result=await api<{id:string}>('/v1/student/feed/activity',{method:'POST',body:JSON.stringify({requestId:draft.requestId,category:draft.kind,title:draft.title,description:draft.description,mediaIds:draft.images.map(image=>image.id),...(draft.kind==='OPPORTUNITY'?{deadline:when.toISOString()}:{venue:draft.venue,startsAt:when.toISOString()}),...(draft.link.trim()?{registrationUrl:draft.link.trim()}:{} )})});
   if(revision!==getDeviceCacheRevision()||!isDeviceCacheOwner(owner))return;
   draftSave.discard();await writeCache(key,null);router.replace({pathname:'/post',params:{id:result.id}});
  }catch(e){setError(e instanceof Error?e.message:'Your update could not publish. Your draft is kept.');}finally{lock.current=false;setBusy(false);}
 }
 return <ToolPage title="Share a campus update"><View style={{gap:16}}>
  <DraftRecovery error={restored.error} loading={restored.loading} onRetry={restored.retry}/>
  {draftSave.warning?<Text accessibilityRole="alert" style={{fontFamily:theme.font.body,color:theme.error,lineHeight:21}}>{draftSave.warning}</Text>:null}
  <Text style={{fontFamily:theme.font.body,color:theme.textMuted,lineHeight:21}}>Let other students know what’s happening. Your update appears in All and its category.</Text>
  <ChoiceField label="Update type" value={draft.kind} disabled={!ready||busy} options={[{value:'EVENT',label:'Event'},{value:'SPORTS',label:'Sports'},{value:'OPPORTUNITY',label:'Opportunity'}]} onChange={kind=>update({kind:kind as Kind})}/>
  <ToolField label="Title" value={draft.title} maxLength={180} editable={ready&&!busy} onChangeText={title=>update({title})} placeholder="What should students know?"/>
  <ToolField label="Description" value={draft.description} maxLength={5000} multiline editable={ready&&!busy} onChangeText={description=>update({description})} placeholder="Add the useful details"/>
  {draft.kind!=='OPPORTUNITY'?<ToolField label="Venue" value={draft.venue} editable={ready&&!busy} onChangeText={venue=>update({venue})} placeholder="Where is it happening?"/>:null}
  <ActivityDatePicker label={draft.kind==='OPPORTUNITY'?'Application deadline':'Date'} value={draft.date} disabled={!ready||busy} onChange={date=>update({date})}/>{draft.kind!=='OPPORTUNITY'?<ActivityDatePicker label="Start time" mode="time" value={draft.time} disabled={!ready||busy} onChange={time=>update({time})}/>:null}
  <ToolField label={draft.kind==='OPPORTUNITY'?'Application link':'Registration link (optional)'} value={draft.link} editable={ready&&!busy} autoCapitalize="none" keyboardType="url" onChangeText={link=>update({link})} placeholder="https://…"/>
  <Text style={{fontFamily:theme.font.medium,color:theme.text}}>Photos · {draft.images.length}/5</Text>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:10}}>{draft.images.map(image=><View key={image.id} style={{width:96,height:96}}><Image source={{uri:image.url}} style={{width:96,height:96,borderRadius:12}}/><Pressable accessibilityRole="button" accessibilityLabel="Remove photo" disabled={!ready||busy} onPress={()=>update({images:draft.images.filter(item=>item.id!==image.id)})} style={{position:'absolute',right:0,top:0,padding:9,backgroundColor:theme.surface,borderRadius:18}}><Ionicons name="close" size={18} color={theme.text}/></Pressable></View>)}</View>
  <ToolButton secondary disabled={!ready||uploading||busy||draft.images.length>=5} label={uploading?'Uploading photo…':'Add a photo'} onPress={()=>void photo()}/>
  {error?<Text accessibilityRole="alert" style={{fontFamily:theme.font.body,color:theme.error,lineHeight:21}}>{error}</Text>:null}
  <ToolButton disabled={!ready||busy||uploading||!draft.title.trim()||!draft.description.trim()} label={busy?'Publishing…':'Publish update'} onPress={()=>void publish()}/>
 </View></ToolPage>;
}
