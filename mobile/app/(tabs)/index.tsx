import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { InlineFeedback, ProductScreen } from "@/src/components/product-ui";
import { SectionHeading } from "@/src/components/section-heading";
import { GlassCard, MotivationBanner, PressScale, useReducedMotionPreference } from "@/src/components/visual-system";
import { theme } from "@/src/theme";

const agenda = [
  { id: "csc", start: "10:00", end: "12:00", code: "CSC 211 — Data Structures", room: "Lecture Theatre 3", status: "Next" },
  { id: "edu", start: "13:00", end: "14:00", code: "EDU 201", room: "Faculty of Education", status: "Later" },
  { id: "mth", start: "15:00", end: "17:00", code: "MTH 213", room: "Hall B", status: "Later" },
] as const;

const quickActions = [
  { key: "gpa", icon: "calculator-outline" as const, label: "GPA planner", meta: "3.72 saved" },
  { key: "files", icon: "folder-open-outline" as const, label: "My files", meta: "12 offline" },
  { key: "alarm", icon: "alarm-outline" as const, label: "Alarm sounds", meta: "Choose a tone" },
] as const;

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function TodayScreen() {
  const [reminderOn, setReminderOn] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const reminderPulse = useRef(new Animated.Value(1)).current;
  const reducedMotion = useReducedMotionPreference();
  const date = useMemo(
    () => new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "long", weekday: "long" }).format(new Date()),
    [],
  );

  function tap() {
    void Haptics.selectionAsync();
  }

  function toggleReminder() {
    const next = !reminderOn;
    setReminderOn(next);
    setFeedback(next ? "Reminder set for 9:40 AM." : "Class reminder removed.");
    void (next ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.selectionAsync());
    if (reducedMotion) {
      reminderPulse.setValue(1);
      return;
    }
    Animated.sequence([
      Animated.timing(reminderPulse, { duration: 90, toValue: 0.78, useNativeDriver: true }),
      Animated.spring(reminderPulse, { damping: 7, stiffness: 260, toValue: 1.14, useNativeDriver: true }),
      Animated.spring(reminderPulse, { damping: 9, stiffness: 220, toValue: 1, useNativeDriver: true }),
    ]).start();
  }

  return (
    <ProductScreen>
      <AppHeader
        onBellPress={() => {
          tap();
          setNotificationsOpen((value) => !value);
        }}
        showStreak
        subtitle={date}
        title={`${greeting()}, Gideon`}
        unread={!notificationsOpen}
      />

      {notificationsOpen ? (
        <GlassCard style={styles.notifications}>
          <View style={styles.notificationTop}>
            <Text style={styles.notificationHeading}>Fresh for you</Text>
            <Text style={styles.notificationCount}>2 new</Text>
          </View>
          <NotificationLine icon="alarm-outline" text="CSC 211 begins at 10:00 AM." />
          <View style={styles.notificationRule} />
          <NotificationLine icon="school-outline" text="Course registration closes Friday night." />
        </GlassCard>
      ) : null}

      {feedback ? <InlineFeedback message={feedback} tone={feedback.includes("set") ? "success" : "brand"} /> : null}

      <View style={styles.alertStack}>
        {reminderOn ? (
          <AlertCard icon="time-outline" title="Reminder set for 9:40 AM" meta="You’re all set. We’ll remind you." onPress={toggleReminder} />
        ) : null}
        <AlertCard
          icon="megaphone-outline"
          meta="Works department · 40 minutes ago"
          onPress={() => {
            tap();
            router.push("/feed");
          }}
          strong
          title="Water will be off in Hall 3 from 2 PM"
        />
      </View>

      <GlassCard style={styles.nextCard}>
        <View style={styles.nextTopline}>
          <View style={styles.nextEyebrowWrap}><View style={styles.nextLine} /><Text style={styles.nextEyebrow}>NEXT CLASS</Text></View>
          <View style={styles.countdown}><Ionicons name="timer-outline" size={17} color={theme.brandPressed} /><Text style={styles.countdownText}>IN 42 MINUTES</Text></View>
        </View>

        <View style={styles.courseRow}>
          <View style={styles.courseBadge}><Text style={styles.courseBadgeText}>CSC{`\n`}211</Text></View>
          <View style={styles.courseCopy}>
            <Text style={styles.courseTitle}>Data Structures</Text>
            <Text style={styles.courseLine}>Time to build something great.</Text>
          </View>
          <BookStack />
        </View>

        <View style={styles.metaRow}>
          <MetaChip icon="time-outline" text="10:00 – 12:00" />
          <MetaChip icon="location-outline" text="Lecture Theatre 3" />
          <MetaChip icon="person-outline" text="Dr Ehiaguina" />
        </View>

        <View style={styles.actions}>
          <PressScale
            accessibilityLabel="Get directions to Lecture Theatre 3"
            onPress={() => {
              tap();
              router.push("/campus");
            }}
            style={styles.primaryAction}
          >
            <Ionicons name="navigate-outline" size={21} color="#FFFFFF" />
            <Text style={styles.primaryActionText}>Get directions</Text>
            <Ionicons name="arrow-forward" size={19} color="#FFFFFF" />
          </PressScale>
          <PressScale accessibilityLabel="Set class reminder" onPress={toggleReminder} style={[styles.secondaryAction, reminderOn && styles.secondaryActionOn]}>
            <Animated.View style={{ transform: [{ scale: reminderPulse }] }}>
              <Ionicons name={reminderOn ? "checkmark-done" : "calendar-outline"} size={20} color={reminderOn ? theme.statusPositive : theme.brandPressed} />
            </Animated.View>
            <Text style={[styles.secondaryActionText, reminderOn && styles.secondaryActionTextOn]}>{reminderOn ? "Reminder set" : "Set reminder"}</Text>
          </PressScale>
        </View>
      </GlassCard>

      <View style={styles.section}>
        <SectionHeading meta="Full timetable" onPress={() => router.push("/timetable")} title="Today" />
        <View style={styles.timeline}>
          <View pointerEvents="none" style={styles.timelineRail} />
          {agenda.map((item, index) => (
            <View key={item.id} style={styles.scheduleRow}>
              <View style={styles.timeBlock}>
                <Text style={styles.startTime}>{item.start}</Text>
                <Text style={styles.endTime}>{item.end}</Text>
              </View>
              <View style={[styles.timelineDot, index === 0 && styles.timelineDotActive]} />
              <View style={styles.scheduleCard}>
                <View style={styles.scheduleCopy}>
                  <Text numberOfLines={1} style={styles.scheduleTitle}>{item.code}</Text>
                  <View style={styles.roomRow}><Ionicons name="location-outline" size={15} color={theme.brandPressed} /><Text style={styles.scheduleRoom}>{item.room}</Text></View>
                </View>
                <View style={[styles.status, index === 0 && styles.statusActive]}><Text style={[styles.statusText, index === 0 && styles.statusTextActive]}>{item.status}</Text></View>
              </View>
            </View>
          ))}
        </View>
      </View>

      <MotivationBanner body="You’ve got this, Gideon." title="Same campus. Brighter futures." />

      <View style={styles.section}>
        <SectionHeading title="Ready when you are" />
        <View style={styles.quickRow}>
          {quickActions.map((action) => (
            <PressScale
              accessibilityLabel={action.label}
              key={action.key}
              onPress={() => {
                tap();
                setFeedback(`${action.label} preview selected.`);
              }}
              style={styles.quickCard}
            >
              <View style={styles.quickIcon}><Ionicons name={action.icon} size={20} color={theme.brandPressed} /></View>
              <Text style={styles.quickLabel}>{action.label}</Text>
              <Text style={styles.quickMeta}>{action.meta}</Text>
            </PressScale>
          ))}
        </View>
      </View>

      <Text style={styles.disclaimer}>Preview data only. Your real timetable appears after sign-in.</Text>
    </ProductScreen>
  );
}

