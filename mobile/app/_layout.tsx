import { Stack } from "expo-router";
import Head from "expo-router/head";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { Lato_700Bold, Lato_700Bold_Italic, Lato_900Black } from "@expo-google-fonts/lato";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { theme } from "@/src/theme";

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Lato_700Bold,
    Lato_700Bold_Italic,
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
      <Head>
        <title>KampusOne · Your campus, in rhythm</title>
        <meta name="description" content="Campus utility, timetable, study tools and trusted campus services in one place." />
        <meta name="theme-color" content={theme.canvas} />
      </Head>
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
