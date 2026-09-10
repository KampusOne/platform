import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { ProductScreen } from "@/src/components/product-ui";
import { MotivationBanner } from "@/src/components/visual-system";
import { theme } from "@/src/theme";

const days = [
  { day: "Mon", date: 7 }, { day: "Tue", date: 8 }, { day: "Wed", date: 9 },
  { day: "Thu", date: 10 }, { day: "Fri", date: 11 }, { day: "Sat", date: 12 }, { day: "Sun", date: 13 },
] as const;

const classes = [
  { code: "CSC\n211", title: "CSC 211 — Data Structures", room: "Lecture Theatre 3", lecturer: "Dr Ehiaguina", start: "09:00", end: "10:00", status: "Ongoing", tone: "#C35D38" },
  { code: "EDU\n201", title: "EDU 201", room: "Faculty of Education", lecturer: "Prof. A. Mensah", start: "10:00", end: "12:00", status: "Upcoming", tone: "#E9B18E" },
  { code: "MTH\n213", title: "MTH 213", room: "Hall B", lecturer: "Dr K. Owusu", start: "13:00", end: "14:00", status: "Later", tone: "#CFA18C" },
  { code: "ENG\n102", title: "ENG 102", room: "Lecture Theatre 1", lecturer: "Ms. T. Daniels", start: "15:00", end: "17:00", status: "Later", tone: "#D8B39F" },
] as const;

