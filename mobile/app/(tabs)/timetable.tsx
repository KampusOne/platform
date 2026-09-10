import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { EmptyResult, ProductScreen } from "@/src/components/product-ui";
import { ApiError, api } from "@/src/lib/api";
import { theme } from "@/src/theme";

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
type Entry = { id: string; title: string; course_code: string | null; venue: string | null; lecturer: string | null; day_of_week: number; starts_at: string; ends_at: string; reminder_minutes: number; reminder_enabled: boolean };

export default function TimetableScreen() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [day, setDay] = useState(new Date().getDay());
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(""); const [code, setCode] = useState(""); const [venue, setVenue] = useState(""); const [lecturer, setLecturer] = useState("");
  const [startsAt, setStartsAt] = useState("09:00"); const [endsAt, setEndsAt] = useState("10:00");
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setError(""); setEntries((await api<{ entries: Entry[] }>("/v1/student/timetable")).entries); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "Your timetable could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const visible = useMemo(() => entries.filter((entry) => entry.day_of_week === day), [day, entries]);

  async function add() {
    setSaving(true); setError("");
    try {
      await api("/v1/student/timetable", { method: "POST", body: JSON.stringify({ title, courseCode: code || undefined, venue: venue || undefined, lecturer: lecturer || undefined, dayOfWeek: day, startsAt, endsAt, reminderMinutes: 15, reminderEnabled: true }) });
      setTitle(""); setCode(""); setVenue(""); setLecturer(""); setEditing(false); await load();
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : "The class could not be added."); }
    finally { setSaving(false); }
  }

  async function remove(id: string) {
    try { await api(`/v1/student/timetable/${id}`, { method: "DELETE" }); setEntries((items) => items.filter((item) => item.id !== id)); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : "The class could not be removed."); }
  }

  return (
    <ProductScreen>
      <AppHeader badge={{ icon: "calendar", text: `${entries.length} saved ${entries.length === 1 ? "class" : "classes"}` }} showBell={false} subtitle="A schedule that belongs to you" title="My timetable" unread={false} />
      <View style={styles.days}>{days.map((label, index) => <Pressable key={label} onPress={() => setDay(index)} style={[styles.day, day === index && styles.dayActive]}><Text style={[styles.dayText, day === index && styles.dayTextActive]}>{label}</Text></Pressable>)}</View>
      <Pressable onPress={() => setEditing((value) => !value)} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}><Ionicons name={editing ? "close" : "add"} size={21} color="#FFFFFF" /><Text style={styles.addButtonText}>{editing ? "Close editor" : `Add a ${days[day]} class`}</Text></Pressable>
      {editing ? (
        <View style={styles.editor}>
          <Text style={styles.editorTitle}>New class</Text>
          <Field label="Class title" onChangeText={setTitle} placeholder="Data Structures" value={title} />
          <View style={styles.double}><View style={styles.half}><Field label="Course code" onChangeText={setCode} placeholder="CSC 211" value={code} /></View><View style={styles.half}><Field label="Venue" onChangeText={setVenue} placeholder="LT 3" value={venue} /></View></View>
          <Field label="Lecturer (optional)" onChangeText={setLecturer} placeholder="Dr Ehiaguina" value={lecturer} />
          <View style={styles.double}><View style={styles.half}><Field label="Starts" onChangeText={setStartsAt} placeholder="09:00" value={startsAt} /></View><View style={styles.half}><Field label="Ends" onChangeText={setEndsAt} placeholder="10:00" value={endsAt} /></View></View>
          {error ? <Text style={styles.formError}>{error}</Text> : null}
          <Pressable disabled={!title || saving} onPress={() => void add()} style={[styles.save, (!title || saving) && styles.disabled]}>{saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>Save class</Text>}</Pressable>
        </View>
      ) : null}
      {!editing && error ? <Pressable onPress={() => { setLoading(true); void load(); }} style={styles.error}><Ionicons name="cloud-offline-outline" size={20} color={theme.deepBrand} /><Text style={styles.errorText}>{error} Tap to retry.</Text></Pressable> : null}
      {loading ? <ActivityIndicator color={theme.brand} style={styles.loading} /> : null}
      {!loading && !visible.length ? <EmptyResult body={`Add your ${days[day]} classes to make Today useful and keep reminders in one place.`} title={`No ${days[day]} classes yet`} /> : null}
      <View style={styles.list}>{visible.map((entry) => (
        <View key={entry.id} style={styles.row}>
          <View style={styles.time}><Text style={styles.start}>{entry.starts_at}</Text><Text style={styles.end}>{entry.ends_at}</Text></View>
          <View style={styles.rail}><View style={styles.dot} /></View>
          <View style={styles.card}><Text style={styles.code}>{entry.course_code ?? "CLASS"}</Text><Text style={styles.title}>{entry.title}</Text><View style={styles.meta}><Ionicons name="location-outline" size={14} color={theme.brandPressed} /><Text style={styles.metaText}>{entry.venue ?? "Venue not added"}</Text></View>{entry.lecturer ? <View style={styles.meta}><Ionicons name="person-outline" size={14} color={theme.textMuted} /><Text style={styles.metaText}>{entry.lecturer}</Text></View> : null}</View>
          <Pressable accessibilityLabel={`Delete ${entry.title}`} hitSlop={10} onPress={() => void remove(entry.id)} style={styles.delete}><Ionicons name="trash-outline" size={18} color={theme.deepBrand} /></Pressable>
        </View>
      ))}</View>
    </ProductScreen>
  );
}

