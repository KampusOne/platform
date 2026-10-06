import { isPlayDistribution } from "@/src/lib/digital-billing-policy";
import {sharedLink} from '@/src/lib/shared-links';
import {shareContent} from '@/src/lib/share-content';
import * as Clipboard from "expo-clipboard";
import { KiraVoiceInput } from "@/src/components/kira-voice-input";
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams,useFocusEffect } from "expo-router";
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
import { requestKiraResult } from "@/src/lib/kira-request";

type Mode="study"|"summary"|"explanation"|"notes"|"quiz";
type Tier="standard"|"pro";
type Card={id:string;kind:"product"|"vendor"|"tutor"|"video";title:string;subtitle:string;path:string;thumbnail?:string;description?:string;source?:string};
type ActionState={id:string;confirmed?:boolean;undone?:boolean};
type Action=
  | (ActionState&{type:"timetable";entry:{title:string;courseCode?:string;venue?:string;dayOfWeek:number;date?:string;startsAt:string;endsAt:string};operation?:"update";entryId?:string})
  | (ActionState&{type:"alarm";alarm:{label:string;time:string;days:number[];firesAt?:string|null;sound:"default"|"silent";vibration:boolean;snoozeMinutes:number}})
  | (ActionState&{type:"calendar";event:{title:string;startsOn:string;endsOn:string;semester?:string}});
type Turn={feedback?:{rating:"like"|"dislike"}|null;requestId:string;text:string;prompt?:string;fileName?:string;fileType?:string;mediaId?:string;file?:StagedAttachment;mode?:Mode;cards?:Card[];actions?:Action[]};
type Draft={prompt:string;mode:Mode;tier:Tier;attachment?:StagedAttachment;replyTo?:string;key:string};
type Status={voiceEnabled?:boolean;enabled:boolean;capabilities:{text:boolean;images:boolean;documents:boolean};tier:Tier;voice?:{maxSeconds:number;standardMaxSeconds?:number;proMaxSeconds?:number;longFormReady?:boolean};askSession?:{windowMinutes:number;limit:number|null;remaining:number|null;resetsAt?:string|null};study:{limit:number;remaining:number|null};subscription:{checkoutEnabled:boolean}};
type SavedWork={id:string;title:string;mode:Mode;created_at:string};
const days=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const suggestions=[{icon:"book-outline" as const,label:"Explain a topic",prompt:"Help me understand "},{icon:"calendar-outline" as const,label:"Plan my classes",prompt:"Help me add a class to my timetable."},{icon:"alarm-outline" as const,label:"Set a reminder",prompt:"Set an alarm to remind me "},{icon:"people-outline" as const,label:"Find a tutor",prompt:"Help me find a tutor for "}];

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}
function finite(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function nullableFinite(value: unknown, fallback: number | null = null) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function normalizeStatus(value: unknown): Status | undefined {
  const raw = recordOf(value);
  if (!raw) return undefined;
  const capabilities = recordOf(raw.capabilities);
  const voice = recordOf(raw.voice);
  const ask = recordOf(raw.askSession);
  const study = recordOf(raw.study);
  const subscription = recordOf(raw.subscription);
  return {
    enabled: raw.enabled === true,
    voiceEnabled: raw.voiceEnabled === true,
    capabilities: {
      text: capabilities?.text === true,
      images: capabilities?.images === true,
      documents: capabilities?.documents === true,
    },
    tier: raw.tier === "pro" ? "pro" : "standard",
    ...(voice
      ? {
          voice: {
            maxSeconds: Math.max(1, finite(voice.maxSeconds, 60)),
            standardMaxSeconds: Math.max(1, finite(voice.standardMaxSeconds, 60)),
            proMaxSeconds: Math.max(1, finite(voice.proMaxSeconds, 300)),
            longFormReady: voice.longFormReady !== false,
          },
        }
      : {}),
    ...(ask
      ? {
          askSession: {
            windowMinutes: Math.max(1, finite(ask.windowMinutes, 15)),
            limit: nullableFinite(ask.limit),
            remaining: nullableFinite(ask.remaining),
            resetsAt: typeof ask.resetsAt === "string" ? ask.resetsAt : null,
          },
        }
      : {}),
    study: {
      limit: Math.max(0, finite(study?.limit, 0)),
      remaining: nullableFinite(study?.remaining),
    },
    subscription: {
      checkoutEnabled: subscription?.checkoutEnabled === true,
    },
  };
}
function normalizeCards(value: unknown): Card[] {
  if (!Array.isArray(value)) return [];
  const output: Card[] = [];
  for (const item of value) {
    const raw = recordOf(item);
    if (!raw || typeof raw.id !== "string") continue;
    if (!["product", "vendor", "tutor", "video"].includes(String(raw.kind))) continue;
    output.push({
      id: raw.id,
      kind: raw.kind as Card["kind"],
      title: typeof raw.title === "string" ? raw.title : "KampusOne",
      subtitle: typeof raw.subtitle === "string" ? raw.subtitle : "",
      path: typeof raw.path === "string" ? raw.path : "",
      ...(typeof raw.thumbnail === "string" ? { thumbnail: raw.thumbnail } : {}),
      ...(typeof raw.description === "string" ? { description: raw.description } : {}),
      ...(typeof raw.source === "string" ? { source: raw.source } : {}),
    });
  }
  return output;
}
function normalizeActions(value: unknown): Action[] {
  if (!Array.isArray(value)) return [];
  const output: Action[] = [];
  for (const item of value) {
    const raw = recordOf(item);
    if (!raw || typeof raw.id !== "string") continue;
    const state = {
      id: raw.id,
      ...(raw.confirmed === true ? { confirmed: true } : {}),
      ...(raw.undone === true ? { undone: true } : {}),
    };
    if (raw.type === "alarm") {
      const alarm = recordOf(raw.alarm);
      if (!alarm) continue;
      const alarmDays = Array.isArray(alarm.days)
        ? alarm.days
            .map(Number)
            .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        : [];
      output.push({
        ...state,
        type: "alarm",
        alarm: {
          label: typeof alarm.label === "string" ? alarm.label : "Alarm",
          time: typeof alarm.time === "string" ? alarm.time : "08:00",
          days: Array.from(new Set(alarmDays)),
          ...(typeof alarm.firesAt === "string" || alarm.firesAt === null
            ? { firesAt: alarm.firesAt as string | null }
            : {}),
          sound: alarm.sound === "silent" ? "silent" : "default",
          vibration: alarm.vibration !== false,
          snoozeMinutes: Math.max(1, Math.min(30, finite(alarm.snoozeMinutes, 5))),
        },
      });
      continue;
    }
    if (raw.type === "timetable") {
      const entry = recordOf(raw.entry);
      if (!entry || typeof entry.title !== "string") continue;
      output.push({
        ...state,
        type: "timetable",
        entry: {
          title: entry.title,
          ...(typeof entry.courseCode === "string" ? { courseCode: entry.courseCode } : {}),
          ...(typeof entry.venue === "string" ? { venue: entry.venue } : {}),
          dayOfWeek: Math.max(0, Math.min(6, Math.trunc(finite(entry.dayOfWeek, 1)))),
          ...(typeof entry.date === "string" ? { date: entry.date } : {}),
          startsAt: typeof entry.startsAt === "string" ? entry.startsAt : "09:00",
          endsAt: typeof entry.endsAt === "string" ? entry.endsAt : "10:00",
        },
        ...(raw.operation === "update" ? { operation: "update" as const } : {}),
        ...(typeof raw.entryId === "string" ? { entryId: raw.entryId } : {}),
      });
      continue;
    }
    if (raw.type === "calendar") {
      const event = recordOf(raw.event);
      if (!event || typeof event.title !== "string") continue;
      output.push({
        ...state,
        type: "calendar",
        event: {
          title: event.title,
          startsOn: typeof event.startsOn === "string" ? event.startsOn : "",
          endsOn: typeof event.endsOn === "string" ? event.endsOn : "",
          ...(typeof event.semester === "string" ? { semester: event.semester } : {}),
        },
      });
    }
  }
  return output;
}
function normalizeTurn(value: unknown, fallbackId?: string): Turn | null {
  const raw = recordOf(value);
  if (!raw) return null;
  const requestId =
    typeof raw.requestId === "string" && raw.requestId
      ? raw.requestId
      : fallbackId;
  if (!requestId) return null;
  const feedback = recordOf(raw.feedback);
  const rating =
    feedback?.rating === "like" || feedback?.rating === "dislike"
      ? feedback.rating
      : null;
  return {
    requestId,
    text: typeof raw.text === "string" ? raw.text : "",
    ...(typeof raw.prompt === "string" ? { prompt: raw.prompt } : {}),
    ...(typeof raw.fileName === "string" ? { fileName: raw.fileName } : {}),
    ...(typeof raw.fileType === "string" ? { fileType: raw.fileType } : {}),
    ...(typeof raw.mediaId === "string" ? { mediaId: raw.mediaId } : {}),
    ...(raw.mode === "study" || raw.mode === "summary" || raw.mode === "explanation" || raw.mode === "notes" || raw.mode === "quiz"
      ? { mode: raw.mode }
      : {}),
    cards: normalizeCards(raw.cards),
    actions: normalizeActions(raw.actions),
    feedback: rating ? { rating } : null,
  };
}
function normalizeSavedWork(value: unknown): SavedWork[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const raw = recordOf(item);
    if (!raw || typeof raw.id !== "string") return [];
    return [{
      id: raw.id,
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title : "Saved conversation",
      mode: raw.mode === "summary" || raw.mode === "explanation" || raw.mode === "notes" ? raw.mode : "study",
      created_at: typeof raw.created_at === "string" ? raw.created_at : "",
    } satisfies SavedWork];
  });
}

