import { invalidationTargets, matchesRead, waitForRequest } from "./request-policy";
import { withRequestDeadline } from "./request-deadline";
import Constants from "expo-constants";
import { Platform } from "react-native";

import {
  readRefreshToken,
  removeRefreshToken,
  saveRefreshToken,
} from "./session-storage";

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

export type ApiRequestInit = RequestInit & { timeoutMs?: number };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const configuredUrl =
  process.env.EXPO_PUBLIC_KAMPUSONE_API_URL ??
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined);
const configuredFallbackUrl =
  process.env.EXPO_PUBLIC_KAMPUSONE_API_FALLBACK_URL ??
  (Constants.expoConfig?.extra?.apiFallbackUrl as string | undefined);
export const apiUrl =
  Platform.OS === "web" &&
  typeof window !== "undefined" &&
  !["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "/api"
    : (configuredUrl ?? "http://localhost:8787").replace(/\/$/, "");
const fallbackApiUrl =
  Platform.OS === "web"
    ? null
    : configuredFallbackUrl?.replace(/\/$/, "") ?? null;
let activeApiUrl = apiUrl;

function currentApiUrl() {
  return Platform.OS === "web" ? apiUrl : activeApiUrl;
}

function alternateApiUrl(origin: string) {
  if (Platform.OS === "web" || !fallbackApiUrl || fallbackApiUrl === apiUrl)
    return null;
  return origin === apiUrl ? fallbackApiUrl : apiUrl;
}

function markApiOriginHealthy(origin: string) {
  if (Platform.OS !== "web") activeApiUrl = origin;
}

function markApiOriginUnavailable(origin: string) {
  const alternate = alternateApiUrl(origin);
  if (alternate && activeApiUrl === origin) activeApiUrl = alternate;
  return alternate;
}
let accessToken: string | null = null;
let sessionListener: ((session: Session | null) => void) | null = null;
let restrictionListener: (() => void) | null = null;
export function onAccountRestriction(listener: () => void) {
  restrictionListener = listener;
  return () => {
    if (restrictionListener === listener) restrictionListener = null;
  };
}
let refreshPromise: Promise<Session | null> | null = null;
let refreshAbortController: AbortController | null = null;
let credentialVersion = 0;
let cacheVersion = 0;
let sessionTransitionQueue: Promise<void> = Promise.resolve();
let queuedSessionTransitions = 0;
const reads = new Map<string, { expires: number; value: unknown }>();
const inFlight = new Map<string, Promise<unknown>>();
const cacheable =
  /^\/v1\/(?!auth(?:\/|$)|media(?:\/|$)|config(?:\/|$))/;

function readCacheTtl(path: string) {
  if (/\/catalog(?:\/|\?|$)|\/campus\/places(?:\/|\?|$)/.test(path))
    return 300_000;
  if (/^\/v1\/(messages|notifications)(\/|\?|$)/.test(path)) return 5_000;
  if (/\/feed(?:\/|\?|$)|^\/v1\/people(\/|\?|$)/.test(path)) return 10_000;
  return 20_000;
}

export function clearApiCache() {
  cacheVersion += 1;
  reads.clear();
  inFlight.clear();
}


function invalidateMutation(path: string) {
  const targets = invalidationTargets(path);
  if (targets === null) { clearApiCache(); return; }
  if (!targets.length) return;
  cacheVersion += 1;
  for (const key of reads.keys()) if (targets.some((prefix) => matchesRead(key, prefix))) reads.delete(key);
  for (const key of inFlight.keys()) if (targets.some((prefix) => matchesRead(key, prefix))) inFlight.delete(key);
}

/** Account-local, bounded in-memory data only. Never persisted or publicly cached. */
export function peekTransportCache<T>(path: string): T | undefined {
  const saved = reads.get(path);
  return saved && saved.expires > Date.now() ? saved.value as T : undefined;
}

export function setAccessToken(token: string | null) {
  if (token !== accessToken || !token) clearApiCache();
  accessToken = token;
  credentialVersion += 1;
}

export function onSessionChange(listener: (session: Session | null) => void) {
  sessionListener = listener;
  return () => {
    if (sessionListener === listener) sessionListener = null;
  };
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
    const failure = payload as {
      error?: {
        code?: string;
        message?: string;
        details?: Record<string, unknown>;
      };
    } | null;
    if (failure?.error?.code === "ACCOUNT_RESTRICTED") restrictionListener?.();
    const code = failure?.error?.code ?? "REQUEST_FAILED";
    const message =
      code === "INTERNAL_ERROR" &&
      (!failure?.error?.message ||
        failure.error.message === "The service could not complete this request.")
        ? "KampusOne is temporarily unavailable. Please try again shortly."
        : failure?.error?.message ?? "KampusOne could not complete this request.";
    throw new ApiError(
      response.status,
      code,
      message,
      failure?.error?.details,
    );
  }
  return payload as T;
}

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Session>;
  const user = candidate.user as Partial<SessionUser> | undefined;
  return (
    typeof candidate.accessToken === "string" &&
    candidate.accessToken.length > 0 &&
    typeof candidate.refreshToken === "string" &&
    candidate.refreshToken.length > 0 &&
    typeof candidate.expiresIn === "number" &&
    typeof candidate.refreshExpiresIn === "number" &&
    Boolean(user) &&
    typeof user?.id === "string" &&
    typeof user.email === "string" &&
    Array.isArray(user.roles) &&
    Array.isArray(user.operatorRoles)
  );
}

