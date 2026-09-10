import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "@/src/theme";

const notices = [
  { icon: "alarm-outline" as const, title: "GST 111 starts in 24 minutes", copy: "Lecture Theatre B · leave now for an unhurried walk.", time: "Now" },
  { icon: "calendar-outline" as const, title: "CSC 212 moved", copy: "Today’s class is now in Lab 2 at 2:00 PM.", time: "34m" },
  { icon: "ticket-outline" as const, title: "Reservation confirmed", copy: "Your place at UNIBEN Tech Mixer has been saved.", time: "2h" },
];

export default function NotificationsScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}><Pressable accessibilityLabel="Go back" onPress={() => router.back()} style={styles.back}><Ionicons color={theme.text} name="arrow-back" size={21} /></Pressable><View style={styles.heading}><Text style={styles.title}>Notifications</Text><Text style={styles.subtitle}>The things that need your attention</Text></View></View>
      <View style={styles.permission}><View style={styles.permissionIcon}><Ionicons color={theme.white} name="notifications-outline" size={25} /></View><View style={styles.permissionCopy}><Text style={styles.permissionTitle}>Phone notifications are not confirmed</Text><Text style={styles.permissionText}>Enable them so class alarms and urgent changes can reach you.</Text></View><Pressable style={styles.permissionAction}><Text style={styles.permissionActionText}>Review</Text></Pressable></View>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <Text style={styles.section}>Today</Text>
        {notices.map((item) => <View key={item.title} style={styles.row}><View style={styles.icon}><Ionicons color={theme.brandPressed} name={item.icon} size={21} /></View><View style={styles.copy}><Text style={styles.noticeTitle}>{item.title}</Text><Text style={styles.noticeCopy}>{item.copy}</Text></View><Text style={styles.time}>{item.time}</Text></View>)}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: theme.canvas, flex: 1 }, header: { alignItems: "center", flexDirection: "row", gap: 12, marginHorizontal: "auto", maxWidth: 620, padding: 20, width: "100%" }, back: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: "#E2D5CC", borderRadius: 22, borderWidth: 1, height: 44, justifyContent: "center", width: 44 }, heading: { flex: 1 }, title: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 28 }, subtitle: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5 },
  permission: { alignItems: "center", alignSelf: "center", backgroundColor: "#322A25", borderRadius: 18, flexDirection: "row", gap: 12, marginBottom: 16, maxWidth: 580, padding: 15, width: "90%" }, permissionIcon: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 14, height: 46, justifyContent: "center", width: 46 }, permissionCopy: { flex: 1 }, permissionTitle: { color: theme.white, fontFamily: theme.font.semibold, fontSize: 12.5 }, permissionText: { color: "#D7CBC3", fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 15, marginTop: 3 }, permissionAction: { backgroundColor: theme.white, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8 }, permissionActionText: { color: theme.text, fontFamily: theme.font.bold, fontSize: 10.5 },
  list: { marginHorizontal: "auto", maxWidth: 620, paddingBottom: 30, paddingHorizontal: 20, width: "100%" }, section: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 11, letterSpacing: 1, marginBottom: 3, textTransform: "uppercase" }, row: { alignItems: "flex-start", borderBottomColor: "#E5D9D0", borderBottomWidth: 1, flexDirection: "row", gap: 12, paddingVertical: 17 }, icon: { alignItems: "center", backgroundColor: "#F3DFD2", borderRadius: 20, height: 40, justifyContent: "center", width: 40 }, copy: { flex: 1 }, noticeTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13.5 }, noticeCopy: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, lineHeight: 18, marginTop: 4 }, time: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 10.5 },
});