function NotificationLine({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return <View style={styles.notificationLine}><Ionicons name={icon} size={17} color={theme.brand} /><Text style={styles.notificationText}>{text}</Text></View>;
}

function AlertCard({ icon, title, meta, onPress, strong = false }: { icon: keyof typeof Ionicons.glyphMap; title: string; meta: string; onPress: () => void; strong?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.alert, strong && styles.alertStrong, pressed && styles.pressed]}>
      <View style={[styles.alertIcon, strong && styles.alertIconStrong]}><Ionicons name={icon} size={22} color={strong ? theme.deepBrand : theme.brandPressed} /></View>
      <View style={styles.alertCopy}><Text style={[styles.alertTitle, strong && styles.alertTitleStrong]}>{title}</Text><Text style={styles.alertMeta}>{meta}</Text></View>
      <Ionicons name="chevron-forward" size={19} color={theme.brandPressed} />
    </Pressable>
  );
}

function MetaChip({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return <View style={styles.metaChip}><Ionicons name={icon} size={15} color={theme.textMuted} /><Text numberOfLines={1} style={styles.metaChipText}>{text}</Text></View>;
}

function BookStack() {
  return (
    <View pointerEvents="none" style={styles.books}>
      <View style={[styles.book, styles.bookBack]} />
      <View style={[styles.book, styles.bookMiddle]} />
      <View style={[styles.book, styles.bookFront]}><Text style={styles.bookQuote}>Small{`\n`}steps.{`\n`}Big futures.</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  notifications: { marginBottom: 12, marginTop: -4, padding: 15 },
  notificationTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  notificationHeading: { color: theme.text, fontFamily: theme.font.display, fontSize: 16 },
  notificationCount: { color: theme.brand, fontFamily: theme.font.semibold, fontSize: 11.5 },
  notificationLine: { alignItems: "center", flexDirection: "row", gap: 9 },
  notificationText: { color: theme.textMuted, flex: 1, fontFamily: theme.font.body, fontSize: 12.5 },
  notificationRule: { backgroundColor: theme.border, height: StyleSheet.hairlineWidth, marginVertical: 10 },
  alertStack: { gap: 10, marginTop: 2 },
  alert: { alignItems: "center", backgroundColor: "rgba(255,253,252,0.80)", borderColor: "rgba(195,93,56,0.13)", borderRadius: 18, borderWidth: 1, flexDirection: "row", minHeight: 70, padding: 11, ...theme.shadow },
  alertStrong: { backgroundColor: "rgba(252,230,220,0.62)", borderColor: "rgba(168,70,46,0.17)" },
  alertIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.28)", borderRadius: 14, height: 46, justifyContent: "center", width: 46 },
  alertIconStrong: { backgroundColor: "rgba(233,177,142,0.42)" },
  alertCopy: { flex: 1, marginLeft: 11 },
  alertTitle: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 13.5 },
  alertTitleStrong: { color: theme.deepBrand },
  alertMeta: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, marginTop: 3 },
  nextCard: { marginTop: 17, padding: 17 },
  nextTopline: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  nextEyebrowWrap: { alignItems: "center", flexDirection: "row", gap: 9 },
  nextLine: { backgroundColor: theme.brand, borderRadius: 3, height: 23, width: 4 },
  nextEyebrow: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 11.5, letterSpacing: 0.65 },
  countdown: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.28)", borderRadius: 12, flexDirection: "row", gap: 6, paddingHorizontal: 10, paddingVertical: 7 },
  countdownText: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 10.5, letterSpacing: 0.25 },
  courseRow: { alignItems: "center", flexDirection: "row", marginTop: 14, minHeight: 80 },
  courseBadge: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 17, height: 72, justifyContent: "center", width: 72, ...theme.shadow },
  courseBadgeText: { color: "#FFFFFF", fontFamily: theme.font.displayStrong, fontSize: 20, lineHeight: 21, textAlign: "center" },
  courseCopy: { flex: 1, marginLeft: 13, zIndex: 2 },
  courseTitle: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 23, letterSpacing: -0.45, lineHeight: 27 },
  courseLine: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  books: { alignItems: "flex-end", height: 84, justifyContent: "flex-end", marginRight: -16, width: 61 },
  book: { backgroundColor: "#C67A59", borderColor: "rgba(111,48,37,0.25)", borderRadius: 3, borderWidth: 1, bottom: 0, position: "absolute" },
  bookBack: { height: 62, right: 0, transform: [{ rotate: "-4deg" }], width: 25 },
  bookMiddle: { backgroundColor: "#D49173", height: 69, right: 13, transform: [{ rotate: "-2deg" }], width: 27 },
  bookFront: { alignItems: "center", backgroundColor: "#E1AA8C", height: 76, justifyContent: "center", right: 28, width: 31 },
  bookQuote: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 6.5, lineHeight: 9, textAlign: "center" },
  metaRow: { flexDirection: "row", gap: 7, marginTop: 14 },
  metaChip: { alignItems: "center", backgroundColor: "rgba(251,247,242,0.76)", borderColor: "rgba(41,35,31,0.08)", borderRadius: 12, borderWidth: 1, flex: 1, flexDirection: "row", gap: 5, justifyContent: "center", minHeight: 38, paddingHorizontal: 7 },
  metaChipText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 10.5 },
  actions: { flexDirection: "row", gap: 9, marginTop: 14 },
  primaryAction: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 14, flex: 1, flexDirection: "row", gap: 7, justifyContent: "center", minHeight: 52, paddingHorizontal: 13 },
  primaryActionText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 13 },
  secondaryAction: { alignItems: "center", backgroundColor: "rgba(241,223,200,0.49)", borderColor: "rgba(195,93,56,0.10)", borderRadius: 14, borderWidth: 1, flex: 1, flexDirection: "row", gap: 7, justifyContent: "center", minHeight: 52, paddingHorizontal: 13 },
  secondaryActionOn: { backgroundColor: "rgba(241,223,200,0.62)", borderColor: "rgba(111,48,37,0.16)" },
  secondaryActionText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 12.5 },
  secondaryActionTextOn: { color: theme.statusPositive },
  section: { marginTop: 27 },
  timeline: { position: "relative" },
  timelineRail: { backgroundColor: "rgba(195,93,56,0.42)", bottom: 25, left: 87, position: "absolute", top: 25, width: 2 },
  scheduleRow: { alignItems: "center", flexDirection: "row", minHeight: 84 },
  timeBlock: { width: 72 },
  startTime: { color: theme.text, fontFamily: theme.font.bold, fontSize: 14 },
  endTime: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 12, marginTop: 3 },
  timelineDot: { backgroundColor: theme.peach, borderColor: theme.canvas, borderRadius: 8, borderWidth: 3, height: 16, marginHorizontal: 8, width: 16, zIndex: 2 },
  timelineDotActive: { backgroundColor: theme.brandPressed },
  scheduleCard: { alignItems: "center", backgroundColor: "rgba(255,253,252,0.92)", borderColor: "rgba(255,255,255,0.96)", borderRadius: 16, borderWidth: 1, flex: 1, flexDirection: "row", minHeight: 72, padding: 12, ...theme.shadow },
  scheduleCopy: { flex: 1 },
  scheduleTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13.5 },
  roomRow: { alignItems: "center", flexDirection: "row", gap: 4, marginTop: 5 },
  scheduleRoom: { color: theme.textMuted, flex: 1, fontFamily: theme.font.body, fontSize: 11.5 },
  status: { backgroundColor: "rgba(241,223,200,0.45)", borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6 },
  statusActive: { backgroundColor: "rgba(233,177,142,0.31)" },
  statusText: { color: theme.textMuted, fontFamily: theme.font.semibold, fontSize: 10.5 },
  statusTextActive: { color: theme.brandPressed },
  quickRow: { flexDirection: "row", gap: 9 },
  quickCard: { backgroundColor: "rgba(255,253,252,0.90)", borderColor: "rgba(255,255,255,0.96)", borderRadius: 17, borderWidth: 1, flex: 1, minHeight: 123, padding: 12, ...theme.shadow },
  quickIcon: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 13, height: 40, justifyContent: "center", width: 40 },
  quickLabel: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12, marginTop: 11 },
  quickMeta: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 15, marginTop: 3 },
  disclaimer: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 16, marginTop: 24, textAlign: "center" },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
});
