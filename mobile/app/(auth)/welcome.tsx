import { router } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "@/src/theme";

export default function WelcomeScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <View style={styles.artWrap}>
          <Image accessibilityLabel="Students planning their campus day" resizeMode="cover" source={require("@/assets/brand-scenes/onboarding.png")} style={styles.art} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>YOUR CAMPUS, IN ONE PLACE</Text>
          <Text style={styles.title}>Start every campus day one step ahead.</Text>
          <Text style={styles.body}>Classes, verified updates, campus places, tutorials and student essentials—built around your university.</Text>
        </View>
        <View style={styles.actions}>
          <Pressable onPress={() => router.push("/(auth)/sign-up")} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
            <Text style={styles.primaryText}>Create student account</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/(auth)/sign-in")} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
            <Text style={styles.secondaryText}>I already have an account</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: theme.canvas, flex: 1 },
  content: { alignSelf: "center", flex: 1, justifyContent: "space-between", maxWidth: 540, padding: 22, width: "100%" },
  artWrap: { backgroundColor: theme.sand, borderRadius: 34, flex: 1, maxHeight: 500, minHeight: 320, overflow: "hidden" },
  art: { height: "100%", width: "100%" },
  copy: { marginTop: 26 },
  eyebrow: { color: theme.brandPressed, fontFamily: theme.font.bold, fontSize: 10.5, letterSpacing: 1.4 },
  title: { color: theme.text, fontFamily: theme.font.displayStrong, fontSize: 32, letterSpacing: -0.8, lineHeight: 37, marginTop: 9 },
  body: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14, lineHeight: 21, marginTop: 10 },
  actions: { gap: 10, marginTop: 24 },
  primary: { alignItems: "center", backgroundColor: theme.brand, borderRadius: 17, height: 58, justifyContent: "center" },
  primaryText: { color: "#FFFFFF", fontFamily: theme.font.bold, fontSize: 15 },
  secondary: { alignItems: "center", backgroundColor: theme.surfaceRaised, borderColor: theme.border, borderRadius: 17, borderWidth: 1, height: 56, justifyContent: "center" },
  secondaryText: { color: theme.text, fontFamily: theme.font.semibold, fontSize: 14 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
});
