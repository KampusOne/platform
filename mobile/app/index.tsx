import { Redirect, router } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/src/auth/auth-context";
import { theme } from "@/src/theme";

export default function EntryScreen() {
  const {
    state,
    sessionRestoreError,
    profile,
    profileError,
    profileState,
    retrySessionRestore,
    reloadProfile,
    signOut,
  } = useAuth();
  if (state === "loading" && sessionRestoreError) {
    return (
      <View accessibilityLiveRegion="polite" style={styles.errorState}>
        <View style={styles.errorIcon}><Text style={styles.errorIconText}>!</Text></View>
        <Text style={styles.errorTitle}>We can’t check your session</Text>
        <Text style={styles.errorBody}>{sessionRestoreError}</Text>
        <Pressable accessibilityRole="button" onPress={() => void retrySessionRestore()} style={styles.retry}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.replace("/(auth)/sign-in")} style={styles.signOut}>
          <Text style={styles.signOutText}>Go to sign in</Text>
        </Pressable>
      </View>
    );
  }
  if (state === "loading" || (state === "authenticated" && profileState === "loading")) {
    return <View style={styles.loading}><ActivityIndicator color={theme.brand} size="large" /></View>;
  }
  if (state === "anonymous") return <Redirect href="/(auth)/welcome" />;
  if (profileState === "error") {
    return (
      <View style={styles.errorState}>
        <View style={styles.errorIcon}><Text style={styles.errorIconText}>!</Text></View>
        <Text style={styles.errorTitle}>Your profile didn’t load</Text>
        <Text style={styles.errorBody}>{profileError || "Check your connection and try again."}</Text>
        <Pressable accessibilityRole="button" onPress={() => void reloadProfile().catch(() => undefined)} style={styles.retry}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => void signOut()} style={styles.signOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    );
  }
  if (!profile?.onboarding_completed_at) return <Redirect href="/(auth)/onboarding" />;
  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  loading: { alignItems: "center", backgroundColor: theme.canvas, flex: 1, justifyContent: "center" },
  errorState: { alignItems: "center", backgroundColor: theme.canvas, flex: 1, justifyContent: "center", paddingHorizontal: 28 },
  errorIcon: { alignItems: "center", backgroundColor: "rgba(233,177,142,0.24)", borderRadius: 28, height: 56, justifyContent: "center", width: 56 },
  errorIconText: { color: theme.deepBrand, fontFamily: theme.font.displayStrong, fontSize: 28 },
  errorTitle: { color: theme.text, fontFamily: theme.font.display, fontSize: 22, marginTop: 18 },
  errorBody: { color: theme.textMuted, fontFamily: theme.font.body, fontSize: 14, lineHeight: 21, marginTop: 7, maxWidth: 360, textAlign: "center" },
  retry: { alignItems: "center", backgroundColor: theme.deepBrand, borderRadius: 14, justifyContent: "center", marginTop: 20, minHeight: 50, paddingHorizontal: 24 },
  retryText: { color: "#FFFFFF", fontFamily: theme.font.semibold, fontSize: 14 },
  signOut: { alignItems: "center", justifyContent: "center", marginTop: 8, minHeight: 44, paddingHorizontal: 20 },
  signOutText: { color: theme.deepBrand, fontFamily: theme.font.semibold, fontSize: 13 },
});