function Field({ label, ...props }: { label: string; placeholder: string; value: string; onChangeText: (value: string) => void }) {
  return <View style={styles.fieldWrap}><Text style={styles.label}>{label}</Text><TextInput placeholderTextColor={theme.textSubtle} style={styles.field} {...props} /></View>;
}

const styles = StyleSheet.create({
  days: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 18, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", padding: 5 }, day: { alignItems: "center", borderRadius: 13, flex: 1, minHeight: 46, justifyContent: "center" }, dayActive: { backgroundColor: theme.brand }, dayText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 10.5 }, dayTextActive: { color: "#FFFFFF", fontFamily: theme.font.bold },
  addButton: { alignItems: "center", alignSelf: "flex-start", backgroundColor: theme.text, borderRadius: 15, flexDirection: "row", gap: 7, marginBottom: 20, marginTop: 13, minHeight: 46, paddingHorizontal: 15 }, addButtonText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 12 },
  editor: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 22, borderWidth: 1, marginBottom: 22, padding: 16, ...theme.shadow }, editorTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 20, marginBottom: 14 }, fieldWrap: { marginBottom: 12 }, label: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 10.5, marginBottom: 6 }, field: { backgroundColor: theme.canvas, borderColor: theme.border, borderRadius: 13, borderWidth: 1, color: theme.text, fontFamily: theme.font.body, fontSize: 13, minHeight: 48, paddingHorizontal: 12 }, double: { flexDirection: "row", gap: 9 }, half: { flex: 1 }, save: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 14, height: 50, justifyContent: "center", marginTop: 4 }, saveText: { color: "#FFFFFF", fontFamily: theme.font.bold, fontSize: 13 }, disabled: { opacity: .45 }, formError: { color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 11.5, marginBottom: 8 },
  error: { alignItems: "center", backgroundColor: "#FFF0EB", borderRadius: 16, flexDirection: "row", gap: 9, marginBottom: 15, padding: 13 }, errorText: { color: theme.deepBrand, flex: 1, fontFamily: theme.font.medium, fontSize: 12 }, loading: { marginVertical: 34 }, list: { gap: 4 }, row: { alignItems: "stretch", flexDirection: "row", minHeight: 112 }, time: { paddingTop: 18, width: 52 }, start: { color: theme.text, fontFamily: theme.font.bold, fontSize: 12 }, end: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 10, marginTop: 3 }, rail: { alignItems: "center", backgroundColor: theme.border, marginHorizontal: 7, width: 2 }, dot: { backgroundColor: theme.brand, borderColor: theme.canvas, borderRadius: 8, borderWidth: 3, height: 16, marginTop: 18, width: 16 }, card: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 18, borderWidth: 1, flex: 1, marginBottom: 10, padding: 13 }, code: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 9, letterSpacing: .7 }, title: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14, marginBottom: 5, marginTop: 3 }, meta: { alignItems: "center", flexDirection: "row", gap: 4, marginTop: 4 }, metaText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 10.5 }, delete: { alignItems: "center", alignSelf: "center", backgroundColor: "#FFF0EB", borderRadius: 12, height: 38, justifyContent: "center", marginLeft: 7, width: 38 }, pressed: { opacity: .78, transform: [{ scale: .98 }] },
});
