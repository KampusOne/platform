import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, authApi, onSessionChange, setAccessToken, type Session, type SessionUser } from "@/src/lib/api";

type Profile = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  university_id: string | null;
  university_name: string | null;
  onboarding_completed_at: string | null;
};

type AuthState = "loading" | "anonymous" | "authenticated";

type AuthContextValue = {
  state: AuthState;
  user: SessionUser | null;
  profile: Profile | null;
  beginSession(session: Session): Promise<void>;
  reloadProfile(): Promise<void>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const reloadProfile = useCallback(async () => {
    const response = await api<{ profile: Profile }>("/v1/student/me");
    setProfile(response.profile);
  }, []);

  const applySession = useCallback(async (session: Session) => {
    setAccessToken(session.accessToken);
    setUser(session.user);
    setState("authenticated");
    try {
      await reloadProfile();
    } catch {
      setProfile(null);
    }
  }, [reloadProfile]);

  useEffect(() => onSessionChange((session) => {
    if (session) {
      void applySession(session);
    } else {
      setUser(null);
      setProfile(null);
      setState("anonymous");
    }
  }), [applySession]);

  useEffect(() => {
    let mounted = true;
    void authApi.refresh().then((session) => {
      if (!mounted) return;
      if (session) void applySession(session);
      else setState("anonymous");
    });
    return () => { mounted = false; };
  }, [applySession]);

  const signOut = useCallback(async () => {
    try { await authApi.logout(); } finally {
      setAccessToken(null);
      setUser(null);
      setProfile(null);
      setState("anonymous");
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    state, user, profile, beginSession: applySession, reloadProfile, signOut,
  }), [applySession, profile, reloadProfile, signOut, state, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
