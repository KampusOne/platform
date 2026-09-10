import { describe, expect, it } from "vitest";

import { apiErrorSchema, publicConfigSchema } from "./index";

describe("shared API contracts", () => {
  it("accepts a deliberately gated public configuration", () => {
    const value = publicConfigSchema.parse({
      environment: "preview",
      maintenance: false,
      minimumAppVersion: "0.1.0",
      features: {
        academicCore: true,
        socialFeed: false,
        marketplace: false,
        payments: false,
        aiAssistant: false,
      },
    });

    expect(value.features.academicCore).toBe(true);
    expect(value.features.payments).toBe(false);
  });

  it("rejects an unstable error shape", () => {
    expect(() =>
      apiErrorSchema.parse({ error: { code: "WHOOPS", message: "No" } }),
    ).toThrow();
  });
});
