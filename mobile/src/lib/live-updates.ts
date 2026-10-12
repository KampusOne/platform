import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../auth/auth-context';
import { invalidateApiReads } from './api';
import { ReadCoordinator } from './read-coordinator';
import { cacheScopeForUser } from './request-policy';
export const liveReads = new ReadCoordinator(invalidateApiReads);
/** Initial hydration stays with the screen; events and bounded fallback only reconcile it. */
export function useLiveRefresh(path: string, refresh: () => Promise<unknown> | unknown, interval = 60_000, enabled = true) {
  const { user } = useAuth();
  const scope=user?cacheScopeForUser(user):null;
  const latest = useRef(refresh); latest.current=refresh;
  useFocusEffect(useCallback(()=>{
    if(!user?.id||!enabled)return;
    return liveReads.subscribe(path,()=>latest.current(),interval);
  },[scope,path,interval,enabled]));
}
