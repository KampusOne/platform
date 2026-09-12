import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";

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
type ProfileState = "idle" | "loading" | "ready" | "error";

type AuthContextValue = {
  state: AuthState;
  sessionRestoreError: string;
  profileState: ProfileState;
  profileError: string;
  user: SessionUser | null;
  profile: Profile | null;
  beginSession(session: Session): Promise<void>;
  retrySessionRestore(): Promise<void>;
  reloadProfile(): Promise<void>;
  signOut(): Promise<boolean>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>("loading");
  const [sessionRestoreError, setSessionRestoreError] = useState("");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileState, setProfileState] = useState<ProfileState>("idle");
  const [profileError, setProfileError] = useState("");

  const reloadProfile = useCallback(async () => {
    setProfileState("loading");
    setProfileError("");
    try {
      const response = await api<{ profile: Profile }>("/v1/student/me");
      setProfile(response.profile);
      setProfileState("ready");
    } catch (caught) {
      setProfile(null);
      setProfileState("error");
      setProfileError(caught instanceof Error ? caught.message : "Your student profile could not be loaded.");
      throw caught;
    }
  }, []);

  const applySession = useCallback(async (session: Session) => {
    setAccessToken(session.accessToken);
    setSessionRestoreError("");
    setUser(session.user);
    setState("authenticated");
    try {
      await reloadProfile();
    } catch { /* The signed-in session remains valid; the UI exposes a profile retry state. */ }
  }, [reloadProfile]);

  useEffect(() => onSessionChange((session) => {
    if (session) {
      void applySession(session);
    } else {
      setSessionRestoreError("");
      setUser(null);
      setProfile(null);
      setProfileState("idle");
      setProfileError("");
      setState("anonymous");
    }
  }), [applySession]);

  const retrySessionRestore = useCallback(async () => {
    setSessionRestoreError("");
    try {
      const session = await authApi.refresh();
      if (!session) {
        setState((current) => current === "loading" ? "anonymous" : current);
      }
    } catch {
      // An unavailable API does not prove the device's refresh session is
      // invalid. Keep any known credentials untouched and let the entry screen
      // offer an explicit retry or a privacy-safe path to interactive sign-in.
      setSessionRestoreError("We couldn’t check this device’s session. Check your connection and try again.");
    }
  }, []);

  useEffect(() => {
    void retrySessionRestore();
  }, [retrySessionRestore]);

  const signOut = useCallback(async function requestSignOut(): Promise<boolean> {
    try {
      await authApi.logout();
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "The server could not be reached.";
      Alert.alert(
        "Couldn’t sign out",
        `${detail}\n\nYou are still signed in. Check your connection and try again.`,
        [
          { style: "cancel", text: "Stay signed in" },
          { onPress: () => { void requestSignOut(); }, text: "Try again" },
        ],
      );
      return false;
    }

    setAccessToken(null);
    setSessionRestoreError("");
    setUser(null);
    setProfile(null);
    setProfileState("idle");
    setProfileError("");
    setState("anonymous");
    return true;
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    state,
    sessionRestoreError,
    profileState,
    profileError,
    user,
    profile,
    beginSession: applySession,
    retrySessionRestore,
    reloadProfile,
    signOut,
  }), [applySession, profile, profileError, profileState, reloadProfile, retrySessionRestore, sessionRestoreError, signOut, state, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
