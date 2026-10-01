import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { sharedDestination, type ShareKind } from "./shared-links";
const introKey = "k1.install-intro.v1",
  pendingKey = "k1.pending-share.v1";
type Target = { kind: ShareKind; id: string; expires: number };
let complete = false,
  ready = false,
  initialized: Promise<void> | null = null,
  target: Target | null = null;
const listeners = new Set<() => void>();
export function initializeEntryPreferences() {
  return (initialized ??= (async () => {
    try {
      const [saved, pending, keys] = await Promise.all([
        AsyncStorage.getItem(introKey),
        AsyncStorage.getItem(pendingKey),
        AsyncStorage.getAllKeys(),
      ]);
      complete =
        complete ||
        saved === "done" ||
        keys.some(
          (key) =>
            key === "k1.appearance" || key.startsWith("k1.cache.v2.profile."),
        );
      if (complete && saved !== "done")
        await AsyncStorage.setItem(introKey, "done");
      if (pending && !target) {
        try {
          const value = JSON.parse(pending) as Target;
          if (
            sharedDestination(value.kind, value.id) &&
            Number.isFinite(value.expires) &&
            value.expires > Date.now() &&
            value.expires <= Date.now() + 8 * 86400000
          )
            target = value;
        } catch {
          /* Ignore a corrupt navigation bookmark. */
        }
      }
    } catch {
      /* The app remains usable if device storage is unavailable. */
    }
    ready = true;
    listeners.forEach((fn) => fn());
  })());
}
export function useFirstInstallIntro() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => (!ready ? "loading" : complete ? "done" : "new"),
    () => "loading",
  );
}
export async function finishFirstInstallIntro() {
  complete = true;
  listeners.forEach((fn) => fn());
  try {
    await AsyncStorage.setItem(introKey, "done");
    return true;
  } catch {
    return false;
  }
}
export async function rememberSharedTarget(kind: ShareKind, id: string) {
  if (!sharedDestination(kind, id)) return;
  target = { kind, id, expires: Date.now() + 7 * 86400000 };
  try {
    await AsyncStorage.setItem(pendingKey, JSON.stringify(target));
  } catch {
    /* The in-memory target still survives sign-in. */
  }
}
export function pendingSharedDestination() {
  return target && target.expires > Date.now()
    ? sharedDestination(target.kind, target.id)
    : null;
}
export function clearPendingSharedTarget() {
  target = null;
  void AsyncStorage.removeItem(pendingKey).catch(() => undefined);
}