function isExplicitSessionRejection(caught: unknown) {
  return (
    caught instanceof ApiError &&
    ((caught.status === 401 && caught.code === "UNAUTHENTICATED") ||
      (caught.status === 403 && caught.code === "FORBIDDEN" && caught.details?.reason === "ACCOUNT_RESTRICTED"))
  );
}

function runSessionTransition<T>(operation: () => Promise<T>): Promise<T> {
  // Login, verification, and logout all mutate the refresh cookie. Queue them
  // behind any active refresh so a late Set-Cookie response cannot resurrect a
  // logged-out session or replace a newly authenticated account's cookie.
  queuedSessionTransitions += 1;
  const pending = sessionTransitionQueue.then(async () => {
    const activeRefresh = refreshPromise;
    if (activeRefresh) {
      // Interactive auth must never sit behind a stale cold-start refresh.
      // Abort the restore and wait only for its cancellation to settle.
      refreshAbortController?.abort();
      try {
        await activeRefresh;
      } catch {
        /* A cancelled/offline restore must not block sign-in or sign-up. */
      }
    }
    return operation();
  });
  sessionTransitionQueue = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending.finally(() => {
    queuedSessionTransitions -= 1;
  });
}

async function securelyAcceptSession(session: Session) {
  if (!isSession(session)) {
    throw new ApiError(
      200,
      "INVALID_RESPONSE",
      "KampusOne returned an incomplete session. Please try again.",
    );
  }
  try {
    await saveRefreshToken(session.refreshToken);
  } catch {
    throw new ApiError(
      503,
      "SECURE_STORAGE_UNAVAILABLE",
      "This device could not securely save your session. Unlock the device and try again.",
    );
  }
  return session;
}

