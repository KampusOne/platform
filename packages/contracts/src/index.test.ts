import { describe, expect, it } from "vitest";

import { apiErrorSchema, publicConfigSchema } from "./index";

describe("shared API contracts", () => {
  it("accepts a deliberately gated public configuration", () => {
    const value = publicConfigSchema.parse({
      environment: "preview",
      maintenance: false,
      minimumAppVersion: "0.1.0",
      platform: {
        apiRuntime: "cloudflare-workers",
        dataRuntime: "supabase",
        portalRuntime: "vercel",
      },
      features: {
        identity: true,
        academicCore: true,
        notifications: false,
        agentApplications: true,
        socialFeed: false,
        messaging: false,
        events: false,
        learningMarketplace: false,
        marketplace: false,
        riderDispatch: false,
        payments: false,
        aiAssistant: false,
      },
    });

    expect(value.features.academicCore).toBe(true);
    expect(value.features.agentApplications).toBe(true);
    expect(value.features.payments).toBe(false);
    expect(value.platform.apiRuntime).toBe("cloudflare-workers");
  });

  it("rejects an unstable error shape", () => {
    expect(() =>
      apiErrorSchema.parse({ error: { code: "WHOOPS", message: "No" } }),
    ).toThrow();
  });
});
