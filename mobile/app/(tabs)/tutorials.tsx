import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { EmptyResult, FilterRow, InlineFeedback, ProductScreen, SearchField } from "@/src/components/product-ui";
import { SectionHeading } from "@/src/components/section-heading";
import { theme } from "@/src/theme";

const categories = ["Recommended", "My courses", "This week"] as const;

const tutors = [
  { id: "osaze", initials: "OB", name: "Osaze Bello", course: "MTH 213", topic: "Linear algebra revision", rating: "4.8", sessions: "62 sessions", price: "₦2,500/hr", slots: ["Thu 4:00 PM", "Fri 2:00 PM"] },
  { id: "ada", initials: "AN", name: "Ada Nwosu", course: "CSC 211", topic: "Data structures clinic", rating: "4.9", sessions: "41 sessions", price: "₦3,000/hr", slots: ["Fri 11:00 AM", "Sat 10:00 AM"] },
  { id: "efe", initials: "EO", name: "Efe Osagie", course: "EDU 201", topic: "Exam prep group", rating: "4.7", sessions: "35 sessions", price: "₦1,500/hr", slots: ["Thu 6:00 PM", "Sun 3:00 PM"] },
] as const;

export default function TutorialsScreen() {
  const [selectedCategory, setSelectedCategory] = useState<(typeof categories)[number]>("Recommended");
  const [query, setQuery] = useState("");
  const [openTutor, setOpenTutor] = useState("");
  const [selectedSlot, setSelectedSlot] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tutors.filter((tutor) => !needle || `${tutor.name} ${tutor.course} ${tutor.topic}`.toLowerCase().includes(needle));
  }, [query]);

  function tap() {
    void Haptics.selectionAsync();
  }

  function toggleTutor(id: string) {
    tap();
    setOpenTutor((current) => (current === id ? "" : id));
    setSelectedSlot("");
  }

  return (
    <ProductScreen>
      <AppHeader title="Tutorials" subtitle="Verified academic help · Preview" showBell={false} unread={false} />
      <SearchField onChangeText={setQuery} placeholder="Search tutors, courses or topics" value={query} />
      <View style={styles.filters}>
        <FilterRow
          items={categories}
          onSelect={(item) => {
            tap();
            setSelectedCategory(item as (typeof categories)[number]);
          }}
          selected={selectedCategory}
        />
      </View>

      {selectedSlot ? <InlineFeedback message={`${selectedSlot} selected. Booking remains disabled in preview mode.`} tone="success" /> : null}

      <View style={styles.banner}>
        <View style={styles.bannerIcon}><Ionicons name="shield-checkmark-outline" size={22} color={theme.brandPressed} /></View>
        <View style={styles.bannerCopy}>
          <Text style={styles.bannerTitle}>Tutors are verified before listing</Text>
          <Text style={styles.bannerBody}>Course relevance, identity, reporting and availability are checked first.</Text>
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeading meta={`${filtered.length} tutors`} title={selectedCategory} />
        {filtered.length ? (
          <View style={styles.list}>
            {filtered.map((tutor) => {
              const isOpen = openTutor === tutor.id;
              return (
                <View style={styles.card} key={tutor.id}>
                  <View style={styles.profileRow}>
                    <View style={styles.avatar}><Text style={styles.avatarText}>{tutor.initials}</Text></View>
                    <View style={styles.profileCopy}>
                      <View style={styles.nameRow}>
                        <Text style={styles.name}>{tutor.name}</Text>
                        <Ionicons name="checkmark-circle" size={16} color={theme.success} />
                      </View>
                      <Text style={styles.topic}>{tutor.topic}</Text>
                    </View>
                    <View style={styles.courseBadge}><Text style={styles.courseBadgeText}>{tutor.course}</Text></View>
                  </View>

                  <View style={styles.stats}>
                    <View style={styles.stat}><Ionicons name="star" size={15} color="#B76A16" /><Text style={styles.statText}>{tutor.rating}</Text></View>
                    <View style={styles.stat}><Ionicons name="people-outline" size={16} color={theme.textSubtle} /><Text style={styles.statText}>{tutor.sessions}</Text></View>
                    <Text style={styles.price}>{tutor.price}</Text>
                  </View>

                  {isOpen ? (
                    <View style={styles.slots}>
                      <Text style={styles.slotsTitle}>Available sample slots</Text>
                      <View style={styles.slotRow}>
                        {tutor.slots.map((slot) => {
                          const active = selectedSlot === slot;
                          return (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityState={{ selected: active }}
                              key={slot}
                              onPress={() => {
                                tap();
                                setSelectedSlot(slot);
                              }}
                              style={({ pressed }) => [styles.slot, active && styles.slotActive, pressed && styles.pressed]}
                            >
                              <Text style={[styles.slotText, active && styles.slotTextActive]}>{slot}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  ) : null}

                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isOpen }}
                    onPress={() => toggleTutor(tutor.id)}
                    style={({ pressed }) => [styles.action, isOpen && styles.actionOpen, pressed && styles.pressed]}
                  >
                    <Text style={[styles.actionText, isOpen && styles.actionTextOpen]}>{isOpen ? "Close slots" : "View available slots"}</Text>
                    <Ionicons name={isOpen ? "chevron-up" : "arrow-forward"} size={18} color={isOpen ? theme.text : "#FFFFFF"} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : (
          <EmptyResult body="Try a course code, tutor name or topic." title="No tutor found" />
        )}
      </View>

      <Text style={styles.disclaimer}>Profiles, prices and availability are sample data. Payments and bookings are not active.</Text>
    </ProductScreen>
  );
}

const styles = StyleSheet.create({
  filters: { marginBottom: 16, marginTop: 12 },
  banner: { backgroundColor: "rgba(168,70,46,0.08)", borderColor: "rgba(168,70,46,0.2)", borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 11, marginTop: 16, padding: 14 },
  bannerIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.32)", borderRadius: 13, height: 42, justifyContent: "center", width: 42 },
  bannerCopy: { flex: 1 },
  bannerTitle: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 13.5 },
  bannerBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  section: { marginTop: 27 },
  list: { gap: 12 },
  card: { backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 20, borderWidth: 1, padding: 16, ...theme.shadow },
  profileRow: { alignItems: "center", flexDirection: "row" },
  avatar: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderColor: "rgba(195,93,56,0.15)", borderRadius: 25, borderWidth: 1, height: 50, justifyContent: "center", width: 50 },
  avatarText: { color: theme.brandPressed, fontFamily: theme.font.display, fontSize: 15 },
  profileCopy: { flex: 1, marginLeft: 11 },
  nameRow: { alignItems: "center", flexDirection: "row", gap: 5 },
  name: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 15 },
  topic: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 12, marginTop: 3 },
  courseBadge: { backgroundColor: theme.surfaceMuted, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
  courseBadgeText: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 11 },
  stats: { alignItems: "center", borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", marginTop: 15, paddingVertical: 12 },
  stat: { alignItems: "center", flexDirection: "row", gap: 5, marginRight: 15 },
  statText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 12 },
  price: { color: theme.text, fontFamily: theme.font.display, fontSize: 15, marginLeft: "auto" },
  slots: { marginTop: 14 },
  slotsTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 12.5 },
  slotRow: { flexDirection: "row", gap: 8, marginTop: 9 },
  slot: { alignItems: "center", borderColor: theme.border, borderRadius: 11, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 40, paddingHorizontal: 8 },
  slotActive: { backgroundColor: theme.surfaceMuted, borderColor: theme.brand },
  slotText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11.5 },
  slotTextActive: { color: theme.brandPressed, fontFamily: theme.font.semibold },
  action: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 13, flexDirection: "row", justifyContent: "space-between", marginTop: 14, minHeight: 46, paddingHorizontal: 14 },
  actionOpen: { backgroundColor: theme.surfaceSoft, borderColor: theme.border, borderWidth: 1 },
  actionText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 13.5 },
  actionTextOpen: { color: theme.text },
  disclaimer: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17, marginTop: 26, textAlign: "center" },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
});
