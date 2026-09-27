import { useEffect, useRef } from "react";
import { BackHandler, Platform, ToastAndroid } from "react-native";
import { router, useSegments } from "expo-router";
import { useAuth } from "@/src/auth/auth-context";

/** Native back/edge gestures use the same navigation history as in-app back. */
export function AndroidBackNavigation() {
  const { state } = useAuth();
  const segments = useSegments() as string[];
  const current = segments.join("/");
  const lastBack = useRef(0);
  useEffect(() => {
    if (Platform.OS !== "android" || state !== "authenticated") return;
    lastBack.current = 0;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (router.canGoBack()) { router.back(); return true; }
      const isHome = current === "(tabs)" || current === "(tabs)/index";
      if (!isHome) {
        // A deep-linked tool has no stack history; return it to its parent first.
        const exploreTools = new Set(["ai", "ai-summary", "timetable-import", "academic-calendar", "course-planner", "alarms"]);
        router.replace(exploreTools.has(current) ? "/(tabs)/explore" : "/(tabs)");
        return true;
      }
      if (Date.now() - lastBack.current < 2000) { BackHandler.exitApp(); return true; }
      lastBack.current = Date.now();
      ToastAndroid.show("Press back again to leave KampusOne", ToastAndroid.SHORT);
      return true;
    });
    return () => subscription.remove();
  }, [current, state]);
  return null;
}
