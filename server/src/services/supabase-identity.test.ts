import { afterEach, describe, expect, it, vi } from "vitest";

import type { Bindings } from "../types";
import { configuredSocialProviders } from "./supabase-identity";

function env(url: string) {
  return {
    UNIFIED_SCHEMA_READY: "true",
    SUPABASE_URL: url,
    SUPABASE_PUBLISHABLE_KEY: "public-test-key",
  } as Bindings;
}

function settings(google: boolean, apple: boolean) {
  return new Response(
    JSON.stringify({ external: { google, apple } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("social sign-in provider configuration", () => {
  it("uses the last confirmed settings without another upstream request", async () => {
    const request = vi.fn().mockResolvedValue(settings(true, false));
    vi.stubGlobal("fetch", request);

    const config = env("https://auth-cache-test-one.supabase.co");
    const first = await configuredSocialProviders(config);
    expect(first).toEqual(["google"]);
    first.push("apple"); // Callers may not mutate cached provider availability.

    await expect(configuredSocialProviders(config)).resolves.toEqual(["google"]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps recent confirmed providers available through a temporary settings outage", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const request = vi.fn().mockResolvedValueOnce(settings(true, true))
      .mockRejectedValueOnce(new TypeError("network unavailable"));
    vi.stubGlobal("fetch", request);

    const config = env("https://auth-cache-test-two.supabase.co");
    await expect(configuredSocialProviders(config)).resolves.toEqual(["google", "apple"]);
    now.mockReturnValue(1_000_000 + 5 * 60_000 + 1);
    await expect(configuredSocialProviders(config)).resolves.toEqual(["google", "apple"]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed first provider check", async () => {
    const request = vi.fn().mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(settings(true, false));
    vi.stubGlobal("fetch", request);

    const config = env("https://auth-cache-test-three.supabase.co");
    await expect(configuredSocialProviders(config)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    await expect(configuredSocialProviders(config)).resolves.toEqual(["google"]);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
