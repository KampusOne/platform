import { useSyncExternalStore } from 'react';

let offline = false;
const listeners = new Set<() => void>();
export const isOffline = () => offline;
export function setNetworkOffline(value: boolean) {
  if (offline === value) return;
  offline = value;
  for (const listener of listeners) listener();
}
export const subscribeNetwork = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function useOffline() {
  return useSyncExternalStore(subscribeNetwork, isOffline, () => false);
}
