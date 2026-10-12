import { readMigratedPrivateCache } from "@/src/lib/private-cache-migration";
import {AcademicImportUsage} from "@/src/components/academic-import-usage";
import { BulkMenu, BulkToolbar, SelectionCheckbox, useBulkSelection } from "@/src/components/bulk-selection";
import { useCallback, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import {calendarRetryId,calendarRecoveredRows,calendarFields,type CalendarDate,type CalendarFields} from '@/src/lib/calendar-recovery';
import {restoreCalendarEditor,type CalendarEditorDraft,type CalendarCreateIntent} from '@/src/lib/calendar-editor';
import {CalendarConflict,saveCalendarEditor} from '@/src/lib/calendar-sync';
import {useOwnedDraftSave} from '@/src/lib/use-owned-draft-save';
import { Ionicons } from "@expo/vector-icons";
import { randomUUID } from "expo-crypto";
import { getDeviceCacheRevision, writeCache } from "@/src/lib/device-cache";
import {cacheScopeForUser} from '@/src/lib/request-policy';
import { refreshScreenRead } from "@/src/lib/screen-read";
import { router, useFocusEffect } from "expo-router";

import { ToolButton, ToolField, ToolPage } from "@/src/components/toolkit";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { useAppearance, type Theme } from "@/src/lib/appearance";
import { api, ApiError } from "@/src/lib/api";
import { useAuth } from "@/src/auth/auth-context";
import { useOwnedDraftRestore } from '@/src/lib/use-owned-draft-restore';
import { restorePersonalCalendar } from '@/src/lib/form-drafts';
import { DraftRecovery } from '@/src/components/draft-recovery';

type Event = CalendarDate;
type EventDraft = CalendarFields;

const emptyDraft = (): EventDraft => ({
  title: "",
  startsOn: "",
  endsOn: "",
  semester: "",
});

const dateLabel = (value: string) =>
  new Date(value + "T12:00:00Z").toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const dateBadge = (value: string) => {
  const date = new Date(value + "T12:00:00Z");
  return {
    day: date.toLocaleDateString("en-NG", {
      day: "2-digit",
      timeZone: "UTC",
    }),
    month: date
      .toLocaleDateString("en-NG", {
        month: "short",
        timeZone: "UTC",
      })
      .toUpperCase(),
  };
};

const isRealDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T12:00:00Z");
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

const normalizeEvents = (value: unknown): Event[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const raw = row as Record<string, unknown>;
    if (
      typeof raw.id !== "string" ||
      typeof raw.title !== "string" ||
      typeof raw.starts_on !== "string"
    )
      return [];
    return [{
      id: raw.id,
      title: raw.title,
      starts_on: raw.starts_on,
      ends_on:
        typeof raw.ends_on === "string" ? raw.ends_on : raw.starts_on,
      semester: typeof raw.semester === "string" ? raw.semester : "",
      ...(typeof raw.requestId==='string'?{requestId:raw.requestId}:{}),
    } satisfies Event];
  });
};

const sortEvents = (rows: Event[]) =>
  [...rows].sort(
    (left, right) =>
      String(left.starts_on).localeCompare(String(right.starts_on)) ||
      String(left.title).localeCompare(String(right.title)),
  );

const localCalendarKey = (userId?: string | null) =>
  `calendar-local.${userId || "anonymous"}`;

