"use client";

import { withSessionLock } from "./session-lock";

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
  user: SessionUser;
};

export class PortalApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PortalApiError";
  }
}

const connectionError = () =>
  new PortalApiError(
    0,
    "NETWORK_UNAVAILABLE",
    "KampusOne could not reach its server. Your internet may still be working; please try again shortly.",
  );

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const localApiUrl = "http://localhost:8787";
const configuredApiUrl = process.env.NEXT_PUBLIC_KAMPUSONE_API_URL?.trim();
const isLocalBrowser =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname);
const baseUrl =
  typeof window !== "undefined" && !isLocalBrowser
    ? "/api"
    : (configuredApiUrl || localApiUrl).replace(/\/$/, "");
let accessToken: string | null = null;
let refreshPromise: Promise<Session | null> | null = null;
let listener: ((session: Session | null) => void) | null = null;
let credentialVersion = 0;
let transitionQueue: Promise<void> = Promise.resolve();
let queuedTransitions = 0;

export function listenForSession(next: (session: Session | null) => void) {
  listener = next;
  return () => {
    if (listener === next) listener = null;
  };
}
export function applySession(session: Session | null) {
  credentialVersion += 1;
  accessToken = session?.accessToken ?? null;
  listener?.(session);
}

function transition<T>(operation: () => Promise<T>): Promise<T> {
  queuedTransitions += 1;
  const next = transitionQueue.then(async () => {
    if (refreshPromise) await refreshPromise.catch(() => undefined);
    return withSessionLock(operation);
  });
  transitionQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next.finally(() => {
    queuedTransitions -= 1;
  });
}

function validatedSession(value: Session): Session {
  if (
    !value ||
    typeof value.accessToken !== "string" ||
    !value.accessToken ||
    typeof value.refreshToken !== "string" ||
    !value.refreshToken ||
    !value.user ||
    typeof value.user.id !== "string" ||
    typeof value.user.email !== "string" ||
    !Array.isArray(value.user.roles) ||
    !Array.isArray(value.user.operatorRoles)
  ) {
    throw new PortalApiError(
      502,
      "INVALID_RESPONSE",
      "Your session could not be checked. Please try again.",
    );
  }
  return value;
}

async function read<T>(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | T
    | {
        error?: {
          code?: string;
          message?: string;
          details?: Record<string, unknown>;
        };
      }
    | null;
  if (!response.ok) {
    const failure = payload as {
      error?: {
        code?: string;
        message?: string;
        details?: Record<string, unknown>;
      };
    } | null;
    throw new PortalApiError(
      response.status,
      failure?.error?.code ?? "REQUEST_FAILED",
      failure?.error?.message ?? "KampusOne could not complete this request.",
      failure?.error?.details,
    );
  }
  return payload as T;
}

async function refresh() {
  if (!refreshPromise) {
    if (queuedTransitions)
      throw new PortalApiError(
        409,
        "SESSION_TRANSITION",
        "A session change is in progress. Please try again.",
      );
    const versionAtStart = credentialVersion;
    refreshPromise = withSessionLock(() =>
      fetch(`${baseUrl}/v1/auth/refresh`, {
        method: "POST",
        credentials: "include",
        signal: AbortSignal.timeout(15000),
        headers: {
          "Content-Type": "application/json",
          "X-Device-Label": "KampusOne web portal",
        },
        body: "{}",
      }).then((response) => read<Session>(response)),
    )
      .then(validatedSession)
      .then((session) => {
        if (credentialVersion === versionAtStart) applySession(session);
        return session;
      })
      .catch((caught: unknown) => {
        if (
          caught instanceof PortalApiError &&
          caught.status === 401 &&
          caught.code === "UNAUTHENTICATED"
        ) {
          if (credentialVersion === versionAtStart) applySession(null);
          return null;
        }
        throw caught;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function portalApi<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (
    init.body &&
    !(init.body instanceof FormData) &&
    !headers.has("Content-Type")
  )
    headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(20_000),
      credentials: "include",
      headers,
    });
  } catch {
    throw connectionError();
  }
  if (response.status === 401 && retry && path !== "/v1/auth/refresh") {
    if (await refresh()) return portalApi<T>(path, init, false);
  }
  return read<T>(response);
}

async function requestPasswordReset(email: string) {
  return portalApi<{ status: string }>(
    "/v1/auth/forgot-password",
    {
      method: "POST",
      body: JSON.stringify({ email }),
    },
    false,
  );
}

export const webAuth = {
  refresh,
  async login(email: string, password: string) {
    return transition(async () => {
      const session = validatedSession(
        await portalApi<Session>(
          "/v1/auth/login",
          {
            method: "POST",
            body: JSON.stringify({
              email,
              password,
              deviceLabel: "KampusOne web portal",
            }),
          },
          false,
        ),
      );
      applySession(session);
      return session;
    });
  },
  requestEmailCode(email: string) {
    return portalApi<{ status: string }>(
      "/v1/auth/email-code/request",
      { method: "POST", body: JSON.stringify({ email }) },
      false,
    );
  },
  async verifyEmailCode(email: string, code: string) {
    return transition(async () => {
      const session = validatedSession(
        await portalApi<Session>(
          "/v1/auth/email-code/verify",
          {
            method: "POST",
            body: JSON.stringify({
              email,
              code,
              deviceLabel: "KampusOne agent portal",
            }),
          },
          false,
        ),
      );
      applySession(session);
      return session;
    });
  },
  register(input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }) {
    return portalApi<{ status: string }>(
      "/v1/auth/register",
      {
        method: "POST",
        body: JSON.stringify({
          ...input,
          acceptedTerms: true,
          legalVersion: "2026-09-10",
        }),
      },
      false,
    );
  },
  async verify(email: string, code: string) {
    return transition(async () => {
      const session = validatedSession(
        await portalApi<Session>(
          "/v1/auth/verify-email",
          {
            method: "POST",
            body: JSON.stringify({
              email,
              code,
              deviceLabel: "KampusOne web portal",
            }),
          },
          false,
        ),
      );
      applySession(session);
      return session;
    });
  },
  resend(email: string) {
    return portalApi(
      "/v1/auth/resend-verification",
      { method: "POST", body: JSON.stringify({ email }) },
      false,
    );
  },
  async forgotPassword(email: string) {
    try {
      return await requestPasswordReset(email);
    } catch (caught) {
      if (
        !(caught instanceof PortalApiError) ||
        caught.code !== "NETWORK_UNAVAILABLE"
      )
        throw caught;
      await wait(500);
      return requestPasswordReset(email);
    }
  },
  resetPassword(email: string, code: string, password: string) {
    return portalApi<{ status: string }>(
      "/v1/auth/reset-password",
      { method: "POST", body: JSON.stringify({ email, code, password }) },
      false,
    );
  },
  async logout() {
    return transition(async () => {
      const result = await portalApi<{ status: string }>(
        "/v1/auth/logout",
        { method: "POST", body: "{}" },
        false,
      );
      if (result?.status !== "signed_out") {
        throw new PortalApiError(
          502,
          "INVALID_RESPONSE",
          "Sign-out was not confirmed. Please try again.",
        );
      }
      applySession(null);
    });
  },
};
