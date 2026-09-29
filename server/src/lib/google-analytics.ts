import type { Bindings } from "../types";

export const analyticsEventNames = [
  "page_view",
  "ui_interaction",
  "feature_started",
  "feature_completed",
  "feature_failed",
  "content_action",
  "media_action",
  "notification_action",
  "auth_action",
  "performance_timing",
] as const;

export type AnalyticsEventName = (typeof analyticsEventNames)[number];
export type AnalyticsPlatform = "android" | "ios" | "web";

export type ProductAnalyticsEvent = {
  name: AnalyticsEventName;
  timestampMs: number;
  sessionId: string;
  screen?: string | undefined;
  feature?: string | undefined;
  action?: string | undefined;
  component?: string | undefined;
  target?: string | undefined;
  errorCode?: string | undefined;
  durationMs?: number | undefined;
};

export type ProductAnalyticsBatch = {
  clientId: string;
  platform: AnalyticsPlatform;
  appVersion: string;
  buildNumber?: string | undefined;
  events: ProductAnalyticsEvent[];
};

export type GoogleAnalyticsDelivery =
  | { status: "sent" }
  | { status: "disabled" }
  | { status: "misconfigured" }
  | { status: "failed"; statusCode: number };

function isEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function eventParams(
  batch: ProductAnalyticsBatch,
  event: ProductAnalyticsEvent,
) {
  const params: Record<string, string | number> = {
    session_id: event.sessionId,
    engagement_time_msec: Math.max(1, event.durationMs ?? 1),
    app_platform: batch.platform,
    app_version: batch.appVersion,
  };

  if (batch.buildNumber) params.app_build = batch.buildNumber;
  if (event.screen) params.screen = event.screen;
  if (event.feature) params.feature = event.feature;
  if (event.action) params.action = event.action;
  if (event.component) params.component = event.component;
  if (event.target) params.target = event.target;
  if (event.errorCode) params.error_code = event.errorCode;
  if (event.durationMs !== undefined)
    params.duration_ms = Math.max(0, Math.round(event.durationMs));

  if (event.name === "page_view" && event.screen) {
    params.page_location = `https://app.kampusone.app/screen/${encodeURIComponent(event.screen)}`;
    params.page_title = event.screen;
  }

  return params;
}

export async function sendGoogleAnalyticsBatch(
  env: Bindings,
  batch: ProductAnalyticsBatch,
): Promise<GoogleAnalyticsDelivery> {
  if (!isEnabled(env.GA4_ANALYTICS_ENABLED)) return { status: "disabled" };

  const measurementId = env.GA4_MEASUREMENT_ID?.trim();
  const apiSecret = env.GA4_API_SECRET?.trim();
  if (!measurementId || !apiSecret) return { status: "misconfigured" };

  const endpoint = new URL("https://www.google-analytics.com/mp/collect");
  endpoint.searchParams.set("measurement_id", measurementId);
  endpoint.searchParams.set("api_secret", apiSecret);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);
  try {
    const response = await fetch(endpoint.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        client_id: batch.clientId,
        events: batch.events.map((event) => ({
          name: event.name,
          timestamp_micros: Math.trunc(event.timestampMs * 1_000),
          params: eventParams(batch, event),
        })),
      }),
    });

    return response.ok
      ? { status: "sent" }
      : { status: "failed", statusCode: response.status };
  } catch {
    return { status: "failed", statusCode: 0 };
  } finally {
    clearTimeout(timeout);
  }
}
