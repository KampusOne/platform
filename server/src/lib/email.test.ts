import { describe, expect, it, vi } from "vitest";

import {
  EmailAutomationError,
  sendEmailAutomationEvent,
  validateEmailEvent,
} from "./email";

const signupEvent = {
  email: "gideon@example.com",
  event: "auth.signup_verification.requested" as const,
  idempotencyKey: "signup-verification:user_123:otp_456",
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

  it("sends the published template with a stable idempotency key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "email_123" }), { status: 200 }),
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
    ).resolves.toEqual({ event: signupEvent.event, status: "sent" });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Authorization: "Bearer re_test_only",
      "Content-Type": "application/json",
      "Idempotency-Key": signupEvent.idempotencyKey,
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      from: "KampusOne <hello@kampusone.app>",
      to: ["gideon@example.com"],
      subject: "Verify your email — KampusOne",
      reply_to: "hello@kampusone.app",
      template: {
        id: "k1-signup-code",
        variables: {
          USER_NAME: "Gideon",
          CODE: "248106",
          EXPIRES_MINUTES: 10,
        },
      },
      tags: [{ name: "event", value: "auth_signup_verification_requested" }],
    });
  });

  it("requires a provider key only when delivery is enabled", async () => {
    await expect(
      sendEmailAutomationEvent({ EMAIL_AUTOMATIONS_ENABLED: "true" }, signupEvent),
    ).rejects.toMatchObject({
      message: "Email delivery is enabled but not configured.",
      retryable: false,
    });
  });

  it("rejects a missing idempotency key before any provider call", () => {
    expect(() =>
      validateEmailEvent({
        ...signupEvent,
        idempotencyKey: "",
      }),
    ).toThrow("Email idempotency key is invalid.");
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
        idempotencyKey: "onboarding:user_123",
        payload: {
          first_name: "Gideon",
          dashboard_url: "https://example.com/lookalike",
        },
      }),
    ).toThrow("Email event field dashboard_url must use a KampusOne URL.");
  });

  it("marks provider rate limits as safe to retry with the same key", async () => {
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