async function saveDeviceDates(key:string,rows:Event[]){
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([writeCache(key,JSON.stringify(rows)),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Saving your device dates took too long. Keep this screen open and try again.')),5000);})]);}
  finally{if(timer!==undefined)clearTimeout(timer);}
}

const mergeCalendarEvents = (serverRows: Event[], localRows: Event[]) => {
  const localById = new Map(localRows.map((row) => [row.id, row]));
  const serverIds = new Set(serverRows.map((row) => row.id));
  return sortEvents([
    ...serverRows.map((row) => localById.get(row.id) ?? row),
    ...localRows.filter((row) => !serverIds.has(row.id)),
  ]);
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    hero: {
      borderRadius: 22,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 18,
      gap: 16,
      ...theme.shadow,
    },
    heroTop: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 14,
    },
    heroIcon: {
      width: 46,
      height: 46,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceTint,
      flexShrink: 0,
    },
    eyebrow: {
      fontFamily: theme.font.semibold,
      fontSize: 11,
      letterSpacing: 0.8,
      color: theme.deepBrand,
      marginBottom: 5,
    },
    heroTitle: {
      fontFamily: theme.font.displayStrong,
      fontSize: 21,
      lineHeight: 26,
      color: theme.text,
    },
    heroBody: {
      fontFamily: theme.font.body,
      fontSize: 13,
      lineHeight: 20,
      color: theme.textMuted,
      marginTop: 6,
    },
    heroActions: {
      gap: 10,
    },
    importButton: {
      minHeight: 52,
      borderRadius: 16,
      backgroundColor: theme.deepBrand,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
    },
    importText: {
      fontFamily: theme.font.semibold,
      fontSize: 14,
      color: "#FFFFFF",
    },
    addButton: {
      minHeight: 50,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceMuted,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 9,
    },
    addText: {
      fontFamily: theme.font.semibold,
      fontSize: 14,
      color: theme.accentText,
    },
    formCard: {
      marginTop: 14,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 16,
      ...theme.shadow,
    },
    formHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 16,
    },
    formHeaderCopy: {
      flex: 1,
      minWidth: 0,
    },
    formTitle: {
      fontFamily: theme.font.displayStrong,
      fontSize: 18,
      color: theme.text,
    },
    formBody: {
      fontFamily: theme.font.body,
      fontSize: 12,
      lineHeight: 18,
      color: theme.textMuted,
      marginTop: 5,
    },
    closeForm: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted,
      flexShrink: 0,
    },
    formHint: {
      fontFamily: theme.font.body,
      fontSize: 11,
      lineHeight: 17,
      color: theme.textMuted,
      marginTop: -8,
      marginBottom: 16,
    },
    formError: {
      fontFamily: theme.font.medium,
      fontSize: 12,
      lineHeight: 18,
      color: theme.error,
      marginBottom: 12,
    },
    formActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },
    saveButton: {
      minHeight: 46,
      borderRadius: 14,
      paddingHorizontal: 18,
      flex: 1,
      minWidth: 140,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.deepBrand,
    },
    saveButtonText: {
      fontFamily: theme.font.semibold,
      fontSize: 13,
      color: "#FFFFFF",
    },
    cancelButton: {
      minHeight: 46,
      borderRadius: 14,
      paddingHorizontal: 18,
      minWidth: 100,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.border,
    },
    cancelButtonText: {
      fontFamily: theme.font.semibold,
      fontSize: 13,
      color: theme.accentText,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 26,
      marginBottom: 12,
    },
    sectionTitle: {
      fontFamily: theme.font.display,
      fontSize: 18,
      color: theme.text,
    },
    countPill: {
      minWidth: 30,
      height: 26,
      paddingHorizontal: 9,
      borderRadius: 13,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted,
    },
    countText: {
      fontFamily: theme.font.semibold,
      fontSize: 12,
      color: theme.accentText,
    },
    stateCard: {
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      paddingHorizontal: 20,
      paddingVertical: 26,
      alignItems: "center",
    },
    stateIcon: {
      width: 52,
      height: 52,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surfaceMuted,
      marginBottom: 14,
    },
    stateTitle: {
      fontFamily: theme.font.displayStrong,
      fontSize: 17,
      color: theme.text,
      textAlign: "center",
    },
    stateBody: {
      fontFamily: theme.font.body,
      fontSize: 13,
      lineHeight: 20,
      color: theme.textMuted,
      textAlign: "center",
      marginTop: 6,
      maxWidth: 310,
    },
    retryButton: {
      minHeight: 44,
      borderRadius: 14,
      paddingHorizontal: 18,
      marginTop: 16,
      backgroundColor: theme.surfaceMuted,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    retryText: {
      fontFamily: theme.font.semibold,
      fontSize: 13,
      color: theme.accentText,
    },
    eventCard: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      padding: 15,
      flexDirection: "row",
      gap: 14,
      marginBottom: 10,
    },
    dateBox: {
      width: 54,
      minHeight: 58,
      borderRadius: 15,
      backgroundColor: theme.surfaceMuted,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 7,
      flexShrink: 0,
    },
    dateMonth: {
      fontFamily: theme.font.bold,
      fontSize: 10,
      letterSpacing: 0.6,
      color: theme.deepBrand,
    },
    dateDay: {
      fontFamily: theme.font.displayStrong,
      fontSize: 20,
      color: theme.text,
      marginTop: 1,
    },
    eventContent: {
      flex: 1,
      minWidth: 0,
    },
    eventTitle: {
      fontFamily: theme.font.semibold,
      fontSize: 15,
      lineHeight: 21,
      color: theme.text,
    },
    eventDate: {
      fontFamily: theme.font.body,
      fontSize: 12,
      lineHeight: 18,
      color: theme.textMuted,
      marginTop: 4,
    },
    semesterPill: {
      alignSelf: "flex-start",
      marginTop: 9,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: theme.surfaceTint,
    },
    semesterText: {
      fontFamily: theme.font.medium,
      fontSize: 11,
      color: theme.accentText,
    },
    eventActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 4,
      marginTop: 3,
    },
    eventAction: {
      alignSelf: "flex-start",
      paddingTop: 9,
      paddingBottom: 3,
      paddingRight: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    editText: {
      fontFamily: theme.font.medium,
      fontSize: 12,
      color: theme.accentText,
    },
    removeText: {
      fontFamily: theme.font.medium,
      fontSize: 12,
      color: theme.deepBrand,
    },
    confirmBox: {
      marginTop: 12,
      borderRadius: 14,
      padding: 12,
      backgroundColor: theme.surfaceMuted,
    },
    confirmText: {
      fontFamily: theme.font.medium,
      fontSize: 12,
      lineHeight: 18,
      color: theme.text,
    },
    actionError: {
      fontFamily: theme.font.body,
      fontSize: 12,
      lineHeight: 18,
      color: theme.error,
      marginTop: 6,
    },
    confirmActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 10,
    },
    smallButton: {
      minHeight: 38,
      borderRadius: 12,
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
    },
    smallDangerButton: {
      backgroundColor: theme.deepBrand,
      borderColor: theme.deepBrand,
    },
    smallButtonText: {
      fontFamily: theme.font.semibold,
      fontSize: 12,
      color: theme.text,
    },
    smallDangerText: {
      color: "#FFFFFF",
    },
  });

