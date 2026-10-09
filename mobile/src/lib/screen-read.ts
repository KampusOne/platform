import { api, peekApiCache } from './api';

/** Show this account's last successful read immediately, then reconcile it.
 * Cached content is for rendering only; actions still use the live API. */
export async function refreshScreenRead<T>(path: string, publish: (value: T) => void): Promise<T> {
  const saved = peekApiCache<T>(path, { allowStale: true });
  if (saved !== undefined) publish(saved);
  const fresh = await api<T>(path);
  publish(fresh);
  return fresh;
}
