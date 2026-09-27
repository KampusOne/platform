import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import middleware, { config } from "../../mobile/middleware";

const host = "kampusone-mobile-test.vercel.app";
function request(origin: string | null = `https://${host}`, method = "POST", extra: Record<string, string> = {}) {
  return new Request(`https://${host}/api/v1/auth/refresh`, { method, headers: { host, ...(origin === null ? {} : { origin }), ...extra } });
}
beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("VERCEL_URL", host);
  vi.stubEnv("VERCEL_BRANCH_URL", "kampusone-mobile-branch.vercel.app");
});
afterEach(() => vi.unstubAllEnvs());

describe("mobile preview auth boundary", () => {
  it("forwards only a verified same-origin browser request using the approved mobile origin", () => {
    const result = middleware(request(undefined, "POST", { cookie: "k1_refresh=test-session; _vercel_jwt=hosting-only", "x-vercel-protection-bypass": "hosting-only" }));
    expect(result.headers.get("x-middleware-request-origin")).toBe("https://kampusone-mobile-preview.vercel.app");
    expect(result.headers.get("x-middleware-request-cookie")).toBe("k1_refresh=test-session");
    expect(result.headers.has("x-middleware-request-x-vercel-protection-bypass")).toBe(false);
  });
  it.each(["https://unowned.vercel.app", "https://kampusone-mobile-branch.vercel.app", "null", null])("rejects foreign or missing write Origin: %s", (origin) => {
    expect(middleware(request(origin)).status).toBe(403);
  });
  it("rejects forged Host and cross-site fetch metadata", () => {
    expect(middleware(request(undefined, "POST", { host: "unowned.vercel.app" })).status).toBe(403);
    expect(middleware(request(undefined, "POST", { "sec-fetch-site": "same-site" })).status).toBe(403);
  });
  it("accepts the exact server-configured branch alias", () => {
    const alias = "kampusone-mobile-branch.vercel.app";
    const result = middleware(request(`https://${alias}`, "POST", { host: alias }));
    expect(result.headers.get("x-middleware-request-origin")).toBe("https://kampusone-mobile-preview.vercel.app");
  });
  it("preserves production routing and scopes middleware away from uploads", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(middleware(request()).headers.has("x-middleware-request-origin")).toBe(false);
    expect(config.matcher).toBe("/api/v1/auth/:path*");
  });
});
