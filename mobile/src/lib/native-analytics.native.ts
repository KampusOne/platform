import {
  getAnalytics,
  logEvent,
  logScreenView,
} from "@react-native-firebase/analytics";

import type { PendingAnalyticsEvent } from "./analytics";

function eventParams(event: PendingAnalyticsEvent) {
  const params: Record<string, string | number> = {};
  if (event.screen) params.screen = event.screen;
  if (event.feature) params.feature = event.feature;
  if (event.action) params.action = event.action;
  if (event.component) params.component = event.component;
  if (event.target) params.target = event.target;
  if (event.errorCode) params.error_code = event.errorCode;
  if (event.durationMs !== undefined)
    params.duration_ms = Math.max(0, Math.round(event.durationMs));
  return params;
}

export async function deliverNativeAnalytics(
  event: PendingAnalyticsEvent,
): Promise<boolean> {
  try {
    const analytics = getAnalytics();
    if (event.name === "page_view" && event.screen) {
      await logScreenView(analytics, {
        screen_name: event.screen,
        screen_class: event.screen,
      });
      return true;
    }

    await logEvent(analytics, event.name, eventParams(event));
    return true;
  } catch {
    // Analytics must never interrupt navigation or feature completion.
    return false;
  }
}
