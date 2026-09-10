import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Image,
  type ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSession } from "@/src/auth/session-context";
import { PrimaryButton, SecondaryButton } from "@/src/components/auth-ui";
import { theme } from "@/src/theme";

type IntroSlide = {
  eyebrow: string;
  title: string;
  body: string;
  image: ImageSourcePropType;
};

const slides: IntroSlide[] = [
  {
    eyebrow: "YOUR DAY, ALREADY SORTED",
    title: "Know what matters before class starts.",
    body: "Your timetable, deadlines, reminders and campus updates stay together — clear, calm and ready for the day.",
    image: require("@/assets/onboarding/day-organised.jpg"),
  },
  {
    eyebrow: "MOVE WITH CONFIDENCE",
    title: "Find your way around campus.",
    body: "Locate lecture theatres, offices, hostels and useful places without asking five people for directions.",
    image: require("@/assets/onboarding/find-your-way.jpg"),
  },
  {
    eyebrow: "LEARN. BUILD. EARN.",
    title: "Make more of university life.",
    body: "Discover trusted tutors, study materials, events and student services built for your own campus.",
    image: require("@/assets/onboarding/learn-and-earn.jpg"),
  },
];

export default function IntroScreen() {
  const { loading, session } = useSession();
  const [index, setIndex] = useState(0);
  const transition = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const [reducedMotion, setReducedMotion] = useState(false);
  const { width } = useWindowDimensions();
  const slide = slides[index] ?? slides[0]!;
  const finalSlide = index === slides.length - 1;

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (live) setReducedMotion(value);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!loading && session) router.replace("/today");
  }, [loading, session]);

  useEffect(() => {
    if (!loading || reducedMotion) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { duration: 820, toValue: 1, useNativeDriver: true }),
        Animated.timing(pulse, { duration: 820, toValue: 0, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [loading, pulse, reducedMotion]);

  const artworkHeight = useMemo(() => Math.min(330, Math.max(250, width * 0.72)), [width]);

  function goTo(nextIndex: number) {
    void Haptics.selectionAsync();
    if (reducedMotion) {
      setIndex(nextIndex);
      return;
    }
    Animated.timing(transition, { duration: 120, toValue: 0, useNativeDriver: true }).start(() => {
      setIndex(nextIndex);
      transition.setValue(0);
      Animated.timing(transition, { duration: 220, toValue: 1, useNativeDriver: true }).start();
    });
  }

  if (loading || session) {
    return (
      <SafeAreaView style={styles.splash}>
        <Animated.Image
          accessibilityLabel="KampusOne"
          source={require("@/assets/icon.png")}
          style={[
            styles.splashLogo,
            reducedMotion ? undefined : {
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.04] }) }],
            },
          ]}
        />
        <Text style={styles.splashWord}>KampusOne</Text>
        <Text style={styles.splashTagline}>Already Ready for School</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safe}>
      <View pointerEvents="none" style={styles.ambient} />
      <View style={[styles.frame, { width: Math.min(width, 540) }]}>
        <View style={styles.header}>
          <View style={styles.brand}>
            <Image source={require("@/assets/icon.png")} style={styles.brandMark} />
            <Text style={styles.brandWord}>KampusOne</Text>
          </View>
          {!finalSlide ? (
            <Pressable accessibilityRole="button" onPress={() => goTo(slides.length - 1)} style={({ pressed }) => [styles.skip, pressed && styles.pressed]}>
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
          ) : <View style={styles.skip} />}
        </View>

        <Animated.View
          style={[
            styles.slide,
            {
              opacity: transition,
              transform: [{ translateX: transition.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
            },
          ]}
        >
          <View style={[styles.artwork, { height: artworkHeight }]}>
            <View pointerEvents="none" style={styles.artworkHalo} />
            <Image accessibilityIgnoresInvertColors resizeMode="contain" source={slide.image} style={styles.artworkImage} />
          </View>
          <View style={styles.dots} accessibilityLabel={`Introduction ${index + 1} of ${slides.length}`}>
            {slides.map((_item, dotIndex) => <View key={dotIndex} style={[styles.dot, dotIndex === index && styles.dotActive]} />)}
          </View>
          <Text style={styles.eyebrow}>{slide.eyebrow}</Text>
          <Text style={styles.title}>{slide.title}</Text>
          <Text style={styles.body}>{slide.body}</Text>
        </Animated.View>

        <View style={styles.actions}>
          <PrimaryButton
            icon={finalSlide ? "person-add-outline" : "arrow-forward"}
            onPress={() => finalSlide ? router.push("/sign-up") : goTo(index + 1)}
          >
            {finalSlide ? "Create my account" : "Continue"}
          </PrimaryButton>
          <SecondaryButton onPress={() => router.push("/sign-in")}>I already have an account</SecondaryButton>
          <Pressable accessibilityRole="button" onPress={() => router.push("/today")} style={({ pressed }) => [styles.previewLink, pressed && styles.pressed]}>
            <Ionicons name="eye-outline" size={17} color={theme.brandPressed} />
            <Text style={styles.previewText}>Explore the preview first</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: theme.canvas, flex: 1, overflow: "hidden" },
  frame: { alignSelf: "center", flex: 1, paddingBottom: 18, paddingHorizontal: 24 },
  ambient: { backgroundColor: "rgba(233,177,142,0.18)", borderRadius: 220, height: 440, position: "absolute", right: -250, top: -230, width: 440 },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 58 },
  brand: { alignItems: "center", flexDirection: "row", gap: 9 },
  brandMark: { borderRadius: 11, height: 35, width: 35 },
  brandWord: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 19, letterSpacing: -0.35 },
  skip: { alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 54 },
  skipText: { color: theme.textMuted, fontFamily: theme.font.semibold, fontSize: 14 },
  slide: { flex: 1, justifyContent: "center" },
  artwork: { alignItems: "center", justifyContent: "center", marginBottom: 15, maxHeight: 330, position: "relative", width: "100%" },
  artworkHalo: { backgroundColor: "rgba(241,223,200,0.48)", borderRadius: 150, height: "82%", position: "absolute", width: "82%" },
  artworkImage: { height: "100%", width: "100%" },
  dots: { flexDirection: "row", gap: 7, marginBottom: 18 },
  dot: { backgroundColor: "rgba(41,35,31,0.13)", borderRadius: 4, height: 6, width: 20 },
  dotActive: { backgroundColor: theme.brand, width: 31 },
  eyebrow: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 10.5, letterSpacing: 1.1, marginBottom: 8 },
  title: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 30, letterSpacing: -0.75, lineHeight: 35 },
  body: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14.5, lineHeight: 22, marginTop: 9 },
  actions: { gap: 10, paddingTop: 18 },
  previewLink: { alignItems: "center", alignSelf: "center", flexDirection: "row", gap: 7, minHeight: 42, paddingHorizontal: 12 },
  previewText: { color: theme.brandPressed, fontFamily: theme.font.semibold, fontSize: 13 },
  pressed: { opacity: 0.68, transform: [{ scale: 0.98 }] },
  splash: { alignItems: "center", backgroundColor: theme.canvas, flex: 1, justifyContent: "center" },
  splashLogo: { borderRadius: 24, height: 92, width: 92 },
  splashWord: { color: theme.brand, fontFamily: theme.font.displayStrong, fontSize: 26, marginTop: 16 },
  splashTagline: { bottom: 36, color: theme.textSubtle, fontFamily: theme.font.medium, fontSize: 12.5, position: "absolute" },
});
