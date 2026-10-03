import { useCallback, useState, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { updateNotificationCount, changeNotificationCount } from "@/src/lib/notification-state";
import { router, useFocusEffect, type Href } from "expo-router";
import { ToolPage, ToolRow, ToolButton } from "@/src/components/toolkit";
import { EmptyResult } from "@/src/components/product-ui";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { ProfileAvatar } from "@/src/components/profile-avatar";
import { useAppearance } from "@/src/lib/appearance";
import { useToast } from "@/src/components/toast";
import { api } from "@/src/lib/api";
type Notice = {
  id: string;
  title: string;
  body: string;
  path: string | null;
  read_at: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_profile_image_url: string | null;
};
function normalizeNotices(value: unknown): Notice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    if (typeof raw.id !== "string" || !raw.id) return [];
    return [{
      id: raw.id,
      title:
        typeof raw.title === "string" && raw.title.trim()
          ? raw.title
          : "KampusOne notification",
      body: typeof raw.body === "string" ? raw.body : "",
      path: typeof raw.path === "string" ? raw.path : null,
      read_at: typeof raw.read_at === "string" ? raw.read_at : null,
      actor_user_id:
        typeof raw.actor_user_id === "string" ? raw.actor_user_id : null,
      actor_name: typeof raw.actor_name === "string" ? raw.actor_name : null,
      actor_profile_image_url:
        typeof raw.actor_profile_image_url === "string"
          ? raw.actor_profile_image_url
          : null,
    } satisfies Notice];
  });
}
export default function Notifications() {
  const toast = useToast();
  const { theme } = useAppearance();
  const [items, setItems] = useState<Notice[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [nextCursor,setNextCursor]=useState<string|null>(null);
  const extended=useRef(false);
  const [moreBusy,setMoreBusy]=useState(false);
  const load = useCallback(async () => {
    setError("");
    try {
      const result=await api<{notifications:Notice[];unreadCount:number;nextCursor:string|null}>("/v1/notifications/inbox");
      const incoming=normalizeNotices(result?.notifications);
      setItems(current=>extended.current?[...incoming,...current.filter(n=>!incoming.some(f=>f.id===n.id))]:incoming);
      const unread=Number(result?.unreadCount);
      updateNotificationCount(Number.isFinite(unread)?Math.max(0,Math.trunc(unread)):incoming.filter(n=>!n.read_at).length);
      if(!extended.current)setNextCursor(typeof result?.nextCursor==="string"?result.nextCursor:null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Notifications could not load.",
      );
    } finally {
      setReady(true);
    }
  }, []);
  useFocusEffect(useCallback(() => { void load();const timer=setInterval(()=>void load(),20000);return()=>clearInterval(timer); },[load]));
  async function loadMore(){if(!nextCursor||moreBusy)return;setMoreBusy(true);extended.current=true;try{const result=await api<{notifications:Notice[];nextCursor:string|null}>("/v1/notifications/inbox?before="+encodeURIComponent(nextCursor));const incoming=normalizeNotices(result?.notifications);setItems(current=>[...current,...incoming.filter(n=>!current.some(old=>old.id===n.id))]);setNextCursor(typeof result?.nextCursor==="string"?result.nextCursor:null);}catch{toast("Could not load older notifications","error");}finally{setMoreBusy(false);}}
  async function open(n: Notice) {
    const wasUnread=!n.read_at;
    const openedAt=new Date().toISOString();
    if(wasUnread){
      setItems(current=>current.map(i=>i.id===n.id?{...i,read_at:openedAt}:i));
      changeNotificationCount(-1);
    }
    const readRequest=wasUnread
      ? api("/v1/notifications/inbox/" + n.id + "/read", { method: "PATCH" })
      : null;
    if (n.path?.startsWith("/") && !n.path.startsWith("//")) {
      try {
        router.push(n.path as Href);
      } catch {
        toast("Could not open notification", "error");
      }
    }
    if(!readRequest)return;
    try {
      await readRequest;
    } catch (e) {
      setItems(current=>current.map(i=>i.id===n.id?{...i,read_at:null}:i));
      changeNotificationCount(1);
      toast(
        e instanceof Error ? e.message : "Could not mark notification as read",
        "error",
      );
    }
  }
  return (
    <ToolPage title="Notifications" action={<Pressable accessibilityRole="button" accessibilityLabel="Notification settings" onPress={()=>router.push('/notification-preferences')} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="settings-outline" size={24} color={theme.text}/></Pressable>}>
      <ToolButton secondary label="Mark all as read" disabled={!items.some(item=>!item.read_at)} onPress={()=>{void api('/v1/notifications/read-all',{method:'POST'}).then(()=>{setItems(current=>current.map(item=>({...item,read_at:new Date().toISOString()})));updateNotificationCount(0);}).catch(()=>toast('Could not mark notifications as read','error'));}}/>
      {!ready ? (
        <ScreenSkeleton variant="list" compact />
      ) : error ? (
        <>
          <Text accessibilityRole="alert" style={{ color: theme.error }}>
            {error}
          </Text>
          <ToolButton
            secondary
            label="Retry notifications"
            onPress={() => {
              setReady(false);
              void load();
            }}
          />
        </>
      ) : !items.length ? (
        <EmptyResult title="No notifications yet" />
      ) : (
        items.map((n) => (
          <ToolRow
            key={n.id}
            title={n.title}
            detail={n.body}
            {...(n.actor_user_id
              ? { leading: <ProfileAvatar name={n.actor_name || "Student"} imageUrl={n.actor_profile_image_url} size={42} /> }
              : { icon: n.read_at ? "mail-open-outline" as const : "mail-unread-outline" as const })}
            trailing={<View style={{flexDirection:"row",alignItems:"center",gap:10}}>{!n.read_at?<View accessibilityLabel="Unread notification" style={{width:8,height:8,borderRadius:4,backgroundColor:theme.brand}}/>:null}<Ionicons name="chevron-forward" color={theme.textMuted} size={18}/></View>}
            onPress={() => void open(n)}
          />
        ))
      )}
      {nextCursor?<ToolButton secondary label={moreBusy?"Loading…":"Older notifications"} disabled={moreBusy} onPress={()=>void loadMore()}/>:null}
    </ToolPage>
  );
}
