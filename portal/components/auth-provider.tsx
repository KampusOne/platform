"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  applySession,
  listenForSession,
  type Session,
  type SessionUser,
  webAuth,
} from "@/lib/api";

type AuthValue = {
  status: "loading" | "anonymous" | "authenticated";
  user: SessionUser | null;
  restoreError: string;
  retryRestore(): Promise<void>;
  start(session: Session): void;
  signOut(): Promise<void>;
};
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthValue["status"]>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [restoreError, setRestoreError] = useState("");
  const start = useCallback((session: Session) => {
    applySession(session);
    setUser(session.user);
    setStatus("authenticated");
    setRestoreError("");
  }, []);
  useEffect(
    () =>
      listenForSession((session) => {
        setUser(session?.user ?? null);
        setStatus(session ? "authenticated" : "anonymous");
        setRestoreError("");
      }),
    [],
  );
  const retryRestore = useCallback(async () => {
    setRestoreError("");
    try {
      const session = await webAuth.refresh();
      setUser(session?.user ?? null);
      setStatus(session ? "authenticated" : "anonymous");
    } catch {
      setRestoreError(
        "We couldn’t check your session. Check your connection and try again.",
      );
    }
  }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void retryRestore();
    });
    return () => {
      active = false;
    };
  }, [retryRestore]);
  const signOut = useCallback(async () => {
    await webAuth.logout();
    setUser(null);
    setStatus("anonymous");
  }, []);
  const value = useMemo(
    () => ({ status, user, start, signOut, restoreError, retryRestore }),
    [signOut, start, status, user, restoreError, retryRestore],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function usePortalAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("usePortalAuth must be used inside AuthProvider");
  return value;
}
