import { useCallback, useEffect, useRef, useState } from 'react';
import { getDeviceCacheRevision, saveOwnedDraft } from './device-cache';

/** Debounced autosave with visible failure, unmount flush and explicit completion. */
export function useOwnedDraftSave(key: string, value: unknown, enabled: boolean, delay = 300) {
  const revision = getDeviceCacheRevision(), serialized = JSON.stringify(value);
  const mounted = useRef(false), attempt = useRef(0), completed = useRef('');
  const pending = useRef<{ key: string; value: unknown; revision: number } | null>(null);
  const [notice, setNotice] = useState<{ key: string; revision: number; message: string } | null>(null);
  const [cycle, setCycle] = useState(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const persist = useCallback(async (next: unknown) => {
    const turn = ++attempt.current;
    try {
      const level = await saveOwnedDraft(key, next, revision);
      if (mounted.current && turn === attempt.current)
        setNotice({ key, revision, message: level === 'session' ? 'This draft is kept while this browser tab stays open. Finish or copy it before closing the tab.' : '' });
    } catch (error) {
      if (mounted.current && turn === attempt.current)
        setNotice({ key, revision, message: error instanceof Error ? error.message : 'This draft could not be saved. Keep this screen open and try again.' });
      throw error;
    }
  }, [key, revision]);
  useEffect(() => {
    if (!enabled || completed.current === key) { pending.current = null; return; }
    const next: unknown = serialized === undefined ? undefined : JSON.parse(serialized);
    pending.current = { key, value: next, revision };
    const timer = setTimeout(() => {
      if (completed.current !== key) void persist(next).catch(() => undefined);
    }, delay);
    return () => clearTimeout(timer);
  }, [key, revision, serialized, enabled, delay, persist, cycle]);
  useEffect(() => () => {
    const draft = pending.current;
    if (draft?.key === key && completed.current !== key)
      void saveOwnedDraft(draft.key, draft.value, draft.revision).catch(() => undefined);
  }, [key, revision]);
  const discard = useCallback(() => {
    completed.current = key; pending.current = null; attempt.current++;
  }, [key]);
  const begin = useCallback(() => { completed.current = ''; pending.current = null; attempt.current++; setCycle(value => value + 1); }, []);
  return { warning: notice?.key === key && notice.revision === revision ? notice.message : '', persist, discard, begin };
}