export default function Calendar() {
  const{user}=useAuth();return <AccountCalendar key={user?cacheScopeForUser(user):'signed-out'} />;
}
function AccountCalendar() {
  const { theme } = useAppearance();
  const { user } = useAuth();
  const styles = createStyles(theme);

  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [draft, setDraft] = useState<EventDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [formError, setFormError] = useState("");
  const [storageWarning,setStorageWarning]=useState("");
  const working=useRef(false);
  const generation = useRef(0);
  const createRequestId = useRef(randomUUID());
  const createIntent=useRef<CalendarCreateIntent|undefined>(undefined);
  const editBase=useRef<CalendarFields|undefined>(undefined);
  const [conflict,setConflict]=useState<CalendarConflict|null>(null);
  const localEvents = useRef<Event[]>([]);
  const storageKey = localCalendarKey(user?.id);
  const scope=user?cacheScopeForUser(user):null;
  const previousScope=useRef<string|null>(null);
  const restored=useOwnedDraftRestore<string>(storageKey,raw=>{
    const local=raw===null?[]:restorePersonalCalendar(raw);
    localEvents.current=local;setEvents(rows=>mergeCalendarEvents(rows,local));
  },Boolean(user?.id),(key)=>readMigratedPrivateCache(`@kampusone/calendar/personal/${key.slice("calendar-local.".length)}`,key,user!.id));
  const editorKey=`calendar-editor-draft.${user?.id??'anonymous'}`;
  const editorRestored=useOwnedDraftRestore<unknown>(editorKey,raw=>{
    if(raw===null)return;
    const saved=restoreCalendarEditor(raw);
    createRequestId.current=saved.requestId;createIntent.current=saved.create;editBase.current=saved.base;
    setDraft(saved.fields);setEditing(saved.target);
  },Boolean(user?.id));
  const ready=restored.ready&&editorRestored.ready;
  const editorRecord=():CalendarEditorDraft|null=>editing?{target:editing,requestId:createRequestId.current,fields:draft,...(createIntent.current?{create:createIntent.current}:{}),...(editBase.current?{base:editBase.current}:{})}:null;
  const editorSave=useOwnedDraftSave(editorKey,editorRecord(),ready&&Boolean(editing)&&!busy);

  useFocusEffect(
    useCallback(() => {
      const current = ++generation.current;
      if(previousScope.current!==scope){previousScope.current=scope;localEvents.current=[];setEvents([]);}
      const revision=getDeviceCacheRevision();
      setLoading(true);
      setError("");
      setRemoving(null);
      setBusy(false);
      working.current=false;
      setActionError("");

      void refreshScreenRead<{events:Event[]}>("/v1/calendar",snapshot=>{if(current===generation.current&&revision===getDeviceCacheRevision()){setEvents(mergeCalendarEvents(normalizeEvents(snapshot.events),localEvents.current));setLoading(false);}})
          .then((result) => ({ rows: normalizeEvents(result?.events), error: "" }))
          .catch((caught) => ({
            rows: [] as Event[],
            error:
              caught instanceof Error
                ? caught.message
                : "Your calendar could not be loaded.",
          }))
        .then((server) => {
          if (current !== generation.current||revision!==getDeviceCacheRevision()) return;
          const merged = mergeCalendarEvents(server.rows, localEvents.current);
          setEvents(rows=>server.error?mergeCalendarEvents(rows,localEvents.current):merged);
          if (server.error && merged.length === 0) setError(server.error);
        })
        .finally(() => {
          if (current === generation.current) setLoading(false);
        });

      return () => {
        generation.current++;
      };
    }, [scope, retry]),
  );

  async function closeEditor() {
    if (busy||working.current||!ready) return;
    const current=generation.current,revision=getDeviceCacheRevision();working.current=true;setBusy(true);
    try{await editorSave.persist(null);if(current!==generation.current||revision!==getDeviceCacheRevision())return;editorSave.discard();setEditing(null);setDraft(emptyDraft());setConflict(null);setFormError("");}
    catch(error){if(current===generation.current)setFormError(error instanceof Error?error.message:'Your editor draft could not be cleared. Keep it open and try again.');}
    finally{if(current===generation.current){working.current=false;setBusy(false);}}
  }

  function openNew() {
    if (busy || working.current || !ready || editing) return;
    editorSave.begin();createIntent.current=undefined;editBase.current=undefined;setConflict(null);
    createRequestId.current = randomUUID();
    setDraft(emptyDraft());
    setFormError("");
    setRemoving(null);
    setActionError("");
    setEditing("new");
  }

  function openEdit(event: Event) {
    if (busy || working.current || !ready || editing) return;
    editorSave.begin();setConflict(null);
    setDraft(calendarFields(event));
    setFormError("");
    setRemoving(null);
    setActionError("");
    createRequestId.current=calendarRetryId(event)??randomUUID();
    createIntent.current=event.id.startsWith('local:')?{requestId:createRequestId.current,original:event.submittedEvent??calendarFields(event)}:undefined;
    editBase.current=event.pendingBase??(localEvents.current.some(row=>row.id===event.id)?undefined:calendarFields(event));
    setEditing(event.id);
  }

  function changeDraft<Key extends keyof EventDraft>(
    key: Key,
    value: EventDraft[Key],
  ) {
    if (busy||working.current||!ready)return;
    if (editing === "new"&&!createIntent.current) createRequestId.current = randomUUID();
    setDraft((current) => ({ ...current, [key]: value }));
    if (formError) setFormError("");
  }

  async function saveDate(overwrite?:Event,asNew=false) {
    if (!editing || busy || working.current || !ready || (conflict&&!overwrite&&!asNew)) return;

    const title = draft.title.trim();
    const startsOn = draft.startsOn.trim();
    const endsOn = draft.endsOn.trim() || startsOn;
    const semester = draft.semester.trim();

    if (!title) {
      setFormError("Add a title for this date.");
      return;
    }
    if (!isRealDate(startsOn)) {
      setFormError("Enter a real start date in YYYY-MM-DD format.");
      return;
    }
    if (!isRealDate(endsOn)) {
      setFormError("Enter a real end date in YYYY-MM-DD format.");
      return;
    }
    if (endsOn < startsOn) {
      setFormError("The end date cannot be before the start date.");
      return;
    }

    const current = generation.current;
    const revision=getDeviceCacheRevision();
    const active=()=>current===generation.current&&revision===getDeviceCacheRevision();
    const event = { title, startsOn, endsOn, semester };
    const firstCreate=asNew||(!createIntent.current&&(editing==='new'||editing.startsWith('local:')));
    if(asNew){createRequestId.current=randomUUID();createIntent.current={requestId:createRequestId.current,original:event};editBase.current=undefined;setConflict(null);}
    if((editing==='new'||editing.startsWith('local:'))&&!createIntent.current)createIntent.current={requestId:createRequestId.current,original:event};
    const record={...editorRecord()!,fields:event};
    working.current=true;
    setBusy(true);
    setFormError("");
    setStorageWarning("");

    try {
      await editorSave.persist(record);
      if(!active())return;
      let saved: Event;
      let backedByServer = false;
      try {
        saved = await saveCalendarEditor(record,event,active,overwrite,firstCreate);
        backedByServer = true;
      } catch (caught) {
        if (!(caught instanceof ApiError) || !["NETWORK_UNAVAILABLE","REQUEST_TIMEOUT"].includes(caught.code)) throw caught;
        saved = {
          id: editing === "new" ? `local:${createRequestId.current}` : editing,
          title,
          starts_on: startsOn,
          ends_on: endsOn,
          semester,
          ...(record.create?{requestId:record.create.requestId,submittedEvent:record.create.original}:{}),
          ...(record.base?{pendingBase:record.base}:{}),
        };
      }

      if (!active()) return;

      if (backedByServer) {
        const nextLocal = localEvents.current.filter(
          (row) => row.id !== saved.id && row.id !== editing,
        );
        try { await saveDeviceDates(storageKey,nextLocal); }
        catch { if(current===generation.current)setStorageWarning("Your date is saved online, but its device copy could not be updated. Keep this screen open and retry before relying on offline recovery."); }
        if(current!==generation.current)return;
        localEvents.current = nextLocal;
      } else {
        const nextLocal = calendarRecoveredRows(localEvents.current,saved,editing);
        await saveDeviceDates(storageKey,nextLocal);
        localEvents.current = nextLocal;
      }

      if (!active()) return;
      editorSave.discard();
      try{await editorSave.persist(null);}catch{if(active())setStorageWarning(backedByServer?'Your date is saved online, but its editor copy could not be cleared. Retry saving the device copy before leaving.':'Your pending date is kept, but its editor copy could not be cleared. Retry saving the device copy before leaving.');}
      if(!active())return;
      setEvents((rows) =>
        sortEvents(
          calendarRecoveredRows(rows,saved,editing),
        ),
      );
      setEditing(null);
      setDraft(emptyDraft());
      setConflict(null);
      setFormError("");
    } catch (caught) {
      if (!active()) return;
      if(caught instanceof CalendarConflict)setConflict(caught);
      setFormError(
        caught instanceof Error
          ? caught.message
          : "This date could not be saved. Try again.",
      );
    } finally {
      if (current === generation.current) {working.current=false;setBusy(false);}
    }
  }

  async function useOnlineDate(){
    if(!conflict?.event||!editing||working.current||busy||!ready)return;
    const current=generation.current,revision=getDeviceCacheRevision(),saved=conflict.event,target=editing;
    working.current=true;setBusy(true);
    try{
      const next=localEvents.current.filter(row=>row.id!==target&&row.id!==saved.id);
      await saveDeviceDates(storageKey,next);
      if(current!==generation.current||revision!==getDeviceCacheRevision())return;
      await editorSave.persist(null);
      if(current!==generation.current||revision!==getDeviceCacheRevision())return;
      editorSave.discard();localEvents.current=next;setEvents(rows=>sortEvents(calendarRecoveredRows(rows,saved,target)));setEditing(null);setDraft(emptyDraft());setConflict(null);setFormError('');
    }catch(error){if(current===generation.current)setFormError(error instanceof Error?error.message:'Your device copy could not be updated. Your edits are kept.');}
    finally{if(current===generation.current){working.current=false;setBusy(false);}}
  }

  async function remove(id: string) {
    if (busy || working.current || !ready || editing) return;
    const current = generation.current;
    working.current=true;
    setBusy(true);
    setActionError("");

    try {
      if (!id.startsWith("local:")) {
        await api(`/v1/calendar/${id}`, {
          method: "DELETE",
          timeoutMs: 12_000,
        });
      }
      if(current!==generation.current)return;
      const nextLocal = localEvents.current.filter((row) => row.id !== id);
      try { await saveDeviceDates(storageKey,nextLocal); }
      catch(error) {
        if(id.startsWith("local:"))throw error;
        if(current===generation.current)setStorageWarning("Your date was removed online, but its device copy could not be updated. Retry saving the device copy before relying on offline recovery.");
      }
      if(current!==generation.current)return;
      localEvents.current = nextLocal;
      if (current === generation.current) {
        setEvents((rows) => rows.filter((row) => row.id !== id));
        setRemoving(null);
      }
    } catch (caught) {
      if (current === generation.current) {
        setActionError(
          caught instanceof Error
            ? caught.message
            : "This event could not be removed. Try again.",
        );
      }
    } finally {
      if (current === generation.current) {working.current=false;setBusy(false);}
    }
  }

  const selection = useBulkSelection(events.map(event => event.id), async ids => {
    if(!ready||working.current||editing)throw new Error("Finish the editor and restore your saved personal dates before changing the calendar.");
    const current=generation.current;
    const remoteIds=ids.filter(id=>!id.startsWith("local:"));
    working.current=true;setBusy(true);
    try {
      if(remoteIds.length) await api("/v1/calendar/bulk-delete",{method:"POST",body:JSON.stringify({ids:remoteIds})});
      if(current!==generation.current)return;
      const next=localEvents.current.filter(row=>!ids.includes(row.id));
      try {await saveDeviceDates(storageKey,next);}
      catch(error){
        if(current!==generation.current)return;
        if(remoteIds.length) {
          localEvents.current=localEvents.current.filter(row=>!remoteIds.includes(row.id));
          setEvents(rows=>rows.filter(row=>!remoteIds.includes(row.id)));
          setStorageWarning("Online dates were removed. Device dates are kept until their removal is saved. Retry saving the device copy, then remove those device dates again.");
        }
        throw error;
      }
      if(current!==generation.current)return;
      localEvents.current=next;setEvents(rows=>rows.filter(row=>!ids.includes(row.id)));
    } finally {if(current===generation.current){working.current=false;setBusy(false);}}
  }, "calendar dates");
  async function retryDeviceCopy(){
    if(working.current||!ready)return;
    const current=generation.current;working.current=true;setBusy(true);
    try{await saveDeviceDates(storageKey,localEvents.current);if(current!==generation.current)return;await editorSave.persist(editorRecord());if(current===generation.current)setStorageWarning("");}
    catch{if(current===generation.current)setStorageWarning("The device copy still could not be saved. Keep this screen open and try again.");}
    finally{if(current===generation.current){working.current=false;setBusy(false);}}
  }
  return (
    <ToolPage syncPath="/v1/calendar" title="Academic calendar" action={ready&&!editing?<BulkMenu selection={selection} />:null}>
      {ready&&!editing?<BulkToolbar selection={selection} count={events.length} />:null}
      <DraftRecovery loading={restored.loading} error={restored.error} onRetry={restored.retry} />
      <DraftRecovery loading={editorRestored.loading} error={editorRestored.error} onRetry={editorRestored.retry} />
      {storageWarning?<View><Text accessibilityRole="alert" style={styles.actionError}>{storageWarning}</Text><ToolButton label="Retry saving device copy" disabled={busy} onPress={()=>void retryDeviceCopy()} /></View>:null}
      <AcademicImportUsage calendar />
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroIcon}>
            <Ionicons
              name="calendar-outline"
              size={24}
              color={theme.deepBrand}
            />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.eyebrow}>ACADEMIC YEAR</Text>
            <Text
              android_hyphenationFrequency="none"
              style={styles.heroTitle}
              textBreakStrategy="simple"
            >
              Keep important dates together.
            </Text>
            <Text
              android_hyphenationFrequency="none"
              style={styles.heroBody}
              textBreakStrategy="simple"
            >
              Import your university calendar, then add your own deadlines,
              events and reminders too.
            </Text>
          </View>
        </View>

        <View style={styles.heroActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Import academic calendar"
            onPress={() => router.push("/timetable-import?kind=calendar")}
            style={({ pressed }) => [
              styles.importButton,
              pressed && { opacity: 0.78 },
            ]}
          >
            <Ionicons name="cloud-upload-outline" size={19} color="#FFFFFF" />
            <Text style={styles.importText}>Import academic calendar</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a date"
            disabled={busy||!ready||Boolean(editing)}
            onPress={openNew}
            style={({ pressed }) => [
              styles.addButton,
              (pressed || busy) && { opacity: 0.62 },
            ]}
          >
            <Ionicons name="add-circle-outline" size={19} color={theme.accentText} />
            <Text style={styles.addText}>Add a date</Text>
          </Pressable>
        </View>
      </View>

      {editing ? (
        <View style={styles.formCard}>
          <View style={styles.formHeader}>
            <View style={styles.formHeaderCopy}>
              <Text style={styles.formTitle}>
                {editing === "new" ? "Add personal date" : "Edit date"}
              </Text>
              <Text style={styles.formBody}>
                Add anything you want to remember. Changes here only affect your
                own calendar.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close calendar editor"
              disabled={busy||!ready}
              onPress={closeEditor}
              style={({ pressed }) => [
                styles.closeForm,
                (pressed || busy) && { opacity: 0.58 },
              ]}
            >
              <Ionicons name="close" size={21} color={theme.text} />
            </Pressable>
          </View>

          <ToolField
            label="Title"
            placeholder="e.g. Project defence"
            value={draft.title}
            maxLength={160}
            onChangeText={(value) => changeDraft("title", value)}
            editable={!busy&&ready}
            returnKeyType="next"
          />
          <ToolField
            label="Start date"
            placeholder="YYYY-MM-DD"
            value={draft.startsOn}
            maxLength={10}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            onChangeText={(value) => changeDraft("startsOn", value)}
            editable={!busy&&ready}
          />
          <ToolField
            label="End date"
            placeholder="Leave blank for a one-day event"
            value={draft.endsOn}
            maxLength={10}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            onChangeText={(value) => changeDraft("endsOn", value)}
            editable={!busy&&ready}
          />
          <Text style={styles.formHint}>
            Use YYYY-MM-DD, for example 2026-10-12.
          </Text>
          <ToolField
            label="Semester or label (optional)"
            placeholder="e.g. First semester, Personal"
            value={draft.semester}
            maxLength={80}
            onChangeText={(value) => changeDraft("semester", value)}
            editable={!busy&&ready}
          />

          {editorSave.warning?<Text accessibilityRole="alert" style={styles.formError}>{editorSave.warning}</Text>:null}
          {conflict?<View style={{gap:10,marginBottom:12}}>
            {conflict.event?<><Text style={styles.formBody}>Online date: {conflict.event.title} · {dateLabel(conflict.event.starts_on)}</Text><ToolButton secondary label="Use online date" disabled={busy} onPress={()=>void useOnlineDate()} /><ToolButton label="Save my edits" disabled={busy} onPress={()=>void saveDate(conflict.event!)} /></>:<ToolButton label="Save as a new date" disabled={busy} onPress={()=>void saveDate(undefined,true)} />}
          </View>:null}
          {formError ? (
            <Text accessibilityRole="alert" style={styles.formError}>
              {formError}
            </Text>
          ) : null}

          <View style={styles.formActions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy||!ready||Boolean(conflict)}
              onPress={() => void saveDate()}
              style={({ pressed }) => [
                styles.saveButton,
                (pressed || busy) && { opacity: 0.58 },
              ]}
            >
              <Text style={styles.saveButtonText}>
                {busy
                  ? "Saving…"
                  : editing === "new"
                    ? "Add to calendar"
                    : "Save changes"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy||!ready}
              onPress={closeEditor}
              style={({ pressed }) => [
                styles.cancelButton,
                (pressed || busy) && { opacity: 0.58 },
              ]}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Your dates</Text>
        {!loading && !error && events.length ? (
          <View style={styles.countPill}>
            <Text style={styles.countText}>{events.length}</Text>
          </View>
        ) : null}
      </View>

      {loading ? (
        <ScreenSkeleton variant="list" compact />
      ) : error ? (
        <View style={styles.stateCard}>
          <View style={styles.stateIcon}>
            <Ionicons
              name="cloud-offline-outline"
              size={25}
              color={theme.deepBrand}
            />
          </View>
          <Text style={styles.stateTitle}>Calendar couldn’t load</Text>
          <Text accessibilityRole="alert" style={styles.stateBody}>
            {error.includes("connect") || error.includes("internet")
              ? error
              : "We couldn’t load your academic dates. Please try again."}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => setRetry((value) => value + 1)}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && { opacity: 0.68 },
            ]}
          >
            <Ionicons name="refresh-outline" size={17} color={theme.accentText} />
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : events.length ? (
        events.map((event) => {
          const badge = dateBadge(event.starts_on);
          return (
            <View key={event.id} style={styles.eventCard}>
              {ready&&!editing?<SelectionCheckbox selection={selection} id={event.id} />:null}
              <View style={styles.dateBox}>
                <Text style={styles.dateMonth}>{badge.month}</Text>
                <Text style={styles.dateDay}>{badge.day}</Text>
              </View>

              <View style={styles.eventContent}>
                <Text
                  android_hyphenationFrequency="none"
                  style={styles.eventTitle}
                  textBreakStrategy="simple"
                >
                  {event.title}
                </Text>
                {localEvents.current.some(row=>row.id===event.id)?<Text style={styles.eventDate}>{Platform.OS==='web'?'Kept for this browser session · reconnect and save before closing':'Saved on this device · server confirmation pending. Edit and save after reconnecting.'}</Text>:null}
                <Text style={styles.eventDate}>
                  {dateLabel(event.starts_on)}
                  {event.ends_on !== event.starts_on
                    ? ` – ${dateLabel(event.ends_on)}`
                    : ""}
                </Text>

                {event.semester ? (
                  <View style={styles.semesterPill}>
                    <Text style={styles.semesterText}>{event.semester}</Text>
                  </View>
                ) : null}

                {removing === event.id ? (
                  <View style={styles.confirmBox}>
                    <Text style={styles.confirmText}>Remove this date?</Text>
                    {actionError ? (
                      <Text accessibilityRole="alert" style={styles.actionError}>
                        {actionError}
                      </Text>
                    ) : null}
                    <View style={styles.confirmActions}>
                      <Pressable
                        accessibilityRole="button"
                        disabled={busy||!ready}
                        onPress={() => setRemoving(null)}
                        style={({ pressed }) => [
                          styles.smallButton,
                          (pressed || busy) && { opacity: 0.58 },
                        ]}
                      >
                        <Text style={styles.smallButtonText}>Keep</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={busy||!ready}
                        onPress={() => void remove(event.id)}
                        style={({ pressed }) => [
                          styles.smallButton,
                          styles.smallDangerButton,
                          (pressed || busy) && { opacity: 0.58 },
                        ]}
                      >
                        <Text
                          style={[
                            styles.smallButtonText,
                            styles.smallDangerText,
                          ]}
                        >
                          {busy ? "Removing…" : "Remove"}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={styles.eventActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${event.title}`}
                      disabled={busy||!ready||Boolean(editing)}
                      onPress={() => openEdit(event)}
                      style={({ pressed }) => [
                        styles.eventAction,
                        (pressed || busy) && { opacity: 0.62 },
                      ]}
                    >
                      <Ionicons
                        name="create-outline"
                        size={14}
                        color={theme.accentText}
                      />
                      <Text style={styles.editText}>Edit</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${event.title}`}
                      disabled={busy||!ready||Boolean(editing)}
                      onPress={() => {
                        if(working.current||editing||!ready)return;
                        setRemoving(event.id);
                        setActionError("");
                        setFormError("");
                      }}
                      style={({ pressed }) => [
                        styles.eventAction,
                        (pressed || busy) && { opacity: 0.62 },
                      ]}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={14}
                        color={theme.deepBrand}
                      />
                      <Text style={styles.removeText}>Remove</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          );
        })
      ) : (
        <View style={styles.stateCard}>
          <View style={styles.stateIcon}>
            <Ionicons
              name="calendar-clear-outline"
              size={26}
              color={theme.deepBrand}
            />
          </View>
          <Text style={styles.stateTitle}>No academic dates yet</Text>
          <Text style={styles.stateBody}>
            Import your university calendar or add a personal date to get
            started.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={openNew}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && { opacity: 0.68 },
            ]}
          >
            <Ionicons name="add-outline" size={17} color={theme.accentText} />
            <Text style={styles.retryText}>Add a date</Text>
          </Pressable>
        </View>
      )}
    </ToolPage>
  );
}
