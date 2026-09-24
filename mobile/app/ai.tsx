import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/src/auth/auth-context";
import { useAppearance } from "@/src/lib/appearance";
import { api, ApiError, clearApiCache } from "@/src/lib/api";
import { readCache, writeCache } from "@/src/lib/device-cache";
import { pickAttachment, uploadAttachment, type StagedAttachment } from "@/src/lib/uploads";
import { AttachmentPreview } from "@/src/components/attachment-preview";
import { StudyAnswer } from "@/src/components/study-answer";
import { AIEdgeGlow } from "@/src/components/ai-edge-glow";
import { SkeletonBlock, ListSkeleton } from "@/src/components/skeleton";
import { useToast } from "@/src/components/toast";
import { syncAlarms, type Alarm } from "@/src/lib/alarms";

type Mode="study"|"summary"|"notes"|"quiz";
type Tier="standard"|"pro";
type Card={id:string;kind:"product"|"tutor";title:string;subtitle:string;path:string};
type Action={id:string;type:"timetable";entry:{title:string;courseCode?:string;venue?:string;dayOfWeek:number;date?:string;startsAt:string;endsAt:string};confirmed?:boolean};
type Turn={requestId:string;text:string;prompt?:string;fileName?:string;mediaId?:string;file?:StagedAttachment;mode?:Mode;cards?:Card[];actions?:Action[]};
type Draft={prompt:string;mode:Mode;tier:Tier;attachment?:StagedAttachment;replyTo?:string;key:string};
type Status={enabled:boolean;capabilities:{text:boolean;images:boolean;documents:boolean};tier:Tier;study:{limit:number;remaining:number|null};subscription:{checkoutEnabled:boolean}};
type SavedWork={id:string;title:string;mode:Mode;created_at:string};
const days=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const suggestions=[{icon:"book-outline" as const,label:"Explain a topic",prompt:"Help me understand "},{icon:"calendar-outline" as const,label:"Plan my classes",prompt:"Help me add a class to my timetable."},{icon:"people-outline" as const,label:"Find a tutor",prompt:"Help me find a tutor for "}];

