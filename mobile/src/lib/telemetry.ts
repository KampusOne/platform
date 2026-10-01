import { recordActivityEvent,type ActivityEvent } from "./activity-events";
import { trackFeatureLifecycle } from "./analytics";

export type {ActivityEvent}from'./activity-events';

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
  recordActivityEvent(event,options);
}
