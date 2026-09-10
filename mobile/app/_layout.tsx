import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { theme } from "@/src/theme";

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    "Manrope-Regular": require("@/assets/fonts/manrope-400.ttf"),
    "Manrope-SemiBold": require("@/assets/fonts/manrope-600.ttf"),
    "Manrope-ExtraBold": require("@/assets/fonts/manrope-800.ttf"),
    "Caveat-SemiBold": require("@/assets/fonts/caveat-600.ttf"),
  });

  if (!fontsLoaded && !fontError) {
    return (
      <View style={styles.loading} accessibilityLabel="Loading KampusOne">
        <ActivityIndicator color={theme.brand} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.canvas } }} />
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    alignItems: "center",
    backgroundColor: theme.canvas,
    flex: 1,
    justifyContent: "center",
  },
});
