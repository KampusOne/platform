import { useEffect, useRef } from "react";
import { BackHandler, Platform, ToastAndroid } from "react-native";
import { router, useSegments } from "expo-router";
import { useAuth } from "@/src/auth/auth-context";

const exploreTools = new Set([
  "ai",
  "ai-summary",
  "timetable-import",
  "academic-calendar",
  "course-planner",
  "alarms",
]);

/**
 * Expo Router already owns Android navigation history.
 * This handler only adds the double-back-to-exit behavior on Home and a
 * deterministic parent for deep links that genuinely have no back entry.
 */
export function AndroidBackNavigation() {
  const { state } = useAuth();
  const segments = useSegments() as string[];
  const current = segments.join("/");
  const lastBack = useRef(0);

  useEffect(() => {
    if (Platform.OS !== "android" || state !== "authenticated") return;

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      const isHome = current === "(tabs)" || current === "(tabs)/index";

      if (isHome) {
        if (Date.now() - lastBack.current < 2_000) {
          BackHandler.exitApp();
          return true;
        }

        lastBack.current = Date.now();
        ToastAndroid.show(
          "Press back again to leave KampusOne",
          ToastAndroid.SHORT,
        );
        return true;
      }

      lastBack.current = 0;

      // Let Expo Router/React Navigation consume ordinary back presses.
      // Calling router.back() here duplicates the navigator's own handler and
      // was able to unwind the same history twice during route transitions.
      if (router.canGoBack()) return false;

      // A route opened from a deep link may legitimately have no stack entry.
      if (exploreTools.has(current)) {
        router.replace("/(tabs)/explore");
        return true;
      }

      router.replace("/(tabs)");
      return true;
    });

    return () => subscription.remove();
  }, [current, state]);

  return null;
}
