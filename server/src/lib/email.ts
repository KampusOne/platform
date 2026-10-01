import type { Bindings } from "../types";
import { AppError } from "./errors";
import { renderTransactionalEmail } from "./email-template";

type MailKind = "verification" | "password-reset" | "agent-login" | "welcome";

type MailInput = {
  to: string;
  firstName?: string | null;
  code?: string;
  kind: MailKind;
  idempotencyKey: string;
};

const DEFAULT_FROM_EMAIL = "KampusOne <hello@kampusone.app>";

const copy = {
  verification: {
    subject: "Verify your KampusOne email",
    label: "Email verification",
    heading: "Verify your email",
    intro: "Use the six digit code below to finish creating your KampusOne account.",
    note: "This code expires in 10 minutes and can be used once. Never send this code to another person.",
  },
  "password-reset": {
    subject: "Reset your KampusOne password",
    label: "Password reset",
    heading: "Reset your password",
    intro: "Use the code below to choose a new password. If you did not request this, you can ignore this email.",
    note: "This code expires in 10 minutes and can be used once.",
  },
  "agent-login": {
    subject: "Your KampusOne agent sign-in code",
    label: "Agent sign in",
    heading: "Continue to your agent workspace",
    intro: "Use this one-time code to continue with your existing KampusOne account.",
    note: "This code expires in 10 minutes and can be used once.",
  },
  welcome: {
    subject: "Welcome to KampusOne",
    label: "Welcome to KampusOne",
    heading: "You're already ready.",
    intro: "Your account is verified. Add your school details and KampusOne will organise the day around you.",
  },
} as const;

function transactionalEmail(input: MailInput) {
  const content = copy[input.kind];
  return renderTransactionalEmail({
    subject: content.subject,
    label: content.label,
    heading: content.heading,
    intro: content.intro,
    ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
    ...(input.code !== undefined ? { code: input.code } : {}),
    ...("note" in content && content.note ? { note: content.note } : {}),
  });
}

function resolveFromEmail(configured: string) {
  const trimmed = configured.trim();
  const bracketed = trimmed.match(/<([^>]+)>$/)?.[1];
  const address = (bracketed ?? trimmed).trim().toLowerCase();
  const domain = address.split("@")[1];
  if (domain === "kampusone.app") return `KampusOne <${address}>`;

  console.warn(JSON.stringify({
    level: "warn",
    event: "email.sender.fallback",
    configuredDomain: domain ?? "invalid",
    fallbackDomain: "kampusone.app",
  }));
  return DEFAULT_FROM_EMAIL;
}

function providerUnavailable() {
  return new AppError(503, "PROVIDER_UNAVAILABLE", "We could not send the email. Please try again shortly.");
}

export async function sendMail(env: Bindings, input: MailInput) {
  requireEmailProvider(env);
  const message = transactionalEmail(input);

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from: resolveFromEmail(env.RESEND_FROM_EMAIL),
        to: [input.to],
        subject: copy[input.kind].subject,
        html: message.html,
        text: message.text,
        ...(env.RESEND_REPLY_TO ? { reply_to: env.RESEND_REPLY_TO } : {}),
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    console.error(JSON.stringify({
      level: "error",
      event: "email.provider.request_failed",
      kind: input.kind,
      errorName: error.name,
      message: error.message,
    }));
    throw providerUnavailable();
  }

  if (!response.ok) {
    const providerRequestId = response.headers.get("x-request-id") ?? response.headers.get("cf-ray");
    const providerMessage = await response.text().catch(() => "");
    console.error(JSON.stringify({
      level: "error",
      event: "email.provider.rejected",
      kind: input.kind,
      status: response.status,
      providerRequestId,
      providerMessage: providerMessage.slice(0, 500),
    }));
    throw providerUnavailable();
  }
}

export function requireEmailProvider(
  env: Bindings,
): asserts env is Binds & { RESEND_API_KEY: string; RESEND_FROM_EMAIL: string } {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "Email delivery is not configured yet.", {
      requirement: "RESEND_API_KEY and RESEND_FROM_EMAIL",
    });
  }
}
