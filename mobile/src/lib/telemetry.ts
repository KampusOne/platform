import { randomUUID } from "expo-crypto";
import { api } from "./api";
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
  void api("/v1/student/events", {
    method: "POST",
    body: JSON.stringify({ requestId: randomUUID(), event, ...options }),
  }).catch(() => undefined);
}
