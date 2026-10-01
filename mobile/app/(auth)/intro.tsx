import { Ionicons } from "@expo/vector-icons";
import { Redirect, router } from "expo-router";
import { useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth/auth-context";
import { useToast } from "@/src/components/toast";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import {
  finishFirstInstallIntro,
  useFirstInstallIntro,
} from "@/src/lib/entry-preferences";
const pages = [
  {
    title: "Your day, already ready",
    body: "Keep classes, notes and reminders together.",
    image: require("@/assets/illustrations/auth-study-v2.png"),
  },
  {
    title: "Find your campus people",
    body: "Join conversations and share what matters.",
    image: require("@/assets/illustrations/feed-empty-v2.png"),
  },
  {
    title: "More from campus life",
    body: "Shop local, learn together and get things delivered.",
    image: require("@/assets/illustrations/home-student-v2.png"),
  },
] as const;
export default function FirstInstallIntro() {
  const { state } = useAuth(),
    status = useFirstInstallIntro(),
    { styles, theme } = useThemeStyles(createStyles),
    { height } = useWindowDimensions(),
    toast = useToast();
  const [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    page = pages[step]!;
  async function finish() {
    if (busy) return;
    setBusy(true);
    const saved = await finishFirstInstallIntro();
    if (!saved)
      toast(
        "Your phone could not save this choice. The introduction may appear again.",
        "error",
      );
    router.replace("/(auth)/welcome");
  }
  if (state === "authenticated") return <Redirect href="/" />;
  if (status === "done" && !busy) return <Redirect href="/(auth)/welcome" />;
  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safe}>
      <View style={styles.page}>
        <View style={styles.top}>
          <Image
            source={require("@/assets/brand/kampusone-symbol-solid.png")}
            resizeMode="contain"
            style={styles.mark}
            accessible={false}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void finish()}
            style={styles.skip}
          >
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Image
            source={page.image}
            accessibilityIgnoresInvertColors
            accessible={false}
            resizeMode="contain"
            style={[
              styles.art,
              { height: Math.min(430, Math.max(210, height * 0.43)) },
            ]}
          />
          <View accessibilityLiveRegion="polite" style={styles.copy}>
            <Text style={styles.title}>{page.title}</Text>
            <Text style={styles.body}>{page.body}</Text>
          </View>
        </ScrollView>
        <View
          style={styles.dots}
          accessibilityLabel={`Introduction ${step + 1} of ${pages.length}`}
        >
          {pages.map((_, index) => (
            <View
              key={index}
              style={[styles.dot, index === step && styles.activeDot]}
            />
          ))}
        </View>
        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous introduction"
            disabled={!step || busy}
            onPress={() => setStep((n) => Math.max(0, n - 1))}
            style={[styles.back, (!step || busy) && { opacity: 0.3 }]}
          >
            <Ionicons name="arrow-back" color={theme.text} size={22} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() =>
              step === pages.length - 1 ? void finish() : setStep((n) => n + 1)
            }
            style={[styles.next, busy && { opacity: 0.5 }]}
          >
            <Text style={styles.nextText}>
              {busy
                ? "Opening…"
                : step === pages.length - 1
                  ? "Get started"
                  : "Next"}
            </Text>
            <Ionicons name="arrow-forward" color="white" size={19} />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: theme.canvas },
    page: {
      flex: 1,
      width: "100%",
      maxWidth: 580,
      alignSelf: "center",
      paddingHorizontal: 24,
    },
    top: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 12,
    },
    mark: { width: 35, height: 35, tintColor: theme.brand },
    skip: { paddingHorizontal: 14, minHeight: 48, justifyContent: "center" },
    skipText: {
      color: theme.textMuted,
      fontFamily: theme.font.medium,
      fontSize: 14,
    },
    content: { flexGrow: 1, justifyContent: "center", paddingVertical: 10 },
    art: { width: "100%", borderRadius: 20 },
    copy: { alignItems: "center", paddingHorizontal: 14, marginTop: 23 },
    title: {
      color: theme.text,
      fontFamily: theme.font.displayStrong,
      fontSize: 29,
      lineHeight: 35,
      textAlign: "center",
    },
    body: {
      color: theme.textMuted,
      fontFamily: theme.font.body,
      fontSize: 15,
      lineHeight: 23,
      textAlign: "center",
      marginTop: 11,
      maxWidth: 320,
    },
    dots: {
      flexDirection: "row",
      justifyContent: "center",
      gap: 7,
      marginVertical: 16,
    },
    dot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: theme.border,
    },
    activeDot: { width: 23, backgroundColor: theme.brand },
    controls: { flexDirection: "row", gap: 17, paddingVertical: 17 },
    back: {
      alignItems: "center",
      justifyContent: "center",
      width: 53,
      height: 53,
      borderRadius: 15,
      borderColor: theme.border,
      borderWidth: 1,
    },
    next: {
      flex: 1,
      backgroundColor: theme.deepBrand,
      borderRadius: 15,
      flexDirection: "row",
      gap: 10,
      justifyContent: "center",
      alignItems: "center",
      minHeight: 53,
    },
    nextText: { color: "white", fontFamily: theme.font.semibold, fontSize: 15 },
  });
