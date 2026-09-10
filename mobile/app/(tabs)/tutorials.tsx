import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from "react-native";

import { AppHeader } from "@/src/components/app-header";
import { EmptyResult, FilterRow, InlineFeedback, ProductScreen, SearchField } from "@/src/components/product-ui";
import { SectionHeading } from "@/src/components/section-heading";
import { GlassCard, PressScale, useReducedMotionPreference, VerifiedBadge } from "@/src/components/visual-system";
import { theme } from "@/src/theme";

const categories = ["Recommended", "My courses", "This week"] as const;

const tutors = [
  { id: "osaze", initials: "OB", name: "Osaze Bello", course: "MTH 213", topic: "Linear algebra revision", rating: "4.8", sessions: "62 sessions", price: "₦2,500/hr", slots: ["Thu 4:00 PM", "Fri 2:00 PM"], tone: "#D9855F" },
  { id: "ada", initials: "AN", name: "Ada Nwosu", course: "CSC 211", topic: "Data structures clinic", rating: "4.9", sessions: "41 sessions", price: "₦3,000/hr", slots: ["Fri 11:00 AM", "Sat 10:00 AM"], tone: "#346E8A" },
  { id: "efe", initials: "EO", name: "Efe Osagie", course: "EDU 201", topic: "Exam prep group", rating: "4.7", sessions: "35 sessions", price: "₦1,500/hr", slots: ["Thu 6:00 PM", "Sun 3:00 PM"], tone: "#2D7D59" },
] as const;

const studyTools = [
  { href: "/timetable" as const, icon: "calendar-outline" as const, title: "Timetable", body: "Classes and reminders" },
  { href: "/gpa" as const, icon: "calculator-outline" as const, title: "GPA & CGPA", body: "Plan every semester" },
  { href: "/ai-summary" as const, icon: "sparkles-outline" as const, title: "AI summary", body: "Notes to study guide" },
  { href: "/study-tools" as const, icon: "grid-outline" as const, title: "All tools", body: "Your academic workspace" },
] as const;

