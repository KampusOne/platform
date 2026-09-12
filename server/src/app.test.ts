import { describe, expect, it } from "vitest";

import { liveHealthSchema, publicConfigSchema } from "@kampusone/contracts";

import { app } from "./app";
import type { Bindings } from "./types";

const env: Bindings = {
  ENVIRONMENT: "staging",
  ALLOWED_ORIGINS: "https://staging.kampusone.app",
  MINIMUM_APP_VERSION: "0.1.0",
  MAINTENANCE_MODE: "false",
  ACADEMIC_CORE_ENABLED: "true",
  SOCIAL_FEED_ENABLED: "false",
  MARKETPLACE_ENABLED: "false",
  PHASE_2_SCHEMA_READY: "true",
  PHASE_3_SCHEMA_READY: "false",
  TUTORIALS_ENABLED: "true",
  STORE_ENABLED: "false",
  LOGISTICS_ENABLED: "false",
  PAYMENTS_ENABLED: "false",
  AI_ASSISTANT_ENABLED: "false",
};

describe("KampusOne Worker", () => {
  it("returns a stable liveness contract", async () => {
    const response = await app.request("http://local.test/health/live", {}, env);
    const body = liveHealthSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.environment).toBe("staging");
  });

  it("keeps unreleased features disabled", async () => {
    const response = await app.request("http://local.test/v1/config/public", {}, env);
    const body = publicConfigSchema.parse(await response.json());

    expect(body.features.academicCore).toBe(true);
    expect(body.features.socialFeed).toBe(false);
    expect(body.features.tutorials).toBe(true);
    expect(body.features.store).toBe(false);
    expect(body.features.payments).toBe(false);
  });

  it("keeps tutorials off until the Phase 2 schema is ready", async () => {
    const response = await app.request("http://local.test/v1/config/public", {}, {
      ...env,
      PHASE_2_SCHEMA_READY: "false",
      TUTORIALS_ENABLED: "true",
    });
    const body = publicConfigSchema.parse(await response.json());

    expect(body.features.tutorials).toBe(false);
  });

  it("keeps Store and Logistics off until the Phase 3 schema is ready", async () => {
    const response = await app.request("http://local.test/v1/config/public", {}, {
      ...env,
      MARKETPLACE_ENABLED: "true",
      PHASE_3_SCHEMA_READY: "false",
      STORE_ENABLED: "true",
      LOGISTICS_ENABLED: "true",
    });
    const body = publicConfigSchema.parse(await response.json());

    expect(body.features.store).toBe(false);
    expect(body.features.logistics).toBe(false);
    expect(body.features.marketplace).toBe(false);
  });

  it("allows Store and Logistics only after their flags and Phase 3 schema gate are ready", async () => {
    const response = await app.request("http://local.test/v1/config/public", {}, {
      ...env,
      PHASE_3_SCHEMA_READY: "true",
      STORE_ENABLED: "true",
      LOGISTICS_ENABLED: "true",
      MARKETPLACE_ENABLED: "true",
    });
    const body = publicConfigSchema.parse(await response.json());

    expect(body.features.store).toBe(true);
    expect(body.features.logistics).toBe(true);
    expect(body.features.marketplace).toBe(true);
  });

  it("does not let the legacy Marketplace flag enable Store or Logistics", async () => {
    const response = await app.request("http://local.test/v1/config/public", {}, {
      ...env,
      PHASE_3_SCHEMA_READY: "true",
      STORE_ENABLED: undefined,
      LOGISTICS_ENABLED: undefined,
      MARKETPLACE_ENABLED: "true",
    });
    const body = publicConfigSchema.parse(await response.json());

    expect(body.features.store).toBe(false);
    expect(body.features.logistics).toBe(false);
    expect(body.features.marketplace).toBe(true);
  });

  it("does not report ready until server-only configuration exists", async () => {
    const response = await app.request("http://local.test/health/ready", {}, env);
    const body = (await response.json()) as { status: string };

    expect(response.status).toBe(503);
    expect(body.status).toBe("not_ready");
  });

  it("returns a provider error before registration touches the database when email is not configured", async () => {
    const response = await app.request("http://local.test/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "student@example.com",
        password: "correct horse battery staple",
        firstName: "Ada",
        lastName: "Student",
        acceptedTerms: true,
        legalVersion: "2026-09-10",
      }),
    }, env);
    const body = (await response.json()) as { error: { code: string; message: string } };

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(body.error.message).toContain("Email delivery");
  });

  it("requires email delivery before starting passwordless agent access", async () => {
    const response = await app.request("http://local.test/v1/auth/email-code/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "student@example.com" }),
    }, env);
    const body = (await response.json()) as { error: { code: string; message: string } };

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(body.error.message).toContain("Email delivery");
  });

  it("uses the stable error envelope", async () => {
    const response = await app.request("http://local.test/missing", {}, env);
    const body = (await response.json()) as {
      error: { code: string; requestId: string };
    };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.requestId).toBeTruthy();
  });
});
