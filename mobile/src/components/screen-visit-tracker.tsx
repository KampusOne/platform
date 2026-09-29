import { useEffect, useRef } from "react";
import { usePathname } from "expo-router";

import { useAuth } from "@/src/auth/auth-context";
import {
  analyticsScreenName,
  trackScreenView,
} from "@/src/lib/analytics";
import {
  isFeedRoutePath,
  setFeedRoutePlaybackActive,
} from "@/src/lib/feed-video-playback";
import { recordActivity } from "@/src/lib/telemetry";

const knownRoutes = new Set([
  "today",
  "welcome",
  "sign-in",
  "sign-up",
  "forgot-password",
  "verify",
  "onboarding",
  "auth-callback",
  "campus",
  "explore",
  "feed",
  "gpa",
  "map",
  "profile",
  "purchases",
  "store",
  "timetable",
  "tutorials",
  "academic-calendar",
  "account-edit",
  "account",
  "agent-create",
  "agent",
  "ai",
  "alarm-import",
  "alarm-ring",
  "alarms",
  "blocked",
  "communities",
  "community",
  "compose",
  "conversation",
  "course-planner",
  "delete-account",
  "earnings",
  "guidelines",
  "learning-checkout",
  "learning-library",
  "legal",
  "message-media",
  "messages",
  "notification-preferences",
  "notifications",
  "payment-review",
  "post",
  "publishing-post",
  "restricted",
  "settings",
  "social-connections",
  "store-settings",
  "streak",
  "student-profile",
  "student-service",
  "study-history",
  "support",
  "timetable-edit",
  "timetable-import",
  "trial",
  "tutor-learners",
  "tutorial-manage",
  "video",
]);

export function ScreenVisitTracker() {
  const pathname = usePathname();
  const { user, state } = useAuth();
  const lastAnalyticsPath = useRef("");
  const lastFirstPartyVisit = useRef("");

  useEffect(() => {
    setFeedRoutePlaybackActive(isFeedRoutePath(pathname));
  }, [pathname]);

  useEffect(() => {
    // Use only the known route name. Dynamic ids and query values never enter analytics.
    const route = analyticsScreenName(pathname);
    if (!knownRoutes.has(route)) return;

    if (lastAnalyticsPath.current !== pathname) {
      lastAnalyticsPath.current = pathname;
      const analyticsTimer = setTimeout(() => trackScreenView(route), 250);
      return () => clearTimeout(analyticsTimer);
    }
  }, [pathname]);

  useEffect(() => {
    if (!user || state !== "authenticated") {
      lastFirstPartyVisit.current = "";
      return;
    }

    const route = analyticsScreenName(pathname);
    if (!knownRoutes.has(route)) return;

    const visit = user.id + ":" + pathname;
    if (lastFirstPartyVisit.current === visit) return;
    lastFirstPartyVisit.current = visit;

    // Keep the existing first-party event store for admin/internal reporting.
    const timer = setTimeout(
      () => recordActivity("screen_view", { screen: route }),
      1_200,
    );
    return () => clearTimeout(timer);
  }, [pathname, user?.id, state]);

  return null;
}