export default function TutorialsScreen() {
  const [selectedCategory, setSelectedCategory] = useState<(typeof categories)[number]>("Recommended");
  const [query, setQuery] = useState("");
  const [openTutor, setOpenTutor] = useState("");
  const [selectedSlot, setSelectedSlot] = useState("");
  const reducedMotion = useReducedMotionPreference();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tutors.filter((tutor) => !needle || `${tutor.name} ${tutor.course} ${tutor.topic}`.toLowerCase().includes(needle));
  }, [query]);

  function tap() {
    void Haptics.selectionAsync();
  }

  function toggleTutor(id: string) {
    tap();
    if (!reducedMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenTutor((current) => (current === id ? "" : id));
    setSelectedSlot("");
  }

  return (
    <ProductScreen>
      <AppHeader
        badge={{ text: "Verified academic help", verified: true }}
        showBell={false}
        subtitle="Understand it. Practise it. Own it."
        title="Tutorials"
        unread={false}
      />
      <View style={styles.toolGrid}>
        {studyTools.map((tool) => (
          <PressScale accessibilityLabel={tool.title} key={tool.title} onPress={() => router.push(tool.href)} style={styles.toolCard}>
            <View style={styles.toolIcon}><Ionicons name={tool.icon} size={20} color={theme.brandPressed} /></View>
            <Text style={styles.toolTitle}>{tool.title}</Text>
            <Text style={styles.toolBody}>{tool.body}</Text>
          </PressScale>
        ))}
      </View>
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

      {selectedSlot ? <InlineFeedback message={`${selectedSlot} selected. Booking is disabled in preview mode.`} tone="success" /> : null}

      <GlassCard style={styles.heroCard}>
        <View style={styles.heroCopy}>
          <View style={styles.heroEyebrow}><Ionicons name="sparkles" size={14} color={theme.brandPressed} /><Text style={styles.heroEyebrowText}>PICKED FOR YOUR COURSES</Text></View>
          <Text style={styles.heroTitle}>A clearer path through the hard topics.</Text>
          <Text style={styles.heroBody}>Meet verified student tutors who already know the course.</Text>
          <View style={styles.trustRow}>
            <View style={styles.avatarStack}>
              {tutors.map((tutor, index) => <View key={tutor.id} style={[styles.miniAvatar, { backgroundColor: tutor.tone, marginLeft: index ? -7 : 0 }]}><Text style={styles.miniAvatarText}>{tutor.initials}</Text></View>)}
            </View>
            <Text style={styles.trustText}>140+ helpful sessions</Text>
          </View>
        </View>
        <TutorIllustration />
      </GlassCard>

      <View style={styles.section}>
        <SectionHeading meta={`${filtered.length} available`} title={selectedCategory} />
        {filtered.length ? (
          <View style={styles.list}>
            {filtered.map((tutor) => {
              const open = openTutor === tutor.id;
              return (
                <View key={tutor.id} style={[styles.card, open && styles.cardOpen]}>
                  <Pressable accessibilityRole="button" onPress={() => toggleTutor(tutor.id)} style={({ pressed }) => [styles.cardHeader, pressed && styles.pressed]}>
                    <View style={[styles.avatar, { backgroundColor: tutor.tone }]}>
                      <Text style={styles.avatarText}>{tutor.initials}</Text>
                      <View style={styles.onlineDot} />
                    </View>
                    <View style={styles.cardCopy}>
                      <View style={styles.nameRow}>
                        <Text style={styles.name}>{tutor.name}</Text>
                        <VerifiedBadge label={`${tutor.name} is a verified tutor`} size={15} />
                      </View>
                      <Text style={styles.topic}>{tutor.topic}</Text>
                      <View style={styles.ratingRow}>
                        <Ionicons name="star" size={13} color="#C97824" />
                        <Text style={styles.rating}>{tutor.rating}</Text>
                        <Text style={styles.sessions}>· {tutor.sessions}</Text>
                      </View>
                    </View>
                    <View style={styles.cardRight}>
                      <View style={styles.courseChip}><Text style={styles.courseChipText}>{tutor.course}</Text></View>
                      <Text style={styles.price}>{tutor.price}</Text>
                      <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={theme.brandPressed} />
                    </View>
                  </Pressable>

                  {open ? (
                    <View style={styles.bookingPanel}>
                      <View style={styles.panelRule} />
                      <Text style={styles.slotLabel}>NEXT AVAILABLE</Text>
                      <View style={styles.slotRow}>
                        {tutor.slots.map((slot) => {
                          const selected = selectedSlot === `${tutor.name} · ${slot}`;
                          return (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityState={{ selected }}
                              key={slot}
                              onPress={() => {
                                tap();
                                setSelectedSlot(`${tutor.name} · ${slot}`);
                              }}
                              style={({ pressed }) => [styles.slot, selected && styles.slotSelected, pressed && styles.pressed]}
                            >
                              <Ionicons name="time-outline" size={14} color={selected ? "#FFFFFF" : theme.brandPressed} />
                              <Text style={[styles.slotText, selected && styles.slotTextSelected]}>{slot}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <PressScale disabled accessibilityLabel="Request tutorial session" style={styles.requestButton}>
                        <Text style={styles.requestButtonText}>Request a session</Text>
                        <Ionicons name="arrow-forward" size={17} color="#FFFFFF" />
                      </PressScale>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : (
          <EmptyResult body="Try a course code, topic or tutor name." title="No tutors found" />
        )}
      </View>

      <View style={styles.safety}>
        <Ionicons name="shield-outline" size={18} color={theme.verification} />
        <Text style={styles.safetyText}>Identity, course relevance, ratings, reporting and session safeguards will be checked before live booking opens.</Text>
      </View>
    </ProductScreen>
  );
}

function TutorIllustration() {
  return (
    <View pointerEvents="none" style={styles.illustration}>
      <View style={styles.illustrationOrb} />
      <View style={styles.personHead}><View style={styles.personHair} /></View>
      <View style={styles.personBody}><View style={styles.personBook}><Text style={styles.personBookText}>CSC</Text></View></View>
      <View style={styles.desk} />
      <View style={[styles.floatingNote, styles.noteOne]}><Ionicons name="code-slash" size={15} color={theme.brandPressed} /></View>
      <View style={[styles.floatingNote, styles.noteTwo]}><Ionicons name="bulb-outline" size={15} color={theme.info} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginBottom: 19 },
  toolCard: { backgroundColor: "rgba(255,253,252,0.91)", borderColor: "rgba(255,255,255,0.98)", borderRadius: 17, borderWidth: 1, minHeight: 116, padding: 12, width: "48.7%", ...theme.shadow },
  toolIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.27)", borderRadius: 12, height: 38, justifyContent: "center", width: 38 },
  toolTitle: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 13, marginTop: 10 },
  toolBody: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 10.5, marginTop: 3 },
  filters: { marginBottom: 16, marginTop: 12 },
  heroCard: { flexDirection: "row", minHeight: 208, padding: 17 },
  heroCopy: { flex: 1, zIndex: 2 },
  heroEyebrow: { alignItems: "center", flexDirection: "row", gap: 5 },
  heroEyebrowText: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 8.5, letterSpacing: 0.55 },
  heroTitle: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 22, letterSpacing: -0.45, lineHeight: 26, marginTop: 10, maxWidth: 225 },
  heroBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11.5, lineHeight: 17, marginTop: 7, maxWidth: 210 },
  trustRow: { alignItems: "center", flexDirection: "row", marginTop: 15 },
  avatarStack: { flexDirection: "row" },
  miniAvatar: { alignItems: "center", borderColor: theme.warmWhite, borderRadius: 14, borderWidth: 2, height: 28, justifyContent: "center", width: 28 },
  miniAvatarText: { color: "#FFFFFF", fontFamily: theme.font.bold, fontSize: 7 },
  trustText: { color: theme.textSubtle, fontFamily: theme.font.medium, fontSize: 9.5, marginLeft: 7 },
  illustration: { bottom: 0, height: 188, overflow: "hidden", position: "absolute", right: 0, width: 159 },
  illustrationOrb: { backgroundColor: "rgba(233,177,142,0.37)", borderRadius: 70, height: 140, position: "absolute", right: -31, top: 10, width: 140 },
  personHead: { backgroundColor: "#8A513A", borderRadius: 24, height: 46, position: "absolute", right: 47, top: 33, width: 43 },
  personHair: { backgroundColor: "#29231F", borderBottomLeftRadius: 12, borderBottomRightRadius: 9, borderTopLeftRadius: 22, borderTopRightRadius: 22, height: 20, width: 43 },
  personBody: { alignItems: "center", backgroundColor: theme.deepBrand, borderTopLeftRadius: 27, borderTopRightRadius: 27, bottom: 20, height: 94, position: "absolute", right: 25, width: 89 },
  personBook: { alignItems: "center", backgroundColor: theme.sand, borderRadius: 5, bottom: 13, height: 47, justifyContent: "center", position: "absolute", transform: [{ rotate: "-5deg" }], width: 55 },
  personBookText: { color: theme.brandPressed, fontFamily: theme.font.displayStrong, fontSize: 13 },
  desk: { backgroundColor: "#B66C4A", bottom: 11, height: 12, position: "absolute", right: 2, transform: [{ rotate: "-3deg" }], width: 145 },
  floatingNote: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.89)", borderRadius: 12, height: 34, justifyContent: "center", position: "absolute", width: 34, ...theme.shadow },
  noteOne: { right: 9, top: 22, transform: [{ rotate: "8deg" }] },
  noteTwo: { right: 111, top: 69, transform: [{ rotate: "-8deg" }] },
  section: { marginTop: 27 },
  list: { gap: 11 },
  card: { backgroundColor: "rgba(255,253,252,0.92)", borderColor: "rgba(255,255,255,0.98)", borderRadius: 20, borderWidth: 1, overflow: "hidden", padding: 13, ...theme.shadow },
  cardOpen: { borderColor: "rgba(195,93,56,0.18)" },
  cardHeader: { alignItems: "center", flexDirection: "row" },
  avatar: { alignItems: "center", borderRadius: 20, height: 58, justifyContent: "center", position: "relative", width: 58 },
  avatarText: { color: "#FFFFFF", fontFamily: theme.font.displayStrong, fontSize: 17 },
  onlineDot: { backgroundColor: theme.clay, borderColor: theme.warmWhite, borderRadius: 6, borderWidth: 2, bottom: 1, height: 12, position: "absolute", right: 1, width: 12 },
  cardCopy: { flex: 1, marginLeft: 11 },
  nameRow: { alignItems: "center", flexDirection: "row", gap: 5 },
  name: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14 },
  topic: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 11, marginTop: 3 },
  ratingRow: { alignItems: "center", flexDirection: "row", marginTop: 6 },
  rating: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 10.5, marginLeft: 3 },
  sessions: { color: theme.textSubtle, fontFamily: theme.font.body, fontSize: 10 },
  cardRight: { alignItems: "flex-end", gap: 6, marginLeft: 7 },
  courseChip: { backgroundColor: "rgba(233,177,142,0.27)", borderRadius: 9, paddingHorizontal: 8, paddingVertical: 5 },
  courseChipText: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 9.5 },
  price: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 10.5 },
  bookingPanel: { paddingTop: 2 },
  panelRule: { backgroundColor: theme.border, height: StyleSheet.hairlineWidth, marginVertical: 13 },
  slotLabel: { color: theme.textSubtle, fontFamily: theme.font.bold, fontSize: 8.5, letterSpacing: 0.6 },
  slotRow: { flexDirection: "row", gap: 8, marginTop: 9 },
  slot: { alignItems: "center", backgroundColor: theme.surfaceMuted, borderColor: "rgba(195,93,56,0.13)", borderRadius: 12, borderWidth: 1, flex: 1, flexDirection: "row", gap: 5, justifyContent: "center", minHeight: 39, paddingHorizontal: 8 },
  slotSelected: { backgroundColor: theme.brand, borderColor: theme.brand },
  slotText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 10 },
  slotTextSelected: { color: "#FFFFFF" },
  requestButton: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 13, flexDirection: "row", gap: 7, justifyContent: "center", marginTop: 10, minHeight: 44 },
  requestButtonText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 12 },
  safety: { alignItems: "flex-start", flexDirection: "row", gap: 8, marginTop: 22, paddingHorizontal: 7 },
  safetyText: { color: theme.textSubtle, flex: 1, fontFamily: theme.font.body, fontSize: 10.5, lineHeight: 16 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
});
