import { useEffect, useState } from "react";
import { router, type Href } from "expo-router";
import { ToolPage, ToolRow } from "@/src/components/toolkit";
import { EmptyResult } from "@/src/components/product-ui";
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
  const [items, setItems] = useState<Notice[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void api<{ notifications: Notice[] }>("/v1/account/notifications")
      .then((r) => {
        setItems(r.notifications);
        setReady(true);
      })
      .catch((e) => toast(e.message, "error"));
  }, [toast]);
  async function open(n: Notice) {
    try {
      await api("/v1/account/notifications/" + n.id, { method: "PATCH" });
      setItems((s) =>
        s.map((i) =>
          i.id === n.id ? { ...i, read_at: new Date().toISOString() } : i,
        ),
      );
      if (n.path?.startsWith("/") && !n.path.startsWith("//"))
        router.push(n.path as Href);
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Could not open notification",
        "error",
      );
    }
  }
  return (
    <ToolPage title="Notifications">
      {ready && !items.length ? (
        <EmptyResult title="No notifications yet" />
      ) : null}
      {items.map((n) => (
        <ToolRow
          key={n.id}
          title={n.title}
          detail={n.body}
          icon={n.read_at ? "mail-open-outline" : "mail-unread-outline"}
          onPress={() => void open(n)}
        />
      ))}
    </ToolPage>
  );
}