export default function TimetableScreen() {
  const [mode, setMode] = useState<"Today" | "Week">("Today");
  const [selectedDay, setSelectedDay] = useState(10);
  const [reminders, setReminders] = useState(true);

  function tap() {
    void Haptics.selectionAsync();
  }

  return (
    <ProductScreen>
      <AppHeader
        badge={{ icon: "calendar", text: "4 classes today" }}
        showBell={false}
        subtitle="Stay on track. Make the most of your day."
        title="My timetable"
        unread={false}
      />

      <View style={styles.segmented}>
        {(["Today", "Week"] as const).map((item) => {
          const active = item === mode;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={item}
              onPress={() => {
                tap();
                setMode(item);
              }}
              style={({ pressed }) => [styles.segment, active && styles.segmentActive, pressed && styles.pressed]}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{item}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.weekStrip}>
        {days.map((item) => {
          const active = item.date === selectedDay;
          return (
            <Pressable
              accessibilityLabel={`${item.day} ${item.date} September`}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={item.day}
              onPress={() => {
                tap();
                setSelectedDay(item.date);
              }}
              style={({ pressed }) => [styles.day, active && styles.dayActive, pressed && styles.pressed]}
            >
              <Text style={[styles.dayName, active && styles.dayNameActive]}>{item.day}</Text>
              <Text style={[styles.dayDate, active && styles.dayDateActive]}>{item.date}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.reminderCard}>
        <View style={styles.reminderIcon}><Ionicons name="notifications" size={22} color={theme.brandPressed} /></View>
        <View style={styles.reminderCopy}><Text style={styles.reminderTitle}>Class reminders</Text><Text style={styles.reminderBody}>Get notified before your classes start.</Text></View>
        <Switch
          accessibilityLabel="Class reminders"
          onValueChange={(value) => {
            void Haptics.selectionAsync();
            setReminders(value);
          }}
          thumbColor="#FFFFFF"
          trackColor={{ false: "#D9D2CD", true: theme.brand }}
          value={reminders}
        />
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{mode}</Text>
        <Text style={styles.sectionDate}>{selectedDay === 10 ? "Thu, 10 September" : `September ${selectedDay}`}</Text>
      </View>

      <View style={styles.timeline}>
        <View pointerEvents="none" style={styles.timelineRail} />
        {classes.map((item, index) => (
          <View key={item.title} style={styles.classRow}>
            <View style={styles.timeBlock}><Text style={styles.start}>{item.start}</Text><Text style={styles.end}>{item.end}</Text></View>
            <View style={[styles.dot, { backgroundColor: index === 0 ? theme.brandPressed : theme.peach }]} />
            <View style={[styles.classCard, { borderLeftColor: item.tone }]}>
              <View style={[styles.codeBadge, { backgroundColor: item.tone }]}><Text style={[styles.code, index > 0 && styles.codeDark]}>{item.code}</Text></View>
              <View style={styles.classCopy}>
                <Text numberOfLines={1} style={styles.classTitle}>{item.title}</Text>
                <View style={styles.detailRow}><Ionicons name="location-outline" size={14} color={theme.brandPressed} /><Text numberOfLines={1} style={styles.detail}>{item.room}</Text></View>
                <View style={styles.detailRow}><Ionicons name="person-outline" size={14} color={theme.textMuted} /><Text numberOfLines={1} style={styles.detail}>{item.lecturer}</Text></View>
              </View>
              <View style={styles.classActions}>
                <View style={[styles.status, item.status === "Ongoing" && styles.statusOngoing]}>{item.status === "Ongoing" ? <View style={styles.ongoingDot} /> : null}<Text style={[styles.statusText, item.status === "Ongoing" && styles.statusTextOngoing]}>{item.status}</Text></View>
                {index < 2 ? (
                  <Pressable accessibilityRole="button" onPress={tap} style={({ pressed }) => [styles.miniAction, pressed && styles.pressed]}>
                    <Ionicons name={index === 0 ? "document-text-outline" : "notifications-outline"} size={14} color={theme.brandPressed} />
                    <Text style={styles.miniActionText}>{index === 0 ? "Notes" : "Remind"}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
        ))}
      </View>

      <MotivationBanner body="Keep going, Gideon." title="A well-planned day leads to a brighter tomorrow." />
    </ProductScreen>
  );
}

const styles = StyleSheet.create({
  segmented: { backgroundColor: "rgba(255,253,252,0.81)", borderColor: "rgba(255,255,255,0.96)", borderRadius: 19, borderWidth: 1, flexDirection: "row", gap: 4, padding: 5, ...theme.shadow },
  segment: { alignItems: "center", borderRadius: 14, flex: 1, justifyContent: "center", minHeight: 48 },
  segmentActive: { backgroundColor: theme.brand, ...theme.shadow },
  segmentText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 14 },
  segmentTextActive: { color: "#FFFFFF", fontFamily: theme.font.semibold },
  weekStrip: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginHorizontal: -5, marginTop: 13 },
  day: { alignItems: "center", borderRadius: 13, gap: 5, minHeight: 67, paddingHorizontal: 8, paddingTop: 10 },
  dayActive: { backgroundColor: theme.brand, ...theme.shadow },
  dayName: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 10.5 },
  dayNameActive: { color: "rgba(255,255,255,0.82)" },
  dayDate: { color: theme.text, fontFamily: theme.font.display, fontSize: 17 },
  dayDateActive: { color: "#FFFFFF" },
  reminderCard: { alignItems: "center", backgroundColor: "rgba(255,253,252,0.88)", borderColor: "rgba(195,93,56,0.13)", borderRadius: 18, borderWidth: 1, flexDirection: "row", marginTop: 17, minHeight: 78, padding: 12, ...theme.shadow },
  reminderIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.28)", borderRadius: 14, height: 46, justifyContent: "center", width: 46 },
  reminderCopy: { flex: 1, marginLeft: 11 },
  reminderTitle: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 13.5 },
  reminderBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, marginTop: 3 },
  sectionHeader: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between", marginTop: 28 },
  sectionTitle: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 25, letterSpacing: -0.4 },
  sectionDate: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 12 },
  timeline: { marginTop: 11, position: "relative" },
  timelineRail: { backgroundColor: "rgba(195,93,56,0.42)", bottom: 27, left: 83, position: "absolute", top: 27, width: 2 },
  classRow: { alignItems: "center", flexDirection: "row", minHeight: 123 },
  timeBlock: { alignSelf: "flex-start", paddingTop: 16, width: 68 },
  start: { color: theme.text, fontFamily: theme.font.bold, fontSize: 14 },
  end: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 11.5, marginTop: 3 },
  dot: { borderColor: theme.canvas, borderRadius: 8, borderWidth: 3, height: 16, marginHorizontal: 7, width: 16, zIndex: 2 },
  classCard: { alignItems: "center", backgroundColor: "rgba(255,253,252,0.93)", borderColor: "rgba(255,255,255,0.98)", borderLeftWidth: 5, borderRadius: 18, borderWidth: 1, flex: 1, flexDirection: "row", minHeight: 108, padding: 10, ...theme.shadow },
  codeBadge: { alignItems: "center", borderRadius: 14, height: 66, justifyContent: "center", width: 58 },
  code: { color: "#FFFFFF", fontFamily: theme.font.displayStrong, fontSize: 15, lineHeight: 16, textAlign: "center" },
  codeDark: { color: theme.deepBrand },
  classCopy: { flex: 1, marginLeft: 10, minWidth: 0 },
  classTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12.5 },
  detailRow: { alignItems: "center", flexDirection: "row", gap: 4, marginTop: 5 },
  detail: { color: theme.textMuted, flex: 1, fontFamily: theme.font.body, fontSize: 10.5 },
  classActions: { alignItems: "flex-end", alignSelf: "stretch", justifyContent: "space-between", marginLeft: 5 },
  status: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 10, flexDirection: "row", gap: 4, paddingHorizontal: 8, paddingVertical: 5 },
  statusOngoing: { backgroundColor: "rgba(154,91,62,0.12)" },
  ongoingDot: { backgroundColor: theme.statusPositive, borderRadius: 4, height: 7, width: 7 },
  statusText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 8.5 },
  statusTextOngoing: { color: theme.statusPositive },
  miniAction: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.24)", borderRadius: 10, flexDirection: "row", gap: 4, minHeight: 31, paddingHorizontal: 7 },
  miniActionText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 8.5 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
});
