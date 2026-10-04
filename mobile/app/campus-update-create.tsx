import {useEffect,useRef,useState} from 'react';
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
import {readCache,writeCache} from '@/src/lib/device-cache';
type Kind='EVENT'|'SPORTS'|'OPPORTUNITY';
type Draft={kind:Kind;title:string;description:string;venue:string;date:string;time:string;link:string;images:UploadedFile[];requestId:string};
export default function CampusUpdateCreate(){
 const {user}=useAuth();return <UpdateForm key={user?.id} owner={user?.id??''}/>;
}
function UpdateForm({owner}:{owner:string}){
 const {kind:requested}=useLocalSearchParams<{kind?:string}>(),{theme}=useAppearance();
 const [draft,setDraft]=useState<Draft>({kind:'EVENT',title:'',description:'',venue:'',date:'',time:'',link:'',images:[],requestId:randomUUID()});
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),key='campus-activity-draft.'+owner;
 useEffect(()=>{let live=true;void readCache<Draft>(key).then(saved=>{if(live){setDraft(current=>{const restored=saved??current;return ['EVENT','SPORTS','OPPORTUNITY'].includes(requested??'')&&restored.kind!==requested?{...restored,kind:requested as Kind,requestId:randomUUID()}:restored;});setReady(true);}}).catch(()=>{if(live)setReady(true);});return()=>{live=false;};},[key,requested]);
 useEffect(()=>{if(ready)void writeCache(key,draft).catch(()=>undefined);},[key,draft,ready]);
 function update(next:Partial<Draft>){setDraft(current=>({...current,...next,requestId:randomUUID()}));setError('');}
 async function photo(){if(uploading||draft.images.length>=5)return;setUploading(true);setError('');try{const image=await pickAndUpload('post');if(image)update({images:[...draft.images,image]});}catch(e){setError(e instanceof Error?e.message:'This photo could not upload. Try again.');}finally{setUploading(false);}}
 async function publish(){
  if(lock.current||!owner||!ready)return;lock.current=true;setBusy(true);setError('');
  try{
   const when=selectedActivityDate(draft.date,draft.kind==='OPPORTUNITY'?'23:59':draft.time);
   if(!when)throw new Error(draft.date?'Choose the start time before publishing.':'Choose a date before publishing.');

   const result=await api<{id:string}>('/v1/student/feed/activity',{method:'POST',body:JSON.stringify({requestId:draft.requestId,category:draft.kind,title:draft.title,description:draft.description,mediaIds:draft.images.map(image=>image.id),...(draft.kind==='OPPORTUNITY'?{deadline:when.toISOString()}:{venue:draft.venue,startsAt:when.toISOString()}),...(draft.link.trim()?{registrationUrl:draft.link.trim()}:{} )})});
   await writeCache(key,null);router.replace({pathname:'/post',params:{id:result.id}});
  }catch(e){setError(e instanceof Error?e.message:'Your update could not publish. Your draft is kept.');}finally{lock.current=false;setBusy(false);}
 }
 return <ToolPage title="Share a campus update"><View style={{gap:16}}>
  <Text style={{fontFamily:theme.font.body,color:theme.textMuted,lineHeight:21}}>Let other students know what’s happening. Your update appears in All and its category.</Text>
  <ChoiceField label="Update type" value={draft.kind} disabled={busy} options={[{value:'EVENT',label:'Event'},{value:'SPORTS',label:'Sports'},{value:'OPPORTUNITY',label:'Opportunity'}]} onChange={kind=>update({kind:kind as Kind})}/>
  <ToolField label="Title" value={draft.title} maxLength={180} editable={!busy} onChangeText={title=>update({title})} placeholder="What should students know?"/>
  <ToolField label="Description" value={draft.description} maxLength={5000} multiline editable={!busy} onChangeText={description=>update({description})} placeholder="Add the useful details"/>
  {draft.kind!=='OPPORTUNITY'?<ToolField label="Venue" value={draft.venue} editable={!busy} onChangeText={venue=>update({venue})} placeholder="Where is it happening?"/>:null}
  <ActivityDatePicker label={draft.kind==='OPPORTUNITY'?'Application deadline':'Date'} value={draft.date} disabled={busy} onChange={date=>update({date})}/>{draft.kind!=='OPPORTUNITY'?<ActivityDatePicker label="Start time" mode="time" value={draft.time} disabled={busy} onChange={time=>update({time})}/>:null}
  <ToolField label={draft.kind==='OPPORTUNITY'?'Application link':'Registration link (optional)'} value={draft.link} editable={!busy} autoCapitalize="none" keyboardType="url" onChangeText={link=>update({link})} placeholder="https://…"/>
  <Text style={{fontFamily:theme.font.medium,color:theme.text}}>Photos · {draft.images.length}/5</Text>
  <View style={{flexDirection:'row',flexWrap:'wrap',gap:10}}>{draft.images.map(image=><View key={image.id} style={{width:96,height:96}}><Image source={{uri:image.url}} style={{width:96,height:96,borderRadius:12}}/><Pressable accessibilityRole="button" accessibilityLabel="Remove photo" disabled={busy} onPress={()=>update({images:draft.images.filter(item=>item.id!==image.id)})} style={{position:'absolute',right:0,top:0,padding:9,backgroundColor:theme.surface,borderRadius:18}}><Ionicons name="close" size={18} color={theme.text}/></Pressable></View>)}</View>
  <ToolButton secondary disabled={uploading||busy||draft.images.length>=5} label={uploading?'Uploading photo…':'Add a photo'} onPress={()=>void photo()}/>
  {error?<Text accessibilityRole="alert" style={{fontFamily:theme.font.body,color:theme.error,lineHeight:21}}>{error}</Text>:null}
  <ToolButton disabled={!ready||busy||uploading||!draft.title.trim()||!draft.description.trim()} label={busy?'Publishing…':'Publish update'} onPress={()=>void publish()}/>
 </View></ToolPage>;
}
