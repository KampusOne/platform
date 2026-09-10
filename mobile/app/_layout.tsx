import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { Lato_700Bold, Lato_900Black } from "@expo-google-fonts/lato";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { theme } from "@/src/theme";

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Lato_700Bold,
    Lato_900Black,
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
