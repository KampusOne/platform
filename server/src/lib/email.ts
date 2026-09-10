import type { Bindings } from "../types";
import { AppError } from "./errors";

type MailKind = "verification" | "password-reset" | "welcome";

type MailInput = {
  to: string;
  firstName?: string | null;
  code?: string;
  kind: MailKind;
  idempotencyKey: string;
};

const copy = {
  verification: {
    subject: "Verify your KampusOne email",
    heading: "You’re one step from being ready.",
    intro: "Use this code to verify your email and continue setting up your school life.",
  },
  "password-reset": {
    subject: "Reset your KampusOne password",
    heading: "Reset your password safely.",
    intro: "Use this code to choose a new password. If you did not request this, you can ignore this email.",
  },
  welcome: {
    subject: "Welcome to KampusOne",
    heading: "Already ready for school.",
    intro: "Your account is verified. Add your school details and KampusOne will organise the day around you.",
  },
} as const;

function emailHtml(input: MailInput) {
  const content = copy[input.kind];
  const greeting = input.firstName ? `Hi ${escapeHtml(input.firstName)},` : "Hi there,";
  const code = input.code
    ? `<div style="margin:28px 0;padding:18px 20px;background:#F1DFC8;border:1px solid #E9B18E;border-radius:14px;text-align:center">
        <div style="font:600 12px Inter,Arial,sans-serif;letter-spacing:.12em;color:#7B6C64;text-transform:uppercase">Your code</div>
        <div style="margin-top:8px;font:700 34px Inter,Arial,sans-serif;letter-spacing:.22em;color:#29231F;user-select:all">${input.code}</div>
      </div>`
    : "";

  return `<!doctype html>
  <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#FBF7F2;color:#29231F">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FBF7F2;padding:28px 14px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#FFFFFF;border:1px solid #F1DFC8;border-radius:20px;overflow:hidden">
          <tr><td style="height:8px;background:#C35D38"></td></tr>
          <tr><td style="padding:30px 34px 14px">
            <div style="font:700 24px Lato,Arial,sans-serif;color:#C35D38">KampusOne</div>
            <div style="margin-top:3px;font:500 11px Inter,Arial,sans-serif;letter-spacing:.08em;color:#9A8D84;text-transform:uppercase">Already Ready for School</div>
          </td></tr>
          <tr><td style="padding:16px 34px 34px;font:400 16px/1.65 Inter,Arial,sans-serif">
            <p style="margin:0 0 14px">${greeting}</p>
            <h1 style="margin:0 0 12px;font:700 27px/1.18 Lato,Arial,sans-serif;color:#29231F">${content.heading}</h1>
            <p style="margin:0;color:#685E58">${content.intro}</p>
            ${code}
            ${input.code ? '<p style="margin:0;color:#685E58">The code expires in 10 minutes and can be used once. KampusOne will never ask you to send this code to another person.</p>' : ""}
          </td></tr>
          <tr><td style="padding:20px 34px;background:#F1DFC8;font:400 12px/1.5 Inter,Arial,sans-serif;color:#685E58">KampusOne · From campus to the world.</td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

function providerUnavailable() {
  return new AppError(503, "PROVIDER_UNAVAILABLE", "We could not send the email. Please try again shortly.");
}

export async function sendMail(env: Bindings, input: MailInput) {
  requireEmailProvider(env);

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
        from: env.RESEND_FROM_EMAIL,
        to: [input.to],
        subject: copy[input.kind].subject,
        html: emailHtml(input),
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
): asserts env is Bindings & { RESEND_API_KEY: string; RESEND_FROM_EMAIL: string } {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    throw new AppError(503, "PROVIDER_UNAVAILABLE", "Email delivery is not configured yet.", {
      requirement: "RESEND_API_KEY and RESEND_FROM_EMAIL",
    });
  }
}