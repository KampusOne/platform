import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppHeader } from "@/src/components/app-header";
import { PreviewBanner } from "@/src/components/preview-banner";
import { SectionHeading } from "@/src/components/section-heading";
import { theme } from "@/src/theme";

const sampleAgenda = [
  { time: "10:00", meridiem: "AM", title: "CSC 211 · Data Structures", place: "LT 3", current: true },
  { time: "02:00", meridiem: "PM", title: "MTH 213 · Linear Algebra", place: "Hall B", current: false },
  { time: "04:30", meridiem: "PM", title: "Course rep check-in", place: "Online", current: false },
];

function currentGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function TodayScreen() {
  const [acknowledged, setAcknowledged] = useState(false);
  const { width } = useWindowDimensions();
  const maxWidth = Math.min(width, 680);
  const date = useMemo(
    () =>
      new Intl.DateTimeFormat("en-NG", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(new Date()),
    [],
  );

  async function acknowledgePreview() {
    await Haptics.selectionAsync();
    setAcknowledged(true);
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={[styles.content, { width: maxWidth }]} showsVerticalScrollIndicator={false}>
        <AppHeader />
        <PreviewBanner>FOUNDATION PREVIEW · SAMPLE SCHEDULE</PreviewBanner>

        <View style={styles.hero}>
          <Text style={styles.date}>{date.toUpperCase()}</Text>
          <Text style={styles.title}>{currentGreeting()}.</Text>
          <Text style={styles.accent}>You&apos;re on track.</Text>
        </View>

        <View style={styles.nowPanel}>
          <View style={styles.nowTopline}>
            <View style={styles.liveLabel}><View style={styles.liveDot} /><Text style={styles.liveText}>NEXT UP · SAMPLE</Text></View>
            <Text style={styles.startsIn}>Starts in 42 min</Text>
          </View>
          <Text style={styles.courseCode}>CSC 211</Text>
          <Text style={styles.courseTitle}>Data Structures</Text>
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={17} color="#EBC7B5" />
            <Text style={styles.location}>Lecture Theatre 3 · Main campus</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Acknowledge the timetable preview"
            onPress={acknowledgePreview}
            style={({ pressed }) => [styles.primaryAction, pressed && styles.primaryActionPressed]}
          >
            <Text style={styles.primaryActionText}>{acknowledged ? "Preview checked" : "Check timetable preview"}</Text>
            <Ionicons name={acknowledged ? "checkmark" : "arrow-forward"} size={17} color={theme.text} />
          </Pressable>
        </View>

        <View style={styles.section}>
          <SectionHeading title="Your day" meta="3 sample items" />
          <View style={styles.agenda}>
            {sampleAgenda.map((item) => (
              <View style={styles.agendaRow} key={`${item.time}-${item.title}`}>
                <View style={styles.timeBlock}>
                  <Text style={styles.time}>{item.time}</Text>
                  <Text style={styles.meridiem}>{item.meridiem}</Text>
                </View>
                <View style={[styles.timeline, item.current && styles.timelineCurrent]} />
                <View style={styles.agendaText}>
                  <Text style={styles.agendaTitle}>{item.title}</Text>
                  <Text style={styles.agendaPlace}>{item.place}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeading title="Useful now" />
          <View style={styles.utilityList}>
            <View style={styles.utilityRow}>
              <View style={styles.utilityIcon}><Ionicons name="calculator-outline" size={20} color={theme.brand} /></View>
              <View style={styles.utilityText}><Text style={styles.utilityTitle}>GPA planner</Text><Text style={styles.utilityMeta}>Structure ready · results not connected</Text></View>
              <Ionicons name="lock-closed-outline" size={16} color={theme.textMuted} />
            </View>
            <View style={styles.utilityRow}>
              <View style={styles.utilityIcon}><Ionicons name="navigate-outline" size={20} color={theme.brand} /></View>
              <View style={styles.utilityText}><Text style={styles.utilityTitle}>Find a campus place</Text><Text style={styles.utilityMeta}>Directory foundation in progress</Text></View>
              <Ionicons name="chevron-forward" size={17} color={theme.textMuted} />
            </View>
          </View>
        </View>

        <Text style={styles.disclaimer}>Preview data only. Nothing on this screen is a real class or student record.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: theme.canvas, flex: 1 },
  content: { alignSelf: "center", paddingBottom: 50, paddingHorizontal: theme.spacing[5] },
  hero: { marginBottom: theme.spacing[8] },
  date: { color: theme.brand, fontFamily: "Manrope-ExtraBold", fontSize: 10, letterSpacing: 1.3, marginBottom: 8 },
  title: { color: theme.text, fontFamily: "Manrope-ExtraBold", fontSize: 38, letterSpacing: -1.8, lineHeight: 42 },
  accent: { color: theme.brand, fontFamily: "Caveat-SemiBold", fontSize: 26, marginTop: -1 },
  nowPanel: { backgroundColor: theme.text, borderRadius: theme.radius.large, padding: theme.spacing[6], ...theme.shadow },
  nowTopline: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: theme.spacing[6] },
  liveLabel: { alignItems: "center", flexDirection: "row", gap: 7 },
  liveDot: { backgroundColor: "#EFA98E", borderRadius: 4, height: 7, width: 7 },
  liveText: { color: "#E8C9BA", fontFamily: "Manrope-ExtraBold", fontSize: 9, letterSpacing: 1.1 },
  startsIn: { color: "#CDBFB7", fontFamily: "Manrope-SemiBold", fontSize: 10 },
  courseCode: { color: "#EFA98E", fontFamily: "Manrope-ExtraBold", fontSize: 12, letterSpacing: 0.7 },
  courseTitle: { color: "#FFFFFF", fontFamily: "Manrope-ExtraBold", fontSize: 27, letterSpacing: -1, marginTop: 4 },
  locationRow: { alignItems: "center", flexDirection: "row", gap: 6, marginTop: 10 },
  location: { color: "#D5C9C1", fontFamily: "Manrope-Regular", fontSize: 12 },
  primaryAction: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: theme.radius.medium, flexDirection: "row", justifyContent: "space-between", marginTop: theme.spacing[6], minHeight: 50, paddingHorizontal: theme.spacing[4] },
  primaryActionPressed: { backgroundColor: "#F1DFC8", transform: [{ scale: 0.99 }] },
  primaryActionText: { color: theme.text, fontFamily: "Manrope-ExtraBold", fontSize: 13 },
  section: { marginTop: theme.spacing[8] },
  agenda: { borderBottomColor: theme.border, borderBottomWidth: 1, borderTopColor: theme.border, borderTopWidth: 1 },
  agendaRow: { alignItems: "center", flexDirection: "row", minHeight: 70 },
  timeBlock: { alignItems: "flex-end", flexDirection: "row", gap: 3, width: 66 },
  time: { color: theme.text, fontFamily: "Manrope-ExtraBold", fontSize: 14 },
  meridiem: { color: theme.textMuted, fontFamily: "Manrope-SemiBold", fontSize: 8, marginBottom: 2 },
  timeline: { backgroundColor: theme.border, height: 70, marginHorizontal: theme.spacing[4], width: 2 },
  timelineCurrent: { backgroundColor: theme.brand },
  agendaText: { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth, flex: 1, justifyContent: "center", minHeight: 70 },
  agendaTitle: { color: theme.text, fontFamily: "Manrope-SemiBold", fontSize: 13 },
  agendaPlace: { color: theme.textMuted, fontFamily: "Manrope-Regular", fontSize: 11, marginTop: 3 },
  utilityList: { backgroundColor: "rgba(255,255,255,0.72)", borderColor: theme.border, borderRadius: theme.radius.medium, borderWidth: 1, overflow: "hidden" },
  utilityRow: { alignItems: "center", flexDirection: "row", minHeight: 70, paddingHorizontal: theme.spacing[4] },
  utilityIcon: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 10, height: 38, justifyContent: "center", marginRight: theme.spacing[3], width: 38 },
  utilityText: { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth, flex: 1, justifyContent: "center", minHeight: 70 },
  utilityTitle: { color: theme.text, fontFamily: "Manrope-SemiBold", fontSize: 13 },
  utilityMeta: { color: theme.textMuted, fontFamily: "Manrope-Regular", fontSize: 10, marginTop: 3 },
  disclaimer: { color: theme.textMuted, fontFamily: "Manrope-Regular", fontSize: 10, lineHeight: 16, marginTop: theme.spacing[8], textAlign: "center" },
});
