import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let recentToolIds: string[] = [];

export function recordRecentTool(id: string) {
  recentToolIds = [id, ...recentToolIds.filter((toolId) => toolId !== id)].slice(0, 4);
  listeners.forEach((listener) => listener());
}

export function useRecentToolIds() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => recentToolIds,
    () => recentToolIds,
  );
}
