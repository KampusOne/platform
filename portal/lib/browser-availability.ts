const listeners = new Set<(available: boolean) => void>();
export function browserAvailable() {
  return typeof document !== 'undefined' && document.visibilityState === 'visible' && (typeof navigator === 'undefined' || navigator.onLine !== false);
}
function changed() { for (const listener of listeners) listener(browserAvailable()); }
/** One visibility/connectivity listener set across all foreground status readers. */
export function observeBrowserAvailability(listener: (available: boolean) => void) {
  listeners.add(listener);
  if (listeners.size === 1) { document.addEventListener('visibilitychange', changed); window.addEventListener('online', changed); window.addEventListener('offline', changed); }
  listener(browserAvailable());
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { document.removeEventListener('visibilitychange', changed); window.removeEventListener('online', changed); window.removeEventListener('offline', changed); }
  };
}
