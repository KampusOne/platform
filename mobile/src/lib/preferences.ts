import { useSyncExternalStore } from "react";
export type Preferences = {
  notifications: boolean;
  marketing: boolean;
  haptics: boolean;
  hideCgpa: boolean;
};
export const defaultPreferences: Preferences = {
  notifications: true,
  marketing: false,
  haptics: true,
  hideCgpa: true,
};
let current: Preferences = defaultPreferences;
const subscribers = new Set<() => void>();
export function applyPreferences(value: Partial<Preferences> = {}) {
  current = { ...defaultPreferences, ...value };
  subscribers.forEach((fn) => fn());
}
export function getPreferences() {
  return current;
}
export function usePreferences() {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    getPreferences,
    () => defaultPreferences,
  );
}
