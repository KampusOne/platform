import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import { Platform } from "react-native";

import { registerAnalyticsLifecycleRecorder } from "./analytics-bridge";


export type AnalyticsEventName =
  | "page_view"
  | "ui_interaction"
  | "feature_started"
  | "feature_completed"
  | "feature_failed"
  | "content_action"
  | "media_action"
  | "notification_action"
  | "auth_action"
  | "performance_timing";

type AnalyticsEventData = {
  screen?: string | undefined;
  feature?: string | undefined;
  action?: string | undefined;
  component?: string | undefined;
  target?: string | undefined;
  errorCode?: string | undefined;
  durationMs?: number | undefined;
};

type PendingAnalyticsEvent = AnalyticsEventData & {
  id: string;
  name: AnalyticsEventName;
  timestampMs: number;
  sessionId: string;
};

const QUEUE_KEY = "kampusone.analytics.queue.v1";
const CLIENT_ID_KEY = "kampusone.analytics.client.v1";
const MAX_QUEUE_SIZE = 250;
const MAX_BATCH_SIZE = 25;
const NORMAL_FLUSH_DELAY_MS = 7_000;
const FAST_FLUSH_DELAY_MS = 250;
const RETRY_DELAY_MS = 30_000;
const SESSION_TIMEOUT_MS = 30 * 60_000;

const configuredApiUrl =
  process.env.EXPO_PUBLIC_KAMPUSONE_API_URL ??
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined);

const analyticsApiUrl =
  Platform.OS === "web" &&
  typeof window !== "undefined" &&
  !["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "/api"
    : (configuredApiUrl ?? "http://localhost:8787").replace(/\/$/, "");


let queue: PendingAnalyticsEvent[] = [];
let hydrated = false;
let hydration: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight = false;
let clientIdPromise: Promise<string> | null = null;
let sessionId = String(Math.floor(Date.now() / 1_000));
let lastActivityAt = Date.now();

function safeToken(value: string | undefined, max = 100) {
  if (!value) return undefined;
  if (value.length > max) return undefined;
  return /^[a-z0-9][a-z0-9_-]*$/.test(value) ? value : undefined;
}

function safeErrorCode(value: string | undefined) {
  if (!value || value.length > 60) return undefined;
  return /^[A-Z0-9_]+$/.test(value) ? value : undefined;
}

function isPendingEvent(value: unknown): value is PendingAnalyticsEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<PendingAnalyticsEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.name === "string" &&
    typeof event.timestampMs === "number" &&
    typeof event.sessionId === "string"
  );
}

function currentSessionId(now = Date.now()) {
  if (now - lastActivityAt >= SESSION_TIMEOUT_MS) {
    sessionId = String(Math.floor(now / 1_000));
  }
  lastActivityAt = now;
  return sessionId;
}

function createClientId() {
  const uuid = randomUUID().replace(/-/g, "");
  const randomPart = Math.max(1, Number.parseInt(uuid.slice(0, 8), 16));
  return `${randomPart}.${Math.floor(Date.now() / 1_000)}`;
}

async function clientId() {
  if (!clientIdPromise) {
    clientIdPromise = AsyncStorage.getItem(CLIENT_ID_KEY)
      .then(async (saved) => {
        if (saved && /^\d{1,10}\.\d{1,12}$/.test(saved)) return saved;
        const created = createClientId();
        await AsyncStorage.setItem(CLIENT_ID_KEY, created);
        return created;
      })
      .catch(() => createClientId());
  }
  return clientIdPromise;
}

async function hydrateQueue() {
  if (hydrated) return;
  if (!hydration) {
    hydration = AsyncStorage.getItem(QUEUE_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        queue = parsed.filter(isPendingEvent).slice(-MAX_QUEUE_SIZE);
      })
      .catch(() => {
        queue = [];
      })
      .finally(() => {
        hydrated = true;
        hydration = null;
      });
  }
  await hydration;
}

async function persistQueue() {
  try {
    if (queue.length === 0) await AsyncStorage.removeItem(QUEUE_KEY);
    else await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Product analytics must never interrupt the product experience.
  }
}

function schedulePersist(delay = 750) {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistQueue();
  }, delay);
}

