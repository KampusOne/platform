import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withSessionLock as portalLock } from "../../portal/lib/session-lock";
import { withSessionLock as mobileLock } from "../../mobile/src/lib/session-lock";
const storage = vi.hoisted(() => ({
  readRefreshToken: vi.fn(async () => null),
  saveRefreshToken: vi.fn(async () => {}),
  removeRefreshToken: vi.fn(async () => {}),
}));
vi.mock("../../mobile/src/lib/session-storage", () => storage);
vi.mock("../../mobile/node_modules/expo-constants", () => ({
  default: { expoConfig: { extra: {} } },
}));
vi.mock("../../mobile/node_modules/react-native", () => ({
  Platform: { OS: "web" },
}));
const session = {
  accessToken: "test-access",
  refreshToken: "test-refresh",
  expiresIn: 900,
  refreshExpiresIn: 2592000,
  user: {
    id: "test-person",
    email: "test@example.invalid",
    roles: ["STUDENT"],
    universityId: null,
    operatorRoles: [],
  },
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
});
beforeEach(() => {
  vi.stubGlobal("window", {
    location: { hostname: "preview.example.invalid" },
  });
});

describe("requirements 87–88: client restoration and auth mutations", () => {
  it.each(["portal", "mobile"])(
    "%s preserves the session when refresh is offline",
    async (client) => {
      const fetch = vi.fn().mockRejectedValue(new TypeError("offline"));
      vi.stubGlobal("fetch", fetch);
      if (client === "portal") {
        const api = await import("../../portal/lib/api");
        const listener = vi.fn();
        api.listenForSession(listener);
        api.applySession(session);
        listener.mockClear();
        await expect(api.webAuth.refresh()).rejects.toThrow();
        expect(listener).not.toHaveBeenCalled();
      } else {
        const api = await import("../../mobile/src/lib/api");
        const listener = vi.fn();
        api.onSessionChange(listener);
        api.setAccessToken(session.accessToken);
        await expect(api.authApi.refresh()).rejects.toThrow();
        expect(listener).not.toHaveBeenCalled();
        expect(storage.removeRefreshToken).not.toHaveBeenCalled();
      }
    },
  );
  it.each(["portal", "mobile"])(
    "%s clears an explicitly revoked session",
    async (client) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            Response.json(
              { error: { code: "UNAUTHENTICATED", message: "revoked" } },
              { status: 401 },
            ),
          ),
      );
      const listener = vi.fn();
      if (client === "portal") {
        const api = await import("../../portal/lib/api");
        api.listenForSession(listener);
        expect(await api.webAuth.refresh()).toBe(null);
      } else {
        const api = await import("../../mobile/src/lib/api");
        api.onSessionChange(listener);
        expect(await api.authApi.refresh()).toBe(null);
      }
      expect(listener).toHaveBeenCalledWith(null);
    },
  );
  it("does not erase portal authentication on failed logout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const api = await import("../../portal/lib/api");
    const listener = vi.fn();
    api.listenForSession(listener);
    api.applySession(session);
    listener.mockClear();
    await expect(api.webAuth.logout()).rejects.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
  it("does not erase mobile credentials for a rejected browser origin", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: "FORBIDDEN", message: "origin unavailable" } },
            { status: 403 },
          ),
        ),
    );
    const api = await import("../../mobile/src/lib/api");
    const listener = vi.fn();
    api.onSessionChange(listener);
    await expect(api.authApi.refresh()).rejects.toMatchObject({ status: 403 });
    expect(listener).not.toHaveBeenCalled();
    expect(storage.removeRefreshToken).not.toHaveBeenCalled();
  });
  it("rejects a malformed portal refresh without treating it as signed out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ message: "not a session" })),
    );
    const api = await import("../../portal/lib/api");
    const listener = vi.fn();
    api.listenForSession(listener);
    await expect(api.webAuth.refresh()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    expect(listener).not.toHaveBeenCalled();
  });
  it("waits for an active refresh before logging out", async () => {
    let complete!: (r: Response) => void;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValueOnce(Response.json({ status: "signed_out" }));
    vi.stubGlobal("fetch", fetch);
    const api = await import("../../portal/lib/api");
    const refresh = api.webAuth.refresh();
    const logout = api.webAuth.logout();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    complete(Response.json(session));
    await refresh;
    await logout;
    expect(
      fetch.mock.calls.map((args) => String(args[0]).split("/").at(-1)),
    ).toEqual(["refresh", "logout"]);
  });
  it("serializes cookie mutations across separate browser clients", async () => {
    let queue = Promise.resolve();
    const request = vi.fn((_name, _options, callback) => {
      const result = queue.then(callback);
      queue = result.then(() => undefined);
      return result;
    });
    vi.stubGlobal("navigator", { locks: { request } });
    const order: string[] = [];
    let release!: () => void;
    const a = portalLock(async () => {
      order.push("portal-start");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      order.push("portal-end");
    });
    const b = mobileLock(async () => {
      order.push("mobile-start");
    });
    await Promise.resolve();
    expect(order).toEqual(["portal-start"]);
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(["portal-start", "portal-end", "mobile-start"]);
    expect(request.mock.calls.map((c) => c[0])).toEqual([
      "kampusone.session.v1",
      "kampusone.session.v1",
    ]);
  });
});
