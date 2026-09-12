import Constants from "expo-constants";

export type SessionUser = {
  id: string;
  email: string;
  roles: string[];
  universityId: string | null;
  operatorRoles: string[];
};

export type Session = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
  user: SessionUser;
};

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
  }
}

const configuredUrl = process.env.EXPO_PUBLIC_KAMPUSONE_API_URL
  ?? process.env.EXPO_PUBLIC_API_URL
  ?? (Constants.expoConfig?.extra?.apiUrl as string | undefined);
const apiUrl = (configuredUrl ?? "http://localhost:8787").replace(/\/$/, "");
let accessToken: string | null = null;
let sessionListener: ((session: Session | null) => void) | null = null;
let refreshPromise: Promise<Session | null> | null = null;
let credentialVersion = 0;
let sessionTransitionQueue: Promise<void> = Promise.resolve();
let queuedSessionTransitions = 0;

export function setAccessToken(token: string | null) {
  accessToken = token;
  credentialVersion += 1;
}

export function onSessionChange(listener: (session: Session | null) => void) {
  sessionListener = listener;
  return () => { if (sessionListener === listener) sessionListener = null; };
}

async function parse<T>(response: Response): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) {
      throw new ApiError(
        response.status,
        "REQUEST_FAILED",
        "KampusOne could not complete this request.",
      );
    }
    throw new ApiError(
      response.status,
      "INVALID_RESPONSE",
      "KampusOne returned an unreadable response. Please try again.",
    );
  }
  if (!response.ok) {
    const failure = payload as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null;
    throw new ApiError(
      response.status,
      failure?.error?.code ?? "REQUEST_FAILED",
      failure?.error?.message ?? "KampusOne could not complete this request.",
      failure?.error?.details,
    );
  }
  return payload as T;
}

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Session>;
  const user = candidate.user as Partial<SessionUser> | undefined;
  return typeof candidate.accessToken === "string"
    && candidate.accessToken.length > 0
    && typeof candidate.refreshToken === "string"
    && candidate.refreshToken.length > 0
    && typeof candidate.expiresIn === "number"
    && typeof candidate.refreshExpiresIn === "number"
    && Boolean(user)
    && typeof user?.id === "string"
    && typeof user.email === "string"
    && Array.isArray(user.roles)
    && Array.isArray(user.operatorRoles);
}

function isExplicitSessionRejection(caught: unknown) {
  return caught instanceof ApiError
    && ((caught.status === 401 && caught.code === "UNAUTHENTICATED")
      || (caught.status === 403 && caught.code === "FORBIDDEN"));
}

function runSessionTransition<T>(operation: () => Promise<T>): Promise<T> {
  // Login, verification, and logout all mutate the refresh cookie. Queue them
  // behind any active refresh so a late Set-Cookie response cannot resurrect a
  // logged-out session or replace a newly authenticated account's cookie.
  queuedSessionTransitions += 1;
  const pending = sessionTransitionQueue.then(async () => {
    const activeRefresh = refreshPromise;
    if (activeRefresh) {
      try { await activeRefresh; } catch { /* The transition can still proceed with the current cookie. */ }
    }
    return operation();
  });
  sessionTransitionQueue = pending.then(() => undefined, () => undefined);
  return pending.finally(() => { queuedSessionTransitions -= 1; });
}

async function refreshSession() {
  if (!refreshPromise) {
    if (queuedSessionTransitions > 0) {
      throw new ApiError(409, "SESSION_TRANSITION", "A session change is already in progress. Please try again.");
    }
    const versionAtStart = credentialVersion;
    refreshPromise = fetch(`${apiUrl}/v1/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Device-Label": "KampusOne mobile" },
      body: "{}",
    })
      .then((response) => parse<Session>(response))
      .then((session) => {
        if (!isSession(session)) {
          throw new ApiError(
            200,
            "INVALID_RESPONSE",
            "KampusOne returned an incomplete session. Please try again.",
          );
        }
        // Do not let an older refresh overwrite a session established while it
        // was in flight (for example, a fresh interactive sign-in).
        if (credentialVersion === versionAtStart) {
          setAccessToken(session.accessToken);
          sessionListener?.(session);
        }
        return session;
      })
      .catch((caught: unknown) => {
        // A failed connection, a 5xx, or malformed JSON does not prove that a
        // refresh cookie or the current access token is invalid. Only the API's
        // explicit auth rejection is allowed to end the local session.
        if (!isExplicitSessionRejection(caught)) throw caught;
        if (credentialVersion === versionAtStart) {
          setAccessToken(null);
          sessionListener?.(null);
        }
        return null;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function api<T>(path: string, init: RequestInit = {}, canRefresh = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${apiUrl}${path}`, { ...init, credentials: "include", headers });
  if (response.status === 401 && canRefresh && path !== "/v1/auth/refresh") {
    const renewed = await refreshSession();
    if (renewed) return api<T>(path, init, false);
  }
  return parse<T>(response);
}

export const authApi = {
  register(input: { email: string; password: string; firstName: string; lastName: string; acceptedTerms: true }) {
    return api<{ status: string; email: string }>("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ ...input, legalVersion: "2026-09-10" }),
    }, false);
  },
  verify(email: string, code: string) {
    return runSessionTransition(() => api<Session>("/v1/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ email, code, deviceLabel: "KampusOne mobile" }),
    }, false));
  },
  resend(email: string) {
    return api<{ status: string }>("/v1/auth/resend-verification", {
      method: "POST", body: JSON.stringify({ email }),
    }, false);
  },
  login(email: string, password: string) {
    return runSessionTransition(() => api<Session>("/v1/auth/login", {
      method: "POST", body: JSON.stringify({ email, password, deviceLabel: "KampusOne mobile" }),
    }, false));
  },
  refresh: refreshSession,
  forgotPassword(email: string) {
    return api<{ status: string }>("/v1/auth/forgot-password", {
      method: "POST", body: JSON.stringify({ email }),
    }, false);
  },
  resetPassword(email: string, code: string, password: string) {
    return api<{ status: string }>("/v1/auth/reset-password", {
      method: "POST", body: JSON.stringify({ email, code, password }),
    }, false);
  },
  async logout() {
    const result = await runSessionTransition(() => api<{ status: string }>(
      "/v1/auth/logout",
      { method: "POST", body: "{}" },
      false,
    ));
    if (result.status !== "signed_out") {
      throw new ApiError(502, "INVALID_RESPONSE", "KampusOne could not confirm that this session was signed out.");
    }
    return result;
  },
};
