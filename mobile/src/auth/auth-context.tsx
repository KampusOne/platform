import { checkBuildVersion } from "@/src/lib/build-version";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert } from "react-native";

import {
  api,
  authApi,
  onSessionChange,
  setAccessToken,
  type Session,
  type SessionUser,
} from "@/src/lib/api";
import {
  clearDeviceCache,
  readCache,
  writeCache,
} from "@/src/lib/device-cache";
import { clearScheduledAlarms } from "@/src/lib/alarms";
import { applyPreferences, type Preferences } from "@/src/lib/preferences";
import { unregisterPushDevice } from "@/src/lib/push-registration";

type Profile = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  profile_image_url?: string | null;
  university_id: string | null;
  university_name: string | null;
  onboarding_completed_at: string | null;
  settings?: Partial<Preferences>;
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
  const sessionVersion = useRef(0),
    sessionUserId = useRef<string | null>(null);

  const reloadProfile = useCallback(async () => {
    const generation = sessionVersion.current,
      expectedUser = sessionUserId.current;
    setProfileState((current) => (current === "ready" ? current : "loading"));
    setProfileError("");
    try {
      const response = await api<{ profile: Profile }>("/v1/student/me");
      if (
        generation !== sessionVersion.current ||
        response.profile.id !== expectedUser
      )
        return;
      setProfile(response.profile);
      applyPreferences(response.profile.settings);
      setProfileState("ready");
      await writeCache(`profile.${response.profile.id}`, response.profile);
    } catch (caught) {
      if (generation !== sessionVersion.current) return;
      setProfileState((current) => (current === "ready" ? current : "error"));
      setProfileError(
        caught instanceof Error
          ? caught.message
          : "Your student profile could not be loaded.",
      );
      throw caught;
    }
  }, []);

  const applySession = useCallback(
    async (session: Session) => {
      if (sessionUserId.current !== session.user.id) {
        sessionVersion.current++;
        sessionUserId.current = session.user.id;
        setProfile(null);
        setProfileState("loading");
      }
      setAccessToken(session.accessToken);
      setSessionRestoreError("");
      setUser(session.user);
      setState("authenticated");
      void writeCache("last-session", { user: session.user }, 30 * 86400_000).catch(() => undefined);
      try {
        await reloadProfile();
      } catch {
        /* The signed-in session remains valid; the UI exposes a profile retry state. */
      }
    },
    [reloadProfile],
  );

  useEffect(
    () =>
      onSessionChange((session) => {
        if (session) {
          void applySession(session);
        } else {
          sessionVersion.current++;
          sessionUserId.current = null;
          setSessionRestoreError("");
          setUser(null);
          setProfile(null);
          setProfileState("idle");
          setProfileError("");
          setState("anonymous");
          void clearDeviceCache().catch(() => undefined);
          applyPreferences();
          void clearScheduledAlarms().catch(() => undefined);
        }
      }),
    [applySession],
  );

  const retrySessionRestore = useCallback(async () => {
    setSessionRestoreError("");
    try {
      const session = await authApi.refresh();
      if (!session) {
        setState((current) => (current === "loading" ? "anonymous" : current));
      }
    } catch {
      // An unavailable API does not prove the device's refresh session is
      // invalid. Keep any known credentials untouched and let the entry screen
      // offer an explicit retry or a privacy-safe path to interactive sign-in.
      setSessionRestoreError(
        "We couldn’t check this device’s session. Check your connection and try again.",
      );
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const snapshot = await readCache<{ user: SessionUser }>(
        "last-session",
      ).catch(() => null);
      if (snapshot && active) {
        const savedProfile = await readCache<Profile>(
          `profile.${snapshot.user.id}`,
        ).catch(() => null);
        if (savedProfile?.onboarding_completed_at && active) {
          sessionUserId.current = snapshot.user.id;
          setUser(snapshot.user);
          setProfile(savedProfile);
          // Cached profile data is only a rendering optimization. It is never
          // proof that a cookie/session is still valid after a restart.
          setProfileState("ready");
          applyPreferences(savedProfile.settings);
        }
      }
      if (active) await retrySessionRestore();
    })();
    return () => {
      active = false;
    };
  }, [retrySessionRestore]);

  const signOut = useCallback(
    async function requestSignOut(): Promise<boolean> {
      try {
        if (sessionUserId.current)
          await unregisterPushDevice(sessionUserId.current).catch(
            () => undefined,
          );
        await authApi.logout();
      } catch (caught) {
        const detail =
          caught instanceof Error
            ? caught.message
            : "The server could not be reached.";
        Alert.alert(
          "Couldn’t sign out",
          `${detail}\n\nYou are still signed in. Check your connection and try again.`,
          [
            { style: "cancel", text: "Stay signed in" },
            {
              onPress: () => {
                void requestSignOut();
              },
              text: "Try again",
            },
          ],
        );
        return false;
      }

      sessionVersion.current++;
      sessionUserId.current = null;
      setAccessToken(null);
      setSessionRestoreError("");
      setUser(null);
      setProfile(null);
      setProfileState("idle");
      setProfileError("");
      setState("anonymous");
      await clearDeviceCache().catch(() => undefined);
      applyPreferences();
      await clearScheduledAlarms().catch(() => undefined);
      return true;
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      sessionRestoreError,
      profileState,
      profileError,
      user,
      profile,
      beginSession: async (session) => {
        // The cookie/token has already been securely accepted; update checks never block rendering.
        void checkBuildVersion();
        await applySession(session);
      },
      retrySessionRestore,
      reloadProfile,
      signOut,
    }),
    [
      applySession,
      profile,
      profileError,
      profileState,
      reloadProfile,
      retrySessionRestore,
      sessionRestoreError,
      signOut,
      state,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