function appMetadata() {
  const appVersion = Constants.expoConfig?.version ?? "0";
  const rawBuild =
    Platform.OS === "android"
      ? Constants.expoConfig?.android?.versionCode
      : Platform.OS === "ios"
        ? Constants.expoConfig?.ios?.buildNumber
        : undefined;
  return {
    platform:
      Platform.OS === "ios" ? ("ios" as const) :
      Platform.OS === "web" ? ("web" as const) :
      ("android" as const),
    appVersion,
    ...(rawBuild !== undefined && rawBuild !== null
      ? { buildNumber: String(rawBuild) }
      : {}),
  };
}

async function flushQueue() {
  if (flushInFlight) return;
  await hydrateQueue();
  if (queue.length === 0) return;

  flushInFlight = true;
  const batch = queue.slice(0, MAX_BATCH_SIZE);
  try {
    const id = await clientId();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    let response: Response;
    try {
      response = await fetch(`${analyticsApiUrl}/v1/analytics/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        signal: controller.signal,
        body: JSON.stringify({
          clientId: id,
          ...appMetadata(),
          events: batch.map(({ id: _localId, ...event }) => event),
        }),
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error("Analytics delivery failed");

    const sent = new Set(batch.map((event) => event.id));
    queue = queue.filter((event) => !sent.has(event.id));
    schedulePersist(0);
    if (queue.length > 0) scheduleFlush(FAST_FLUSH_DELAY_MS);
  } catch {
    scheduleFlush(RETRY_DELAY_MS);
  } finally {
    flushInFlight = false;
  }
}

function scheduleFlush(delay: number) {
  if (flushTimer) {
    if (delay > FAST_FLUSH_DELAY_MS) return;
    clearTimeout(flushTimer);
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueue();
  }, delay);
}

function enqueue(name: AnalyticsEventName, data: AnalyticsEventData = {}) {
  const now = Date.now();
  const event: PendingAnalyticsEvent = {
    id: randomUUID(),
    name,
    timestampMs: now,
    sessionId: currentSessionId(now),
  };

  const screen = safeToken(data.screen);
  const feature = safeToken(data.feature);
  const action = safeToken(data.action);
  const component = safeToken(data.component);
  const target = safeToken(data.target);
  const errorCode = safeErrorCode(data.errorCode);

  if (screen) event.screen = screen;
  if (feature) event.feature = feature;
  if (action) event.action = action;
  if (component) event.component = component;
  if (target) event.target = target;
  if (errorCode) event.errorCode = errorCode;
  if (
    typeof data.durationMs === "number" &&
    Number.isFinite(data.durationMs) &&
    data.durationMs >= 0
  ) {
    event.durationMs = Math.min(600_000, Math.round(data.durationMs));
  }

  void hydrateQueue().then(() => {
    queue.push(event);
    if (queue.length > MAX_QUEUE_SIZE)
      queue.splice(0, queue.length - MAX_QUEUE_SIZE);
    schedulePersist();
    scheduleFlush(
      queue.length >= 10 ? FAST_FLUSH_DELAY_MS : NORMAL_FLUSH_DELAY_MS,
    );
  });
}

export function analyticsScreenName(pathname: string) {
  return pathname.split("/").filter(Boolean)[0] ?? "today";
}

export function trackScreenView(screen: string) {
  enqueue("page_view", { screen: safeToken(screen) });
}

export function trackUiInteraction(
  action: string,
  options: Omit<AnalyticsEventData, "action"> = {},
) {
  enqueue("ui_interaction", { ...options, action });
}

export function trackContentAction(
  action: string,
  options: Omit<AnalyticsEventData, "action"> = {},
) {
  enqueue("content_action", { ...options, action });
}

export function trackAuthAction(
  action: string,
  options: Omit<AnalyticsEventData, "action"> = {},
) {
  enqueue("auth_action", { ...options, action });
}

export function trackFeatureLifecycle(
  name: "feature_started" | "feature_completed" | "feature_failed",
  feature: string,
  options: Omit<AnalyticsEventData, "feature"> = {},
) {
  enqueue(name, { ...options, feature });
}

export function trackPerformanceTiming(
  feature: string,
  durationMs: number,
  options: Omit<AnalyticsEventData, "feature" | "durationMs"> = {},
) {
  enqueue("performance_timing", { ...options, feature, durationMs });
}

export function flushAnalytics() {
  void flushQueue();
}

registerAnalyticsLifecycleRecorder(trackFeatureLifecycle);
