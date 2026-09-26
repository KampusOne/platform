import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

type Startup = { homeReady: boolean; markHomeReady: () => void };
const Context = createContext<Startup>({ homeReady: false, markHomeReady: () => undefined });

/** Readiness belongs to the actual screen, never to an arbitrary splash timer. */
export function StartupProvider({ children }: { children: ReactNode }) {
  const [homeReady, setHomeReady] = useState(false);
  const markHomeReady = useCallback(() => setHomeReady(true), []);
  const value = useMemo(() => ({ homeReady, markHomeReady }), [homeReady, markHomeReady]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useStartup() { return useContext(Context); }
