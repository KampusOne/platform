export type AnalyticsLifecycleName =
  | "feature_started"
  | "feature_completed"
  | "feature_failed";

export type AnalyticsLifecycleOptions = {
  screen?: string | undefined;
  action?: string | undefined;
  component?: string | undefined;
  target?: string | undefined;
  errorCode?: string | undefined;
  durationMs?: number | undefined;
};

type LifecycleRecord = {
  name: AnalyticsLifecycleName;
  feature: string;
  options: AnalyticsLifecycleOptions;
};

type LifecycleRecorder = (
  name: AnalyticsLifecycleName,
  feature: string,
  options: AnalyticsLifecycleOptions,
) => void;

let recorder: LifecycleRecorder | null = null;
let pending: LifecycleRecord[] = [];
const MAX_PENDING = 40;

export function registerAnalyticsLifecycleRecorder(next: LifecycleRecorder) {
  recorder = next;
  if (pending.length === 0) return;
  const buffered = pending;
  pending = [];
  for (const event of buffered) {
    recorder(event.name, event.feature, event.options);
  }
}

export function emitFeatureLifecycle(
  name: AnalyticsLifecycleName,
  feature: string,
  options: AnalyticsLifecycleOptions = {},
) {
  if (recorder) {
    recorder(name, feature, options);
    return;
  }

  pending.push({ name, feature, options });
  if (pending.length > MAX_PENDING)
    pending.splice(0, pending.length - MAX_PENDING);
}
