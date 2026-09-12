import { sql } from "drizzle-orm";
import { Hono, type Context } from "hono";

import {
  forgotPasswordSchema,
  loginSchema,
  refreshSessionSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  type RegisterInput,
  verifyEmailSchema,
} from "@kampusone/contracts";

import type { Bindings, Variables } from "../types";
import { clearSessionCookies, refreshCookie, setSessionCookies } from "../middleware/auth";
import { database, firstRow } from "../lib/database";
import { requireEmailProvider, sendMail } from "../lib/email";
import { AppError } from "../lib/errors";
import { phase2SchemaReady } from "../lib/features";
import { generateOtp, hashOtp, hashPassword, sha256, validatePassword, verifyPassword } from "../lib/security";
import {
  createSession,
  findUserByEmail,
  revokeSession,
  rotateSession,
  toAuthenticatedUser,
} from "../services/sessions";

export const authRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;

type RegistrationStage =
  | "password_hash"
  | "verification_hash"
  | "account_insert"
  | "verification_delivery";

async function body(context: AppContext) {
  return context.req.json().catch(() => null) as Promise<unknown>;
}

function requestMetadata(context: { req: { header(name: string): string | undefined } }) {
  const deviceLabel = context.req.header("X-Device-Label");
  const ipAddress = context.req.header("CF-Connecting-IP") ?? context.req.header("X-Forwarded-For")?.split(",")[0]?.trim();
  const userAgent = context.req.header("User-Agent");
  return {
    ...(deviceLabel ? { deviceLabel } : {}),
    ...(ipAddress ? { ipAddress } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
}

function logRegistrationFailure(context: AppContext, stage: RegistrationStage, caught: unknown) {
  const error = caught instanceof Error ? caught : new Error(String(caught));
  console.error(JSON.stringify({
    level: "error",
    event: "auth.register.failed",
    stage,
    requestId: context.get("requestId"),
    errorName: error.name,
    message: error.message,
    stack: error.stack?.slice(0, 2_000),
  }));
}

async function consumeAuthRateLimit(
  context: AppContext,
  scope: "REGISTER" | "LOGIN" | "RESEND_OTP" | "VERIFY_OTP" | "FORGOT_PASSWORD" | "RESET_PASSWORD",
  identifier: string,
  limit: number,
  blockSeconds: number,
) {
  const ipAddress = context.req.header("CF-Connecting-IP")
    ?? context.req.header("X-Forwarded-For")?.split(",")[0]?.trim()
    ?? "unknown";
  const keyHash = await sha256(`${identifier.trim().toLowerCase()}:${ipAddress}`);
  const result = await database(context.env).execute<{ allowed: boolean }>(sql`
    select app_private.consume_request_rate_limit(
      ${scope}, ${keyHash}, ${limit}, 900, ${blockSeconds}
    ) as allowed
  `);
  if (!firstRow(result)?.allowed) {
    throw new AppError(429, "RATE_LIMITED", "Too many attempts. Wait before trying again.");
  }
  return keyHash;
}

async function clearAuthRateLimit(env: Bindings, scope: string, keyHash: string) {
  await database(env).execute(sql`
    select app_private.clear_request_rate_limit(${scope}, ${keyHash})
  `);
}

function maybeSetWebCookies(
  context: Parameters<typeof setSessionCookies>[0],
  env: Bindings,
  session: { accessToken: string; refreshToken: string },
) {
  setSessionCookies(context, env, session.accessToken, session.refreshToken);
}

async function latestVerification(env: Bindings, email: string, type: "EMAIL_VERIFICATION" | "PASSWORD_RESET") {
  const result = await database(env).execute<{
    id: string;
    user_id: string;
    token_hash: string;
    expires_at: string;
    used_at: string | null;
    attempts: number;
    last_sent_at: string;
    first_name: string | null;
  }>(sql`
    select
      tokens.id,
      tokens.user_id,
      tokens.token_hash,
      tokens.expires_at::text,
      tokens.used_at::text,
      tokens.attempts,
      tokens.last_sent_at::text,
      profiles.first_name
    from public.verification_tokens tokens
    join public.users users on users.id = tokens.user_id
    left join public.profiles profiles on profiles.user_id = users.id
    where users.email = ${email}
      and tokens.type::text = ${type}
    order by tokens.created_at desc
    limit 1
  `);
  return firstRow(result);
}

async function createVerification(
  env: Bindings,
  userId: string,
  type: "EMAIL_VERIFICATION" | "PASSWORD_RESET",
) {
  const code = generateOtp();
  const tokenHash = await hashOtp(env, code);
  const tokenId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await database(env).execute(sql`
    insert into public.verification_tokens (
      id, user_id, token_hash, type, expires_at, attempts, last_sent_at
    ) values (
      ${tokenId}::uuid, ${userId}::uuid, ${tokenHash}, ${type}::"VerificationTokenType",
      ${expiresAt}::timestamptz, 0, now()
    )
  `);
  return { code, tokenId };
}

async function supersedeOlderVerifications(
  env: Bindings,
  userId: string,
  type: "EMAIL_VERIFICATION" | "PASSWORD_RESET",
  keepTokenId: string,
) {
  await database(env).execute(sql`
    update public.verification_tokens set used_at = coalesce(used_at, now())
    where user_id = ${userId}::uuid and type::text = ${type}
      and id <> ${keepTokenId}::uuid and used_at is null
  `);
}

async function sendFreshEmailVerification(
  env: Bindings,
  user: { id: string; email: string; first_name: string | null },
) {
  const latest = await latestVerification(env, user.email, "EMAIL_VERIFICATION");
  if (latest && Date.now() - new Date(latest.last_sent_at).getTime() < 60_000) return;

  if (!phase2SchemaReady(env)) {
    const verification = await createVerification(env, user.id, "EMAIL_VERIFICATION");
    await sendMail(env, {
      to: user.email,
      firstName: user.first_name,
      code: verification.code,
      kind: "verification",
      idempotencyKey: `verify-${verification.tokenId}`,
    });
    await supersedeOlderVerifications(env, user.id, "EMAIL_VERIFICATION", verification.tokenId);
    return;
  }

  const code = generateOtp();
  const tokenId = crypto.randomUUID();
  const tokenHash = await hashOtp(env, code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await database(env).execute(sql`
    with invalidated as (
      update public.verification_tokens set used_at = coalesce(used_at, now())
      where user_id = ${user.id}::uuid and type::text = 'EMAIL_VERIFICATION' and used_at is null
    ), inserted_token as (
      insert into public.verification_tokens (
        id, user_id, token_hash, type, expires_at, attempts, last_sent_at
      ) values (
        ${tokenId}::uuid, ${user.id}::uuid, ${tokenHash},
        'EMAIL_VERIFICATION'::"VerificationTokenType", ${expiresAt}::timestamptz, 0, now()
      ) returning id
    )
    update app_private.pending_registrations staged set
      verification_token_id = inserted_token.id,
      expires_at = ${expiresAt}::timestamptz,
      created_at = now()
    from inserted_token where staged.user_id = ${user.id}::uuid
  `);
  try {
    await sendMail(env, {
      to: user.email,
      firstName: user.first_name,
      code,
      kind: "verification",
      idempotencyKey: `verify-${tokenId}`,
    });
  } catch (caught) {
    // Keep the token if delivery fails or times out. The provider may have
    // accepted the message even when its response did not reach the Worker.
    throw caught;
  }
}

async function stagePendingRegistration(
  context: AppContext,
  user: { id: string; email: string },
  input: RegisterInput,
) {
  const verificationId = crypto.randomUUID();
  const verificationCode = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const displayName = `${input.firstName} ${input.lastName}`;
  if (input.firstName.length > 40 || input.lastName.length > 40 || displayName.length > 80) {
    throw new AppError(400, "BAD_REQUEST", "Use a shorter first or last name and try again.");
  }
  const [passwordHash, verificationHash] = await Promise.all([
    hashPassword(input.password),
    hashOtp(context.env, verificationCode),
  ]);
  await database(context.env).execute(sql`
    with invalidated as (
      update public.verification_tokens set used_at = coalesce(used_at, now())
      where user_id = ${user.id}::uuid and type::text = 'EMAIL_VERIFICATION' and used_at is null
    ), inserted_token as (
      insert into public.verification_tokens (
        id, user_id, token_hash, type, expires_at, attempts, last_sent_at
      ) values (
        ${verificationId}::uuid, ${user.id}::uuid, ${verificationHash},
        'EMAIL_VERIFICATION'::"VerificationTokenType", ${expiresAt}::timestamptz, 0, now()
      ) returning id
    )
    insert into app_private.pending_registrations (
      user_id, verification_token_id, password_hash, first_name, last_name,
      display_name, legal_version, expires_at
    ) select ${user.id}::uuid, inserted_token.id, ${passwordHash},
      ${input.firstName}, ${input.lastName}, ${displayName},
      ${input.legalVersion}, ${expiresAt}::timestamptz
    from inserted_token
    on conflict (user_id) do update set
      verification_token_id = excluded.verification_token_id,
      password_hash = excluded.password_hash,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      display_name = excluded.display_name,
      legal_version = excluded.legal_version,
      expires_at = excluded.expires_at,
      created_at = now()
  `);
  await sendMail(context.env, {
    to: user.email,
    firstName: input.firstName,
    code: verificationCode,
    kind: "verification",
    idempotencyKey: `verify-${verificationId}`,
  });
}

async function sendRegistrationVerification(
  context: AppContext,
  user: { id: string; email: string; first_name: string | null },
  input: RegisterInput,
) {
  if (phase2SchemaReady(context.env)) {
    await stagePendingRegistration(context, user, input);
    return;
  }
  await sendFreshEmailVerification(context.env, user);
}

function verificationFailure(result: string): never {
  if (result === "LOCKED") {
    throw new AppError(429, "RATE_LIMITED", "Too many attempts. Request a new code.");
  }
  throw new AppError(400, "BAD_REQUEST", "That code is incorrect, expired, or already used. Request a new one if needed.");
}

authRoutes.post("/register", async (context) => {
  const parsed = registerSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Check the account details and try again.");
  validatePassword(parsed.data.password);
  requireEmailProvider(context.env);
  await consumeAuthRateLimit(context, "REGISTER", parsed.data.email, 5, 900);

  const existing = await findUserByEmail(context.env, parsed.data.email);
  if (existing) {
    if (!existing.email_verified_at) {
      try {
        await sendRegistrationVerification(context, existing, parsed.data);
      } catch (caught) {
        logRegistrationFailure(context, "verification_delivery", caught);
        throw caught;
      }
    }
    return context.json({
      status: existing.email_verified_at ? "already_registered" : "verification_required",
      email: parsed.data.email,
    }, 202);
  }

  const userId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const verificationId = crypto.randomUUID();
  const termsAcceptanceId = crypto.randomUUID();
  const privacyAcceptanceId = crypto.randomUUID();
  const verificationCode = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const username = `student_${userId.replaceAll("-", "").slice(0, 10)}`;
  const displayName = `${parsed.data.firstName} ${parsed.data.lastName}`;

  if (parsed.data.firstName.length > 40 || parsed.data.lastName.length > 40 || displayName.length > 80) {
    throw new AppError(400, "BAD_REQUEST", "Use a shorter first or last name and try again.");
  }

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(parsed.data.password);
  } catch (caught) {
    logRegistrationFailure(context, "password_hash", caught);
    throw new AppError(500, "INTERNAL_ERROR", "We could not secure the account credentials. Please try again.");
  }

  let verificationHash: string;
  try {
    verificationHash = await hashOtp(context.env, verificationCode);
  } catch (caught) {
    logRegistrationFailure(context, "verification_hash", caught);
    throw caught;
  }

  let created: {
    user_id: string | null;
    verification_id: string | null;
    profile_created: boolean;
    terms_created: boolean;
    privacy_created: boolean;
  } | undefined;

  try {
    const result = await database(context.env).execute<{
      user_id: string | null;
      verification_id: string | null;
      profile_created: boolean;
      terms_created: boolean;
      privacy_created: boolean;
    }>(sql`
      with inserted_user as (
        insert into public.users (id, email, password_hash, created_at, updated_at)
        values (${userId}::uuid, ${parsed.data.email}, ${passwordHash}, now(), now())
        on conflict (email) do nothing
        returning id
      ), inserted_profile as (
        insert into public.profiles (
          id, user_id, username, display_name, first_name, last_name,
          onboarding_step, created_at, updated_at
        )
        select
          ${profileId}::uuid, inserted_user.id, ${username}, ${displayName},
          ${parsed.data.firstName}, ${parsed.data.lastName}, 'EMAIL_VERIFICATION', now(), now()
        from inserted_user
        returning id
      ), inserted_terms as (
        insert into public.legal_acceptances (id, user_id, document, version)
        select
          ${termsAcceptanceId}::uuid, inserted_user.id,
          'TERMS_OF_SERVICE'::"LegalDocument", ${parsed.data.legalVersion}
        from inserted_user
        returning id
      ), inserted_privacy as (
        insert into public.legal_acceptances (id, user_id, document, version)
        select
          ${privacyAcceptanceId}::uuid, inserted_user.id,
          'PRIVACY_POLICY'::"LegalDocument", ${parsed.data.legalVersion}
        from inserted_user
        returning id
      ), inserted_token as (
        insert into public.verification_tokens (
          id, user_id, token_hash, type, expires_at, attempts, last_sent_at
        )
        select
          ${verificationId}::uuid, inserted_user.id, ${verificationHash},
          'EMAIL_VERIFICATION'::"VerificationTokenType", ${expiresAt}::timestamptz, 0, now()
        from inserted_user
        returning id
      )
      select
        (select id::text from inserted_user) as user_id,
        (select id::text from inserted_token) as verification_id,
        exists(select 1 from inserted_profile) as profile_created,
        exists(select 1 from inserted_terms) as terms_created,
        exists(select 1 from inserted_privacy) as privacy_created
    `);
    created = firstRow(result);
  } catch (caught) {
    logRegistrationFailure(context, "account_insert", caught);
    throw new AppError(500, "INTERNAL_ERROR", "We could not finish creating the account. Please try again.");
  }

  if (!created?.user_id) {
    const raced = await findUserByEmail(context.env, parsed.data.email);
    if (!raced) {
      const error = new Error("Registration insert returned no user after an email conflict.");
      logRegistrationFailure(context, "account_insert", error);
      throw new AppError(500, "INTERNAL_ERROR", "We could not finish creating the account. Please try again.");
    }
    if (!raced.email_verified_at) {
      try {
        await sendRegistrationVerification(context, raced, parsed.data);
      } catch (caught) {
        logRegistrationFailure(context, "verification_delivery", caught);
        throw caught;
      }
    }
    return context.json({
      status: raced.email_verified_at ? "already_registered" : "verification_required",
      email: parsed.data.email,
    }, 202);
  }

  if (!created.verification_id || !created.profile_created || !created.terms_created || !created.privacy_created) {
    const error = new Error("Atomic registration did not create every required account record.");
    logRegistrationFailure(context, "account_insert", error);
    throw new AppError(500, "INTERNAL_ERROR", "We could not finish creating the account. Please try again.");
  }

  try {
    await sendMail(context.env, {
      to: parsed.data.email,
      firstName: parsed.data.firstName,
      code: verificationCode,
      kind: "verification",
      idempotencyKey: `verify-${verificationId}`,
    });
  } catch (caught) {
    // Keep the pending verification token. If the provider accepted the message
    // but its response timed out, deleting the token would make that delivered
    // code unusable. A retry/resend can safely supersede it later.
    logRegistrationFailure(context, "verification_delivery", caught);
    throw caught;
  }

  return context.json({ status: "verification_required", email: parsed.data.email }, 201);
});

authRoutes.post("/resend-verification", async (context) => {
  const parsed = resendVerificationSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Enter a valid email address.");
  requireEmailProvider(context.env);
  await consumeAuthRateLimit(context, "RESEND_OTP", parsed.data.email, 5, 900);
  const user = await findUserByEmail(context.env, parsed.data.email);
  if (!user || user.email_verified_at) return context.json({ status: "accepted" }, 202);

  await sendFreshEmailVerification(context.env, user);
  return context.json({ status: "accepted" }, 202);
});

authRoutes.post("/verify-email", async (context) => {
  const parsed = verifyEmailSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Enter the six-digit code from your email.");
  await consumeAuthRateLimit(context, "VERIFY_OTP", parsed.data.email, 30, 900);
  const token = await latestVerification(context.env, parsed.data.email, "EMAIL_VERIFICATION");
  if (!token) verificationFailure("INVALID");
  const consumed = await database(context.env).execute<{ result: string }>(sql`
    select app_private.check_and_consume_email_verification(
      ${token.id}::uuid, ${await hashOtp(context.env, parsed.data.code)}
    ) as result
  `);
  const verificationResult = firstRow(consumed)?.result ?? "INVALID";
  if (verificationResult !== "VERIFIED") verificationFailure(verificationResult);

  const userRecord = await findUserByEmail(context.env, parsed.data.email);
  if (!userRecord) throw new AppError(500, "INTERNAL_ERROR", "The account could not be loaded.");
  const session = await createSession(context.env, toAuthenticatedUser(userRecord), {
    ...requestMetadata(context),
    ...(parsed.data.deviceLabel ? { deviceLabel: parsed.data.deviceLabel } : {}),
  });
  maybeSetWebCookies(context, context.env, session);

  context.executionCtx.waitUntil(sendMail(context.env, {
    to: userRecord.email,
    firstName: userRecord.first_name,
    kind: "welcome",
    idempotencyKey: `welcome-${userRecord.id}`,
  }).catch(() => undefined));

  return context.json(session);
});

authRoutes.post("/login", async (context) => {
  const parsed = loginSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Enter your email and password.");
  const rateLimitKey = await consumeAuthRateLimit(context, "LOGIN", parsed.data.email, 10, 1800);
  const userRecord = await findUserByEmail(context.env, parsed.data.email);
  if (!userRecord || !(await verifyPassword(parsed.data.password, userRecord.password_hash))) {
    throw new AppError(401, "UNAUTHENTICATED", "The email or password is incorrect.");
  }
  if (!userRecord.email_verified_at) {
    throw new AppError(403, "FORBIDDEN", "Verify your email before signing in.", { verificationRequired: true });
  }

  await database(context.env).execute(sql`
    update public.users set last_login_at = now(), updated_at = now() where id = ${userRecord.id}::uuid
  `);
  const session = await createSession(context.env, toAuthenticatedUser(userRecord), {
    ...requestMetadata(context),
    ...(parsed.data.deviceLabel ? { deviceLabel: parsed.data.deviceLabel } : {}),
  });
  await clearAuthRateLimit(context.env, "LOGIN", rateLimitKey);
  maybeSetWebCookies(context, context.env, session);
  return context.json(session);
});

authRoutes.post("/refresh", async (context) => {
  const parsed = refreshSessionSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "The session request is invalid.");
  const token = parsed.data.refreshToken ?? refreshCookie(context);
  if (!token) throw new AppError(401, "UNAUTHENTICATED", "No refresh session was provided.");
  const session = await rotateSession(context.env, token, {
    ...requestMetadata(context),
    ...(parsed.data.deviceLabel ? { deviceLabel: parsed.data.deviceLabel } : {}),
  });
  maybeSetWebCookies(context, context.env, session);
  return context.json(session);
});

authRoutes.post("/logout", async (context) => {
  const raw = await body(context);
  const parsed = refreshSessionSchema.safeParse(raw);
  const token = (parsed.success ? parsed.data.refreshToken : undefined) ?? refreshCookie(context);
  if (token) await revokeSession(context.env, token);
  clearSessionCookies(context, context.env);
  return context.json({ status: "signed_out" });
});

authRoutes.post("/forgot-password", async (context) => {
  const parsed = forgotPasswordSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Enter a valid email address.");
  requireEmailProvider(context.env);
  await consumeAuthRateLimit(context, "FORGOT_PASSWORD", parsed.data.email, 5, 900);
  const user = await findUserByEmail(context.env, parsed.data.email);
  if (!user) return context.json({ status: "accepted" }, 202);

  const latest = await latestVerification(context.env, parsed.data.email, "PASSWORD_RESET");
  if (latest && Date.now() - new Date(latest.last_sent_at).getTime() < 60_000) {
    return context.json({ status: "accepted" }, 202);
  }

  const verification = await createVerification(context.env, user.id, "PASSWORD_RESET");
  try {
    await sendMail(context.env, {
      to: user.email,
      firstName: user.first_name,
      code: verification.code,
      kind: "password-reset",
      idempotencyKey: `reset-${verification.tokenId}`,
    });
  } catch (caught) {
    // Preserve the token on a provider timeout so a message that was actually
    // accepted by Resend still contains a usable reset code.
    throw caught;
  }
  await supersedeOlderVerifications(context.env, user.id, "PASSWORD_RESET", verification.tokenId);
  return context.json({ status: "accepted" }, 202);
});

authRoutes.post("/reset-password", async (context) => {
  const parsed = resetPasswordSchema.safeParse(await body(context));
  if (!parsed.success) throw new AppError(400, "BAD_REQUEST", "Check the reset code and new password.");
  await consumeAuthRateLimit(context, "RESET_PASSWORD", parsed.data.email, 20, 900);
  validatePassword(parsed.data.password);
  const token = await latestVerification(context.env, parsed.data.email, "PASSWORD_RESET");
  if (!token) verificationFailure("INVALID");
  const passwordHash = await hashPassword(parsed.data.password);
  const consumed = await database(context.env).execute<{ result: string }>(sql`
    select app_private.check_and_consume_password_reset(
      ${token.id}::uuid, ${await hashOtp(context.env, parsed.data.code)}, ${passwordHash}
    ) as result
  `);
  const resetResult = firstRow(consumed)?.result ?? "INVALID";
  if (resetResult !== "UPDATED") verificationFailure(resetResult);
  clearSessionCookies(context, context.env);
  return context.json({ status: "password_updated" });
});
