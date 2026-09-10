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

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function onSessionChange(listener: (session: Session | null) => void) {
  sessionListener = listener;
  return () => { if (sessionListener === listener) sessionListener = null; };
}

async function parse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as T | {
    error?: { code?: string; message?: string; details?: Record<string, unknown> };
  } | null;
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

async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = fetch(`${apiUrl}/v1/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-Device-Label": "KampusOne mobile" },
      body: "{}",
    })
      .then((response) => parse<Session>(response))
      .then((session) => {
        accessToken = session.accessToken;
        sessionListener?.(session);
        return session;
      })
      .catch(() => {
        accessToken = null;
        sessionListener?.(null);
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
  register(input: { email: string; password: string; firstName: string; lastName: string }) {
    return api<{ status: string; email: string }>("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ ...input, acceptedTerms: true, legalVersion: "2026-09-10" }),
    }, false);
  },
  verify(email: string, code: string) {
    return api<Session>("/v1/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ email, code, deviceLabel: "KampusOne mobile" }),
    }, false);
  },
  resend(email: string) {
    return api<{ status: string }>("/v1/auth/resend-verification", {
      method: "POST", body: JSON.stringify({ email }),
    }, false);
  },
  login(email: string, password: string) {
    return api<Session>("/v1/auth/login", {
      method: "POST", body: JSON.stringify({ email, password, deviceLabel: "KampusOne mobile" }),
    }, false);
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
  logout() {
    return api<{ status: string }>("/v1/auth/logout", { method: "POST", body: "{}" }, false);
  },
};
