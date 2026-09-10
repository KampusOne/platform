import type { Session } from "@supabase/supabase-js";
import { AppState, type AppStateStatus } from "react-native";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { isSupabaseConfigured, supabase } from "@/src/lib/supabase";

type SessionContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
};

const SessionContext = createContext<SessionContextValue>({
  configured: isSupabaseConfigured,
  loading: true,
  session: null,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setLoading(false);
      return;
    }

    let live = true;
    void client.auth.getSession().then(({ data }) => {
      if (!live) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!live) return;
      setSession(nextSession);
      setLoading(false);
    });

    const appStateListener = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") {
        client.auth.startAutoRefresh();
      } else {
        client.auth.stopAutoRefresh();
      }
    });

    return () => {
      live = false;
      listener.subscription.unsubscribe();
      appStateListener.remove();
    };
  }, []);

  const value = useMemo(
    () => ({ configured: isSupabaseConfigured, loading, session }),
    [loading, session],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
