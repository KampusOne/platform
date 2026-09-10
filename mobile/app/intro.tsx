import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "@/src/theme";

const slides = [
  {
    icon: "calendar-outline" as const,
    title: "Your day, already organised",
    copy: "See the next class, deadlines and changes before they become emergencies.",
    detail: ["GST 111 · 10:00", "Room B12", "Starts in 24 min"],
  },
  {
    icon: "navigate-outline" as const,
    title: "Navigate campus with confidence",
    copy: "Find lecture halls, offices and useful places without asking five people for directions.",
    detail: ["Faculty of Arts", "Main Auditorium", "6 min walk"],
  },
  {
    icon: "sparkles-outline" as const,
    title: "Study tools that do the heavy lifting",
    copy: "Keep GPA history, build a timetable and turn notes into clear study summaries.",
    detail: ["AI note summary", "GPA workspace", "Saved timetable"],
  },
  {
    icon: "people-outline" as const,
    title: "One trusted campus space",
    copy: "Discover events, verified updates and useful services with safety controls built in.",
    detail: ["Campus feed", "Verified events", "Private inbox"],
  },
];

export default function IntroScreen() {
  const [index, setIndex] = useState(0);
  const slide = slides[index] ?? slides[0]!;
  const last = index === slides.length - 1;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <View style={styles.top}>
          <Text style={styles.step}>Welcome · {index + 1} of {slides.length}</Text>
          <Pressable accessibilityRole="button" onPress={() => router.replace("/create-account")} hitSlop={8}>
            <Text style={styles.skip}>Skip</Text>
          </Pressable>
        </View>

        <View style={styles.art}>
          <View style={styles.artHalo} />
          <View style={styles.artCardBack} />
          <View style={styles.artCard}>
            <View style={styles.artIcon}><Ionicons color={theme.white} name={slide.icon} size={40} /></View>
            <Text style={styles.artLabel}>KampusOne</Text>
            {slide.detail.map((item, itemIndex) => (
              <View key={item} style={[styles.detailRow, itemIndex === 2 && styles.detailRowAccent]}>
                <View style={styles.detailDot} />
                <Text style={styles.detailText}>{item}</Text>
              </View>
            ))}
          </View>
          <View style={styles.artStamp}><Ionicons color={theme.brandPressed} name="checkmark" size={18} /></View>
        </View>

        <View style={styles.copy}>
          <Text style={styles.kicker}>Made around student life</Text>
          <Text style={styles.title}>{slide.title}</Text>
          <Text style={styles.description}>{slide.copy}</Text>
        </View>

        <View style={styles.bottom}>
          <View style={styles.dots} accessibilityLabel={`Slide ${index + 1} of ${slides.length}`}>
            {slides.map((item, dotIndex) => (
              <View key={item.title} style={[styles.dot, dotIndex === index && styles.dotActive]} />
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => last ? router.replace("/create-account") : setIndex((value) => value + 1)}
            style={({ pressed }) => [styles.next, pressed && styles.nextPressed]}
          >
            <Text style={styles.nextText}>{last ? "Create my account" : "Continue"}</Text>
            <Ionicons color={theme.white} name="arrow-forward" size={20} />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: theme.canvas, flex: 1 },
  page: { flex: 1, marginHorizontal: "auto", maxWidth: 560, paddingHorizontal: theme.spacing[5], width: "100%" },
  top: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingTop: 14 },
  step: { color: theme.textSubtle, fontFamily: theme.font.semibold, fontSize: 12.5 },
  skip: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 14, padding: 8 },
  art: { alignItems: "center", height: 318, justifyContent: "center", marginTop: 18, position: "relative" },
  artHalo: { backgroundColor: "#F0D6C5", borderRadius: 120, height: 238, position: "absolute", width: 238 },
  artCardBack: { backgroundColor: "#D9855F", borderRadius: 24, height: 215, position: "absolute", transform: [{ rotate: "7deg" }], width: 242 },
  artCard: { backgroundColor: theme.warmWhite, borderColor: "#E4D4C9", borderRadius: 24, borderWidth: 1, minHeight: 226, padding: 21, transform: [{ rotate: "-3deg" }], width: 255, ...theme.floatingShadow },
  artIcon: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 17, height: 68, justifyContent: "center", marginBottom: 15, width: 68 },
  artLabel: { color: theme.text, fontFamily: theme.font.display, fontSize: 19, marginBottom: 12 },
  detailRow: { alignItems: "center", borderTopColor: "#EEE2D9", borderTopWidth: 1, flexDirection: "row", gap: 9, minHeight: 30 },
  detailRowAccent: { backgroundColor: "#FBF1EA", borderRadius: 8, borderTopWidth: 0, paddingHorizontal: 8 },
  detailDot: { backgroundColor: theme.brand, borderRadius: 3, height: 6, width: 6 },
  detailText: { color: theme.textMuted, fontFamily: theme.font.medium, fontSize: 11.5 },
  artStamp: { alignItems: "center", backgroundColor: "#FFF8F2", borderColor: "#E2B69D", borderRadius: 24, borderWidth: 1, bottom: 37, height: 48, justifyContent: "center", position: "absolute", right: 45, width: 48, ...theme.shadow },
  copy: { marginTop: 3 },
  kicker: { color: theme.brandPressed, fontFamily: theme.font.calligraphy, fontSize: 15.5, marginBottom: 9 },
  title: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 34, letterSpacing: -1, lineHeight: 38 },
  description: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 15.5, lineHeight: 23, marginTop: 12 },
  bottom: { marginTop: "auto", paddingBottom: 17, paddingTop: 24 },
  dots: { alignItems: "center", flexDirection: "row", gap: 7, justifyContent: "center", marginBottom: 19 },
  dot: { backgroundColor: "#D8C9BF", borderRadius: 4, height: 7, width: 7 },
  dotActive: { backgroundColor: theme.brand, width: 25 },
  next: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 17, flexDirection: "row", gap: 10, justifyContent: "center", minHeight: 58, ...theme.shadow },
  nextPressed: { backgroundColor: theme.brandPressed, transform: [{ scale: 0.98 }] },
  nextText: { color: theme.white, fontFamily: theme.font.bold, fontSize: 15.5 },
});
