import type { Bindings } from "../types";

const RESEND_EVENTS_URL = "https://api.resend.com/events/send";
const DEFAULT_TIMEOUT_MS = 5_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SIX_DIGIT_CODE = /^\d{6}$/;

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
  payload: EmailEventPayloads[Name];
};

export type EmailAutomationResult<Name extends EmailEventName> = {
  event: Name;
  status: "disabled" | "queued";
};

type EmailAutomationOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
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
    /[<>\u0000-\u001F\u007F]/u.test(value)
  ) {
    throw new EmailAutomationError(`Email event field ${key} is invalid.`, {
      retryable: false,
    });
  }

  return value;
}

function requireEmail(value: unknown, field = "email"): asserts value is string {
  if (typeof value !== "string" || value.length > 254 || !EMAIL_PATTERN.test(value)) {
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
    if (url.protocol !== "https:" || !isKampusOneHost) {
      throw new Error("Invalid action host");
    }
  } catch {
    throw new EmailAutomationError(`Email event field ${key} must use a KampusOne URL.`, {
      retryable: false,
    });
  }
}

export function validateEmailEvent(input: EmailEventInput) {
  requireEmail(input.email);
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

  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(RESEND_EVENTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new EmailAutomationError("The email provider rejected the automation event.", {
        providerStatus: response.status,
        retryable: response.status === 429 || response.status >= 500,
      });
    }

    return { event: input.event, status: "queued" };
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
