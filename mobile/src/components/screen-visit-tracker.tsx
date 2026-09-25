import { useEffect, useRef } from "react";
import { usePathname } from "expo-router";
import { useAuth } from "@/src/auth/auth-context";
import { recordActivity } from "@/src/lib/telemetry";
export function ScreenVisitTracker() {
  const pathname = usePathname();
  const { user, state } = useAuth();
  const last = useRef("");
  useEffect(() => {
    if (!user || state !== "authenticated") {
      last.current = "";
      return;
    }
    // Record only known route names. Dynamic identifiers and search parameters stay private.
    const route = pathname.split("/").filter(Boolean)[0] ?? "today";
    const allowed = new Set([
      "today",
      "feed",
      "store",
      "tutorials",
      "purchases",
      "explore",
      "profile",
      "map",
      "timetable",
      "gpa",
      "compose",
      "streak",
      "ai",
      "study-history",
      "publishing-post",
      "guidelines",
      "settings",
      "account",
      "account-edit",
      "course-planner",
      "timetable-import",
      "academic-calendar",
      "timetable-edit",
      "alarms",
      "support",
      "notifications",
      "communities",
      "community",
      "agent",
      "agent-create",
      "trial",
      "store-settings",
    ]);
    if (!allowed.has(route)) return;
    const visit = user.id + ":" + pathname;
    if (last.current === visit) return;
    last.current = visit;
    recordActivity("screen_view", { screen: route });
  }, [pathname, user?.id, state]);
  return null;
}
