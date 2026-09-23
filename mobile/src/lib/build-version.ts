import { Platform } from "react-native";
const currentBuild = process.env.EXPO_PUBLIC_BUILD_ID;
let pending: Promise<void> | undefined;
const editingPath = /(?:compose|account-edit|onboarding|password|support|settings|timetable|gpa|checkout)/i;
export function checkBuildVersion(): Promise<void> {
  if (Platform.OS !== "web" || typeof window === "undefined" || !currentBuild || editingPath.test(window.location.pathname)) return Promise.resolve();
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch(`/app-version.json?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
      if (!response.ok) return;
      const payload: unknown = await response.json();
      const version = (payload as { version?: unknown } | null)?.version;
      if (typeof version !== "string" || !/^[a-zA-Z0-9._-]{7,80}$/.test(version) || version === currentBuild) return;
      if (editingPath.test(window.location.pathname)) return;
      const key = "kampusone.loaded-build";
      if (window.sessionStorage.getItem(key) === version) return;
      window.sessionStorage.setItem(key, version);
      window.location.reload();
    } catch { /* Offline, blocked storage or version-check failure must never prevent sign-in. */ }
  })().finally(() => { pending = undefined; });
  return pending;
}
