import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { getDeviceCacheRevision, readOwnedDraft } from './device-cache';
import { waitForRequest } from './request-policy';

/** A failed restore must never unlock autosave with an empty replacement. */
export function useOwnedDraftRestore<T>(key: string, restore: (value: T | null) => void, enabled = true,
  reader: (key: string, revision: number) => Promise<T | null> = readOwnedDraft<T>) {
  const revision = getDeviceCacheRevision();
  const [retryVersion, setRetryVersion] = useState(0);
  const [result, setResult] = useState<{ key: string; revision: number; version: number; error: string } | null>(null);
  const apply = useEffectEvent(restore), read = useEffectEvent(reader);
  useEffect(() => {
    if (!enabled) return;
    let active = true, timedOut = false;
    const controller = new AbortController();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 5000);
    void waitForRequest(read(key, revision), controller.signal).then(value => {
      if (!active || controller.signal.aborted || revision !== getDeviceCacheRevision()) return;
      apply(value);
      setResult({ key, revision, version: retryVersion, error: '' });
    }).catch(error => {
      if (active && revision === getDeviceCacheRevision())
        setResult({ key, revision, version: retryVersion, error: timedOut ? 'Restoring your saved draft took too long. Its saved copy has been kept. Try again.' : error instanceof Error ? error.message : 'Your saved draft could not be restored. Its saved copy has been kept. Try again.' });
    }).finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [key, revision, retryVersion, enabled]);
  const current = result?.key === key && result.revision === revision && result.version === retryVersion ? result : null;
  const retry = useCallback(() => setRetryVersion(version => version + 1), []);
  return { ready: enabled && current !== null && !current.error, error: current?.error ?? '', loading: enabled && current === null, retry };
}
