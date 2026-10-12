"use client";
import { useCallback, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';
import { ForegroundPoller, type PollOptions, type PollResult } from './foreground-poller';
import { browserAvailable, observeBrowserAvailability } from './browser-availability';
const subscribe=(listener:()=>void)=>observeBrowserAvailability(()=>listener());
export function useForegroundPoll(key: string, enabled: boolean, read: (signal: AbortSignal) => Promise<PollResult>, options: PollOptions) {
  const latest = useEffectEvent(read);
  const available=useSyncExternalStore(subscribe,browserAvailable,()=>false);
  const poller = useRef<ForegroundPoller | null>(null);
  const [exhaustedKey, setExhaustedKey] = useState<string | null>(null);
  const { intervalMs, maxAttempts, idleBackoff = false, immediate = false } = options;
  useEffect(() => {
    if (!enabled) return;
    const current = new ForegroundPoller(signal => latest(signal), { intervalMs, maxAttempts, idleBackoff, immediate }, () => setExhaustedKey(key));
    poller.current = current;
    const remove = observeBrowserAvailability(value => current.setAvailable(value));
    return () => { remove(); current.stop(); if (poller.current === current) poller.current = null; };
  }, [key, enabled, intervalMs, maxAttempts, idleBackoff, immediate]);
  const restart = useCallback(() => { setExhaustedKey(null); poller.current?.restart(); }, []);
  return { exhausted: exhaustedKey === key, restart, available };
}
