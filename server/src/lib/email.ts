import type { Bindings } from "../types";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const EMAIL_FROM = "KampusOne <hello@kampusone.app>";
const EMAIL_REPLY_TO = "hello@kampusone.app";
const DEFAULT_TIMEOUT_MS = 5_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SIX_DIGIT_CODE = /^\d{6}$/;
const UNSAFE_TEXT = /[<>\u0000-\u001F\u007F]/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

export type EmailEventPayloads = {
  "auth.signup_verification.requested": {
    first_name: string;
    code: string;
    expires_minutes: number;
  };
  "user.onboarding.completed": {
    first_name: string;
    dashboard_url: string;
  };
  "auth.password_reset.requested": {
    first_name: string;
    code: string;
    expires_minutes: number;
  };
  "auth.password.changed": {
    first_name: string;
    changed_at: string;
    security_url: string;
  };
  "auth.email_change.requested": {
    first_name: string;
    code: string;
    new_email: string;
    expires_minutes: number;
  };
  "auth.new_login.detected": {
    first_name: string;
    device: string;
    location: string;
    signed_in_at: string;
    security_url: string;
  };
  "account.deletion.requested": {
    first_name: string;
    deletion_date: string;
    cancel_url: string;
  };
};

export type EmailEventName = keyof EmailEventPayloads;

export type EmailEventInput<Name extends EmailEventName = EmailEventName> = {
  email: string;
  event: Name;
  idempotencyKey: string;
  payload: EmailEventPayloads[Name];
};

export type EmailAutomationResult<Name extends EmailEventName> = {
  event: Name;
  status: "disabled" | "sent";
};

type EmailAutomationOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

type TemplateDefinition = {
  alias: string;
  subject: string;
};

const templates: Record<EmailEventName, TemplateDefinition> = {
  "auth.signup_verification.requested": {
    alias: "k1-signup-code",
    subject: "Verify your email — KampusOne",
  },
  "user.onboarding.completed": {
    alias: "k1-welcome",
    subject: "You’re already ready — KampusOne",
  },
  "auth.password_reset.requested": {
    alias: "k1-password-reset",
    subject: "Reset your KampusOne password",
  },
  "auth.password.changed": {
    alias: "k1-password-changed",
    subject: "Your KampusOne password was changed",
  },
  "auth.email_change.requested": {
    alias: "k1-email-change-code",
    subject: "Confirm your new KampusOne email",
  },
  "auth.new_login.detected": {
    alias: "k1-new-login",
    subject: "New sign-in to your KampusOne account",
  },
  "account.deletion.requested": {
    alias: "k1-account-deletion",
    subject: "Your KampusOne account deletion is scheduled",
  },
};

export class EmailAutomationError extends Error {
  readonly providerStatus: number | undefined;
  readonly retryable: boolean;

  constructor(message: string, options: { providerStatus?: number; retryable: boolean }) {
    super(message);
    this.name = "EmailAutomationError";
    this.providerStatus = options.providerStatus;
    this.retryable = options.retryable;
  }
}

const isEnabled = (value: string | undefined) => value?.toLowerCase() === "true";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EmailAutomationError("Email event payload is invalid.", { retryable: false });
  }

  return value as Record<string, unknown>;
}

function requiredText(
  payload: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string {
  const value = payload[key];
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximumLength ||
    UNSAFE_TEXT.test(value)
  ) {
    throw new EmailAutomationError(`Email event field ${key} is invalid.`, {
      retryable: false,
    });
  }

  return value;
}

function requireEmail(value: unknown, field = "email"): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    UNSAFE_TEXT.test(value) ||
    !EMAIL_PATTERN.test(value)
  ) {
    throw new EmailAutomationError(`Email event field ${field} is invalid.`, {
      retryable: false,
    });
  }
}

function requireSixDigitCode(payload: Record<string, unknown>) {
  const code = payload.code;
  if (typeof code !== "string" || !SIX_DIGIT_CODE.test(code)) {
    throw new EmailAutomationError("Email verification codes must contain six digits.", {
      retryable: false,
    });
  }
}

function requireExpiry(payload: Record<string, unknown>) {
  const minutes = payload.expires_minutes;
  if (!Number.isInteger(minutes) || (minutes as number) < 1 || (minutes as number) > 30) {
    throw new EmailAutomationError("Email code expiry must be between 1 and 30 minutes.", {
      retryable: false,
    });
  }
}

function requireKampusOneUrl(payload: Record<string, unknown>, key: string) {
  const value = requiredText(payload, key, 2_048);

  try {
    const url = new URL(value);
    const isKampusOneHost =
      url.hostname === "kampusone.app" || url.hostname.endsWith(".kampusone.app");
    if (url.protocol !== "https:" || !isKampusOneHost || url.username || url.password) {
      throw new Error("Invalid action URL");
    }
  } catch {
    throw new EmailAutomationError(`Email event field ${key} must use a KampusOne URL.`, {
      retryable: false,
    });
  }
}

