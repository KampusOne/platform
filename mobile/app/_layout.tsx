import { AlarmSync } from "@/src/components/alarm-sync";
import { checkBuildVersion } from "@/src/lib/build-version";
import { useThemeStyles, type Theme } from "@/src/lib/appearance";
import { SplashScreen, Stack, router, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
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
import { Platform, StyleSheet, View } from "react-native";
import { ScreenVisitTracker } from "@/src/components/screen-visit-tracker";
import {ForegroundUsageTracker} from '@/src/components/foreground-usage-tracker';
import { AuthProvider } from "@/src/auth/auth-context";
import { ToastProvider } from "@/src/components/toast";
import { useEffect, useState } from "react";
import { initializeAppearance } from "@/src/lib/appearance";
import { listenForSnooze } from "@/src/lib/alarms";
import { onAccountRestriction } from "@/src/lib/api";
import { PhotoEditorHost } from "@/src/components/photo-editor";
import { VideoEditorHost } from "@/src/components/video-editor";
import { BrandIntro } from "@/src/components/brand-intro";
import { AppErrorBoundary, AppFeatureBoundary, ScreenErrorRecovery } from "@/src/components/app-error-boundary";
import { NotificationBootstrap } from "@/src/components/notification-bootstrap";
import { StartupProvider } from "@/src/lib/startup";
import { AndroidBackNavigation } from "@/src/components/android-back-navigation";
import { AutoStreak } from "@/src/components/auto-streak";
import { DownloadTray } from "@/src/components/download-tray";
import { PurchaseReviewPrompt } from "@/src/components/purchase-review-prompt";
import { ShareSheetHost } from "@/src/components/share-sheet";
import { initializeEntryPreferences } from "@/src/lib/entry-preferences";
import { OfflineRecovery } from "@/src/components/offline-recovery";
import { DocumentReaderHost } from '@/src/components/document-reader-host';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export const unstable_settings = { screenErrorBoundary: ScreenErrorRecovery };

export default function RootLayout() {
  const pathname = usePathname();
  const { theme, isDark } = useThemeStyles(createStyles);
  const [appearanceReady, setAppearanceReady] = useState(false);
  // Static web HTML has no query parameters, device storage or local clock.
  // Mount interactive routes after hydration so every deep link starts from
  // the same shell instead of replacing mismatched server-rendered content.
  const [screensReady, setScreensReady] = useState(Platform.OS !== 'web');
  useEffect(() => setScreensReady(true), []);
  useEffect(() => { void SystemUI.setBackgroundColorAsync(theme.canvas).catch(() => undefined); }, [theme.canvas]);
  useEffect(() => {
    void Promise.all([initializeAppearance(), initializeEntryPreferences()]).catch(() => undefined).finally(() => setAppearanceReady(true));
    void checkBuildVersion();
  }, []);

  useEffect(listenForSnooze, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const style = document.createElement("style");
    style.textContent =
      'input:focus,input:focus-visible,textarea:focus,textarea:focus-visible,select:focus,select:focus-visible,[contenteditable="true"]:focus,[contenteditable="true"]:focus-visible{outline:none!important;box-shadow:none!important}button:focus-visible,[role=button]:focus-visible{outline:2px solid #C35D38;outline-offset:2px}';
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  useEffect(
    () => onAccountRestriction(() => {
      if (pathname !== "/restricted" && pathname !== "/support") router.replace("/restricted");
    }),
    [pathname],
  );

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Lato_700Bold,
    Lato_700Bold_Italic,
    Lato_900Black,
    Caveat_600SemiBold: require("@/assets/fonts/caveat-600.ttf"),
  });

  return (
    <AuthProvider>
      <StartupProvider><ToastProvider><AlarmSync/><NotificationBootstrap /><AutoStreak />
        <StatusBar style={isDark ? "light" : "dark"} />
        <ScreenVisitTracker />
        <ForegroundUsageTracker/>
        <AppErrorBoundary>
          {screensReady ? <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.canvas },
            }}
          /> : <View accessibilityRole="progressbar" accessibilityLabel="Opening KampusOne" style={{flex:1,backgroundColor:theme.canvas}} />}
        </AppErrorBoundary>
        <AppFeatureBoundary feature="photo_editor"><PhotoEditorHost /></AppFeatureBoundary>
        <AppFeatureBoundary feature="video_editor"><VideoEditorHost /></AppFeatureBoundary>
        <AppFeatureBoundary feature="document_reader"><DocumentReaderHost /></AppFeatureBoundary>
        <AndroidBackNavigation />
        <AppFeatureBoundary feature="download_tray"><DownloadTray /></AppFeatureBoundary>
        <AppFeatureBoundary feature="purchase_review"><PurchaseReviewPrompt /></AppFeatureBoundary>
        <AppFeatureBoundary feature="share_sheet"><ShareSheetHost /></AppFeatureBoundary>
        <AppFeatureBoundary feature="offline_recovery"><OfflineRecovery /></AppFeatureBoundary>
        <BrandIntro fontsReady={fontsLoaded || Boolean(fontError)} appearanceReady={appearanceReady} />
      </ToastProvider></StartupProvider>
    </AuthProvider>
  );
}

const createStyles = (_theme: Theme) =>
  StyleSheet.create({
    launchUnderlay: {
      alignItems: "center",
      backgroundColor: "#F1DFC8",
      flex: 1,
      justifyContent: "center",
    },
    launchMark: {
      height: 220,
      width: 220,
    },
  });
