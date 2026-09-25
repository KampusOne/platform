import { useCallback, useRef, useState } from "react";
import { Text, View, Pressable } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { ToolPage, ToolButton } from "@/src/components/toolkit";
import { useAppearance } from "@/src/lib/appearance";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/auth/auth-context";
import { ScreenSkeleton } from "@/src/components/skeleton";
type Event = { id: string; title: string; starts_on: string; ends_on: string; semester: string };
const dateLabel = (value: string) => new Date(value + "T12:00:00Z").toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export default function Calendar() {
  const { theme } = useAppearance(), { user } = useAuth();
  const [events, setEvents] = useState<Event[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null), [busy, setBusy] = useState(false), [actionError, setActionError] = useState("");
  const generation = useRef(0);
  useFocusEffect(useCallback(() => {
    const current = ++generation.current;
    setLoading(true); setEvents([]); setError(""); setRemoving(null); setBusy(false); setActionError("");
    void api<{ events: Event[] }>("/v1/calendar").then(r => { if (current === generation.current) setEvents(r.events); }).catch(e => { if (current === generation.current) setError(e.message); }).finally(() => { if (current === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [user?.id, retry]));
  async function remove(id: string) {
    if (busy) return;
    const current = generation.current;
    setBusy(true); setActionError("");
    try {
      await api(`/v1/calendar/${id}`, { method: "DELETE" });
      if (current === generation.current) { setEvents(rows => rows.filter(row => row.id !== id)); setRemoving(null); }
    } catch (e) { if (current === generation.current) setActionError(e instanceof Error ? e.message : "This event could not be removed. Try again."); }
    finally { if (current === generation.current) setBusy(false); }
  }
  const body = { fontFamily: theme.font.body, color: theme.text, fontSize: 14, lineHeight: 21 };
  return <ToolPage title="Academic calendar">
    <ToolButton label="Upload calendar" onPress={() => router.push("/timetable-import")} />
    {loading ? <ScreenSkeleton /> : error ? <><Text accessibilityRole="alert" style={body}>{error}</Text><ToolButton secondary label="Retry" onPress={() => setRetry(v => v + 1)} /></> : events.length ? events.map(e => <View key={e.id} style={{ paddingVertical: 18, borderBottomWidth: 1, borderColor: theme.border }}>
      <Text style={{ ...body, fontFamily: theme.font.semibold }}>{e.title}</Text>
      <Text style={{ ...body, color: theme.textMuted }}>{dateLabel(e.starts_on)}{e.ends_on !== e.starts_on ? ` – ${dateLabel(e.ends_on)}` : ""}</Text>
      {e.semester ? <Text style={{ ...body, fontSize: 12, color: theme.textMuted }}>{e.semester}</Text> : null}
      {removing === e.id ? <View style={{ gap: 8, marginTop: 10 }}><Text style={body}>Remove this event?</Text>{actionError ? <Text accessibilityRole="alert" style={{ ...body, color: theme.error }}>{actionError}</Text> : null}<ToolButton secondary label="Keep event" disabled={busy} onPress={() => setRemoving(null)} /><ToolButton label={busy ? "Removing…" : "Remove event"} disabled={busy} onPress={() => void remove(e.id)} /></View> : <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${e.title}`} disabled={busy} onPress={() => { setRemoving(e.id); setActionError(""); }} style={{ alignSelf: "flex-start", paddingVertical: 12, paddingRight: 20 }}><Text style={{ ...body, color: theme.deepBrand }}>Remove</Text></Pressable>}
    </View>) : <Text style={{ ...body, paddingVertical: 24 }}>No calendar events yet.</Text>}
  </ToolPage>;
}
