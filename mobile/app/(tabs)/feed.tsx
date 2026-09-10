import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { EmptyResult, FilterRow, InlineFeedback, ProductScreen, SearchField } from "@/src/components/product-ui";
import { FavoriteButton, IllustrationTile, VerifiedBadge } from "@/src/components/visual-system";
import { theme } from "@/src/theme";

const categories = ["All", "Updates", "Events", "Sports"] as const;

const updates = [
  {
    id: "library",
    category: "Updates",
    source: "Campus Facilities",
    title: "New Library Wing Officially Opens",
    body: "More study spaces, group rooms and extended hours are now available.",
    time: "2 hours ago",
    art: "library" as const,
    icon: "business-outline" as const,
  },
  {
    id: "lecture",
    category: "Updates",
    source: "Academic Office",
    title: "CSC 211 Lecture Shift",
    body: "Tomorrow’s class moves to Lecture Theatre 2 during maintenance in LT 3.",
    time: "4 hours ago",
    art: "notice" as const,
    icon: "person-outline" as const,
    urgent: true,
  },
  {
    id: "scholarship",
    category: "Updates",
    source: "Student Affairs",
    title: "Merit Scholarship Applications Now Open",
    body: "Applications close on 30 September. Check eligibility before you apply.",
    time: "1 day ago",
    art: "scholarship" as const,
    icon: "school-outline" as const,
  },
  {
    id: "lecture-event",
    category: "Events",
    source: "Main Auditorium",
    title: "Guest Lecture: Building for a Better Tomorrow",
    body: "Join Dr Amina Yusuf for a practical conversation on sustainable innovation.",
    time: "1 day ago",
    art: "event" as const,
    icon: "location-outline" as const,
  },
  {
    id: "football",
    category: "Sports",
    source: "Campus Sports",
    title: "Match Day: CPE 250 vs Electrical Engineering",
    body: "Warm-up starts at 4:30 PM at the main sports complex.",
    time: "2 days ago",
    art: "sports" as const,
    icon: "trophy-outline" as const,
  },
] as const;

export default function FeedScreen() {
  const [selected, setSelected] = useState<(typeof categories)[number]>("All");
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return updates.filter((update) => {
      const categoryMatch = selected === "All" || update.category === selected;
      const searchMatch = !needle || `${update.title} ${update.body} ${update.source}`.toLowerCase().includes(needle);
      return categoryMatch && searchMatch;
    });
  }, [query, selected]);

  function selectCategory(item: string) {
    void Haptics.selectionAsync();
    setSelected(item as (typeof categories)[number]);
  }

  function toggleSaved(id: string) {
    const alreadySaved = saved.includes(id);
    setSaved((items) => (alreadySaved ? items.filter((item) => item !== id) : [...items, id]));
    setFeedback(alreadySaved ? "Removed from your saved updates." : "Saved for later.");
  }

  return (
    <ProductScreen>
      <AppHeader
        badge={{ icon: "notifications", text: "5 new updates" }}
        showBell={false}
        subtitle="Stay updated. Be part of it."
        title="Campus feed"
        unread={false}
      />
      <SearchField onChangeText={setQuery} placeholder="Search campus updates" value={query} />
      <View style={styles.filters}><FilterRow items={categories} onSelect={selectCategory} selected={selected} /></View>
      {feedback ? <InlineFeedback message={feedback} tone={feedback.includes("Saved") ? "success" : "brand"} /> : null}

      {filtered.length ? (
        <View style={styles.list}>
          {filtered.map((update) => {
            const isSaved = saved.includes(update.id);
            const urgent = "urgent" in update && update.urgent;
            return (
              <Pressable
                accessibilityLabel={`Open ${update.title}`}
                accessibilityRole="button"
                key={update.id}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setFeedback(`Opened “${update.title}”.`);
                }}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              >
                <IllustrationTile type={update.art} />
                <View style={styles.cardCopy}>
                  <View style={styles.cardTopline}>
                    <View style={[styles.tag, urgent && styles.urgentTag]}>
                      <Text style={[styles.tagText, urgent && styles.urgentTagText]}>{urgent ? "TIME-SENSITIVE" : update.category.toUpperCase()}</Text>
                    </View>
                    <Text style={styles.time}>{update.time}</Text>
                  </View>
                  <Text numberOfLines={2} style={styles.title}>{update.title}</Text>
                  <Text numberOfLines={3} style={styles.body}>{update.body}</Text>
                  <View style={styles.sourceRow}>
                    <Ionicons name={update.icon} size={14} color={theme.brandPressed} />
                    <Text numberOfLines={1} style={styles.source}>{update.source}</Text>
                    <VerifiedBadge label={`${update.source} is a verified source`} size={13} />
                  </View>
                </View>
                <View style={styles.cardActions}>
                  <FavoriteButton active={isSaved} label={isSaved ? "Remove saved update" : "Save update"} onPress={() => toggleSaved(update.id)} />
                  <Ionicons name="chevron-forward" size={19} color={theme.brandPressed} />
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <EmptyResult body="Try another word or choose a different update category." title="No updates found" />
      )}

      <View style={styles.safetyNote}>
        <Ionicons name="shield-outline" size={17} color={theme.verification} />
        <Text style={styles.safetyText}>Official updates are source-labelled and verified before they reach students.</Text>
      </View>
    </ProductScreen>
  );
}

const styles = StyleSheet.create({
  filters: { marginBottom: 16, marginTop: 12 },
  list: { gap: 12 },
  card: { alignItems: "center", backgroundColor: "rgba(255,253,252,0.93)", borderColor: "rgba(255,255,255,0.98)", borderRadius: 21, borderWidth: 1, flexDirection: "row", minHeight: 142, padding: 10, position: "relative", ...theme.shadow },
  cardPressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  cardCopy: { flex: 1, marginLeft: 12, minWidth: 0, paddingVertical: 2 },
  cardTopline: { alignItems: "center", flexDirection: "row", gap: 6, justifyContent: "space-between" },
  tag: { backgroundColor: "rgba(233,177,142,0.28)", borderRadius: 9, paddingHorizontal: 7, paddingVertical: 4 },
  urgentTag: { backgroundColor: "rgba(168,104,42,0.13)" },
  tagText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 8.5, letterSpacing: 0.35 },
  urgentTagText: { color: theme.statusAttention },
  time: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 9.5 },
  title: { color: theme.text, fontFamily: theme.font.display, fontSize: 16.5, lineHeight: 19.5, marginTop: 7 },
  body: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 16, marginTop: 4 },
  sourceRow: { alignItems: "center", flexDirection: "row", gap: 5, marginTop: 7 },
  source: { color: theme.textSubtle, flexShrink: 1, fontFamily: theme.font.medium, fontSize: 10 },
  cardActions: { alignItems: "center", alignSelf: "stretch", justifyContent: "space-between", marginLeft: 7, paddingBottom: 7, paddingTop: 1 },
  safetyNote: { alignItems: "flex-start", flexDirection: "row", gap: 8, marginTop: 22, paddingHorizontal: 7 },
  safetyText: { color: theme.textSubtle, flex: 1, fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 16 },
});
