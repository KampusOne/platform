import {useCallback,useEffect,useRef,useState} from 'react';
import {Pressable,Text,View} from 'react-native';
import {router,useFocusEffect} from 'expo-router';
import {randomUUID} from 'expo-crypto';
import {ToolButton,ToolField,ToolPage,ToolRow} from '@/src/components/toolkit';
import {EmptyResult} from '@/src/components/product-ui';
import {ScreenSkeleton} from '@/src/components/skeleton';
import {useAppearance} from '@/src/lib/appearance';
import {api} from '@/src/lib/api';
type Community={id:string;name:string;kind:'CLASS'|'COMMUNITY'|'STUDY_GROUP';description?:string;keywords?:string[];level_code:string;members:number;joined_at:string|null;archived_at:string|null};
export default function Communities(){
 const {theme}=useAppearance();const [rows,setRows]=useState<Community[]>([]),[query,setQuery]=useState(''),[search,setSearch]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[filter,setFilter]=useState('All'),[create,setCreate]=useState(false),[kind,setKind]=useState<'COMMUNITY'|'STUDY_GROUP'>('COMMUNITY'),[name,setName]=useState(''),[description,setDescription]=useState(''),[keywords,setKeywords]=useState(''),[busy,setBusy]=useState(false);const generation=useRef(0),requestId=useRef(randomUUID());
 useEffect(()=>{const timer=setTimeout(()=>setSearch(query.trim()),250);return()=>clearTimeout(timer);},[query]);
 const load=useCallback(async()=>{const token=++generation.current;setError('');try{const r=await api<{rows:Community[]}>('/v1/communities?q='+encodeURIComponent(search));if(token===generation.current)setRows(r.rows??[]);}catch(e){if(token===generation.current)setError(e instanceof Error?e.message:'Could not load communities.');}finally{if(token===generation.current)setLoading(false);}},[search]);
 useFocusEffect(useCallback(()=>{void load();return()=>{generation.current++;};},[load]));
 const text={fontFamily:theme.font.body,color:theme.text,fontSize:14,lineHeight:22};
 const choices=(values:string[],value:string,onChange:(v:string)=>void)=><View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginVertical:12}}>{values.map(item=><Pressable key={item} accessibilityRole="button" accessibilityState={{selected:value===item}} onPress={()=>onChange(item)} style={{paddingHorizontal:14,minHeight:44,justifyContent:'center',borderRadius:12,borderWidth:1,borderColor:value===item?theme.deepBrand:theme.border,backgroundColor:value===item?theme.surfaceTint:theme.surface}}><Text style={text}>{item}</Text></Pressable>)}</View>;
 async function save(){if(busy)return;setBusy(true);setError('');try{const r=await api<{group:{id:string;kind:string}}>('/v1/communities/groups',{method:'POST',body:JSON.stringify({name,description,kind,keywords:keywords.split(',').map(v=>v.trim()).filter(Boolean).slice(0,12),requestId:requestId.current})});setCreate(false);router.push({pathname:'/community',params:{id:r.group.id,kind:r.group.kind}});}catch(e){setError(e instanceof Error?e.message:'Could not create your group.');}finally{setBusy(false);}}
 const visible=rows.filter(row=>filter==='All'||(filter==='Joined'?!!row.joined_at:filter==='Study groups'?row.kind==='STUDY_GROUP':row.kind!=='STUDY_GROUP'));
 return <ToolPage title="Communities" action={<Pressable accessibilityRole="button" accessibilityLabel="Create community or study group" onPress={()=>{requestId.current=randomUUID();setCreate(v=>!v);setError('');}} style={{minHeight:44,justifyContent:'center',paddingHorizontal:8}}><Text style={[text,{color:theme.deepBrand,fontFamily:theme.font.semibold}]}>{create?'Cancel':'Create'}</Text></Pressable>} onRefresh={()=>void load()}>
 <Text style={[text,{color:theme.textMuted}]}>Keep up with your class, follow a community or study together.</Text>
 {create?<View style={{marginVertical:18,padding:18,borderWidth:1,borderColor:theme.border,borderRadius:18,backgroundColor:theme.surface}}>
 {choices(['Community','Study group'],kind==='COMMUNITY'?'Community':'Study group',value=>{setKind(value==='Community'?'COMMUNITY':'STUDY_GROUP');requestId.current=randomUUID();})}
 <Text style={[text,{color:theme.textMuted,marginBottom:14}]}>{kind==='COMMUNITY'?'Admins publish updates. Members can follow, comment and vote.':'Every member can post. Posts and study insights stay within the group.'}</Text>
 <ToolField label="Name" value={name} maxLength={100} onChangeText={v=>{setName(v);requestId.current=randomUUID();}} placeholder="e.g. CPE 250 study circle"/>
 <ToolField label="Description" value={description} maxLength={1000} onChangeText={v=>{setDescription(v);requestId.current=randomUUID();}} multiline placeholder="What is this group for?"/>
 <ToolField label="Search keywords" value={keywords} maxLength={450} onChangeText={v=>{setKeywords(v);requestId.current=randomUUID();}} placeholder="Computer education, CPE250, 2025 set"/>
 <ToolButton label={busy?'Creating…':'Create '+(kind==='COMMUNITY'?'community':'study group')} disabled={busy||name.trim().length<3} onPress={()=>void save()}/>
 </View>:null}
 <ToolField label="Find a community" placeholder="Name, department, set or keyword" value={query} onChangeText={setQuery}/>
 {choices(['All','Joined','Communities','Study groups'],filter,setFilter)}
 {search&&visible.length?<Text style={[text,{color:theme.textMuted,marginBottom:12}]}>Suggestions for “{search}”</Text>:null}
 {error?<View style={{padding:14,backgroundColor:theme.surfaceMuted,borderRadius:12,marginVertical:12}}><Text accessibilityRole="alert" style={[text,{color:theme.error}]}>{error}</Text>{!create?<ToolButton label="Try again" secondary onPress={()=>void load()}/>:null}</View>:null}
 {loading?<ScreenSkeleton/>:visible.length?visible.map(c=><ToolRow key={c.id} title={c.name} detail={`${c.members} members · ${c.kind==='STUDY_GROUP'?'Study group':c.kind==='CLASS'?'Class community':'Community'}${c.joined_at?' · Joined':''}${c.keywords?.length?'\n'+c.keywords.slice(0,4).join(' · '):''}`} icon={c.kind==='STUDY_GROUP'?'book-outline':'people-outline'} onPress={()=>router.push({pathname:'/community',params:{id:c.id,...(c.kind!=='CLASS'?{kind:c.kind}:{})}})}/>):<EmptyResult title={search?'No matching communities':'No communities yet'} body={search?'Try a different name or keyword.':'Create a community or a study group to get started.'}/>}
 </ToolPage>;
}
