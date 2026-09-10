import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { EmptyResult, FilterRow, ProductScreen, SearchField } from "@/src/components/product-ui";
import { VerifiedBadge } from "@/src/components/visual-system";
import { theme } from "@/src/theme";

const filters = ["All", "KampusOne", "Tutors", "Orders"] as const;
const conversations = [
  { id: "official", category: "KampusOne", initials: "K1", name: "KampusOne", message: "Your account setup checklist is ready.", time: "Now", unread: 2, verified: true, tone: "#6F3025" },
  { id: "tutor", category: "Tutors", initials: "OB", name: "Osaze Bello", message: "Your MTH 213 request is waiting for confirmation.", time: "12:41", unread: 1, verified: true, tone: "#D9855F" },
  { id: "order", category: "Orders", initials: "EO", name: "Efe’s Campus Store", message: "A rider can message you after an order is accepted.", time: "Yesterday", unread: 0, verified: true, tone: "#346E8A" },
] as const;

export default function InboxScreen() {
  const [selected, setSelected] = useState<(typeof filters)[number]>("All");
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState("");
  const visible = useMemo(() => conversations.filter((item) => {
    const categoryMatch = selected === "All" || item.category === selected;
    const queryMatch = !query.trim() || `${item.name} ${item.message}`.toLowerCase().includes(query.trim().toLowerCase());
    return categoryMatch && queryMatch;
  }), [query, selected]);

  return (
    <ProductScreen>
      <AppHeader badge={{ icon: "chatbubble-ellipses", text: "Service conversations only" }} inboxUnread={false} showBell={false} showInbox={false} subtitle="Messages from KampusOne, tutors, vendors and riders." title="Inbox" unread={false} />
      <SearchField onChangeText={setQuery} placeholder="Search your inbox" value={query} />
      <View style={styles.filters}><FilterRow items={filters} onSelect={(item) => setSelected(item as (typeof filters)[number])} selected={selected} /></View>

      <View style={styles.policy}>
        <Ionicons name="shield-checkmark-outline" size={18} color={theme.verification} />
        <Text style={styles.policyText}>Direct classmate-to-classmate messages are not enabled. Every service conversation has a report path and retention rule.</Text>
      </View>

      {visible.length ? <View style={styles.list}>{visible.map((item) => {
        const active = opened === item.id;
        return (
          <Pressable
            accessibilityRole="button"
            key={item.id}
            onPress={() => {
              void Haptics.selectionAsync();
              setOpened(item.id);
            }}
            style={({ pressed }) => [styles.conversation, active && styles.conversationActive, pressed && styles.pressed]}
          >
            <View style={[styles.avatar, { backgroundColor: item.tone }]}><Text style={styles.avatarText}>{item.initials}</Text></View>
            <View style={styles.copy}>
              <View style={styles.nameRow}><Text style={styles.name}>{item.name}</Text>{item.verified ? <VerifiedBadge label={`${item.name} is verified`} size={15} /> : null}</View>
              <Text numberOfLines={1} style={[styles.message, item.unread > 0 && styles.messageUnread]}>{item.message}</Text>
              {active ? <Text style={styles.previewNote}>Conversation delivery will connect after identity and messaging audit gates pass.</Text> : null}
            </View>
            <View style={styles.meta}><Text style={styles.time}>{item.time}</Text>{item.unread > 0 ? <View style={styles.unread}><Text style={styles.unreadText}>{item.unread}</Text></View> : null}</View>
          </Pressable>
        );
      })}</View> : <EmptyResult body="Try another name or conversation type." title="No conversations found" />}
    </ProductScreen>
  );
}

const styles = StyleSheet.create({
  filters: { marginBottom: 15, marginTop: 11 },
  policy: { alignItems: "flex-start", backgroundColor: "rgba(241,223,200,0.42)", borderRadius: 15, flexDirection: "row", gap: 8, marginBottom: 16, padding: 12 },
  policyText: { color: theme.textMuted, flex: 1, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17 },
  list: { gap: 9 },
  conversation: { alignItems: "center", backgroundColor: "rgba(255,253,252,0.91)", borderColor: "rgba(255,255,255,0.97)", borderRadius: 18, borderWidth: 1, flexDirection: "row", minHeight: 82, padding: 12, ...theme.shadow },
  conversationActive: { borderColor: "rgba(195,93,56,0.28)" },
  avatar: { alignItems: "center", borderRadius: 20, height: 52, justifyContent: "center", width: 52 },
  avatarText: { color: "#FFFFFF", fontFamily: theme.font.displayStrong, fontSize: 15 },
  copy: { flex: 1, marginLeft: 11 },
  nameRow: { alignItems: "center", flexDirection: "row", gap: 5 },
  name: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13.5 },
  message: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, marginTop: 4 },
  messageUnread: { color: theme.text, fontFamily: theme.font.medium },
  previewNote: { color: theme.brandPressed, fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 15, marginTop: 8 },
  meta: { alignItems: "flex-end", alignSelf: "stretch", justifyContent: "space-between", marginLeft: 8 },
  time: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 9.5 },
  unread: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 10, height: 20, justifyContent: "center", minWidth: 20, paddingHorizontal: 5 },
  unreadText: { color: "#FFFFFF", fontFamily: theme.font.bold, fontSize: 9.5 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
});