async function refreshSession() {
  if (!refreshPromise) {
    if (queuedSessionTransitions > 0) {
      throw new ApiError(
        409,
        "SESSION_TRANSITION",
        "A session change is already in progress. Please try again.",
      );
    }
    const versionAtStart = credentialVersion;
    const restoreOrigin = currentApiUrl();
    const restoreController = new AbortController();
    refreshAbortController = restoreController;
    refreshPromise = withRequestDeadline(async (signal) => {
        const refreshToken = await readRefreshToken();
        // Native sessions live in SecureStore, not browser cookies. A fresh
        // install or signed-out device has nothing to restore over the network.
        if (Platform.OS !== "web" && !refreshToken) return null;
        if (signal.aborted) throw new Error("Session restoration cancelled");
        const response = await fetch(`${restoreOrigin}/v1/auth/refresh`, {
          method: "POST",
          credentials: "include",
          signal,
          headers: {
            "Content-Type": "application/json",
            "X-Device-Label": "KampusOne mobile",
          },
          body: JSON.stringify(refreshToken ? { refreshToken } : {}),
        });
        markApiOriginHealthy(restoreOrigin);
        return parse<Session>(response);
      }, 12_000, restoreController.signal)
      .then((session) => session ? securelyAcceptSession(session) : null)
      .then((session) => {
        // Do not let an older refresh overwrite a session established while it
        // was in flight (for example, a fresh interactive sign-in).
        if (session && credentialVersion === versionAtStart) {
          setAccessToken(session.accessToken);
          sessionListener?.(session);
        }
        return session;
      })
      .catch((caught: unknown) => {
        // A failed connection, a 5xx, or malformed JSON does not prove that a
        // refresh cookie or the current access token is invalid. Only the API's
        // explicit auth rejection is allowed to end the local session.
        if (
          (caught instanceof Error && caught.name === "TimeoutError") ||
          caught instanceof TypeError
        ) {
          markApiOriginUnavailable(restoreOrigin);
        }
        if (!isExplicitSessionRejection(caught)) throw caught;
        if (credentialVersion === versionAtStart) {
          setAccessToken(null);
          sessionListener?.(null);
          void removeRefreshToken();
        }
        return null;
      })
      .finally(() => {
        if (refreshAbortController === restoreController) refreshAbortController = null;
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function request<T>(
  path: string,
  init: ApiRequestInit = {},
  canRefresh = true,
): Promise<T> {
  const { timeoutMs, signal: parentSignal, ...requestInit } = init;
  const headers = new Headers(init.headers);
  if (
    init.body &&
    !(init.body instanceof FormData) &&
    !headers.has("Content-Type")
  )
    headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  // Expo SDK 57 uses the standard Blob/FormData model for file uploads.
  const send = Platform.OS !== "web" && (init.body instanceof FormData || ((path.startsWith("/v1/media?") || path.startsWith("/v1/ai/transcribe?")) && Boolean(init.body)))
    ? (await import("expo/fetch")).fetch
    : fetch;
  const method = (requestInit.method ?? "GET").toUpperCase();
  const mayRetryOnAnotherOrigin = method === "GET" || method === "HEAD";
  const requestTimeoutMs = timeoutMs ?? 15_000;
  const startedAt = Date.now();
  const remainingTimeoutMs = () =>
    Math.max(1, requestTimeoutMs - (Date.now() - startedAt));
  const attempt = (baseUrl: string) =>
    withRequestDeadline(async (signal) => {
      const response = await send(`${baseUrl}${path}`, {
        ...requestInit, signal, credentials: "include", headers,
      });
      markApiOriginHealthy(baseUrl);
      if (response.status === 401 && canRefresh && path !== "/v1/auth/refresh")
        return { response };
      return { response, value: await parse<T>(response) };
    }, remainingTimeoutMs(), parentSignal);

  let result: { response: Response; value?: T };
  const primaryOrigin = currentApiUrl();
  try {
    result = await attempt(primaryOrigin);
  } catch (caught) {
    const connectionFailure =
      (caught instanceof Error && caught.name === "TimeoutError") ||
      caught instanceof TypeError;
    const alternate = connectionFailure
      ? markApiOriginUnavailable(primaryOrigin)
      : null;
    if (
      alternate &&
      mayRetryOnAnotherOrigin &&
      !parentSignal?.aborted &&
      remainingTimeoutMs() > 250
    ) {
      try {
        result = await attempt(alternate);
      } catch (fallbackError) {
        if (
          fallbackError instanceof Error &&
          fallbackError.name === "TimeoutError"
        )
          throw new ApiError(0, "REQUEST_TIMEOUT", fallbackError.message);
        if (fallbackError instanceof TypeError)
          throw new ApiError(
            0,
            "NETWORK_UNAVAILABLE",
            "We couldn’t connect to KampusOne. Check your internet connection and try again.",
          );
        throw fallbackError;
      }
    } else {
      if (caught instanceof Error && caught.name === "TimeoutError")
        throw new ApiError(0, "REQUEST_TIMEOUT", caught.message);
      if (caught instanceof TypeError)
        throw new ApiError(
          0,
          "NETWORK_UNAVAILABLE",
          "We couldn’t connect to KampusOne. Check your internet connection and try again.",
        );
      throw caught;
    }
  }
  if (result.response.status === 401 && canRefresh && path !== "/v1/auth/refresh") {
    const renewed = await refreshSession();
    if (renewed) return request<T>(path, init, false);
    return withRequestDeadline(() => parse<T>(result.response), timeoutMs, parentSignal);
  }
  return result.value as T;
}

export async function api<T>(
  path: string,
  init: ApiRequestInit = {},
  canRefresh = true,
): Promise<T> {
  const isRead = !init.method || init.method.toUpperCase() === "GET";
  if (!isRead) {
    invalidateMutation(path);
    try { return await request<T>(path, init, canRefresh); }
    finally { invalidateMutation(path); }
  }
  // Explicit caller headers may alter representation; never share those requests.
  if (!cacheable.test(path) || init.headers || init.cache === "no-store")
    return request<T>(path, init, canRefresh);
  if (init.signal?.aborted) throw init.signal.reason ?? new Error("Request cancelled");
  const cached = reads.get(path);
  if (init.cache !== "reload" && cached && cached.expires > Date.now()) return cached.value as T;
  const pending = inFlight.get(path);
  if (pending) return waitForRequest(pending as Promise<T>, init.signal);
  const version = credentialVersion;
  const cacheAtStart = cacheVersion;
  // A single timed network request is shared by independently cancellable consumers.
  const { signal: _consumerSignal, ...sharedInit } = init;
  const operation = request<T>(path, sharedInit, canRefresh)
    .then((value) => {
      if (version === credentialVersion && cacheAtStart === cacheVersion) {
        if (reads.size >= 60) reads.delete(reads.keys().next().value!);
        reads.set(path, {
          value,
          expires: Date.now() + readCacheTtl(path),
        });
      }
      return value;
    })
    .finally(() => {
      if (inFlight.get(path) === operation) inFlight.delete(path);
    });
  inFlight.set(path, operation);
  return waitForRequest(operation, init.signal);
}

export const authApi = {
  socialComplete(authCode: string, codeVerifier: string) {
    return runSessionTransition(() =>
      api<Session>(
        "/v1/auth/social/complete",
        {
          method: "POST",
          timeoutMs: 35_000,
          body: JSON.stringify({
            authCode,
            codeVerifier,
            deviceLabel: "KampusOne " + Platform.OS,
          }),
        },
        false,
      ).then(securelyAcceptSession),
    );
  },
  register(input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    acceptedTerms: true;
  }) {
    return api<{ status: string; email: string }>(
      "/v1/auth/register",
      {
        method: "POST",
        timeoutMs: 35_000,
        body: JSON.stringify({ ...input, legalVersion: "2026-09-10" }),
      },
      false,
    );
  },
  verify(email: string, code: string) {
    return runSessionTransition(() =>
      api<Session>(
        "/v1/auth/verify-email",
        {
          method: "POST",
          timeoutMs: 35_000,
          body: JSON.stringify({
            email,
            code,
            deviceLabel: "KampusOne mobile",
          }),
        },
        false,
      ).then(securelyAcceptSession),
    );
  },
  resend(email: string) {
    return api<{ status: string }>(
      "/v1/auth/resend-verification",
      {
        method: "POST",
        timeoutMs: 35_000,
        body: JSON.stringify({ email }),
      },
      false,
    );
  },
  login(email: string, password: string) {
    return runSessionTransition(() =>
      api<Session>(
        "/v1/auth/login",
        {
          method: "POST",
          timeoutMs: 35_000,
          body: JSON.stringify({
            email,
            password,
            deviceLabel: "KampusOne mobile",
          }),
        },
        false,
      ).then(securelyAcceptSession),
    );
  },
  refresh: refreshSession,
  forgotPassword(email: string) {
    return api<{ status: string }>(
      "/v1/auth/forgot-password",
      {
        method: "POST",
        body: JSON.stringify({ email }),
      },
      false,
    );
  },
  validateResetCode(email: string, code: string) {
    return api<{ status: string }>(
      "/v1/auth/validate-reset-code",
      {
        method: "POST",
        body: JSON.stringify({ email, code }),
      },
      false,
    );
  },
  resetPassword(email: string, code: string, password: string) {
    return api<{ status: string }>(
      "/v1/auth/reset-password",
      {
        method: "POST",
        body: JSON.stringify({ email, code, password }),
      },
      false,
    );
  },
  async logout() {
    const result = await runSessionTransition(async () => {
      const refreshToken = await readRefreshToken();
      return api<{ status: string }>(
        "/v1/auth/logout",
        {
          method: "POST",
          body: JSON.stringify(refreshToken ? { refreshToken } : {}),
        },
        false,
      );
    });
    if (result.status !== "signed_out") {
      throw new ApiError(
        502,
        "INVALID_RESPONSE",
        "KampusOne could not confirm that this session was signed out.",
      );
    }
    await removeRefreshToken();
    return result;
  },
};
