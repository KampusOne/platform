import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  readRefreshToken: vi.fn(async (): Promise<string | null> => null),
  saveRefreshToken: vi.fn(async () => {}),
  removeRefreshToken: vi.fn(async () => {}),
}));
vi.mock("../../mobile/src/lib/session-storage", () => storage);
vi.mock("../../mobile/node_modules/expo-constants", () => ({
  default: { expoConfig: { extra: {} } },
}));
vi.mock("../../mobile/node_modules/react-native", () => ({
  Platform: { OS: "android" },
}));

const primary = "https://worker.example.invalid";
const backup = "https://preview.example.invalid/api";
const session = {
  accessToken: "diagnosis-access-token",
  refreshToken: "diagnosis-refresh-token",
  expiresIn: 900,
  refreshExpiresIn: 2592000,
  user: {
    id: "diagnosis-person", email: "diagnosis@example.invalid",
    roles: ["STUDENT"], universityId: null, operatorRoles: [],
  },
};

beforeEach(() => {
  storage.readRefreshToken.mockResolvedValue(null);
  vi.useFakeTimers();
  vi.stubEnv("EXPO_PUBLIC_KAMPUSONE_API_URL", primary);
  vi.stubEnv("EXPO_PUBLIC_KAMPUSONE_API_FALLBACK_URL", backup);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
});

const live = () => Response.json({ status: "ok", service: "kampusone-api" });

