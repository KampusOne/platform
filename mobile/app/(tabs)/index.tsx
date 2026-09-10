import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { InlineFeedback, ProductScreen } from "@/src/components/product-ui";
import { SectionHeading } from "@/src/components/section-heading";
import { theme } from "@/src/theme";

const agenda = [
  { id: "csc", start: "10:00", end: "12:00", code: "CSC 211", room: "Lecture Theatre 3", status: "Next", tone: "brand" },
  { id: "edu", start: "13:00", end: "14:00", code: "EDU 201", room: "Faculty of Education", status: "Later", tone: "neutral" },
  { id: "mth", start: "15:00", end: "17:00", code: "MTH 213", room: "Hall B", status: "Later", tone: "neutral" },
  { id: "group", start: "18:30", end: "19:00", code: "Project check-in", room: "Online", status: "Personal", tone: "success" },
] as const;

const quickActions = [
  { key: "timetable", icon: "calendar-outline", name: "Timetable", detail: "4 things today" },
  { key: "campus", icon: "navigate-outline", name: "Campus map", detail: "LT 3 is 7 min away" },
  { key: "gpa", icon: "calculator-outline", name: "GPA planner", detail: "Last saved 3.72" },
  { key: "files", icon: "folder-open-outline", name: "Saved files", detail: "12 available offline" },
] as const;