function requireIdempotencyKey(value: unknown): asserts value is string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY.test(value)) {
    throw new EmailAutomationError("Email idempotency key is invalid.", {
      retryable: false,
    });
  }
}

export function validateEmailEvent(input: EmailEventInput) {
  requireEmail(input.email);
  requireIdempotencyKey(input.idempotencyKey);
  const payload = asRecord(input.payload);
  requiredText(payload, "first_name", 80);

  switch (input.event) {
    case "auth.signup_verification.requested":
    case "auth.password_reset.requested":
      requireSixDigitCode(payload);
      requireExpiry(payload);
      break;
    case "user.onboarding.completed":
      requireKampusOneUrl(payload, "dashboard_url");
      break;
    case "auth.password.changed":
      requiredText(payload, "changed_at", 120);
      requireKampusOneUrl(payload, "security_url");
      break;
    case "auth.email_change.requested":
      requireSixDigitCode(payload);
      requireExpiry(payload);
      requireEmail(payload.new_email, "new_email");
      break;
    case "auth.new_login.detected":
      requiredText(payload, "device", 160);
      requiredText(payload, "location", 160);
      requiredText(payload, "signed_in_at", 120);
      requireKampusOneUrl(payload, "security_url");
      break;
    case "account.deletion.requested":
      requiredText(payload, "deletion_date", 120);
      requireKampusOneUrl(payload, "cancel_url");
      break;
    default:
      throw new EmailAutomationError("Email event is not supported.", { retryable: false });
  }
}

function templateVariables(input: EmailEventInput): Record<string, string | number> {
  const payload = input.payload as Record<string, string | number>;
  const value = (key: string): string | number => {
    const variable = payload[key];
    if (typeof variable !== "string" && typeof variable !== "number") {
      throw new EmailAutomationError(`Email event field ${key} is invalid.`, {
        retryable: false,
      });
    }
    return variable;
  };
  const common = { USER_NAME: value("first_name") };

  switch (input.event) {
    case "auth.signup_verification.requested":
    case "auth.password_reset.requested":
      return {
        ...common,
        CODE: value("code"),
        EXPIRES_MINUTES: value("expires_minutes"),
      };
    case "user.onboarding.completed":
      return { ...common, DASHBOARD_URL: value("dashboard_url") };
    case "auth.password.changed":
      return {
        ...common,
        CHANGED_AT: value("changed_at"),
        SECURITY_URL: value("security_url"),
      };
    case "auth.email_change.requested":
      return {
        ...common,
        CODE: value("code"),
        NEW_EMAIL: value("new_email"),
        EXPIRES_MINUTES: value("expires_minutes"),
      };
    case "auth.new_login.detected":
      return {
        ...common,
        DEVICE: value("device"),
        LOCATION: value("location"),
        SIGNED_IN_AT: value("signed_in_at"),
        SECURITY_URL: value("security_url"),
      };
    case "account.deletion.requested":
      return {
        ...common,
        DELETION_DATE: value("deletion_date"),
        CANCEL_URL: value("cancel_url"),
      };
  }
}

export async function sendEmailAutomationEvent<Name extends EmailEventName>(
  env: Pick<Bindings, "EMAIL_AUTOMATIONS_ENABLED" | "RESEND_API_KEY">,
  input: EmailEventInput<Name>,
  options: EmailAutomationOptions = {},
): Promise<EmailAutomationResult<Name>> {
  if (!isEnabled(env.EMAIL_AUTOMATIONS_ENABLED)) {
    return { event: input.event, status: "disabled" };
  }

  if (!env.RESEND_API_KEY) {
    throw new EmailAutomationError("Email delivery is enabled but not configured.", {
      retryable: false,
    });
  }

  validateEmailEvent(input as EmailEventInput);

  const template = templates[input.event];
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(RESEND_EMAILS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [input.email],
        subject: template.subject,
        reply_to: EMAIL_REPLY_TO,
        template: {
          id: template.alias,
          variables: templateVariables(input as EmailEventInput),
        },
        tags: [{ name: "event", value: input.event.replaceAll(".", "_") }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new EmailAutomationError("The email provider rejected the message.", {
        providerStatus: response.status,
        retryable: response.status === 429 || response.status >= 500,
      });
    }

    return { event: input.event, status: "sent" };
  } catch (error) {
    if (error instanceof EmailAutomationError) {
      throw error;
    }

    if (controller.signal.aborted) {
      throw new EmailAutomationError("The email provider timed out.", { retryable: true });
    }

    throw new EmailAutomationError("The email provider could not be reached.", {
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
  }
}
