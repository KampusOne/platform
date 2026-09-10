"use client";

export type SessionUser = { id: string; email: string; roles: string[]; universityId: string | null; operatorRoles: string[] };
export type Session = { accessToken: string; refreshToken: string; expiresIn: number; user: SessionUser };

export class PortalApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: Record<string, unknown>) {
    super(message); this.name = "PortalApiError";
  }
}

const baseUrl = (process.env.NEXT_PUBLIC_KAMPUSONE_API_URL ?? "http://localhost:8787").replace(/\/$/, "");
let accessToken: string | null = null;
let refreshPromise: Promise<Session | null> | null = null;
let listener: ((session: Session | null) => void) | null = null;

export function listenForSession(next: (session: Session | null) => void) { listener = next; return () => { if (listener === next) listener = null; }; }
export function applySession(session: Session | null) { accessToken = session?.accessToken ?? null; listener?.(session); }

async function read<T>(response: Response) {
  const payload = await response.json().catch(() => null) as T | { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null;
  if (!response.ok) {
    const failure = payload as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null;
    throw new PortalApiError(response.status, failure?.error?.code ?? "REQUEST_FAILED", failure?.error?.message ?? "KampusOne could not complete this request.", failure?.error?.details);
  }
  return payload as T;
}

async function refresh() {
  if (!refreshPromise) refreshPromise = fetch(`${baseUrl}/v1/auth/refresh`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "X-Device-Label": "KampusOne web portal" }, body: "{}" })
    .then((response) => read<Session>(response)).then((session) => { applySession(session); return session; })
    .catch(() => { applySession(null); return null; }).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function portalApi<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${baseUrl}${path}`, { ...init, credentials: "include", headers });
  if (response.status === 401 && retry && path !== "/v1/auth/refresh") {
    if (await refresh()) return portalApi<T>(path, init, false);
  }
  return read<T>(response);
}

export const webAuth = {
  refresh,
  async login(email: string, password: string) { const session = await portalApi<Session>("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password, deviceLabel: "KampusOne web portal" }) }, false); applySession(session); return session; },
  register(input: { email: string; password: string; firstName: string; lastName: string }) { return portalApi<{ status: string }>("/v1/auth/register", { method: "POST", body: JSON.stringify({ ...input, acceptedTerms: true, legalVersion: "2026-09-10" }) }, false); },
  async verify(email: string, code: string) { const session = await portalApi<Session>("/v1/auth/verify-email", { method: "POST", body: JSON.stringify({ email, code, deviceLabel: "KampusOne web portal" }) }, false); applySession(session); return session; },
  resend(email: string) { return portalApi("/v1/auth/resend-verification", { method: "POST", body: JSON.stringify({ email }) }, false); },
  forgotPassword(email: string) { return portalApi<{ status: string }>("/v1/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }, false); },
  resetPassword(email: string, code: string, password: string) { return portalApi<{ status: string }>("/v1/auth/reset-password", { method: "POST", body: JSON.stringify({ email, code, password }) }, false); },
  async logout() { try { await portalApi("/v1/auth/logout", { method: "POST", body: "{}" }, false); } finally { applySession(null); } },
};