const deadlines = [
  { id: "assignment", title: "CSC 211 assignment", due: "Due tomorrow · 18:00", icon: "document-text-outline" },
  { id: "registration", title: "Course registration", due: "Closes Friday · 23:59", icon: "school-outline" },
] as const;

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function TodayScreen() {
  const [reminderOn, setReminderOn] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [completed, setCompleted] = useState<string[]>([]);
  const date = useMemo(
    () => new Intl.DateTimeFormat("en-NG", { weekday: "long", day: "numeric", month: "long" }).format(new Date()),
    [],
  );

  function tap() {
    void Haptics.selectionAsync();
  }

  function toggleReminder() {
    tap();
    setReminderOn((value) => !value);
    setFeedback(reminderOn ? "Class reminder removed." : "Reminder set for 9:40 AM.");
  }

  function handleQuickAction(key: (typeof quickActions)[number]["key"]) {
    tap();
    if (key === "campus") {
      router.push("/campus");
      return;
    }
    if (key === "timetable") {
      setShowAll(true);
      setFeedback("Today’s full timetable is open below.");
      return;
    }
    setFeedback(key === "gpa" ? "GPA planner preview selected." : "Your offline files preview is ready.");
  }

  function toggleDeadline(id: string) {
    tap();
    setCompleted((items) => (items.includes(id) ? items.filter((item) => item !== id) : [...items, id]));
  }

  return (
    <ProductScreen>
      <AppHeader
        onBellPress={() => {
          tap();
          setNotificationsOpen((value) => !value);
        }}
        subtitle={`${date} · Preview`}
        title={`${greeting()}, Gideon`}
        unread={!notificationsOpen}
      />

      {notificationsOpen ? (
        <View style={styles.notifications}>
          <View style={styles.notificationTop}>
            <Text style={styles.notificationTitle}>Notifications</Text>
            <Text style={styles.notificationCount}>2 new</Text>
          </View>
          <Text style={styles.notificationBody}>Your CSC 211 class starts at 10:00 AM.</Text>
          <View style={styles.notificationRule} />
          <Text style={styles.notificationBody}>Course registration closes Friday night.</Text>
        </View>
      ) : null}

      {feedback ? <InlineFeedback message={feedback} tone={feedback.includes("set") ? "success" : "brand"} /> : null}

      <Pressable
        accessibilityRole="button"
        onPress={() => setFeedback("The Hall 3 notice is open in Feed.")}
        style={({ pressed }) => [styles.notice, pressed && styles.pressed]}
      >
        <Ionicons name="megaphone-outline" size={20} color={theme.brandPressed} />
        <View style={styles.noticeCopy}>
          <Text style={styles.noticeTitle}>Water will be off in Hall 3 from 2 PM</Text>
          <Text style={styles.noticeMeta}>Works department · 40 minutes ago</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.brandPressed} />
      </Pressable>

      <View style={styles.nextCard}>
        <View style={styles.nextMain}>
          <View style={styles.nextBar} />
          <View style={styles.nextCopy}>
            <View style={styles.nextTopline}>
              <Text style={styles.nextLabel}>Next class · in 42 minutes</Text>
              <View style={styles.previewBadge}><Text style={styles.previewBadgeText}>Sample</Text></View>
            </View>
            <Text style={styles.courseTitle}>CSC 211 — Data Structures</Text>
            <Text style={styles.courseMeta}>10:00–12:00 · Lecture Theatre 3</Text>
            <Text style={styles.courseMeta}>Dr Ehiaguina</Text>
          </View>
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              tap();
              router.push("/campus");
            }}
            style={({ pressed }) => [styles.softAction, pressed && styles.pressed]}
          >
            <Ionicons name="navigate-outline" size={18} color={theme.brandPressed} />
            <Text style={styles.softActionText}>Directions</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: reminderOn }}
            onPress={toggleReminder}
            style={({ pressed }) => [styles.outlineAction, reminderOn && styles.outlineActionSelected, pressed && styles.pressed]}
          >
            <Ionicons name={reminderOn ? "checkmark-circle" : "alarm-outline"} size={18} color={reminderOn ? theme.success : theme.text} />
            <Text style={[styles.outlineActionText, reminderOn && styles.reminderText]}>{reminderOn ? "Reminder on" : "Remind me"}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeading
          meta={showAll ? "Show less" : "Full timetable"}
          onPress={() => {
            tap();
            setShowAll((value) => !value);
          }}
          title="Today"
        />
        <View style={styles.scheduleList}>
          {agenda.slice(0, showAll ? agenda.length : 3).map((item) => (
            <View style={styles.scheduleRow} key={item.id}>
              <View style={styles.timeBlock}>
                <Text style={styles.startTime}>{item.start}</Text>
                <Text style={styles.endTime}>{item.end}</Text>
              </View>
              <View style={[styles.scheduleBar, item.tone === "success" && styles.scheduleBarSuccess]} />
              <View style={styles.scheduleCopy}>
                <Text style={styles.scheduleTitle}>{item.code}</Text>
                <Text style={styles.scheduleRoom}>{item.room}</Text>
              </View>
              <View style={[styles.status, item.tone === "success" && styles.statusSuccess]}>
                <Text style={[styles.statusText, item.tone === "success" && styles.statusTextSuccess]}>{item.status}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeading title="Quick actions" />
        <View style={styles.quickGrid}>
          {quickActions.map((action) => (
            <Pressable
              accessibilityRole="button"
              key={action.key}
              onPress={() => handleQuickAction(action.key)}
              style={({ pressed }) => [styles.quickCard, pressed && styles.cardPressed]}
            >
              <View style={styles.quickTop}>
                <View style={styles.quickIcon}><Ionicons name={action.icon} size={21} color={theme.brand} /></View>
                <Ionicons name="chevron-forward" size={17} color={theme.textSubtle} />
              </View>
              <Text style={styles.quickTitle}>{action.name}</Text>
              <Text style={styles.quickDetail}>{action.detail}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeading meta="2 due soon" title="Deadlines" />
        <View style={styles.deadlineList}>
          {deadlines.map((deadline) => {
            const isDone = completed.includes(deadline.id);
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isDone }}
                key={deadline.id}
                onPress={() => toggleDeadline(deadline.id)}
                style={({ pressed }) => [styles.deadlineRow, pressed && styles.pressed]}
              >
                <View style={styles.deadlineIcon}><Ionicons name={deadline.icon} size={20} color={theme.brand} /></View>
                <View style={styles.deadlineCopy}>
                  <Text style={[styles.deadlineTitle, isDone && styles.doneText]}>{deadline.title}</Text>
                  <Text style={styles.deadlineDue}>{isDone ? "Marked complete" : deadline.due}</Text>
                </View>
                <Ionicons name={isDone ? "checkmark-circle" : "ellipse-outline"} size={23} color={isDone ? theme.success : theme.textSubtle} />
              </Pressable>
            );
          })}
        </View>
      </View>

      <Text style={styles.disclaimer}>Preview data only. Your real timetable and records will appear after sign-in.</Text>
    </ProductScreen>
  );
}

const styles = StyleSheet.create({
  notifications: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 18, borderWidth: 1, marginBottom: 14, padding: 16, ...theme.shadow },
  notificationTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  notificationTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 17 },
  notificationCount: { color: theme.brand, fontFamily: theme.font.semibold, fontSize: 12 },
  notificationBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13.5, lineHeight: 19 },
  notificationRule: { backgroundColor: theme.border, height: StyleSheet.hairlineWidth, marginVertical: 10 },
  notice: { alignItems: "center", backgroundColor: "rgba(168,70,46,0.08)", borderColor: "rgba(168,70,46,0.24)", borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 11, marginTop: 14, padding: 14 },
  noticeCopy: { flex: 1 },
  noticeTitle: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 13.5, lineHeight: 19 },
  noticeMeta: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, marginTop: 2 },
  nextCard: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 22, borderWidth: 1, marginTop: 18, padding: 18, ...theme.shadow },
  nextMain: { flexDirection: "row", gap: 12 },
  nextBar: { backgroundColor: theme.brand, borderRadius: 3, width: 4 },
  nextCopy: { flex: 1 },
  nextTopline: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  nextLabel: { color: theme.brand, flex: 1, fontFamily: theme.font.bold, fontSize: 11.5, letterSpacing: 0.45, textTransform: "uppercase" },
  previewBadge: { backgroundColor: theme.surfaceMuted, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 },
  previewBadgeText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 10.5 },
  courseTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 21, lineHeight: 25, marginTop: 7 },
  courseMeta: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13, lineHeight: 19, marginTop: 4 },
  actions: { flexDirection: "row", gap: 9, marginTop: 16 },
  softAction: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.3)", borderRadius: 12, flex: 1, flexDirection: "row", gap: 7, justifyContent: "center", minHeight: 45 },
  softActionText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 13 },
  outlineAction: { alignItems: "center", borderColor: theme.border, borderRadius: 12, borderWidth: 1.5, flex: 1, flexDirection: "row", gap: 7, justifyContent: "center", minHeight: 45 },
  outlineActionSelected: { backgroundColor: "rgba(45,125,89,0.08)", borderColor: "rgba(45,125,89,0.24)" },
  outlineActionText: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13 },
  reminderText: { color: theme.success },
  section: { marginTop: 27 },
  scheduleList: { gap: 9 },
  scheduleRow: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: "rgba(41,35,31,0.07)", borderRadius: 16, borderWidth: 1, flexDirection: "row", minHeight: 70, padding: 13 },
  timeBlock: { alignItems: "center", width: 52 },
  startTime: { color: theme.text, fontFamily: theme.font.bold, fontSize: 13.5 },
  endTime: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 11.5, marginTop: 2 },
  scheduleBar: { backgroundColor: theme.brand, borderRadius: 3, height: 36, marginHorizontal: 11, width: 3 },
  scheduleBarSuccess: { backgroundColor: theme.success },
  scheduleCopy: { flex: 1 },
  scheduleTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14.5 },
  scheduleRoom: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 12, marginTop: 3 },
  status: { backgroundColor: theme.surfaceMuted, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  statusSuccess: { backgroundColor: "rgba(45,125,89,0.1)" },
  statusText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 11 },
  statusTextSuccess: { color: theme.success },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  quickCard: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 18, borderWidth: 1, minHeight: 126, padding: 14, width: "48.5%" },
  quickTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  quickIcon: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 13, height: 42, justifyContent: "center", width: 42 },
  quickTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14, marginTop: 12 },
  quickDetail: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 12, lineHeight: 17, marginTop: 3 },
  deadlineList: { gap: 9 },
  deadlineRow: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 16, borderWidth: 1, flexDirection: "row", gap: 12, minHeight: 70, padding: 13 },
  deadlineIcon: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 13, height: 42, justifyContent: "center", width: 42 },
  deadlineCopy: { flex: 1 },
  deadlineTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14 },
  deadlineDue: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 12, marginTop: 3 },
  doneText: { color: theme.textSubtle, textDecorationLine: "line-through" },
  disclaimer: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17, marginTop: 28, textAlign: "center" },
  pressed: { opacity: 0.74, transform: [{ scale: 0.99 }] },
  cardPressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
