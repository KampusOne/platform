import { randomUUID } from "expo-crypto";

import { api } from "./api";
import { trackFeatureLifecycle } from "./analytics";

export type ActivityEvent =
  | "screen_view"
  | "feature_started"
  | "feature_completed"
  | "feature_failed"
  | "timetable_import"
  | "study_session"
  | "application_submitted";

// Never accept free-form properties: no prompts, filenames, emails or document contents.
export function recordActivity(
  event: ActivityEvent,
  options: { screen?: string; feature?: string; errorCode?: string } = {},
) {
  if (
    (event === "feature_started" ||
      event === "feature_completed" ||
      event === "feature_failed") &&
    options.feature
  ) {
    trackFeatureLifecycle(event, options.feature, {
      screen: options.screen,
      errorCode: options.errorCode,
    });
  } else if (
    event === "timetable_import" ||
    event === "study_session" ||
    event === "application_submitted"
  ) {
    trackFeatureLifecycle("feature_completed", event, {
      screen: options.screen,
      errorCode: options.errorCode,
    });
  }

  // This first-party store remains useful for admin reporting. Google Analytics
  // is independent, so a database outage cannot block the GA delivery queue.
  void api("/v1/student/events", {
    method: "POST",
    body: JSON.stringify({ requestId: randomUUID(), event, ...options }),
  }).catch(() => undefined);
}
