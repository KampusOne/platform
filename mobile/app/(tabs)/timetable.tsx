import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";

import { ProductScreen } from "@/src/components/product-ui";
import { ApiError, api } from "@/src/lib/api";
import { theme } from "@/src/theme";

const days = [
  { short: "Sun", long: "Sunday" },
  { short: "Mon", long: "Monday" },
  { short: "Tue", long: "Tuesday" },
  { short: "Wed", long: "Wednesday" },
  { short: "Thu", long: "Thursday" },
  { short: "Fri", long: "Friday" },
  { short: "Sat", long: "Saturday" },
] as const;

type Entry = {
  id: string;
  title: string;
  course_code: string | null;
  venue: string | null;
  lecturer: string | null;
  day_of_week: number;
  starts_at: string;
  ends_at: string;
  reminder_minutes: number;
  reminder_enabled: boolean;
};

export default function TimetableScreen() {
  const currentDay = new Date().getDay();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [day, setDay] = useState(currentDay);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [venue, setVenue] = useState("");
  const [lecturer, setLecturer] = useState("");
  const [startsAt, setStartsAt] = useState("09:00");
  const [endsAt, setEndsAt] = useState("10:00");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      setEntries((await api<{ entries: Entry[] }>("/v1/student/timetable")).entries);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Your timetable could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const visible = useMemo(
    () => entries
      .filter((entry) => entry.day_of_week === day)
      .sort((first, second) => first.starts_at.localeCompare(second.starts_at)),
    [day, entries],
  );
  const selectedDay = days[day] ?? days[0];

  const canSave = title.trim().length > 0 && !saving;

  async function add() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      await api("/v1/student/timetable", {
        method: "POST",
        body: JSON.stringify({
          title,
          courseCode: code || undefined,
          venue: venue || undefined,
          lecturer: lecturer || undefined,
          dayOfWeek: day,
          startsAt,
          endsAt,
          reminderMinutes: 15,
          reminderEnabled: false,
        }),
      });
      setTitle("");
      setCode("");
      setVenue("");
      setLecturer("");
      setEditing(false);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The class could not be added.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setDeletingId(id);
    setError("");
    try {
      await api(`/v1/student/timetable/${id}`, { method: "DELETE" });
      setEntries((items) => items.filter((item) => item.id !== id));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The class could not be removed.");
    } finally {
      setDeletingId(null);
    }
  }

  function toggleEditor() {
    setError("");
    setEditing((value) => !value);
  }

  function retry() {
    setLoading(true);
    void load();
  }

  return (
    <ProductScreen>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={4}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-back" size={22} color={theme.text} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>ACADEMICS</Text>
          <Text style={styles.pageTitle}>My timetable</Text>
          <Text style={styles.subtitle}>Classes, venues and reminder preferences in time order.</Text>
        </View>
      </View>

      <ScrollView
        accessibilityLabel="Choose timetable day"
        contentContainerStyle={styles.dayContent}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.dayScroller}
      >
        {days.map((item, index) => {
          const selected = day === index;
          const today = currentDay === index;
          return (
            <Pressable
              accessibilityLabel={`${item.long}${today ? ", today" : ""}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={item.short}
              onPress={() => setDay(index)}
              style={({ pressed }) => [styles.day, selected && styles.dayActive, pressed && styles.pressed]}
            >
              <Text style={[styles.dayText, selected && styles.dayTextActive]}>{item.short}</Text>
              <View style={[styles.todayDot, today && styles.todayDotVisible, today && selected && styles.todayDotActive]} />
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.scheduleHeading}>
        <View>
          <Text style={styles.sectionTitle}>{currentDay === day ? "Today" : selectedDay.long}</Text>
          <Text style={styles.sectionMeta}>{visible.length} {visible.length === 1 ? "class" : "classes"}</Text>
        </View>
        <Pressable
          accessibilityLabel={editing ? "Close class form" : `Add a class on ${selectedDay.long}`}
          accessibilityRole="button"
          onPress={toggleEditor}
          style={({ pressed }) => [styles.addAction, editing && styles.closeAction, pressed && styles.pressed]}
        >
          <Ionicons name={editing ? "close" : "add"} size={19} color={editing ? theme.deepBrand : "#FFFFFF"} />
          <Text style={[styles.addActionText, editing && styles.closeActionText]}>{editing ? "Close" : "Add class"}</Text>
        </Pressable>
      </View>

      {editing ? (
        <View style={styles.editor}>
          <View style={styles.editorHeading}>
            <View style={styles.editorIcon}>
              <Ionicons name="calendar-outline" size={20} color={theme.deepBrand} />
            </View>
            <View style={styles.editorCopy}>
              <Text style={styles.editorTitle}>New {selectedDay.long} class</Text>
              <Text style={styles.editorHint}>Device alerts are not enabled yet, so new classes are saved without reminders.</Text>
            </View>
          </View>
          <Field autoCapitalize="words" label="Class title" onChangeText={setTitle} placeholder="Data Structures" value={title} />
          <View style={styles.double}>
            <View style={styles.half}>
              <Field autoCapitalize="characters" label="Course code" onChangeText={setCode} placeholder="CSC 211" value={code} />
            </View>
            <View style={styles.half}>
              <Field autoCapitalize="words" label="Venue" onChangeText={setVenue} placeholder="LT 3" value={venue} />
            </View>
          </View>
          <Field autoCapitalize="words" label="Lecturer (optional)" onChangeText={setLecturer} placeholder="Dr Ehiaguina" value={lecturer} />
          <View style={styles.double}>
            <View style={styles.half}>
              <Field keyboardType="numbers-and-punctuation" label="Starts" onChangeText={setStartsAt} placeholder="09:00" value={startsAt} />
            </View>
            <View style={styles.half}>
              <Field keyboardType="numbers-and-punctuation" label="Ends" onChangeText={setEndsAt} placeholder="10:00" value={endsAt} />
            </View>
          </View>
          {error ? <Text accessibilityRole="alert" style={styles.formError}>{error}</Text> : null}
          <Pressable
            accessibilityLabel={saving ? "Saving class" : "Save class"}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave, busy: saving }}
            disabled={!canSave}
            onPress={() => void add()}
            style={({ pressed }) => [styles.save, !canSave && styles.disabled, pressed && canSave && styles.pressed]}
          >
            {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={[styles.saveText, !canSave && styles.disabledText]}>Save class</Text>}
          </Pressable>
        </View>
      ) : null}

      {!editing && error ? <ErrorNotice message={error} onRetry={retry} /> : null}
      {loading ? <TimelineSkeleton /> : null}
      {!loading && !error && visible.length === 0 ? <ScheduleEmpty day={selectedDay.long} /> : null}
      {!loading && visible.length > 0 ? (
        <View accessibilityLabel={`${selectedDay.long} class schedule`} style={styles.timeline}>
          {visible.map((entry, index) => (
            <View key={entry.id} style={styles.timelineRow}>
              <View style={styles.timeColumn}>
                <Text style={styles.start}>{entry.starts_at}</Text>
                <Text style={styles.end}>{entry.ends_at}</Text>
              </View>
              <View style={styles.railColumn}>
                <View style={styles.dot} />
                {index < visible.length - 1 ? <View style={styles.rail} /> : null}
              </View>
              <View style={styles.classBlock}>
                <View style={styles.classTopline}>
                  <Text style={styles.code}>{entry.course_code ?? "CLASS"}</Text>
                  <Pressable
                    accessibilityHint="Removes this class from your timetable"
                    accessibilityLabel={`Delete ${entry.title}`}
                    accessibilityRole="button"
                    accessibilityState={{ busy: deletingId === entry.id, disabled: deletingId !== null }}
                    disabled={deletingId !== null}
                    hitSlop={4}
                    onPress={() => void remove(entry.id)}
                    style={({ pressed }) => [styles.delete, pressed && styles.deletePressed]}
                  >
                    {deletingId === entry.id
                      ? <ActivityIndicator color={theme.deepBrand} size="small" />
                      : <Ionicons name="trash-outline" size={18} color={theme.deepBrand} />}
                  </Pressable>
                </View>
                <Text style={styles.classTitle}>{entry.title}</Text>
                <View style={styles.detailRow}>
                  <Ionicons name="location-outline" size={16} color={theme.deepBrand} />
                  <Text style={styles.detailText}>{entry.venue ?? "Venue not added"}</Text>
                </View>
                {entry.lecturer ? (
                  <View style={styles.detailRow}>
                    <Ionicons name="person-outline" size={16} color={theme.textMuted} />
                    <Text style={styles.detailText}>{entry.lecturer}</Text>
                  </View>
                ) : null}
                <View style={styles.reminderRow}>
                  <Ionicons
                    name={entry.reminder_enabled ? "time-outline" : "notifications-off-outline"}
                    size={15}
                    color={entry.reminder_enabled ? theme.deepBrand : theme.textMuted}
                  />
                  <Text style={[styles.reminderText, entry.reminder_enabled && styles.reminderOn]}>
                    {entry.reminder_enabled ? `${entry.reminder_minutes} min preference · device alerts unavailable` : "Reminder preference off"}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </ProductScreen>
  );
}

function Field({ label, ...props }: TextInputProps & { label: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        onBlur={() => setFocused(false)}
        onFocus={() => setFocused(true)}
        placeholderTextColor={theme.textMuted}
        style={[styles.field, focused && styles.fieldFocused]}
        {...props}
      />
    </View>
  );
}

function ErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View accessibilityRole="alert" style={styles.errorNotice}>
      <Ionicons name="cloud-offline-outline" size={22} color={theme.deepBrand} />
      <View style={styles.errorCopy}>
        <Text style={styles.errorTitle}>Timetable unavailable</Text>
        <Text style={styles.errorText}>{message}</Text>
      </View>
      <Pressable accessibilityLabel="Retry timetable" accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

function TimelineSkeleton() {
  return (
    <View accessibilityLabel="Loading timetable" accessibilityRole="progressbar" style={styles.skeletonWrap}>
      {[0, 1, 2].map((item) => (
        <View key={item} style={styles.skeletonRow}>
          <View style={styles.skeletonTime} />
          <View style={styles.skeletonDot} />
          <View style={styles.skeletonBlock}>
            <View style={styles.skeletonShort} />
            <View style={styles.skeletonLong} />
            <View style={styles.skeletonMedium} />
          </View>
        </View>
      ))}
    </View>
  );
}

function ScheduleEmpty({ day }: { day: string }) {
  return (
    <View style={styles.empty}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.emptyArt}>
        <View style={styles.emptyPage}>
          <View style={styles.emptyBinding} />
          <View style={styles.emptyLineLong} />
          <View style={styles.emptyLineShort} />
          <View style={styles.emptyClock}>
            <Ionicons name="time-outline" size={27} color={theme.deepBrand} />
          </View>
        </View>
      </View>
      <Text style={styles.emptyTitle}>No {day} classes yet</Text>
      <Text style={styles.emptyBody}>Add the schedule once and KampusOne will keep this day and its reminder preferences together.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "flex-start", flexDirection: "row", gap: 12, paddingBottom: 18, paddingTop: 6 },
  backButton: { alignItems: "center", height: 44, justifyContent: "center", marginLeft: -10, width: 44 },
  headerCopy: { flex: 1 },
  eyebrow: { color: theme.deepBrand, fontFamily: theme.font.bold, fontSize: 11, letterSpacing: 1.15 },
  pageTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 27, letterSpacing: -0.45, lineHeight: 33, marginTop: 2 },
  subtitle: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14, lineHeight: 21, marginTop: 2 },
  dayScroller: { marginHorizontal: -20 },
  dayContent: { gap: 8, paddingHorizontal: 20, paddingVertical: 2 },
  day: { alignItems: "center", borderColor: theme.border, borderRadius: 12, borderWidth: 1, height: 48, justifyContent: "center", width: 54 },
  dayActive: { backgroundColor: theme.sand, borderColor: "rgba(168,70,46,0.28)" },
  dayText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 13 },
  dayTextActive: { color: theme.deepBrand, fontFamily: theme.font.bold },
  todayDot: { backgroundColor: "transparent", borderRadius: 2, height: 4, marginTop: 3, width: 4 },
  todayDotVisible: { backgroundColor: theme.brand },
  todayDotActive: { backgroundColor: theme.deepBrand },
  scheduleHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 18, marginTop: 24 },
  sectionTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 20, lineHeight: 25 },
  sectionMeta: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, marginTop: 2 },
  addAction: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 14, flexDirection: "row", gap: 7, height: 48, justifyContent: "center", paddingHorizontal: 15 },
  addActionText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 14 },
  closeAction: { backgroundColor: "transparent", borderColor: "rgba(168,70,46,0.35)", borderWidth: 1.5 },
  closeActionText: { color: theme.deepBrand },
  editor: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 20, borderWidth: 1, marginBottom: 24, padding: 18 },
  editorHeading: { alignItems: "center", flexDirection: "row", gap: 11, marginBottom: 18 },
  editorIcon: { alignItems: "center", backgroundColor: theme.surfaceTint, borderRadius: 12, height: 42, justifyContent: "center", width: 42 },
  editorCopy: { flex: 1 },
  editorTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 19, lineHeight: 24 },
  editorHint: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  fieldWrap: { marginBottom: 14 },
  label: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 13, marginBottom: 7 },
  field: { backgroundColor: theme.canvas, borderColor: "rgba(41,35,31,0.18)", borderRadius: 15, borderWidth: 1.5, color: theme.text, fontFamily: theme.font.body, fontSize: 15, minHeight: 52, paddingHorizontal: 15 },
  fieldFocused: { borderColor: theme.brand, shadowColor: theme.brand, shadowOffset: { height: 0, width: 0 }, shadowOpacity: 0.14, shadowRadius: 4 },
  double: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  formError: { color: theme.deepBrand, fontFamily: theme.font.medium, fontSize: 13, lineHeight: 19, marginBottom: 10 },
  save: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 16, height: 52, justifyContent: "center", marginTop: 2 },
  saveText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 15.5 },
  disabled: { backgroundColor: "rgba(41,35,31,0.08)" },
  disabledText: { color: theme.textMuted },
  errorNotice: { alignItems: "center", backgroundColor: "rgba(168,70,46,0.07)", borderColor: "rgba(168,70,46,0.24)", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 20, padding: 14 },
  errorCopy: { flex: 1 },
  errorTitle: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 14 },
  errorText: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  retry: { alignItems: "center", borderColor: "rgba(168,70,46,0.32)", borderRadius: 11, borderWidth: 1, height: 44, justifyContent: "center", paddingHorizontal: 12 },
  retryText: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 13 },
  timeline: { paddingBottom: 8 },
  timelineRow: { alignItems: "stretch", flexDirection: "row", minHeight: 148 },
  timeColumn: { paddingTop: 4, width: 50 },
  start: { color: theme.text, fontFamily: theme.font.bold, fontSize: 13, fontVariant: ["tabular-nums"] },
  end: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, fontVariant: ["tabular-nums"], marginTop: 4 },
  railColumn: { alignItems: "center", marginHorizontal: 9, width: 14 },
  dot: { backgroundColor: theme.brand, borderColor: theme.canvas, borderRadius: 7, borderWidth: 3, height: 14, marginTop: 5, width: 14 },
  rail: { backgroundColor: "rgba(195,93,56,0.22)", flex: 1, marginBottom: -5, width: 2 },
  classBlock: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 18, borderWidth: 1, flex: 1, marginBottom: 14, paddingBottom: 15, paddingHorizontal: 16, paddingTop: 12 },
  classTopline: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  code: { color: theme.deepBrand, fontFamily: theme.font.bold, fontSize: 11, letterSpacing: 0.75 },
  delete: { alignItems: "center", borderRadius: 10, height: 44, justifyContent: "center", marginRight: -10, marginTop: -8, width: 44 },
  deletePressed: { backgroundColor: "rgba(168,70,46,0.08)", transform: [{ scale: 0.97 }] },
  classTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 16, lineHeight: 22, marginBottom: 8, marginTop: -2 },
  detailRow: { alignItems: "center", flexDirection: "row", gap: 7, marginTop: 5 },
  detailText: { color: theme.textMuted, flex: 1, fontFamily: theme.font.body, fontSize: 13, lineHeight: 18 },
  reminderRow: { alignItems: "center", borderTopColor: theme.border, borderTopWidth: 1, flexDirection: "row", gap: 6, marginTop: 11, paddingTop: 10 },
  reminderText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 12.5 },
  reminderOn: { color: theme.deepBrand },
  skeletonWrap: { gap: 15, paddingTop: 2 },
  skeletonRow: { alignItems: "flex-start", flexDirection: "row" },
  skeletonTime: { backgroundColor: theme.surfaceMuted, borderRadius: 6, height: 14, marginTop: 5, width: 42 },
  skeletonDot: { backgroundColor: theme.sand, borderRadius: 7, height: 14, marginHorizontal: 16, marginTop: 5, width: 14 },
  skeletonBlock: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 18, borderWidth: 1, flex: 1, gap: 10, padding: 16 },
  skeletonShort: { backgroundColor: theme.surfaceMuted, borderRadius: 5, height: 10, width: "30%" },
  skeletonLong: { backgroundColor: theme.surfaceMuted, borderRadius: 6, height: 16, width: "76%" },
  skeletonMedium: { backgroundColor: theme.surfaceMuted, borderRadius: 5, height: 11, width: "58%" },
  empty: { alignItems: "center", paddingHorizontal: 18, paddingVertical: 32 },
  emptyArt: { alignItems: "center", height: 142, justifyContent: "center", width: 180 },
  emptyPage: { backgroundColor: theme.surfaceRaised, borderColor: "rgba(168,70,46,0.20)", borderRadius: 20, borderWidth: 1.5, height: 116, paddingHorizontal: 19, paddingTop: 27, transform: [{ rotate: "-3deg" }], width: 138 },
  emptyBinding: { backgroundColor: theme.brand, borderRadius: 4, height: 8, left: 21, position: "absolute", right: 21, top: -4 },
  emptyLineLong: { backgroundColor: theme.sand, borderRadius: 4, height: 9, width: 82 },
  emptyLineShort: { backgroundColor: theme.surfaceTint, borderRadius: 4, height: 9, marginTop: 10, width: 58 },
  emptyClock: { alignItems: "center", backgroundColor: theme.sand, borderColor: theme.canvas, borderRadius: 26, borderWidth: 5, bottom: -22, height: 52, justifyContent: "center", position: "absolute", right: -22, width: 52 },
  emptyTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 20, lineHeight: 25, textAlign: "center" },
  emptyBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14, lineHeight: 21, marginTop: 7, maxWidth: 310, textAlign: "center" },
  pressed: { opacity: 0.82, transform: [{ scale: 0.97 }] },
});
