import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AbortController as NativeAbortController, AbortSignal as NativeAbortSignal } from "../../mobile/node_modules/abort-controller";
import { withRequestDeadline } from "../../mobile/src/lib/request-deadline";

const storage = vi.hoisted(() => ({
  readRefreshToken: vi.fn<() => Promise<string | null>>(async () => null),
  saveRefreshToken: vi.fn(async (_token: string) => {}),
  removeRefreshToken: vi.fn(async () => {}),
}));
vi.mock("../../mobile/src/lib/session-storage", () => storage);
vi.mock("../../mobile/node_modules/expo-constants", () => ({
  default: { expoConfig: { extra: { apiUrl: "https://api.example.invalid" } } },
}));
vi.mock("../../mobile/node_modules/react-native", () => ({ Platform: { OS: "android" } }));

const session = {
  accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 900, refreshExpiresIn: 2592000,
  user: { id: "test-user", email: "student@example.invalid", roles: ["STUDENT"], operatorRoles: [], universityId: null },
};

beforeEach(() => {
  // Use exactly the controller installed by React Native, not Node's newer web API.
  vi.stubGlobal("AbortController", NativeAbortController);
  vi.stubGlobal("AbortSignal", NativeAbortSignal);
  storage.readRefreshToken.mockResolvedValue(null);
});
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks();
});

describe("Android sign-in and startup regression", () => {
  it("sends login and registration with the actual native AbortSignal", async () => {
    expect((NativeAbortSignal as unknown as { timeout?: unknown }).timeout).toBeUndefined();
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json({ status: "verification_required", email: session.user.email }));
    vi.stubGlobal("fetch", fetch);
    const { authApi } = await import("../../mobile/src/lib/api");
    expect(await authApi.login(session.user.email, "test-password-only")).toEqual(session);
    expect(storage.saveRefreshToken).toHaveBeenCalledWith(session.refreshToken);
    expect(await authApi.register({ email: session.user.email, password: "test-password-only", firstName: "Test", lastName: "Student", acceptedTerms: true })).toMatchObject({ status: "verification_required" });
    expect(fetch.mock.calls.map(call => String(call[0]))).toEqual([
      "https://api.example.invalid/v1/auth/login", "https://api.example.invalid/v1/auth/register",
    ]);
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(NativeAbortSignal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("opens a fresh native install without any refresh HTTP request", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const { authApi } = await import("../../mobile/src/lib/api");
    expect(await authApi.refresh()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.removeRefreshToken).not.toHaveBeenCalled();
  });

  it("keeps the longer Kira request budget through the public API wrapper", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => new Promise(resolve => {
      setTimeout(() => resolve(Response.json({ answer: "Ready" })), 20_000);
    }));
    vi.stubGlobal("fetch", fetch);
    const { api } = await import("../../mobile/src/lib/api");
    const result = api("/v1/ai", { method: "POST", body: "{}", timeoutMs: 45_000 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toEqual({ answer: "Ready" });
    expect(fetch.mock.calls[0][1]).not.toHaveProperty("timeoutMs");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["network", "body"])("bounds a stalled %s while preserving saved credentials", async (stage) => {
    vi.useFakeTimers();
    const stalled = new Promise<never>(() => {});
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => stage === "network" ? stalled : Promise.resolve({ status: 200, ok: true, json: () => stalled })));
    const { authApi } = await import("../../mobile/src/lib/api");
    const result = expect(authApi.login(session.user.email, "test-password-only")).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(storage.removeRefreshToken).not.toHaveBeenCalled();
    expect(storage.saveRefreshToken).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unblocks interactive login after a stalled refresh body and ignores its late response", async () => {
    vi.useFakeTimers();
    storage.readRefreshToken.mockResolvedValue("previous-refresh");
    let finishOldBody!: (value: unknown) => void;
    const body = new Promise(resolve => { finishOldBody = resolve; });
    const fetch = vi.fn()
      .mockResolvedValueOnce({ status: 200, ok: true, json: () => body })
      .mockResolvedValueOnce(Response.json(session));
    vi.stubGlobal("fetch", fetch);
    const { authApi, onSessionChange } = await import("../../mobile/src/lib/api");
    const listener = vi.fn(); onSessionChange(listener);
    const refresh = expect(authApi.refresh()).rejects.toMatchObject({ name: "TimeoutError" });
    const login = authApi.login(session.user.email, "test-password-only");
    await vi.advanceTimersByTimeAsync(12_000);
    await refresh;
    expect(await login).toEqual(session);
    finishOldBody({ ...session, refreshToken: "late-old-token" });
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.saveRefreshToken.mock.calls).toEqual([[session.refreshToken]]);
    expect(storage.removeRefreshToken).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels requests with the native signal even when fetch ignores cancellation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const result = expect(withRequestDeadline(() => new Promise<never>(() => {}), 45_000, controller.signal)).rejects.toThrow("Request cancelled");
    controller.abort();
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});
