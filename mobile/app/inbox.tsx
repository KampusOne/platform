import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "@/src/theme";

const conversations = [
  { icon: "shield-checkmark-outline" as const, name: "KampusOne Support", role: "Official", message: "Your student verification is waiting for one document.", time: "8:42", unread: true },
  { icon: "storefront-outline" as const, name: "Campus Print Hub", role: "Vendor", message: "Your course pack is ready for pickup.", time: "Yesterday", unread: true },
  { icon: "bicycle-outline" as const, name: "David O.", role: "Rider · Order K1-2048", message: "I have picked up your delivery.", time: "Mon", unread: false },
];

export default function InboxScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Go back" hitSlop={8} onPress={() => router.back()} style={styles.back}><Ionicons color={theme.text} name="arrow-back" size={21} /></Pressable>
        <View style={styles.heading}><Text style={styles.title}>Inbox</Text><Text style={styles.subtitle}>Official, vendor and delivery conversations</Text></View>
        <Pressable accessibilityLabel="Inbox information" style={styles.info}><Ionicons color={theme.brandPressed} name="information-circle-outline" size={23} /></Pressable>
      </View>
      <View style={styles.boundary}><Ionicons color={theme.brandPressed} name="lock-closed-outline" size={16} /><Text style={styles.boundaryText}>Classmate-to-classmate messaging is off. You control follows separately.</Text></View>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {conversations.map((item) => (
          <Pressable key={item.name} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <View style={styles.avatar}><Ionicons color={theme.brandPressed} name={item.icon} size={23} /></View>
            <View style={styles.copy}><View style={styles.nameRow}><Text numberOfLines={1} style={styles.name}>{item.name}</Text><Text style={styles.time}>{item.time}</Text></View><Text style={styles.role}>{item.role}</Text><Text numberOfLines={1} style={[styles.message, item.unread && styles.messageUnread]}>{item.message}</Text></View>
            {item.unread ? <View style={styles.unread} /> : null}
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: theme.canvas, flex: 1 }, header: { alignItems: "center", flexDirection: "row", gap: 12, marginHorizontal: "auto", maxWidth: 620, padding: 20, width: "100%" },
  back: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: "#E2D5CC", borderRadius: 22, borderWidth: 1, height: 44, justifyContent: "center", width: 44 }, heading: { flex: 1 },
  title: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 28 }, subtitle: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, marginTop: 1 }, info: { alignItems: "center", height: 44, justifyContent: "center", width: 38 },
  boundary: { alignItems: "flex-start", alignSelf: "center", backgroundColor: "#F6E8DE", borderRadius: 13, flexDirection: "row", gap: 8, marginBottom: 8, maxWidth: 580, padding: 12, width: "90%" }, boundaryText: { color: theme.textMuted, flex: 1, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17 },
  list: { marginHorizontal: "auto", maxWidth: 620, paddingBottom: 30, paddingHorizontal: 20, width: "100%" }, row: { alignItems: "center", borderBottomColor: "#E5D9D0", borderBottomWidth: 1, flexDirection: "row", gap: 13, minHeight: 92, paddingVertical: 14 }, pressed: { opacity: 0.68 },
  avatar: { alignItems: "center", backgroundColor: "#F3DFD2", borderRadius: 25, height: 50, justifyContent: "center", width: 50 }, copy: { flex: 1 }, nameRow: { alignItems: "center", flexDirection: "row", gap: 10 }, name: { color: theme.text, flex: 1, fontFamily: theme.font.semibold, fontSize: 14 }, time: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 10.5 },
  role: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 10.5, marginTop: 2 }, message: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, marginTop: 5 }, messageUnread: { color: theme.text, fontFamily: theme.font.medium }, unread: { backgroundColor: theme.brand, borderRadius: 4, height: 8, width: 8 },
});
