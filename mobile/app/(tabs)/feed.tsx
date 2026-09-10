import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { EmptyResult, FilterRow, InlineFeedback, ProductScreen, SearchField } from "@/src/components/product-ui";
import { SectionHeading } from "@/src/components/section-heading";
import { theme } from "@/src/theme";

const categories = ["For you", "Official", "Events", "Sports"] as const;

const updates = [
  {
    id: "registration",
    category: "Official",
    source: "Registry",
    title: "Course registration closes Friday at 11:59 PM",
    body: "Check that every registered course matches your department’s approved list before the portal closes.",
    time: "18 min",
    icon: "school-outline",
    tone: "brand",
  },
  {
    id: "power",
    category: "Official",
    source: "Works department",
    title: "Hall 3 water maintenance starts at 2 PM",
    body: "Water supply is expected to return by 5 PM. Students should make arrangements before the maintenance window.",
    time: "40 min",
    icon: "water-outline",
    tone: "info",
  },
  {
    id: "career",
    category: "Events",
    source: "Engineering Students Association",
    title: "Product design career session moves to LT 2",
    body: "The session still begins at 4 PM. Entry is free, but seating is limited to the first 120 students.",
    time: "1 hr",
    icon: "calendar-outline",
    tone: "success",
  },
  {
    id: "football",
    category: "Sports",
    source: "Faculty sports desk",
    title: "CPE 250 faces Electrical Engineering at 5 PM",
    body: "The departmental league fixture will hold at the main sports complex. Warm-up starts at 4:30 PM.",
    time: "2 hr",
    icon: "football-outline",
    tone: "neutral",
  },
] as const;

export default function FeedScreen() {
  const [selected, setSelected] = useState<(typeof categories)[number]>("For you");
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return updates.filter((update) => {
      const categoryMatch = selected === "For you" || update.category === selected;
      const searchMatch = !needle || `${update.title} ${update.body} ${update.source}`.toLowerCase().includes(needle);
      return categoryMatch && searchMatch;
    });
  }, [query, selected]);

  function selectCategory(item: string) {
    void Haptics.selectionAsync();
    setSelected(item as (typeof categories)[number]);
  }

  function toggleSaved(id: string) {
    void Haptics.selectionAsync();
    const alreadySaved = saved.includes(id);
    setSaved((items) => (alreadySaved ? items.filter((item) => item !== id) : [...items, id]));
    setFeedback(alreadySaved ? "Update removed from saved items." : "Update saved for later.");
  }

  return (
    <ProductScreen>
      <AppHeader title="Campus feed" subtitle="Trusted updates · Preview data" showBell={false} unread={false} />
      <SearchField onChangeText={setQuery} placeholder="Search campus updates" value={query} />
      <View style={styles.filters}><FilterRow items={categories} onSelect={selectCategory} selected={selected} /></View>
      {feedback ? <InlineFeedback message={feedback} tone={feedback.includes("saved") ? "success" : "brand"} /> : null}

      <View style={styles.section}>
        <SectionHeading meta={`${filtered.length} updates`} title={selected} />
        {filtered.length ? (
          <View style={styles.list}>
            {filtered.map((update) => {
              const isSaved = saved.includes(update.id);
              return (
                <View style={styles.card} key={update.id}>
                  <View style={styles.sourceRow}>
                    <View style={[styles.icon, update.tone === "info" && styles.iconInfo, update.tone === "success" && styles.iconSuccess]}>
                      <Ionicons name={update.icon} size={21} color={update.tone === "info" ? theme.info : update.tone === "success" ? theme.success : theme.brand} />
                    </View>
                    <View style={styles.sourceCopy}>
                      <View style={styles.verifiedRow}>
                        <Text style={styles.source}>{update.source}</Text>
                        <Ionicons name="checkmark-circle" size={15} color={theme.success} />
                      </View>
                      <Text style={styles.meta}>{update.category} · {update.time} ago</Text>
                    </View>
                    <Pressable
                      accessibilityLabel={isSaved ? "Remove from saved updates" : "Save update"}
                      accessibilityRole="button"
                      onPress={() => toggleSaved(update.id)}
                      style={({ pressed }) => [styles.save, isSaved && styles.saveActive, pressed && styles.pressed]}
                    >
                      <Ionicons name={isSaved ? "bookmark" : "bookmark-outline"} size={19} color={isSaved ? theme.brand : theme.textSubtle} />
                    </Pressable>
                  </View>
                  <Text style={styles.title}>{update.title}</Text>
                  <Text style={styles.body}>{update.body}</Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setFeedback(`Opened “${update.title}”.`)}
                    style={({ pressed }) => [styles.readMore, pressed && styles.pressed]}
                  >
                    <Text style={styles.readMoreText}>Read update</Text>
                    <Ionicons name="arrow-forward" size={17} color={theme.brand} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : (
          <EmptyResult body="Try another word or choose a different update category." title="No updates found" />
        )}
      </View>

      <Text style={styles.disclaimer}>Sample content only. Publishing and reporting stay locked until identity and moderation are connected.</Text>
    </ProductScreen>
  );
}

const styles = StyleSheet.create({
  filters: { marginBottom: 16, marginTop: 12 },
  section: { marginTop: 7 },
  list: { gap: 12 },
  card: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 20, borderWidth: 1, padding: 16, ...theme.shadow },
  sourceRow: { alignItems: "center", flexDirection: "row" },
  icon: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderRadius: 13, height: 42, justifyContent: "center", width: 42 },
  iconInfo: { backgroundColor: "rgba(52,110,138,0.11)" },
  iconSuccess: { backgroundColor: "rgba(45,125,89,0.1)" },
  sourceCopy: { flex: 1, marginLeft: 11 },
  verifiedRow: { alignItems: "center", flexDirection: "row", gap: 5 },
  source: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13.5 },
  meta: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 11.5, marginTop: 2 },
  save: { alignItems: "center", borderColor: theme.border, borderRadius: 12, borderWidth: 1, height: 40, justifyContent: "center", width: 40 },
  saveActive: { backgroundColor: theme.surfaceMuted, borderColor: "rgba(195,93,56,0.2)" },
  title: { color: theme.text, fontFamily: theme.font.display, fontSize: 18.5, lineHeight: 23, marginTop: 15 },
  body: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 13.5, lineHeight: 21, marginTop: 8 },
  readMore: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 7, marginTop: 14, minHeight: 32 },
  readMoreText: { color: theme.brand, fontFamily: theme.font.semibold, fontSize: 13 },
  disclaimer: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17, marginTop: 26, textAlign: "center" },
  pressed: { opacity: 0.68, transform: [{ scale: 0.98 }] },
});