describe("native authentication route recovery", () => {
  it("signs in through backup on the first try when the primary route stalls", async () => {
    const fetcher = vi.fn((url: string, init?: RequestInit) => url.startsWith(primary)
      ? new Promise<Response>(() => {})
      : Promise.resolve(url.endsWith("/health/live") ? live() : Response.json(session)));
    vi.stubGlobal("fetch", fetcher);
    const { authApi } = await import("../../mobile/src/lib/api-transport");
    await expect(authApi.login("diagnosis@example.invalid", "Same-Test-Password-2026"))
      .resolves.toMatchObject({ user: session.user });
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[0]).toBe(backup + "/v1/auth/login");
    for (const [, init] of fetcher.mock.calls.filter(([url]) => url.endsWith("/health/live"))) {
      expect(init?.body).toBeUndefined();
      expect(init?.headers).toBeUndefined();
      expect(init?.credentials).toBe("omit");
      expect(init?.signal?.aborted).toBe(true);
    }
    expect(fetcher.mock.calls.some(([url]) => /reset-password/.test(url))).toBe(false);
    expect(storage.saveRefreshToken).toHaveBeenCalledWith(session.refreshToken);
  });

  it("reserves time for backup when the primary read hangs", async () => {
    const fetcher = vi.fn((url: string) => url.startsWith(primary)
      ? new Promise<Response>(() => {})
      : Promise.resolve(Response.json({ status: "reachable" })));
    vi.stubGlobal("fetch", fetcher);
    const { api } = await import("../../mobile/src/lib/api-transport");
    const pending = api("/v1/config/public");
    await vi.advanceTimersByTimeAsync(7_500);
    await expect(pending).resolves.toEqual({ status: "reachable" });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      primary + "/v1/config/public", backup + "/v1/config/public",
    ]);
  });

  it("does not replay a rejected password or turn it into a connection timeout", async () => {
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/health/live")) return url.startsWith(primary)
        ? Promise.resolve(live()) : new Promise<Response>(() => {});
      return Promise.resolve(Response.json({ error: {
        code: "UNAUTHENTICATED", message: "The email or password is incorrect.",
      } }, { status: 401 }));
    });
    vi.stubGlobal("fetch", fetcher);
    const { authApi } = await import("../../mobile/src/lib/api-transport");
    await expect(authApi.login("diagnosis@example.invalid", "Wrong-Test-Password"))
      .rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[0]).toBe(primary + "/v1/auth/login");
    expect(storage.saveRefreshToken).not.toHaveBeenCalled();
  });

  it("a lost POST response is not replayed, and manual retry needs no password reset", async () => {
    let stalled = false;
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/health/live")) return url.startsWith(primary) === !stalled
        ? Promise.resolve(live()) : new Promise<Response>(() => {});
      if (url.startsWith(primary)) {
        stalled = true;
        return new Promise<Response>(() => {});
      }
      return Promise.resolve(Response.json(session));
    });
    vi.stubGlobal("fetch", fetcher);
    const { authApi } = await import("../../mobile/src/lib/api-transport");
    const first = authApi.login("diagnosis@example.invalid", "Same-Test-Password-2026");
    const observed = expect(first).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(35_000);
    await observed;
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    await expect(authApi.login("diagnosis@example.invalid", "Same-Test-Password-2026"))
      .resolves.toMatchObject({ user: session.user });
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts.map(([url]) => url)).toEqual([
      primary + "/v1/auth/login", backup + "/v1/auth/login",
    ]);
    expect(posts[0]?.[1]?.body).toBe(posts[1]?.[1]?.body);
  });

  it("fails within the route-selection deadline without sending credentials if both routes hang", async () => {
    const fetcher = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetcher);
    const { authApi } = await import("../../mobile/src/lib/api-transport");
    const pending = authApi.login("diagnosis@example.invalid", "Test-Password-2026");
    const observed = expect(pending).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(8_000);
    await observed;
    expect(fetcher.mock.calls.every(([, init]) => !init?.body)).toBe(true);
    expect(storage.saveRefreshToken).not.toHaveBeenCalled();
  });

  it("an already cancelled authentication request sends neither a probe nor a POST", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { api } = await import("../../mobile/src/lib/api-transport");
    const controller = new AbortController();
    controller.abort(new Error("Left sign-up"));
    await expect(api("/v1/auth/register", {
      method: "POST", body: "{}", signal: controller.signal,
    }, false)).rejects.toThrow("Left sign-up");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retains a recently working route without repeating probes for the next auth action", async () => {
    const fetcher = vi.fn((url: string, _init?: RequestInit) => url.startsWith(primary)
      ? new Promise<Response>(() => {})
      : Promise.resolve(url.endsWith("/health/live") ? live() : Response.json(session)));
    vi.stubGlobal("fetch", fetcher);
    const { authApi } = await import("../../mobile/src/lib/api-transport");
    await authApi.login("diagnosis@example.invalid", "Test-Password-2026");
    await authApi.login("diagnosis@example.invalid", "Test-Password-2026");
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/health/live"))).toHaveLength(2);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });

  it("restores a secure native session through one backup refresh POST", async () => {
    storage.readRefreshToken.mockResolvedValue("stored-refresh-token");
    const fetcher = vi.fn((url: string, _init?: RequestInit) => url.startsWith(primary)
      ? new Promise<Response>(() => {})
      : Promise.resolve(url.endsWith("/health/live") ? live() : Response.json(session)));
    vi.stubGlobal("fetch", fetcher);
    const { authApi } = await import("../../mobile/src/lib/api-transport");
    await expect(authApi.refresh()).resolves.toMatchObject({ user: session.user });
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[0]).toBe(backup + "/v1/auth/refresh");
    expect(posts[0]?.[1]?.body).toBe(JSON.stringify({ refreshToken: "stored-refresh-token" }));
  });

  it("a fresh native install performs no restoration network calls", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { authApi } = await import("../../mobile/src/lib/api-transport");
    await expect(authApi.refresh()).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not probe or replay an ordinary product mutation", async () => {
    const fetcher = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetcher);
    const { api } = await import("../../mobile/src/lib/api-transport");
    const pending = api("/v1/student/feed", { method: "POST", body: "{}" }, false);
    const observed = expect(pending).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(15_000);
    await observed;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(primary + "/v1/student/feed");
  });

  it("a late aborted primary response cannot replace the working backup route", async () => {
    let complete!: (response: Response) => void;
    const fetcher = vi.fn((url: string, _init?: RequestInit) => url.startsWith(primary)
      ? new Promise<Response>((resolve) => { complete = resolve; })
      : Promise.resolve(Response.json(url.endsWith("/v1/auth/login") ? session : { status: "reachable" })));
    vi.stubGlobal("fetch", fetcher);
    const { api, authApi } = await import("../../mobile/src/lib/api-transport");
    const pending = api("/v1/config/public");
    await vi.advanceTimersByTimeAsync(7_500);
    await pending;
    complete(Response.json({ status: "late" }));
    await vi.advanceTimersByTimeAsync(1);
    await authApi.login("diagnosis@example.invalid", "Test-Password-2026");
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe(backup + "/v1/auth/login");
    expect(fetcher.mock.calls.some(([url]) => url.endsWith("/health/live"))).toBe(false);
  });
});
