import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState, Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, type Href, useFocusEffect } from "expo-router";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { useReducedMotionPreference } from "@/src/components/product-ui";

// Reuse the existing approved illustrations. New matching artwork can be replaced
// independently without changing slide destinations, timing or accessibility.
const slides: { title: string; detail: string; action: string; route: Href; image: number; wide?: boolean }[] = [
  { title: "Everything you need for today", detail: "Your campus, all in one place.", action: "Explore now", route: "/(tabs)/explore", image: require("@/assets/illustrations/home-student-v2.png") },
  { title: "Study with Kira", detail: "Summarise notes. Understand more.", action: "Chat with Kira", route: "/ai", image: require("@/assets/illustrations/auth-study-v2.png"), wide: true },
  { title: "Shop on campus", detail: "Find what you need, close to you.", action: "Shop now", route: "/(tabs)/store", image: require("@/assets/illustrations/onboarding-walk-v2.png") },
  { title: "Know your CGPA", detail: "Plan your courses and your next goal.", action: "Calculate now", route: "/course-planner", image: require("@/assets/illustrations/auth-study-v2.png"), wide: true },
  { title: "Make time for your day", detail: "Classes, plans and everything between.", action: "Open timetable", route: "/(tabs)/timetable", image: require("@/assets/illustrations/home-student-v2.png") },
];

export function DashboardCarousel() {
  const { styles, theme } = useThemeStyles(createStyles);
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width, 540) - 40;
  const scroll = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(AppState.currentState === "active");
  const [paused, setPaused] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  const reduced = useReducedMotionPreference();
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => {
    const app = AppState.addEventListener("change", state => setActive(state === "active"));
    let alive = true;
    void AccessibilityInfo.isScreenReaderEnabled().then(value => { if (alive) setScreenReader(value); });
    const a11y = AccessibilityInfo.addEventListener("screenReaderChanged", setScreenReader);
    return () => { alive = false; app.remove(); a11y.remove(); };
  }, []);
  const go = useCallback((next: number) => {
    setIndex(next);
    scroll.current?.scrollTo({ x: next * cardWidth, animated: !reduced });
  }, [cardWidth, reduced]);
  useEffect(() => {
    if (!focused || !active || paused || reduced || screenReader) return;
    const timer = setTimeout(() => go((index + 1) % slides.length), 7000);
    return () => clearTimeout(timer);
  }, [focused, active, paused, reduced, screenReader, index, go]);
  useEffect(() => { scroll.current?.scrollTo({ x: index * cardWidth, animated: false }); }, [cardWidth]);

  return <View style={styles.root}>
    <ScrollView ref={scroll} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
      onScrollBeginDrag={() => setPaused(true)}
      onMomentumScrollEnd={event => setIndex(Math.round(event.nativeEvent.contentOffset.x / cardWidth))}
      style={styles.viewport}
    >
      {slides.map((slide, i) => <View key={slide.action} style={[styles.card, { width: cardWidth }]}
        accessibilityElementsHidden={i !== index} importantForAccessibility={i === index ? "auto" : "no-hide-descendants"}>
        <View style={styles.copy}>
          <Text style={styles.title}>{slide.title}</Text>
          <Text style={styles.detail}>{slide.detail}</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push(slide.route)} style={({ pressed }) => [styles.button, pressed && { opacity: 0.78 }]}>
            <Text style={styles.buttonText}>{slide.action}</Text>
          </Pressable>
        </View>
        <Image accessible={false} accessibilityIgnoresInvertColors resizeMode="contain" source={slide.image} style={[styles.art, slide.wide && styles.wideArt]} />
      </View>)}
    </ScrollView>
    <View style={styles.controls}>
      {slides.map((slide, i) => <Pressable key={slide.action} accessibilityRole="button" accessibilityLabel={`Show ${slide.title}`} accessibilityState={{ selected: i === index }} onPress={() => { setPaused(true); go(i); }} style={styles.dotTarget}><View style={[styles.dot, i === index && styles.selectedDot]} /></Pressable>)}
      {!screenReader && !reduced ? <Pressable accessibilityRole="button" accessibilityLabel={paused ? "Play slides" : "Pause slides"} onPress={() => setPaused(value => !value)} style={styles.play}><Ionicons name={paused ? "play" : "pause"} color={theme.textMuted} size={13} /></Pressable> : null}
    </View>
  </View>;
}

const createStyles = (theme: Theme) => StyleSheet.create({
  root: { marginTop: 20 },
  viewport: { borderRadius: 24, backgroundColor: theme.surfaceSoft },
  card: { minHeight: 232, overflow: "hidden", padding: 20, justifyContent: "center" },
  copy: { width: "59%", zIndex: 2 },
  title: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 27, lineHeight: 29, letterSpacing: -0.6 },
  detail: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 12, lineHeight: 18, marginTop: 8 },
  button: { alignSelf: "flex-start", backgroundColor: theme.deepBrand, borderRadius: 14, minHeight: 45, justifyContent: "center", paddingHorizontal: 14, marginTop: 16 },
  buttonText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 12.5 },
  art: { position: "absolute", bottom: -8, right: -19, width: "51%", height: 216 },
  wideArt: { width: "57%", right: -29, height: 194, bottom: 0 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", height: 32 },
  dotTarget: { width: 24, height: 32, justifyContent: "center", alignItems: "center" },
  dot: { width: 5, height: 5, backgroundColor: theme.textFaint, borderRadius: 4 },
  selectedDot: { width: 16, backgroundColor: theme.accentText },
  play: { position: "absolute", right: 0, height: 32, width: 36, alignItems: "center", justifyContent: "center" },
});
