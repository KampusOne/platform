"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { applySession, listenForSession, type Session, type SessionUser, webAuth } from "@/lib/api";

type AuthValue = { status: "loading" | "anonymous" | "authenticated"; user: SessionUser | null; start(session: Session): void; signOut(): Promise<void> };
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthValue["status"]>("loading"); const [user, setUser] = useState<SessionUser | null>(null);
  const start = useCallback((session: Session) => { applySession(session); setUser(session.user); setStatus("authenticated"); }, []);
  useEffect(() => listenForSession((session) => { setUser(session?.user ?? null); setStatus(session ? "authenticated" : "anonymous"); }), []);
  useEffect(() => { void webAuth.refresh().then((session) => { if (session) { setUser(session.user); setStatus("authenticated"); } else setStatus("anonymous"); }); }, []);
  const signOut = useCallback(async () => { await webAuth.logout(); setUser(null); setStatus("anonymous"); }, []);
  const value = useMemo(() => ({ status, user, start, signOut }), [signOut, start, status, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function usePortalAuth() { const value = useContext(AuthContext); if (!value) throw new Error("usePortalAuth must be used inside AuthProvider"); return value; }
