import { useCallback, useState, useRef } from "react";
import { Pressable, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { updateNotificationCount, changeNotificationCount } from "@/src/lib/notification-state";
import { router, useFocusEffect, type Href } from "expo-router";
import { ToolPage, ToolRow, ToolButton } from "@/src/components/toolkit";
import { EmptyResult } from "@/src/components/product-ui";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { useAppearance } from "@/src/lib/appearance";
import { useToast } from "@/src/components/toast";
import { api } from "@/src/lib/api";
type Notice = {
  id: string;
  title: string;
  body: string;
  path: string | null;
  read_at: string | null;
};
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
      setItems(current=>extended.current?[...result.notifications,...current.filter(n=>!result.notifications.some(f=>f.id===n.id))]:result.notifications);updateNotificationCount(result.unreadCount);if(!extended.current)setNextCursor(result.nextCursor);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Notifications could not load.",
      );
    } finally {
      setReady(true);
    }
  }, []);
  useFocusEffect(useCallback(() => { void load();const timer=setInterval(()=>void load(),20000);return()=>clearInterval(timer); },[load]));
  async function loadMore(){if(!nextCursor||moreBusy)return;setMoreBusy(true);extended.current=true;try{const result=await api<{notifications:Notice[];nextCursor:string|null}>("/v1/notifications/inbox?before="+encodeURIComponent(nextCursor));setItems(current=>[...current,...result.notifications.filter(n=>!current.some(old=>old.id===n.id))]);setNextCursor(result.nextCursor);}catch{toast("Could not load older notifications","error");}finally{setMoreBusy(false);}}
  async function open(n: Notice) {
    if(!n.read_at){setItems(current=>current.map(i=>i.id===n.id?{...i,read_at:new Date().toISOString()}:i));changeNotificationCount(-1);}
    try {
      await api("/v1/account/notifications/" + n.id, { method: "PATCH" });
      if (n.path?.startsWith("/") && !n.path.startsWith("//"))
        router.push(n.path as Href);
    } catch (e) {
      if(!n.read_at){setItems(current=>current.map(i=>i.id===n.id?{...i,read_at:null}:i));changeNotificationCount(1);}
      toast(
        e instanceof Error ? e.message : "Could not open notification",
        "error",
      );
    }
  }
  return (
    <ToolPage title="Notifications" action={<Pressable accessibilityRole="button" accessibilityLabel="Notification settings" onPress={()=>router.push('/notification-preferences')} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}}><Ionicons name="options-outline" size={24} color={theme.text}/></Pressable>}>
      {items.some(item=>!item.read_at)?<ToolButton secondary label="Mark all as read" onPress={()=>{void api('/v1/notifications/read-all',{method:'POST'}).then(()=>{setItems(current=>current.map(item=>({...item,read_at:new Date().toISOString()})));updateNotificationCount(0);}).catch(()=>toast('Could not mark notifications as read','error'));}}/>:null}
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
            icon={n.read_at ? "mail-open-outline" : "mail-unread-outline"}
            onPress={() => void open(n)}
          />
        ))
      )}
      {nextCursor?<ToolButton secondary label={moreBusy?"Loading…":"Older notifications"} disabled={moreBusy} onPress={()=>void loadMore()}/>:null}
      <ToolRow
        title="Notification settings"
        icon="settings-outline"
        onPress={() => router.push("/notification-preferences")}
      />
    </ToolPage>
  );
}
