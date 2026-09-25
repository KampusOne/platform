import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { router, type Href } from "expo-router";
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
  const load = useCallback(async () => {
    setError("");
    try {
      setItems(
        (await api<{ notifications: Notice[] }>("/v1/account/notifications"))
          .notifications,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Notifications could not load.",
      );
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
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
      <ToolRow
        title="Notification settings"
        icon="settings-outline"
        onPress={() => router.push("/settings")}
      />
    </ToolPage>
  );
}
