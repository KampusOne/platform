import { Platform } from "react-native";
import { randomUUID } from "expo-crypto";
import { api } from "./api";
export type ActivityEvent =
  | "screen_view"
  | "feature_started"
  | "feature_completed"
  | "feature_failed"
  | "timetable_import"
  | "study_session"
  | "application_submitted"
  | "ui_interaction"
  | "content_action"
  | "scroll_depth";
export type ActivityOptions = {
  screen?: string | undefined;
  feature?: string | undefined;
  errorCode?: string | undefined;
  action?: string | undefined;
  component?: string | undefined;
  percentScrolled?: 25 | 50 | 75 | 90 | undefined;
};
export function recordActivityEvent(
  event: ActivityEvent,
  options: ActivityOptions = {},
) {
  const token = (value?: string, max = 100) =>
    value && value.length <= max && /^[a-z0-9][a-z0-9_-]*$/.test(value)
      ? value
      : undefined;
  const body = {
    requestId: randomUUID(),
    event,
    platform:
      Platform.OS === "ios" ? "ios" : Platform.OS === "web" ? "web" : "android",
    screen: token(options.screen),
    feature: token(options.feature, 60),
    action: token(options.action),
    component: token(options.component),
    errorCode:
      options.errorCode && /^[A-Z0-9_]{1,60}$/.test(options.errorCode)
        ? options.errorCode
        : undefined,
    percentScrolled: options.percentScrolled,
  };
  void api("/v1/student/events", {
    method: "POST",
    body: JSON.stringify(body),
  }).catch(() => undefined);
}
