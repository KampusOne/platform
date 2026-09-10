import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useAuth } from "@/src/auth/auth-context";
import { theme } from "@/src/theme";

export default function EntryScreen() {
  const { state, profile } = useAuth();
  if (state === "loading") {
    return <View style={styles.loading}><ActivityIndicator color={theme.brand} size="large" /></View>;
  }
  if (state === "anonymous") return <Redirect href="/(auth)/welcome" />;
  if (!profile?.onboarding_completed_at) return <Redirect href="/(auth)/onboarding" />;
  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({ loading: { alignItems: "center", backgroundColor: theme.canvas, flex: 1, justifyContent: "center" } });