export default function StudentAI() {
  const {mode:initial,history:openHistoryParam,question:initialQuestion}=useLocalSearchParams<{mode?:string;history?:string;question?:string}>();
  const {user,profile}=useAuth();const {theme}=useAppearance();const toast=useToast();
  const [workspace,setWorkspace]=useState<"ask"|"study">(initial && initial!=="study"?"study":"ask");
  const [mode,setMode]=useState<Mode>(initial==="explanation"?"explanation":initial==="notes"?"notes":initial==="summary"?"summary":"study");
  const [tier,setTier]=useState<Tier>("standard");
  const [prompt,setPrompt]=useState("");const [attachment,setAttachment]=useState<StagedAttachment>();
  const [turns,setTurns]=useState<Turn[]>([]);const [replyTo,setReplyTo]=useState<string>();
  const [pending,setPending]=useState<{prompt:string;file?:StagedAttachment}>();
  const [screenFocused,setScreenFocused]=useState(true);
  const [waitingStarted,setWaitingStarted]=useState(0);
  const [waitingSeconds,setWaitingSeconds]=useState(0);
  const [requestStage,setRequestStage]=useState<"uploading"|"waiting"|"recovering">("waiting");
  const [busy,setBusy]=useState(false);const [uploading,setUploading]=useState(false);const [loaded,setLoaded]=useState(false);const [voiceActive,setVoiceActive]=useState(false);const [voiceRecording,setVoiceRecording]=useState(false);
  const [error,setError]=useState("");const [status,setStatus]=useState<Status>();
  const [limit,setLimit]=useState<{resetsAt?:string;upgrade?:boolean}>();const [now,setNow]=useState(Date.now());
  const [sheet,setSheet]=useState<"history"|"plans"|"info"|null>(null);const [history,setHistory]=useState<SavedWork[]>([]);
  const [historyBusy,setHistoryBusy]=useState(false);const [historyError,setHistoryError]=useState("");const [search,setSearch]=useState("");
  const [nextOffset,setNextOffset]=useState<number|null>(null);const [historyQuery,setHistoryQuery]=useState("");
  const [deleteId,setDeleteId]=useState<string>();const [confirming,setConfirming]=useState<string>();
  const [preview,setPreview]=useState<{uri:string;name:string}>();
  const tierChosen=useRef(false);
  const key=useRef(randomUUID()),lock=useRef(false),scroll=useRef<ScrollView>(null);
  const owner=useRef(user?.id);owner.current=user?.id;
  const generation=useRef(0),alive=useRef(true),draftOwner=useRef<string | undefined>(undefined),explicitThread=useRef<{id:string;mode:Mode}|undefined>(undefined);
  const text={color:theme.text,fontFamily:theme.font.body,fontSize:15,lineHeight:24};
  const muted={color:theme.textMuted,fontFamily:theme.font.body,fontSize:12,lineHeight:18};
  // Keep the AI composer border clean on Expo web; focus remains available to assistive technology.
  // Release marker: AI polish verified 2026-09-24.
  // Vercel production redeploy trigger: 2026-09-25.
  const webInputStyle=Platform.OS==='web'?({outlineStyle:'none',outlineWidth:0,outlineColor:'transparent',boxShadow:'none',WebkitTapHighlightColor:'transparent'} as any):undefined;
  const storageKey=`ai-workspace-v3.${user?.id}.${workspace}`;
  const valid=()=>alive.current;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
  const loadStatus=useCallback(async()=>{const account=owner.current;try{const result=normalizeStatus(await api<Status>("/v1/ai/status"));if(valid() && owner.current===account){setStatus(result);if(result && (!tierChosen.current||result.tier!=="pro"))setTier(result.tier);}}catch{if(valid() && owner.current===account)setStatus(undefined);}},[]);
  useFocusEffect(useCallback(()=>{setScreenFocused(true);void loadStatus();return()=>setScreenFocused(false);},[loadStatus]));
  useEffect(()=>{if(!busy){setWaitingSeconds(0);return;}const timer=setInterval(()=>setWaitingSeconds(Math.floor((Date.now()-waitingStarted)/1000)),1000);return()=>clearInterval(timer);},[busy,waitingStarted]);
  const restoreThread=useCallback(async(id:string,version:number)=>{
    const result=await api<{turns:Turn[]}>(`/v1/ai/thread/${id}`);
    const safeTurns=(Array.isArray(result?.turns)?result.turns:[])
      .map(turn=>normalizeTurn(turn))
      .filter((turn):turn is Turn=>Boolean(turn));
    if(valid() && version===generation.current)setTurns(safeTurns);
    return {turns:safeTurns};
  },[]);
  useEffect(()=>{
    const version=++generation.current;const account=user?.id;draftOwner.current=account;
    setHistory([]);setSheet(null);setPreview(undefined);setDeleteId(undefined);setHistoryError("");setSearch("");setNextOffset(null);setLoaded(false);setTurns([]);setPrompt("");setAttachment(undefined);setReplyTo(undefined);setPending(undefined);setError("");setLimit(undefined);setBusy(false);setVoiceActive(false);setVoiceRecording(false);lock.current=false;key.current=randomUUID();tierChosen.current=false;setTier("standard");setStatus(undefined);
    setMode(workspace==='ask'?'study':initial==='explanation'?'explanation':initial==='notes'?'notes':'summary');
    if(!account)return;
    void (async()=>{
      const requestedThread=explicitThread.current;
      explicitThread.current=undefined;
      if(requestedThread){
        setMode(requestedThread.mode==='study'?'study':requestedThread.mode==='explanation'?'explanation':requestedThread.mode==='notes'?'notes':'summary');
        setReplyTo(requestedThread.id);key.current=randomUUID();
        try{await restoreThread(requestedThread.id,version);}
        catch{if(valid()&&version===generation.current){setReplyTo(undefined);setError("That saved conversation could not be restored. Open History to try again.");key.current=randomUUID();}}
      }else{
        const draft=await readCache<Draft>(storageKey);
        if(!valid() || version!==generation.current)return;
        if(draft){
          setPrompt(typeof initialQuestion==="string"?initialQuestion.slice(0,20000):draft.prompt??"");
          setMode(workspace==='ask'?'study':draft.mode==='explanation'?'explanation':draft.mode==='notes'?'notes':'summary');
          setAttachment(draft.attachment && typeof draft.attachment.name==="string" && typeof draft.attachment.type==="string" ? draft.attachment : undefined);
          // A fresh Kira entry always starts a fresh thread. Saved conversations reopen only from History.
          setReplyTo(undefined);key.current=draft.key||randomUUID();
        }
      }
      if(valid()&&version===generation.current){if(typeof initialQuestion==="string")setPrompt(initialQuestion.slice(0,20000));setLoaded(true);}
    })();
    void loadStatus();
  },[user?.id,workspace,storageKey,loadStatus,restoreThread]);
  useEffect(()=>{
    if(!loaded||busy||!user?.id||draftOwner.current!==user.id)return;
    const timer=setTimeout(()=>{
      // Private signed links and image bytes are never persisted. An uploaded file
      // is re-opened through the permission-checked media endpoint when required.
      const savedAttachment=attachment?{name:attachment.name,type:attachment.type,...(attachment.size!==undefined?{size:attachment.size}:{}),...(attachment.mediaId?{mediaId:attachment.mediaId}:{})}:undefined;
      void writeCache(storageKey,{prompt,mode,tier,attachment:savedAttachment,key:key.current});
    },250);return()=>clearTimeout(timer);
  },[prompt,attachment,mode,tier,replyTo,loaded,busy,user?.id,storageKey]);
  useEffect(()=>{if(!limit?.resetsAt)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[limit?.resetsAt]);
  useEffect(()=>{if(limit?.resetsAt && now>=Date.parse(limit.resetsAt)){setLimit(undefined);setError("");void loadStatus();}},[limit,now,loadStatus]);
  function changePrompt(value:string){setPrompt(value);key.current=randomUUID();setError("");}
  function newConversation(){if(lock.current)return;setTurns([]);setReplyTo(undefined);setPrompt("");setAttachment(undefined);setError("");key.current=randomUUID();}
  async function attach(){if(lock.current)return;const version=generation.current;try{const file=await pickAttachment();if(file && valid()&&version===generation.current){setAttachment(file);setError("");key.current=randomUUID();}}catch(e){if(valid()&&version===generation.current)setError(e instanceof Error?e.message:"This file could not be attached.");}}
  async function openFile(file:StagedAttachment){const version=generation.current;try{let uri=file.uri;if(!uri&&file.mediaId)uri=(await api<{url:string}>(`/v1/media/${file.mediaId}/access`,{method:"POST"})).url;if(!uri)throw new Error("Reattach this file to preview it.");if(!valid()||version!==generation.current)return;if((typeof file.type==="string"?file.type:"").startsWith('image/'))setPreview({uri,name:typeof file.name==="string"?file.name:"Attachment"});else await Linking.openURL(uri);}catch(e){if(valid()&&version===generation.current)toast(e instanceof Error?e.message:"Could not open this file.","error");}}
  async function send(promptOverride?:string){
    const outgoing=(promptOverride??prompt).trim();
    if(lock.current||!loaded||(!outgoing&&!attachment))return;
    const version=generation.current;const question=outgoing;let file=attachment;
    lock.current=true;setWaitingStarted(Date.now());setWaitingSeconds(0);setRequestStage(attachment&&!attachment.mediaId?"uploading":"waiting");setBusy(true);setError("");setLimit(undefined);
    setPending({prompt:question,...(file?{file}:{})});setPrompt("");setAttachment(undefined);
    try{
      if(file){setUploading(true);file=await uploadAttachment(file,user!.id,question,tier);if(!valid()||version!==generation.current)return;setPending({prompt:question,file});setUploading(false);setRequestStage("waiting");}
      const savedFile=file?{name:file.name,type:file.type,...(file.mediaId?{mediaId:file.mediaId}:{})}:undefined;
      if(!valid()||version!==generation.current)return;
      setPending({prompt:question,...(file?{file}:{})});setPrompt("");setAttachment(undefined);
      // Persist the draft without holding up the network request.
      void writeCache(storageKey,{prompt:question,mode,tier,attachment:savedFile,key:key.current});
      const requestId=key.current;
      const result=normalizeTurn(await requestKiraResult<Turn>({
        submit:()=>api<Turn>("/v1/ai",{method:"POST",timeoutMs:240000,body:JSON.stringify({mode,prompt:question,mediaId:file?.mediaId,extractedText:file?.sourceText,replyTo,tier,idempotencyKey:requestId,consent:true})}),
        check:()=>api<Turn&{status?:string}>(`/v1/ai/requests/${requestId}`,{cache:"no-store",timeoutMs:12000}),
        isCurrent:()=>valid()&&version===generation.current,
        onRecovering:()=>{if(valid()&&version===generation.current)setRequestStage("recovering");},
      }),requestId);
      if(!result)throw new Error("Kira returned an incomplete response. Your draft is kept.");
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
  async function loadHistory(query=search,offset=0){const version=generation.current;setHistoryBusy(true);setHistoryError("");try{const data=await api<{sessions:SavedWork[];nextOffset:number|null}>(`/v1/ai/history?q=${encodeURIComponent(query)}&offset=${offset}`);if(!valid()||version!==generation.current)return;const sessions=normalizeSavedWork(data?.sessions);setHistory(current=>offset?[...current,...sessions.filter(s=>!current.some(c=>c.id===s.id))]:sessions);setNextOffset(Number.isFinite(Number(data?.nextOffset))?Number(data.nextOffset):null);setHistoryQuery(query);}catch(e){if(valid()&&version===generation.current)setHistoryError(e instanceof Error?e.message:"History could not load.");}finally{if(valid()&&version===generation.current)setHistoryBusy(false);}}
  async function openHistory(item:SavedWork){if(lock.current)return;lock.current=true;const version=generation.current;setHistoryBusy(true);try{const data=await restoreThread(item.id,version);if(!valid()||version!==generation.current)return;const last=data.turns.at(-1);if(!last)throw new Error("This conversation is no longer available.");
    const target=item.mode==='study'?'ask':'study';
    if(target!==workspace){explicitThread.current={id:last.requestId,mode:item.mode};setWorkspace(target);}else{setReplyTo(last.requestId);setPrompt("");setAttachment(undefined);setMode(item.mode);key.current=randomUUID();}
    setSheet(null);setError("");
  }catch(e){if(valid()&&version===generation.current)setHistoryError(e instanceof Error?e.message:"Could not open this conversation.");}finally{lock.current=false;if(valid()&&version===generation.current)setHistoryBusy(false);}}
  useEffect(()=>{if(openHistoryParam === "1" && loaded){setSheet("history");void loadHistory("",0);}},[openHistoryParam,loaded]);
  async function removeHistory(id:string){const version=generation.current;setHistoryBusy(true);try{await api(`/v1/ai/history/${id}`,{method:'DELETE'});if(!valid()||version!==generation.current)return;setHistory(rows=>rows.filter(row=>row.id!==id));setTurns(rows=>rows.filter(row=>row.requestId!==id));if(replyTo===id){setReplyTo(undefined);key.current=randomUUID();}setDeleteId(undefined);}catch(e){if(valid()&&version===generation.current)setHistoryError(e instanceof Error?e.message:'Could not delete this answer.');}finally{if(valid()&&version===generation.current)setHistoryBusy(false);}}
  async function confirm(turn:Turn,action:Action,undo=false){
    if(confirming)return;
    const version=generation.current;setConfirming(action.id);
    try{
      await api(`/v1/ai/actions/${undo?'undo':'confirm'}`,{method:'POST',body:JSON.stringify({requestId:turn.requestId,actionId:action.id})});
      if(!valid()||version!==generation.current)return;
      clearApiCache();setTurns(rows=>rows.map(row=>row.requestId===turn.requestId?{...row,actions:row.actions?.map(a=>a.id===action.id?{...a,confirmed:!undo,undone:undo}:a)??[]}:row));
      const target=action.type==='alarm'?'Alarm':action.type==='calendar'?'Calendar event':'Schedule';
      const success=undo?`${target} undone`:action.type==='alarm'?'Alarm added':action.type==='calendar'?'Added to your calendar':action.operation==='update'?'Schedule updated':'Added to your timetable';
      toast(success,'success');
      if(action.type!=='calendar')try{const result=await api<{alarms:Alarm[]}>('/v1/learning/alarms');if(valid()&&version===generation.current)await syncAlarms(result.alarms,true);}catch{if(valid()&&version===generation.current)toast('Saved. Open Alarms to check device reminders.');}
    }catch(e){if(valid()&&version===generation.current)toast(e instanceof Error?e.message:'The change was not saved.','error');}
    finally{if(valid()&&version===generation.current)setConfirming(undefined);}
  }
  async function copy(answer:string){try{await Clipboard.setStringAsync(answer);toast('Copied','success');}catch{toast('Could not copy. Select the answer text and copy it.','error');}}
  async function share(answer:string){try{await shareContent({title:'Kira answer',message:`This is a response I got from Kira in KampusOne.\n\n${answer.slice(0,4000)}${answer.length>4000?'\n… (excerpt)':''}`,url:sharedLink('ai','kira')});}catch{toast('Could not share this answer.','error');}}
  async function rate(turn:Turn,rating:'like'|'dislike'){
    const version=generation.current;const next=turn.feedback?.rating===rating?null:rating;
    try{const result=await api<{feedback:Turn['feedback']}>('/v1/ai/feedback',{method:'POST',body:JSON.stringify({requestId:turn.requestId,rating:next})});if(valid()&&version===generation.current)setTurns(rows=>rows.map(row=>row.requestId===turn.requestId?{...row,feedback:result.feedback??null}:row));}
    catch(e){toast(e instanceof Error?e.message:'Feedback could not be saved.','error');}
  }
  const smallButton=(label:string,onPress:()=>void,disabled=false)=><Pressable accessibilityRole="button" accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={{minHeight:44,paddingVertical:12,paddingHorizontal:12,opacity:disabled?0.5:1}}><Text style={{...muted,color:theme.brand,fontFamily:theme.font.semibold}}>{label}</Text></Pressable>;
  const renderAction=(turn:Turn,action:Action)=>{
    const cardStyle={marginTop:14,padding:17,borderWidth:1,borderColor:theme.border,borderRadius:14,backgroundColor:theme.surface};
    if(action.type==='timetable')return <View key={action.id} style={cardStyle}><Text style={{...text,fontFamily:theme.font.semibold}}>{action.entry.courseCode || action.entry.title}</Text><Text style={muted}>{action.entry.date || `Every ${days[action.entry.dayOfWeek]}`} · {action.entry.startsAt}–{action.entry.endsAt}{action.entry.venue?`\n${action.entry.venue}`:''}</Text>{action.undone?<Text style={muted}>Change undone</Text>:action.confirmed?<View style={{flexDirection:'row',flexWrap:'wrap'}}>{smallButton('Edit',()=>router.push({pathname:'/timetable-edit',params:{id:action.entryId??action.id}}),Boolean(confirming))}{smallButton(confirming===action.id?'Undoing…':'Undo',()=>void confirm(turn,action,true),Boolean(confirming))}</View>:smallButton(confirming===action.id?'Saving…':action.operation==='update'?'Save changes':'Add to timetable',()=>void confirm(turn,action),Boolean(confirming))}</View>;
    if(action.type==='alarm'){
      const repeat=action.alarm.days.length?action.alarm.days.map(day=>days[day]).join(', '):action.alarm.firesAt?new Date(action.alarm.firesAt).toLocaleString([], {year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'One time';
      return <View key={action.id} style={cardStyle}><Text style={{...text,fontFamily:theme.font.semibold}}>{action.alarm.label}</Text><Text style={muted}>{action.alarm.time} · {repeat}</Text>{action.undone?<Text style={muted}>Alarm removed</Text>:action.confirmed?<View style={{flexDirection:'row',flexWrap:'wrap'}}>{smallButton('View alarms',()=>router.push('/alarms' as never),Boolean(confirming))}{smallButton(confirming===action.id?'Undoing…':'Undo',()=>void confirm(turn,action,true),Boolean(confirming))}</View>:smallButton(confirming===action.id?'Saving…':'Add alarm',()=>void confirm(turn,action),Boolean(confirming))}</View>;
    }
    return <View key={action.id} style={cardStyle}><Text style={{...text,fontFamily:theme.font.semibold}}>{action.event.title}</Text><Text style={muted}>{action.event.startsOn}{action.event.endsOn!==action.event.startsOn?` – ${action.event.endsOn}`:''}{action.event.semester?` · ${action.event.semester}`:''}</Text>{action.undone?<Text style={muted}>Calendar event removed</Text>:action.confirmed?<View style={{flexDirection:'row',flexWrap:'wrap'}}>{smallButton('View calendar',()=>router.push('/academic-calendar' as never),Boolean(confirming))}{smallButton(confirming===action.id?'Undoing…':'Undo',()=>void confirm(turn,action,true),Boolean(confirming))}</View>:smallButton(confirming===action.id?'Saving…':'Add to calendar',()=>void confirm(turn,action),Boolean(confirming))}</View>;
  };
  const iconButton=(name:ComponentProps<typeof Ionicons>['name'],label:string,onPress:()=>void,disabled=false)=><Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled}} disabled={disabled} onPress={onPress} style={{minHeight:44,minWidth:44,alignItems:'center',justifyContent:'center',opacity:disabled?0.4:1}}><Ionicons name={name} size={22} color={theme.text}/></Pressable>;
  const renderUser=(question:string,file?:StagedAttachment,isPending=false)=><View style={{alignSelf:'flex-end',...(file?{width:'90%' as const}:{}),maxWidth:'90%',marginTop:22,marginBottom:18}}>{file?<AttachmentPreview file={file} variant="message" uploading={isPending&&requestStage==='uploading'} onOpen={()=>void openFile(file)}/>:null}{question?<View style={{backgroundColor:theme.sand,borderRadius:19,borderBottomRightRadius:5,paddingHorizontal:16,paddingVertical:12}}><Text selectable style={text}>{question}</Text></View>:null}</View>;
  return <SafeAreaView edges={['top','bottom']} style={{flex:1,backgroundColor:theme.canvas}}>
    <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined} style={{flex:1,width:'100%',maxWidth:760,alignSelf:'center'}}>
      <View style={{flexDirection:'row',alignItems:'center',paddingHorizontal:12,paddingVertical:4,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.border}}>
        {iconButton('arrow-back','Go back',()=>router.canGoBack()?router.back():router.replace('/explore'))}
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={{color:theme.text,fontFamily:theme.font.display,fontSize:workspace==='ask'?21:18,flex:1}}>{workspace==='ask'?'Kira':'Study with Kira'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`AI plan: ${tier==='pro'?'Pro':'Standard'}`} onPress={()=>setSheet('plans')} disabled={busy} style={{flexDirection:'row',alignItems:'center',padding:12,gap:5}}><Text style={{...muted,color:theme.text}}>{tier==='pro'?'Pro':'Standard'}</Text><Ionicons name="chevron-down" size={14} color={theme.textMuted}/></Pressable>
        {iconButton('time-outline','Conversation history',()=>{setSheet('history');void loadHistory('',0);},busy)}
        {iconButton('create-outline','New conversation',newConversation,busy)}
      </View>
      <View style={{flexDirection:'row',paddingHorizontal:24,gap:26}}>{(['ask','study'] as const).map(value=><Pressable key={value} accessibilityRole="tab" accessibilityState={{selected:workspace===value,disabled:busy}} disabled={busy} onPress={()=>setWorkspace(value)} style={{paddingVertical:14,borderBottomWidth:2,borderBottomColor:workspace===value?theme.brand:'transparent'}}><Text style={{...text,fontFamily:workspace===value?theme.font.semibold:theme.font.body,color:workspace===value?theme.text:theme.textMuted}}>{value==='ask'?'Ask':'Study material'}</Text></Pressable>)}</View>
      {workspace==='study'?<View style={{flexDirection:'row',alignItems:'center',paddingHorizontal:16,paddingTop:8}}>{(['summary','explanation','notes'] as const).map(value=><Pressable key={value} accessibilityRole="radio" accessibilityState={{checked:mode===value}} disabled={busy} onPress={()=>{setMode(value);key.current=randomUUID();}} style={{paddingVertical:9,paddingHorizontal:13,backgroundColor:mode===value?theme.surfaceMuted:'transparent',borderRadius:8}}><Text style={{...muted,color:theme.text}}>{value==='summary'?'Summary':value==='explanation'?'Explain':'Notes'}</Text></Pressable>)}<View style={{flex:1}}/>{status?.study?.remaining!==null&&status?.study?.remaining!==undefined?<Text style={{...muted,fontSize:11}}>{status.study.remaining} left</Text>:null}</View>:null}
      <ScrollView ref={scroll} style={{flex:1}} contentContainerStyle={{flexGrow:1,paddingHorizontal:24,paddingBottom:16}} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" onContentSizeChange={()=>{if(pending)scroll.current?.scrollToEnd({animated:false});}}>
        {!loaded||draftOwner.current!==user?.id?<View style={{gap:16,paddingTop:40}}><SkeletonBlock width="55%" height={30}/><SkeletonBlock width="80%"/><ListSkeleton count={2}/></View>:null}
        {loaded&&draftOwner.current===user?.id&&!turns.length&&!pending?<View style={{flex:1,justifyContent:'center',paddingVertical:35}}>
          <Text style={{...muted,fontSize:15,marginBottom:10}}>Hi, {profile?.first_name || 'there'}.</Text>
          <Text style={{color:theme.text,fontFamily:theme.font.display,fontSize:34,lineHeight:41,maxWidth:430}}>{workspace==='ask'?'What are we\nworking on?':'Make it easier\nto understand.'}</Text>
          <Text style={{...muted,fontSize:14,lineHeight:22,marginTop:15,maxWidth:410}}>{workspace==='ask'?'Ask a question, plan a class, or find help on campus.':'Add your material or a topic. Get a summary, a full lesson, or revision notes.'}</Text>
          {workspace==='ask'?<View style={{marginTop:30,gap:3}}>{suggestions.map(s=><Pressable key={s.label} accessibilityRole="button" onPress={()=>changePrompt(s.prompt)} style={{flexDirection:'row',gap:12,alignItems:'center',paddingVertical:13}}><Ionicons name={s.icon} size={20} color={theme.brand}/><Text style={{...text,fontSize:14}}>{s.label}</Text><Ionicons name="arrow-up-outline" size={16} color={theme.textFaint} style={{transform:[{rotate:'45deg'}]}}/></Pressable>)}</View>:null}
        </View>:null}
        {loaded&&draftOwner.current===user?.id?turns.map(turn=>{
          const file=turn.file ?? (turn.fileName?{name:turn.fileName,type:turn.fileType??(/\.(png|jpe?g|webp)$/i.test(turn.fileName)?'image/jpeg':/\.txt$/i.test(turn.fileName)?'text/plain':'application/pdf'),...(turn.mediaId?{mediaId:turn.mediaId}:{})}:undefined);
          return <View key={turn.requestId}>{renderUser(turn.prompt??'',file)}<StudyAnswer value={turn.text}/>
            {turn.cards?.map(card=><Pressable key={card.id} accessibilityRole="button" accessibilityLabel={card.kind==='video'?`${card.id==='youtube-search'?'Search YouTube':'Open YouTube video'}: ${card.title}`:card.title} onPress={()=>{if(card.kind==='video' && /^https:\/\/www\.youtube\.com\/(?:watch\?v=[A-Za-z0-9_-]{11}|results\?search_query=[A-Za-z0-9%+_.~-]+)$/.test(card.path))void Linking.openURL(card.path).catch(()=>toast('Could not open this video.','error'));else if(/^\/student-service\?(id|product)=[0-9a-f-]{36}$/i.test(card.path))router.push(card.path as never);}} style={{marginTop:12,padding:16,borderWidth:1,borderColor:theme.border,borderRadius:13,backgroundColor:theme.surface,flexDirection:card.kind==='video'?'column':'row',alignItems:card.kind==='video'?'stretch':'center',gap:12}}>{card.kind==='video'&&card.thumbnail?<Image accessibilityLabel={card.title} source={{uri:card.thumbnail}} resizeMode="cover" style={{width:'100%',aspectRatio:16/9,borderRadius:9,backgroundColor:theme.surfaceMuted}}/>:card.kind!=='video'?<Ionicons name={card.kind==='tutor'?'person-outline':card.kind==='vendor'?'storefront-outline':'bag-outline'} size={23} color={theme.brand}/>:null}<View style={{flex:1}}><Text style={{...text,fontFamily:theme.font.semibold,fontSize:14}}>{card.title}</Text><Text style={{...muted,marginTop:2}}>{card.subtitle}</Text>{card.kind==='video'&&card.description?<Text numberOfLines={3} style={{...muted,marginTop:7,color:theme.text}}>{card.description}</Text>:null}</View><View style={{flexDirection:'row',alignItems:'center',justifyContent:'flex-end',gap:5}}>{card.kind==='video'?<Text style={{...muted,color:theme.brand,fontFamily:theme.font.semibold}}>{card.id==='youtube-search'?'Search YouTube':'Watch on YouTube'}</Text>:null}<Ionicons name="chevron-forward" size={17} color={theme.textMuted}/></View></Pressable>)}
             {turn.actions?.map(action=>renderAction(turn,action))}
            <View style={{alignSelf:'flex-start',marginTop:7,flexDirection:'row'}}>{iconButton('copy-outline','Copy answer',()=>void copy(turn.text))}{iconButton('share-outline','Share answer',()=>void share(turn.text))}{iconButton(turn.feedback?.rating==='like'?'thumbs-up':'thumbs-up-outline','Helpful answer',()=>void rate(turn,'like'))}{iconButton(turn.feedback?.rating==='dislike'?'thumbs-down':'thumbs-down-outline','Unhelpful answer',()=>void rate(turn,'dislike'))}</View>
          </View>;
        }):null}
        {pending?<View>{renderUser(pending.prompt,pending.file,true)}<View accessibilityRole="text" accessibilityLabel="Kira is working" accessibilityLiveRegion="polite" style={{gap:10,marginTop:8}}><Text style={muted}>{requestStage==='uploading'?'Uploading your material…':requestStage==='recovering'?'Checking your saved answer…':pending.file?waitingSeconds<12?'Reading your material…':'Preparing your study response…':waitingSeconds<8?'Kira is working on your question…':waitingSeconds<20?'Still waiting for your answer…':'A detailed answer can take a little longer…'}</Text><SkeletonBlock width="76%"/><SkeletonBlock width="56%"/></View></View>:null}
      </ScrollView>
      <View style={{paddingHorizontal:16,paddingTop:8,paddingBottom:6}}>
        {error?<View accessibilityRole="alert" style={{padding:12,marginBottom:10,backgroundColor:theme.surfaceMuted,borderRadius:10}}><Text style={{...muted,color:theme.text}}>{error}{limit?.resetsAt?` Try again at ${new Date(limit.resetsAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}.`:''}</Text>{limit?.upgrade?smallButton('Get Kira Pro',()=>setSheet('plans')):null}</View>:null}
        {status&&!status.enabled?<Text style={{...muted,marginBottom:8}}>AI is temporarily unavailable. Your draft and saved conversations are kept.</Text>:null}
        {!status&&loaded?smallButton('Check AI availability',()=>void loadStatus(),busy):null}
        {attachment?<AttachmentPreview file={attachment} uploading={uploading} onRemove={()=>{setAttachment(undefined);key.current=randomUUID();}} onOpen={()=>void openFile(attachment)}/>:null}
        <View style={{borderWidth:1,borderColor:theme.border,borderRadius:22,backgroundColor:theme.surface,paddingHorizontal:9,paddingTop:voiceActive?5:12,paddingBottom:5}}>
          {!voiceActive?<TextInput accessibilityLabel="Message Kira" value={prompt} onChangeText={changePrompt} editable={loaded&&!busy} placeholder={workspace==='ask'?'Ask Kira…':'Add instructions or paste your material…'} placeholderTextColor={theme.textMuted} multiline maxLength={20000} textAlignVertical="top" style={[{color:theme.text,fontFamily:theme.font.body,fontSize:16,lineHeight:23,minHeight:43,maxHeight:150,paddingHorizontal:7,paddingBottom:8},webInputStyle]}/>:null}
          <KiraVoiceInput key={`${user?.id}.${workspace}`} disabled={busy||!loaded} enabled={status?.voiceEnabled===true} maxRecordingMs={(status?.voice?.maxSeconds??(status?.tier==='pro'?300:60))*1000} sendBusy={busy} sendDisabled={busy||!loaded||Boolean(limit)||(!prompt.trim()&&!attachment)} onAttach={()=>void attach()} onInfo={()=>setSheet('info')} onSend={()=>void send()} onActiveChange={setVoiceActive} onRecordingChange={setVoiceRecording} onTranscript={value=>changePrompt((prompt?prompt+"\n":"")+value)} onSendTranscript={async value=>{const voicePrompt=(prompt.trim()?prompt.trim()+"\n":"")+value;await send(voicePrompt);}}/>
        </View>
        <Text style={{...muted,fontSize:10,textAlign:'center',marginTop:7}}>Kira can make mistakes. Check important details.</Text>
      </View>
    </KeyboardAvoidingView>
    <AIEdgeGlow active={screenFocused && (busy || voiceRecording)}/>
    <Modal visible={sheet!==null} transparent animationType="fade" onRequestClose={()=>setSheet(null)}>
      <View style={{flex:1,justifyContent:'flex-end',backgroundColor:'rgba(0,0,0,0.35)'}}><Pressable accessibilityLabel="Close panel" accessibilityRole="button" onPress={()=>setSheet(null)} style={{flex:1}}/>
        <SafeAreaView edges={['bottom']} style={{backgroundColor:theme.canvas,borderTopLeftRadius:24,borderTopRightRadius:24,width:'100%',maxWidth:760,alignSelf:'center',maxHeight:'82%',padding:22}}>
          <View style={{flexDirection:'row',alignItems:'center',marginBottom:12}}><Text style={{color:theme.text,fontFamily:theme.font.display,fontSize:25,flex:1}}>{sheet==='history'?'History':sheet==='plans'?'Choose your plan':'About Kira'}</Text>{iconButton('close','Close panel',()=>setSheet(null))}</View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {sheet==='plans'?<View>
              <View style={{padding:18,borderRadius:14,borderWidth:1,borderColor:tier==='standard'?theme.brand:theme.border,backgroundColor:tier==='standard'?theme.surfaceMuted:'transparent',marginBottom:12}}><View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Pressable accessibilityRole='radio' accessibilityState={{checked:tier==='standard'}} onPress={()=>{tierChosen.current=true;setTier('standard');key.current=randomUUID();setSheet(null);}}><Text style={{...text,fontFamily:theme.font.semibold}}>Kira Standard</Text></Pressable>{tier==='standard'?<Ionicons name='checkmark-circle' size={20} color={theme.brand}/>:null}</View>{smallButton('View Plans',()=>{setSheet(null);router.push('/ai-subscription');})}</View>
              <View style={{padding:18,borderRadius:14,borderWidth:1,borderColor:tier==='pro'?theme.brand:theme.border,backgroundColor:tier==='pro'?theme.surfaceMuted:'transparent',marginBottom:16}}><View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Text style={{...text,fontFamily:theme.font.semibold}}>Kira Pro</Text>{tier==='pro'?<Ionicons name='checkmark-circle' size={20} color={theme.brand}/>:null}</View>{status?.tier==='pro'?smallButton('Use Pro',()=>{tierChosen.current=true;setTier('pro');key.current=randomUUID();setSheet(null);}):null}{smallButton(isPlayDistribution(Platform.OS,process.env.EXPO_PUBLIC_ANDROID_DISTRIBUTION)?'View my access':status?.tier==='pro'?'Manage my plan':'Get Kira Pro',()=>{setSheet(null);router.push('/ai-subscription');})}</View>
              {status?.askSession?<Text style={{...muted,marginBottom:8}}>{status.askSession.remaining===null?'Your Ask sessions have no personal message cap.':`${status.askSession.remaining} Ask message${status.askSession.remaining===1?'':'s'} left in this ${status.askSession.windowMinutes}-minute session.`}</Text>:null}
            </View>:null}
            {sheet==='info'?<View style={{gap:15}}><Text style={text}>Your chats are scoped to your account and saved for 90 days. When you rate an answer, authorised support staff can review that question and answer to improve Kira. You can remove saved answers from History.</Text><Text style={text}>Questions and attachments are processed by external AI services. Do not include passwords, payment details or other people's confidential information.</Text><Text style={text}>Kira can read your timetable and find published campus services. Timetable changes require you to review a schedule card and confirm it. You can edit the saved entry or undo a change within 24 hours if the entry has not changed again. It cannot manage accounts or perform admin actions.</Text><Text style={text}>Attach one PDF or text file up to 100 MB, or one image up to 8 MB. Larger documents are read on your device and relevant excerpts are selected for the answer. Kira identifies excerpted sources. For a scanned PDF, attach the relevant page as an image or export a searchable PDF. Compress files larger than 100 MB.</Text></View>:null}
            {sheet==='history'?<View>
              <View style={{flexDirection:'row',alignItems:'center',marginBottom:10,borderWidth:1,borderColor:theme.border,borderRadius:12,paddingLeft:12}}><TextInput accessibilityLabel="Search conversations" value={search} onChangeText={setSearch} placeholder="Search saved work" placeholderTextColor={theme.textMuted} style={{...text,flex:1,paddingVertical:11}} onSubmitEditing={()=>void loadHistory(search,0)}/>{smallButton('Search',()=>void loadHistory(search,0),historyBusy)}</View>
              {historyError?<Text accessibilityRole="alert" style={muted}>{historyError}</Text>:null}{historyBusy?<ListSkeleton count={3}/>:null}
              {!historyBusy&&!history.length?<Text style={{...muted,paddingVertical:24}}>No saved conversations yet.</Text>:null}
              {history.map(item=><View key={item.id} style={{borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.border,paddingVertical:12}}><View style={{flexDirection:'row',alignItems:'center'}}><Pressable accessibilityRole="button" disabled={historyBusy} onPress={()=>void openHistory(item)} style={{flex:1,paddingVertical:5}}><Text numberOfLines={2} style={text}>{item.title}</Text><Text style={muted}>{item.mode==='study'?'Ask':item.mode==='summary'?'Summary':item.mode==='explanation'?'Explanation':'Notes'} · {new Date(item.created_at).toLocaleDateString()}</Text></Pressable>{iconButton('trash-outline','Delete saved answer',()=>setDeleteId(item.id),historyBusy)}</View>{deleteId===item.id?<View><Text style={muted}>Delete this answer? This cannot be undone and does not reset study trials.</Text><View style={{flexDirection:'row'}}>{smallButton('Delete',()=>void removeHistory(item.id),historyBusy)}{smallButton('Cancel',()=>setDeleteId(undefined),historyBusy)}</View></View>:null}</View>)}
              {nextOffset!==null?smallButton('Load older work',()=>void loadHistory(historyQuery,nextOffset),historyBusy):null}
            </View>:null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
    <Modal visible={Boolean(preview)} animationType="fade" onRequestClose={()=>setPreview(undefined)}><SafeAreaView style={{flex:1,backgroundColor:theme.canvas}}><View style={{flexDirection:'row',alignItems:'center',padding:14}}><Text numberOfLines={1} style={{...text,flex:1}}>{preview?.name}</Text>{iconButton('close','Close image',()=>setPreview(undefined))}</View>{preview?<Image source={{uri:preview.uri}} resizeMode="contain" style={{flex:1,width:'100%'}}/>:null}</SafeAreaView></Modal>
  </SafeAreaView>;
}
