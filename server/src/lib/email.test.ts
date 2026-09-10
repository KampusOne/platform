import { describe, expect, it, vi } from "vitest";

import {
  EmailAutomationError,
  sendEmailAutomationEvent,
  validateEmailEvent,
} from "./email";

const signupEvent = {
  email: "gideon@example.com",
  event: "auth.signup_verification.requested" as const,
  payload: {
    first_name: "Gideon",
    code: "248106",
    expires_minutes: 10,
  },
};

describe("KampusOne email automation adapter", () => {
  it("does not contact Resend while the delivery kill switch is off", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      sendEmailAutomationEvent(
        { EMAIL_AUTOMATIONS_ENABLED: "false" },
        signupEvent,
        { fetcher },
      ),
    ).resolves.toEqual({
      event: "auth.signup_verification.requested",
      status: "disabled",
    });

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends only the typed event contract to the Resend event endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ object: "event", event: signupEvent.event }), {
        status: 200,
      }),
    );

    await expect(
      sendEmailAutomationEvent(
        {
          EMAIL_AUTOMATIONS_ENABLED: "true",
          RESEND_API_KEY: "re_test_only",
        },
        signupEvent,
        { fetcher },
      ),
    ).resolves.toEqual({ event: signupEvent.event, status: "queued" });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/events/send");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Authorization: "Bearer re_test_only",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual(signupEvent);
  });

  it("requires a provider key only when delivery is enabled", async () => {
    await expect(
      sendEmailAutomationEvent({ EMAIL_AUTOMATIONS_ENABLED: "true" }, signupEvent),
    ).rejects.toMatchObject({
      message: "Email delivery is enabled but not configured.",
      retryable: false,
    });
  });

  it("rejects malformed codes before any provider call", () => {
    expect(() =>
      validateEmailEvent({
        ...signupEvent,
        payload: { ...signupEvent.payload, code: "12345<script>" },
      }),
    ).toThrow("Email verification codes must contain six digits.");
  });

  it("does not allow action links outside KampusOne", () => {
    expect(() =>
      validateEmailEvent({
        email: "gideon@example.com",
        event: "user.onboarding.completed",
        payload: {
          first_name: "Gideon",
          dashboard_url: "https://example.com/lookalike",
        },
      }),
    ).toThrow("Email event field dashboard_url must use a KampusOne URL.");
  });

  it("marks provider rate limits as safe to retry", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 429 }));

    const promise = sendEmailAutomationEvent(
      {
        EMAIL_AUTOMATIONS_ENABLED: "true",
        RESEND_API_KEY: "re_test_only",
      },
      signupEvent,
      { fetcher },
    );

    await expect(promise).rejects.toBeInstanceOf(EmailAutomationError);
    await expect(promise).rejects.toMatchObject({
      providerStatus: 429,
      retryable: true,
    });
  });
});
