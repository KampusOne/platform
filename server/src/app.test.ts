import { afterEach, describe, expect, it, vi } from "vitest";

import { liveHealthSchema, publicConfigSchema } from "@kampusone/contracts";

import { app } from "./app";
import type { Bindings } from "./types";

const env: Bindings = {
  ENVIRONMENT: "preview",
  ALLOWED_ORIGINS: "https://preview.kampusone.app",
  MINIMUM_APP_VERSION: "0.1.0",
  MAINTENANCE_MODE: "false",
  IDENTITY_ENABLED: "true",
  ACADEMIC_CORE_ENABLED: "true",
  NOTIFICATIONS_ENABLED: "false",
  AGENT_APPLICATIONS_ENABLED: "true",
  SOCIAL_FEED_ENABLED: "false",
  MESSAGING_ENABLED: "false",
  EVENTS_ENABLED: "false",
  LEARNING_MARKETPLACE_ENABLED: "false",
  MARKETPLACE_ENABLED: "false",
  RIDER_DISPATCH_ENABLED: "false",
  PAYMENTS_ENABLED: "false",
  AI_ASSISTANT_ENABLED: "false",
};

describe("KampusOne Worker", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("returns a stable liveness contract", async () => {
    const response = await app.request("http://local.test/health/live", {}, env);
    const body = liveHealthSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.environment).toBe("preview");
  });

  it("keeps unreleased features disabled", async () => {
    const response = await app.request("http://local.test/v1/config/public", {}, env);
    const body = publicConfigSchema.parse(await response.json());

    expect(body.features.academicCore).toBe(true);
    expect(body.features.agentApplications).toBe(true);
    expect(body.features.socialFeed).toBe(false);
    expect(body.features.payments).toBe(false);
  });

  it("rejects privileged reviews without a session", async () => {
    const configured = {
      ...env,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "publishable-test",
      SUPABASE_SECRET_KEY: "secret-test",
    };
    const response = await app.request(
      "http://local.test/v1/admin/agent-applications/11111111-1111-4111-8111-111111111111/review",
      { method: "POST", body: JSON.stringify({ decision: "approve", reason: "Evidence reviewed by operator" }), headers: { "Content-Type": "application/json" } },
      configured,
    );
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("UNAUTHENTICATED");
  });

  it("keeps privileged agent decisions behind the Worker boundary", async () => {
    const actorId = "22222222-2222-4222-8222-222222222222";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: actorId, email: "operator@example.com" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", status: "approved" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const configured = {
      ...env,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "publishable-test",
      SUPABASE_SECRET_KEY: "secret-test",
    };
    const response = await app.request(
      "http://local.test/v1/admin/agent-applications/11111111-1111-4111-8111-111111111111/review",
      {
        method: "POST",
        body: JSON.stringify({ decision: "approve", reason: "All evidence reviewed" }),
        headers: { Authorization: "Bearer user-session", "Content-Type": "application/json" },
      },
      configured,
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/rest/v1/rpc/review_agent_application");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({ actor_id: actorId, review_decision: "approve" });
  });

  it("does not report ready until server-only configuration exists", async () => {
    const response = await app.request("http://local.test/health/ready", {}, env);
    const body = (await response.json()) as { status: string };

    expect(response.status).toBe(503);
    expect(body.status).toBe("not_ready");
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