export default function StudentAI() {
  const {mode:initial}=useLocalSearchParams<{mode?:string}>();
  const {user,profile}=useAuth();const {theme}=useAppearance();const toast=useToast();
  const [workspace,setWorkspace]=useState<"ask"|"study">(initial && initial!=="study"?"study":"ask");
  const [mode,setMode]=useState<Mode>(initial==="notes"?"notes":initial==="summary"?"summary":"study");
  const [tier,setTier]=useState<Tier>("standard");
  const [prompt,setPrompt]=useState("");const [attachment,setAttachment]=useState<StagedAttachment>();
  const [turns,setTurns]=useState<Turn[]>([]);const [replyTo,setReplyTo]=useState<string>();
  const [pending,setPending]=useState<{prompt:string;file?:StagedAttachment}>();
  const [busy,setBusy]=useState(false);const [uploading,setUploading]=useState(false);const [loaded,setLoaded]=useState(false);
  const [error,setError]=useState("");const [status,setStatus]=useState<Status>();
  const [limit,setLimit]=useState<{resetsAt?:string;upgrade?:boolean}>();const [now,setNow]=useState(Date.now());
  const [sheet,setSheet]=useState<"history"|"plans"|"info"|null>(null);const [history,setHistory]=useState<SavedWork[]>([]);
  const [historyBusy,setHistoryBusy]=useState(false);const [historyError,setHistoryError]=useState("");const [search,setSearch]=useState("");
  const [nextOffset,setNextOffset]=useState<number|null>(null);const [historyQuery,setHistoryQuery]=useState("");
  const [deleteId,setDeleteId]=useState<string>();const [confirming,setConfirming]=useState<string>();
  const [preview,setPreview]=useState<{uri:string;name:string}>();
  const key=useRef(randomUUID()),lock=useRef(false),scroll=useRef<ScrollView>(null);
  const owner=useRef(user?.id);owner.current=user?.id;
  const generation=useRef(0),alive=useRef(true),draftOwner=useRef<string | undefined>(undefined);
  const text={color:theme.text,fontFamily:theme.font.body,fontSize:15,lineHeight:24};
  const muted={color:theme.textMuted,fontFamily:theme.font.body,fontSize:12,lineHeight:18};
  // Keep the AI composer border clean on Expo web; focus remains available to assistive technology.
  const webInputStyle=Platform.OS==='web'?({outlineStyle:'none',outlineWidth:0,outlineColor:'transparent',boxShadow:'none',WebkitTapHighlightColor:'transparent'} as any):undefined;
  const storageKey=`ai-workspace-v3.${user?.id}.${workspace}`;
  const valid=()=>alive.current;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
  const loadStatus=useCallback(async()=>{const account=owner.current;try{const result=await api<Status>("/v1/ai/status");if(valid() && owner.current===account)setStatus(result);}catch{if(valid() && owner.current===account)setStatus(undefined);}},[]);
  const restoreThread=useCallback(async(id:string,version:number)=>{
    const result=await api<{turns:Turn[]}>(`/v1/ai/thread/${id}`);
    if(valid() && version===generation.current)setTurns(result.turns);
    return result;
  },[]);
  useEffect(()=>{
    const version=++generation.current;const account=user?.id;draftOwner.current=account;
    setHistory([]);setSheet(null);setPreview(undefined);setDeleteId(undefined);setHistoryError("");setSearch("");setNextOffset(null);setLoaded(false);setTurns([]);setPrompt("");setAttachment(undefined);setReplyTo(undefined);setPending(undefined);setError("");setLimit(undefined);setBusy(false);lock.current=false;key.current=randomUUID();setTier("standard");setStatus(undefined);
    setMode(workspace==='ask'?'study':initial==='notes'?'notes':'summary');
    if(!account)return;
    void (async()=>{
      const draft=await readCache<Draft>(storageKey);
      if(!valid() || version!==generation.current)return;
      if(draft){setPrompt(draft.prompt??"");setMode(workspace==='ask'?'study':draft.mode==='notes'?'notes':'summary');setAttachment(draft.attachment);setReplyTo(draft.replyTo);key.current=draft.key||randomUUID();
        if(draft.replyTo)try{await restoreThread(draft.replyTo,version);}catch{if(valid()&&version===generation.current){setReplyTo(undefined);setError("Your previous conversation could not be restored. Your draft is kept; open History to try again.");key.current=randomUUID();}}
      }
      if(valid()&&version===generation.current)setLoaded(true);
    })();
    void loadStatus();
  },[user?.id,workspace,storageKey,loadStatus,restoreThread]);
  useEffect(()=>{
    if(!loaded||busy||!user?.id||draftOwner.current!==user.id)return;
    const timer=setTimeout(()=>{
      // Private signed links and image bytes are never persisted. An uploaded file
      // is re-opened through the permission-checked media endpoint when required.
      const savedAttachment=attachment?{name:attachment.name,type:attachment.type,...(attachment.size!==undefined?{size:attachment.size}:{}),...(attachment.mediaId?{mediaId:attachment.mediaId}:{})}:undefined;
      void writeCache(storageKey,{prompt,mode,tier,attachment:savedAttachment,replyTo,key:key.current});
    },250);return()=>clearTimeout(timer);
  },[prompt,attachment,mode,tier,replyTo,loaded,busy,user?.id,storageKey]);
  useEffect(()=>{if(!limit?.resetsAt)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[limit?.resetsAt]);
  useEffect(()=>{if(limit?.resetsAt && now>=Date.parse(limit.resetsAt)){setLimit(undefined);setError("");void loadStatus();}},[limit,now,loadStatus]);
  function changePrompt(value:string){setPrompt(value);key.current=randomUUID();setError("");}
  function newConversation(){if(lock.current)return;setTurns([]);setReplyTo(undefined);setPrompt("");setAttachment(undefined);setError("");key.current=randomUUID();}
  async function attach(){if(lock.current)return;const version=generation.current;try{const file=await pickAttachment();if(file && valid()&&version===generation.current){setAttachment(file);setError("");key.current=randomUUID();}}catch(e){if(valid()&&version===generation.current)setError(e instanceof Error?e.message:"This file could not be attached.");}}
  async function openFile(file:StagedAttachment){const version=generation.current;try{let uri=file.uri;if(!uri&&file.mediaId)uri=(await api<{url:string}>(`/v1/media/${file.mediaId}/access`,{method:"POST"})).url;if(!uri)throw new Error("Reattach this file to preview it.");if(!valid()||version!==generation.current)return;if(file.type.startsWith('image/'))setPreview({uri,name:file.name});else await Linking.openURL(uri);}catch(e){if(valid()&&version===generation.current)toast(e instanceof Error?e.message:"Could not open this file.","error");}}
  async function send(){
    if(lock.current||!loaded||(!prompt.trim()&&!attachment))return;
    const version=generation.current;const question=prompt.trim();let file=attachment;
    lock.current=true;setBusy(true);setError("");setLimit(undefined);
    try{
      if(file){setUploading(true);file=await uploadAttachment(file);if(!valid()||version!==generation.current)return;setAttachment(file);setUploading(false);}
      const savedFile=file?{name:file.name,type:file.type,...(file.mediaId?{mediaId:file.mediaId}:{})}:undefined;
      await writeCache(storageKey,{prompt:question,mode,tier,attachment:savedFile,replyTo,key:key.current});
      if(!valid()||version!==generation.current)return;
      setPending({prompt:question,...(file?{file}:{})});setPrompt("");setAttachment(undefined);
      const result=await api<Turn>("/v1/ai",{method:"POST",signal:AbortSignal.timeout(75000),body:JSON.stringify({mode,prompt:question,mediaId:file?.mediaId,replyTo,tier,idempotencyKey:key.current,consent:true})});
      if(!valid()||version!==generation.current)return;
      setTurns(current=>[...current.filter(t=>t.requestId!==result.requestId),{...result,prompt:question,...(file?{file}:{})}]);setReplyTo(result.requestId);key.current=randomUUID();
      void loadStatus();
    }catch(e){
      if(!valid()||version!==generation.current)return;
      setPrompt(question);setAttachment(file);setError(e instanceof Error?e.message:"The answer could not load. Your draft is kept.");
      if(e instanceof ApiError){if(e.details?.retryWithNewKey===true)key.current=randomUUID();if(e.status===429||e.details?.upgrade){setLimit({...(typeof e.details?.resetsAt==='string'?{resetsAt:e.details.resetsAt}:{}),upgrade:e.details?.upgrade===true});}}
      void loadStatus();
    }finally{if(valid()&&version===generation.current){lock.current=false;setBusy(false);setUploading(false);setPending(undefined);}}
  }
  async function loadHistory(query=search,offset=0){const version=generation.current;setHistoryBusy(true);setHistoryError("");try{const data=await api<{sessions:SavedWork[];nextOffset:number|null}>(`/v1/ai/history?q=${encodeURIComponent(query)}&offset=${offset}`);if(!valid()||version!==generation.current)return;setHistory(current=>offset?[...current,...data.sessions.filter(s=>!current.some(c=>c.id===s.id))]:data.sessions);setNextOffset(data.nextOffset);setHistoryQuery(query);}catch(e){if(valid()&&version===generation.current)setHistoryError(e instanceof Error?e.message:"History could not load.");}finally{if(valid()&&version===generation.current)setHistoryBusy(false);}}
  async function openHistory(item:SavedWork){if(lock.current)return;lock.current=true;const version=generation.current;setHistoryBusy(true);try{const data=await restoreThread(item.id,version);if(!valid()||version!==generation.current)return;const last=data.turns.at(-1);if(!last)throw new Error("This conversation is no longer available.");
    const target=item.mode==='study'?'ask':'study';
    if(target!==workspace){await writeCache(`ai-workspace-v3.${user?.id}.${target}`,{prompt:"",mode:item.mode,tier:"standard",replyTo:last.requestId,key:randomUUID()});setWorkspace(target);}else{setReplyTo(last.requestId);setPrompt("");setAttachment(undefined);setMode(item.mode);key.current=randomUUID();}
    setSheet(null);setError("");
  }catch(e){if(valid()&&version===generation.current)setHistoryError(e instanceof Error?e.message:"Could not open this conversation.");}finally{lock.current=false;if(valid()&&version===generation.current)setHistoryBusy(false);}}
  async function removeHistory(id:string){const version=generation.current;setHistoryBusy(true);try{await api(`/v1/ai/history/${id}`,{method:'DELETE'});if(!valid()||version!==generation.current)return;setHistory(rows=>rows.filter(row=>row.id!==id));setTurns(rows=>rows.filter(row=>row.requestId!==id));if(replyTo===id){setReplyTo(undefined);key.current=randomUUID();}setDeleteId(undefined);}catch(e){if(valid()&&version===generation.current)setHistoryError(e instanceof Error?e.message:'Could not delete this answer.');}finally{if(valid()&&version===generation.current)setHistoryBusy(false);}}
  async function confirm(turn:Turn,action:Action){if(confirming)return;const version=generation.current;setConfirming(action.id);try{await api('/v1/ai/actions/confirm',{method:'POST',body:JSON.stringify({requestId:turn.requestId,actionId:action.id})});if(!valid()||version!==generation.current)return;clearApiCache();setTurns(rows=>rows.map(row=>row.requestId===turn.requestId?{...row,actions:row.actions?.map(a=>a.id===action.id?{...a,confirmed:true}:a)??[]}:row));toast('Added to your timetable','success');try{const result=await api<{alarms:Alarm[]}>('/v1/learning/alarms');if(valid()&&version===generation.current)await syncAlarms(result.alarms,true);}catch{if(valid()&&version===generation.current)toast('Class saved. Check device reminders in Alarms.');}}catch(e){if(valid()&&version===generation.current)toast(e instanceof Error?e.message:'The class was not added.','error');}finally{if(valid()&&version===generation.current)setConfirming(undefined);}}
  async function copy(answer:string){try{if(Platform.OS==='web'&&typeof navigator!=='undefined'&&navigator.clipboard){await navigator.clipboard.writeText(answer);toast('Copied','success');}else await Share.share({message:answer});}catch{toast('Select the answer text to copy it.');}}
  const smallButton=(label:string,onPress:()=>void,disabled=false)=><Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={{paddingVertical:10,paddingHorizontal:12,opacity:disabled?0.5:1}}><Text style={{...muted,color:theme.brand,fontFamily:theme.font.semibold}}>{label}</Text></Pressable>;
  const iconButton=(name:ComponentProps<typeof Ionicons>['name'],label:string,onPress:()=>void,disabled=false)=><Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={{minHeight:44,minWidth:44,alignItems:'center',justifyContent:'center',opacity:disabled?0.4:1}}><Ionicons name={name} size={22} color={theme.text}/></Pressable>;
  const renderUser=(question:string,file?:StagedAttachment)=><View style={{alignSelf:'flex-end',maxWidth:'90%',marginTop:22,marginBottom:18}}>{file?<AttachmentPreview file={file} onOpen={()=>void openFile(file)}/>:null}{question?<View style={{backgroundColor:theme.sand,borderRadius:19,borderBottomRightRadius:5,paddingHorizontal:16,paddingVertical:12}}><Text selectable style={text}>{question}</Text></View>:null}</View>;
  return <SafeAreaView edges={['top','bottom']} style={{flex:1,backgroundColor:theme.canvas}}>
    <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={{flex:1,width:'100%',maxWidth:760,alignSelf:'center'}}>
      <View style={{flexDirection:'row',alignItems:'center',paddingHorizontal:12,paddingVertical:4,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.border}}>
        {iconButton('arrow-back','Go back',()=>router.canGoBack()?router.back():router.replace('/explore'))}
        <Text style={{color:theme.text,fontFamily:theme.font.display,fontSize:21,flex:1}}>{workspace==='ask'?'Ask':'Study'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`AI plan: ${tier==='pro'?'Pro':'Standard'}`} onPress={()=>setSheet('plans')} disabled={busy} style={{flexDirection:'row',alignItems:'center',padding:12,gap:5}}><Text style={{...muted,color:theme.text}}>{tier==='pro'?'Pro':'Standard'}</Text><Ionicons name="chevron-down" size={14} color={theme.textMuted}/></Pressable>
        {iconButton('time-outline','Conversation history',()=>{setSheet('history');void loadHistory('',0);},busy)}
        {iconButton('create-outline','New conversation',newConversation,busy)}
      </View>
      <View style={{flexDirection:'row',paddingHorizontal:24,gap:26}}>{(['ask','study'] as const).map(value=><Pressable key={value} accessibilityRole="tab" accessibilityState={{selected:workspace===value,disabled:busy}} disabled={busy} onPress={()=>setWorkspace(value)} style={{paddingVertical:14,borderBottomWidth:2,borderBottomColor:workspace===value?theme.brand:'transparent'}}><Text style={{...text,fontFamily:workspace===value?theme.font.semibold:theme.font.body,color:workspace===value?theme.text:theme.textMuted}}>{value==='ask'?'Ask':'Summary & Notes'}</Text></Pressable>)}</View>
      {workspace==='study'?<View style={{flexDirection:'row',alignItems:'center',paddingHorizontal:16,paddingTop:8}}>{(['summary','notes'] as const).map(value=><Pressable key={value} accessibilityRole="radio" accessibilityState={{checked:mode===value}} disabled={busy} onPress={()=>{setMode(value);key.current=randomUUID();}} style={{paddingVertical:9,paddingHorizontal:13,backgroundColor:mode===value?theme.surfaceMuted:'transparent',borderRadius:8}}><Text style={{...muted,color:theme.text}}>{value==='summary'?'Summary':'Notes'}</Text></Pressable>)}<View style={{flex:1}}/>{status?.study.remaining!==null&&status?.study.remaining!==undefined?<Text style={muted}>{status.study.remaining} free studies left</Text>:null}</View>:null}
      <ScrollView ref={scroll} style={{flex:1}} contentContainerStyle={{flexGrow:1,paddingHorizontal:24,paddingBottom:16}} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" onContentSizeChange={()=>{if(pending)scroll.current?.scrollToEnd({animated:false});}}>
        {!loaded||draftOwner.current!==user?.id?<View style={{gap:16,paddingTop:40}}><SkeletonBlock width="55%" height={30}/><SkeletonBlock width="80%"/><ListSkeleton count={2}/></View>:null}
        {loaded&&draftOwner.current===user?.id&&!turns.length&&!pending?<View style={{flex:1,justifyContent:'center',paddingVertical:35}}>
          <Text style={{...muted,fontSize:15,marginBottom:10}}>Hi, {profile?.first_name || 'there'}.</Text>
          <Text style={{color:theme.text,fontFamily:theme.font.display,fontSize:34,lineHeight:41,maxWidth:430}}>{workspace==='ask'?'What are we\nworking on?':'Make it easier\nto understand.'}</Text>
          <Text style={{...muted,fontSize:14,lineHeight:22,marginTop:15,maxWidth:410}}>{workspace==='ask'?'Ask a question, plan a class, or find help on campus.':'Add your material. Get a detailed summary or organised revision notes.'}</Text>
          {workspace==='ask'?<View style={{marginTop:30,gap:3}}>{suggestions.map(s=><Pressable key={s.label} accessibilityRole="button" onPress={()=>changePrompt(s.prompt)} style={{flexDirection:'row',gap:12,alignItems:'center',paddingVertical:13}}><Ionicons name={s.icon} size={20} color={theme.brand}/><Text style={{...text,fontSize:14}}>{s.label}</Text><Ionicons name="arrow-up-outline" size={16} color={theme.textFaint} style={{transform:[{rotate:'45deg'}]}}/></Pressable>)}</View>:null}
        </View>:null}
        {loaded&&draftOwner.current===user?.id?turns.map(turn=>{
          const file=turn.file ?? (turn.fileName?{name:turn.fileName,type:/\.(png|jpe?g|webp)$/i.test(turn.fileName)?'image/jpeg':'application/pdf',...(turn.mediaId?{mediaId:turn.mediaId}:{})}:undefined);
          return <View key={turn.requestId}>{renderUser(turn.prompt??'',file)}<StudyAnswer value={turn.text}/>
            {turn.cards?.map(card=><Pressable key={card.id} accessibilityRole="button" onPress={()=>{if(/^\/student-service\?(id|product)=[0-9a-f-]{36}$/i.test(card.path))router.push(card.path as never);}} style={{marginTop:12,padding:16,borderWidth:1,borderColor:theme.border,borderRadius:13,backgroundColor:theme.surface,flexDirection:'row',alignItems:'center',gap:12}}><Ionicons name={card.kind==='tutor'?'person-outline':'bag-outline'} size={23} color={theme.brand}/><View style={{flex:1}}><Text style={{...text,fontFamily:theme.font.semibold,fontSize:14}}>{card.title}</Text><Text style={muted}>{card.subtitle}</Text></View><Ionicons name="chevron-forward" size={17} color={theme.textMuted}/></Pressable>)}
            {turn.actions?.map(action=><View key={action.id} style={{marginTop:14,padding:17,borderWidth:1,borderColor:theme.border,borderRadius:14,backgroundColor:theme.surface}}><Text style={{...text,fontFamily:theme.font.semibold}}>{action.entry.courseCode || action.entry.title}</Text><Text style={muted}>{action.entry.date || `Every ${days[action.entry.dayOfWeek]}`} · {action.entry.startsAt}–{action.entry.endsAt}{action.entry.venue?`\n${action.entry.venue}`:''}</Text>{smallButton(action.confirmed?'Added to timetable':confirming===action.id?'Adding…':'Add to timetable',()=>void confirm(turn,action),Boolean(confirming)||action.confirmed===true)}</View>)}
            <View style={{alignSelf:'flex-start',marginTop:7}}>{iconButton('copy-outline','Copy answer',()=>void copy(turn.text))}</View>
          </View>;
        }):null}
        {pending?<View>{renderUser(pending.prompt,pending.file)}<View accessibilityRole="text" accessibilityLabel="KampusOne is working" accessibilityLiveRegion="polite" style={{gap:10,marginTop:8}}><Text style={muted}>Working on it…</Text><SkeletonBlock width="76%"/><SkeletonBlock width="56%"/></View></View>:null}
      </ScrollView>
      <View style={{paddingHorizontal:16,paddingTop:8,paddingBottom:6}}>
        {error?<View accessibilityRole="alert" style={{padding:12,marginBottom:10,backgroundColor:theme.surfaceMuted,borderRadius:10}}><Text style={{...muted,color:theme.text}}>{error}{limit?.resetsAt?` Try again at ${new Date(limit.resetsAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}.`:''}</Text>{limit?.upgrade?smallButton('View Pro',()=>setSheet('plans')):null}</View>:null}
        {status&&!status.enabled?<Text style={{...muted,marginBottom:8}}>AI is temporarily unavailable. Your draft and saved conversations are kept.</Text>:null}
        {!status&&loaded?smallButton('Check AI availability',()=>void loadStatus(),busy):null}
        {attachment?<AttachmentPreview file={attachment} uploading={uploading} onRemove={()=>{setAttachment(undefined);key.current=randomUUID();}} onOpen={()=>void openFile(attachment)}/>:null}
        <View style={{borderWidth:1,borderColor:theme.border,borderRadius:22,backgroundColor:theme.surface,paddingHorizontal:9,paddingTop:12,paddingBottom:5}}>
          <TextInput accessibilityLabel="Message KampusOne AI" value={prompt} onChangeText={changePrompt} editable={loaded&&!busy} placeholder={workspace==='ask'?'Ask KampusOne…':'Add instructions or paste your material…'} placeholderTextColor={theme.textMuted} multiline maxLength={20000} textAlignVertical="top" style={[{color:theme.text,fontFamily:theme.font.body,fontSize:16,lineHeight:23,minHeight:43,maxHeight:150,paddingHorizontal:7,paddingBottom:8},webInputStyle]}/>
          <View style={{flexDirection:'row',alignItems:'center'}}>{iconButton('add','Attach image or document',()=>void attach(),busy||!loaded)}{iconButton('information-circle-outline','AI privacy and help',()=>setSheet('info'))}<View style={{flex:1}}/>
            <Pressable accessibilityRole="button" accessibilityLabel={busy?'AI is working':'Send message'} accessibilityState={{disabled:busy||!loaded||Boolean(limit)||(!prompt.trim()&&!attachment),busy}} disabled={busy||!loaded||Boolean(limit)||(!prompt.trim()&&!attachment)} onPress={()=>void send()} style={{width:42,height:42,borderRadius:21,alignItems:'center',justifyContent:'center',backgroundColor:theme.deepBrand,opacity:busy||(!prompt.trim()&&!attachment)?0.5:1}}><Ionicons name="arrow-up" size={24} color="#FFFFFF"/></Pressable>
          </View>
        </View>
        <Text style={{...muted,fontSize:10,textAlign:'center',marginTop:7}}>AI can make mistakes. Check important details.</Text>
      </View>
    </KeyboardAvoidingView>
    <AIEdgeGlow active={busy}/>
    <Modal visible={sheet!==null} transparent animationType="fade" onRequestClose={()=>setSheet(null)}>
      <View style={{flex:1,justifyContent:'flex-end',backgroundColor:'rgba(0,0,0,0.35)'}}><Pressable accessibilityLabel="Close panel" accessibilityRole="button" onPress={()=>setSheet(null)} style={{flex:1}}/>
        <SafeAreaView edges={['bottom']} style={{backgroundColor:theme.canvas,borderTopLeftRadius:24,borderTopRightRadius:24,width:'100%',maxWidth:760,alignSelf:'center',maxHeight:'82%',padding:22}}>
          <View style={{flexDirection:'row',alignItems:'center',marginBottom:12}}><Text style={{color:theme.text,fontFamily:theme.font.display,fontSize:25,flex:1}}>{sheet==='history'?'History':sheet==='plans'?'Choose your plan':'About your AI'}</Text>{iconButton('close','Close panel',()=>setSheet(null))}</View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {sheet==='plans'?<View><Pressable accessibilityRole="radio" accessibilityState={{checked:tier==='standard'}} onPress={()=>{setTier('standard');key.current=randomUUID();setSheet(null);}} style={{padding:18,borderRadius:14,borderWidth:1,borderColor:theme.border,marginBottom:12}}><Text style={{...text,fontFamily:theme.font.semibold}}>Standard</Text><Text style={muted}>Everyday questions and five shared Summary / Notes trials.</Text></Pressable>
              <View style={{padding:18,borderRadius:14,borderWidth:1,borderColor:theme.brand,marginBottom:16}}><Text style={{...text,fontFamily:theme.font.semibold}}>Pro · Monthly</Text><Text style={{...muted,marginTop:5}}>More room for learning, longer study use and an upgraded AI option.</Text>{status?.tier==='pro'?smallButton('Use Pro',()=>{setTier('pro');key.current=randomUUID();setSheet(null);}):<Text style={{...muted,marginTop:16,color:theme.brand}}>Subscriptions are not open yet. No payment will be taken.</Text>}</View>
            </View>:null}
            {sheet==='info'?<View style={{gap:15}}><Text style={text}>Your chats are private to your account and saved for 90 days. You can remove saved answers from History.</Text><Text style={text}>Questions and attachments are processed by external AI services. Do not include passwords, payment details or other people's confidential information.</Text><Text style={text}>Ask can read your timetable and find published campus services. Timetable changes require you to review a class card and tap Add. It cannot manage accounts or perform admin actions.</Text><Text style={text}>Attach one image, PDF or text file per message, up to 8 MB. Text PDFs support up to 40 pages within the text limit. For scanned PDFs, attach the relevant page as an image.</Text></View>:null}
            {sheet==='history'?<View>
              <View style={{flexDirection:'row',alignItems:'center',marginBottom:10,borderWidth:1,borderColor:theme.border,borderRadius:12,paddingLeft:12}}><TextInput accessibilityLabel="Search conversations" value={search} onChangeText={setSearch} placeholder="Search saved work" placeholderTextColor={theme.textMuted} style={{...text,flex:1,paddingVertical:11}} onSubmitEditing={()=>void loadHistory(search,0)}/>{smallButton('Search',()=>void loadHistory(search,0),historyBusy)}</View>
              {historyError?<Text accessibilityRole="alert" style={muted}>{historyError}</Text>:null}{historyBusy?<ListSkeleton count={3}/>:null}
              {!historyBusy&&!history.length?<Text style={{...muted,paddingVertical:24}}>No saved conversations yet.</Text>:null}
              {history.map(item=><View key={item.id} style={{borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.border,paddingVertical:12}}><View style={{flexDirection:'row',alignItems:'center'}}><Pressable accessibilityRole="button" disabled={historyBusy} onPress={()=>void openHistory(item)} style={{flex:1,paddingVertical:5}}><Text numberOfLines={2} style={text}>{item.title}</Text><Text style={muted}>{item.mode==='study'?'Ask':item.mode==='summary'?'Summary':'Notes'} · {new Date(item.created_at).toLocaleDateString()}</Text></Pressable>{iconButton('trash-outline','Delete saved answer',()=>setDeleteId(item.id),historyBusy)}</View>{deleteId===item.id?<View><Text style={muted}>Delete this answer? This cannot be undone and does not reset study trials.</Text><View style={{flexDirection:'row'}}>{smallButton('Delete',()=>void removeHistory(item.id),historyBusy)}{smallButton('Cancel',()=>setDeleteId(undefined),historyBusy)}</View></View>:null}</View>)}
              {nextOffset!==null?smallButton('Load older work',()=>void loadHistory(historyQuery,nextOffset),historyBusy):null}
            </View>:null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
    <Modal visible={Boolean(preview)} animationType="fade" onRequestClose={()=>setPreview(undefined)}><SafeAreaView style={{flex:1,backgroundColor:theme.canvas}}><View style={{flexDirection:'row',alignItems:'center',padding:14}}><Text numberOfLines={1} style={{...text,flex:1}}>{preview?.name}</Text>{iconButton('close','Close image',()=>setPreview(undefined))}</View>{preview?<Image source={{uri:preview.uri}} resizeMode="contain" style={{flex:1,width:'100%'}}/>:null}</SafeAreaView></Modal>
  </SafeAreaView>;
}
