import { checkBuildVersion } from "@/src/lib/build-version";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  Lato_700Bold,
  Lato_700Bold_Italic,
  Lato_900Black,
} from "@expo-google-fonts/lato";
import { StyleSheet, View } from "react-native";

import { theme } from "@/src/theme";
import { AuthProvider } from "@/src/auth/auth-context";
import { ScreenSkeleton } from "@/src/components/skeleton";
import { ToastProvider } from "@/src/components/toast";
import { useEffect } from "react";
import { initializeAppearance } from "@/src/lib/appearance";
import { listenForSnooze } from "@/src/lib/alarms";
import { onAccountRestriction } from "@/src/lib/api";
import { PhotoEditorHost } from "@/src/components/photo-editor";

export default function RootLayout() {
  const { theme, isDark } = useThemeStyles(createStyles);
  useEffect(() => {
    void initializeAppearance();
    void checkBuildVersion();
  }, []);
  useEffect(listenForSnooze, []);
  useEffect(
    () => onAccountRestriction(() => router.replace("/restricted")),
    [],
  );

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Lato_700Bold,
    Lato_700Bold_Italic,
    Lato_900Black,
  });

  return (
    <AuthProvider>
      {!fontsLoaded && !fontError ? <ScreenSkeleton /> : <ToastProvider>
        <StatusBar style={isDark ? "light" : "dark"} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.canvas },
          }}
        />
        <PhotoEditorHost />
      </ToastProvider>}
    </AuthProvider>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    loading: {
      alignItems: "center",
      backgroundColor: theme.canvas,
      flex: 1,
      justifyContent: "center",
    },
  });
const styles = createStyles(theme);
