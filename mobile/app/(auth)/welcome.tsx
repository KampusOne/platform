import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "@/src/theme";

const DEEP_TERRACOTTA = "#A8462E";

export default function WelcomeScreen() {
  const { height } = useWindowDimensions();
  const illustrationHeight = Math.min(Math.max(height * 0.4, 270), 430);

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={4}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
        >
          <Ionicons color={theme.text} name="arrow-back" size={27} />
        </Pressable>

        <View style={[styles.artWrap, { height: illustrationHeight }]}>
          <Image
            accessible={false}
            accessibilityIgnoresInvertColors
            accessibilityLabel="A student walking through campus with a phone and school bag"
            resizeMode="contain"
            source={require("@/assets/illustrations/onboarding-walk-v2.png")}
            style={styles.art}
          />
        </View>

        <View style={styles.copy}>
          <Text style={styles.eyebrow}>YOUR CAMPUS, IN ONE PLACE</Text>
          <Text style={styles.title}>
            Already ready for <Text style={styles.titleAccent}>school</Text>
          </Text>
          <Text style={styles.body}>your campus in one place</Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/(auth)/sign-up")}
            style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
          >
            <Text style={styles.primaryText}>Create student account</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/(auth)/sign-in")}
            style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
          >
            <Text style={styles.secondaryText}>I already have an account</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: theme.canvas,
    flex: 1,
  },
  content: {
    alignSelf: "center",
    flexGrow: 1,
    maxWidth: 540,
    paddingBottom: 24,
    paddingHorizontal: 22,
    width: "100%",
  },
  back: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    marginBottom: 4,
    marginLeft: -8,
    width: 44,
  },
  backPressed: {
    opacity: 0.55,
    transform: [{ translateX: -2 }],
  },
  artWrap: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  art: {
    height: "100%",
    width: "100%",
  },
  copy: {
    alignItems: "center",
    marginTop: 24,
  },
  eyebrow: {
    color: DEEP_TERRACOTTA,
    fontFamily: theme.font.bold,
    fontSize: 10,
    letterSpacing: 1.4,
    textAlign: "center",
  },
  title: {
    color: theme.text,
    fontFamily: theme.font.displayStrong,
    fontSize: 32,
    letterSpacing: -0.85,
    lineHeight: 38,
    marginTop: 10,
    textAlign: "center",
  },
  titleAccent: {
    color: DEEP_TERRACOTTA,
    fontFamily: theme.font.calligraphy,
  },
  body: {
    color: theme.textMuted,
    fontFamily: theme.font.body,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    textAlign: "center",
  },
  actions: {
    gap: 10,
    marginTop: 34,
  },
  primary: {
    alignItems: "center",
    backgroundColor: DEEP_TERRACOTTA,
    borderRadius: 15,
    height: 56,
    justifyContent: "center",
  },
  primaryPressed: {
    backgroundColor: "#8F3C29",
    transform: [{ scale: 0.99 }],
  },
  primaryText: {
    color: "#FFFFFF",
    fontFamily: theme.font.bold,
    fontSize: 15,
  },
  secondary: {
    alignItems: "center",
    backgroundColor: "rgba(255,253,252,0.7)",
    borderColor: "#DCC9BE",
    borderRadius: 15,
    borderWidth: 1,
    height: 54,
    justifyContent: "center",
  },
  secondaryPressed: {
    backgroundColor: theme.surfaceSoft,
  },
  secondaryText: {
    color: theme.text,
    fontFamily: theme.font.semibold,
    fontSize: 14.5,
  },
});
