import { sql } from "drizzle-orm";

import type { AuthenticatedUser, Bindings } from "../types";
import { database, firstRow } from "../lib/database";
import { AppError } from "../lib/errors";
import { issueAccessToken, randomToken, REFRESH_TOKEN_SECONDS, sha256 } from "../lib/security";

type UserRecord = {
  id: string;
  email: string;
  password_hash: string;
  email_verified_at: string | null;
  roles: string[] | null;
  university_id: string | null;
  first_name: string | null;
  operator_roles: string[] | null;
};

export async function findUserByEmail(env: Bindings, email: string) {
  const result = await database(env).execute<UserRecord>(sql`
    select
      users.id,
      users.email,
      users.password_hash,
      users.email_verified_at::text,
      users.roles::text[] as roles,
      profiles.university_id,
      profiles.first_name,
      coalesce(
        array_agg(distinct operator_roles.role) filter (
          where operator_roles.role is not null
            and (operator_roles.expires_at is null or operator_roles.expires_at > now())
        ),
        '{}'::text[]
      ) as operator_roles
    from public.users users
    left join public.profiles profiles on profiles.user_id = users.id and profiles.deleted_at is null
    left join public.operator_roles operator_roles on operator_roles.user_id = users.id
    where users.email = ${email}
      and users.deleted_at is null
      and users.status::text = 'ACTIVE'
    group by users.id, profiles.university_id, profiles.first_name
    limit 1
  `);
  return firstRow(result);
}

export async function findUserById(env: Bindings, id: string) {
  const result = await database(env).execute<UserRecord>(sql`
    select
      users.id,
      users.email,
      users.password_hash,
      users.email_verified_at::text,
      users.roles::text[] as roles,
      profiles.university_id,
      profiles.first_name,
      coalesce(
        array_agg(distinct operator_roles.role) filter (
          where operator_roles.role is not null
            and (operator_roles.expires_at is null or operator_roles.expires_at > now())
        ),
        '{}'::text[]
      ) as operator_roles
    from public.users users
    left join public.profiles profiles on profiles.user_id = users.id and profiles.deleted_at is null
    left join public.operator_roles operator_roles on operator_roles.user_id = users.id
    where users.id = ${id}::uuid
      and users.deleted_at is null
      and users.status::text = 'ACTIVE'
    group by users.id, profiles.university_id, profiles.first_name
    limit 1
  `);
  return firstRow(result);
}

export function toAuthenticatedUser(user: UserRecord): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    roles: user.roles ?? [],
    universityId: user.university_id,
    operatorRoles: user.operator_roles ?? [],
  };
}

export async function createSession(
  env: Bindings,
  user: AuthenticatedUser,
  metadata: { deviceLabel?: string; ipAddress?: string; userAgent?: string; familyId?: string } = {},
) {
  const refreshToken = randomToken(48);
  const tokenHash = await sha256(refreshToken);
  const id = crypto.randomUUID();
  const familyId = metadata.familyId ?? crypto.randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000).toISOString();

  await database(env).execute(sql`
    insert into public.refresh_tokens (
      id, user_id, token_hash, family_id, expires_at,
      device_label, ip_address, user_agent, last_used_at
    ) values (
      ${id}::uuid, ${user.id}::uuid, ${tokenHash}, ${familyId}::uuid, ${expiresAt}::timestamptz,
      ${metadata.deviceLabel ?? null}, ${metadata.ipAddress ?? null}::inet,
      ${metadata.userAgent ?? null}, now()
    )
  `);

  return {
    accessToken: await issueAccessToken(env, user),
    refreshToken,
    expiresIn: 15 * 60,
    refreshExpiresIn: REFRESH_TOKEN_SECONDS,
    user,
  };
}

export async function rotateSession(
  env: Bindings,
  refreshToken: string,
  metadata: { deviceLabel?: string; ipAddress?: string; userAgent?: string } = {},
) {
  const hash = await sha256(refreshToken);
  const found = await database(env).execute<{
    id: string;
    user_id: string;
    family_id: string;
    revoked_at: string | null;
    expires_at: string;
  }>(sql`
    select id, user_id, family_id, revoked_at::text, expires_at::text
    from public.refresh_tokens
    where token_hash = ${hash}
    limit 1
  `);
  const current = firstRow(found);
  if (!current) throw new AppError(401, "UNAUTHENTICATED", "Your session is invalid or has expired.");

  if (current.revoked_at) {
    await database(env).execute(sql`
      update public.refresh_tokens
      set revoked_at = coalesce(revoked_at, now())
      where family_id = ${current.family_id}::uuid
    `);
    throw new AppError(401, "UNAUTHENTICATED", "This session was already used. Sign in again.");
  }
  if (new Date(current.expires_at).getTime() <= Date.now()) {
    throw new AppError(401, "UNAUTHENTICATED", "Your session has expired. Sign in again.");
  }

  const userRecord = await findUserById(env, current.user_id);
  if (!userRecord || !userRecord.email_verified_at) {
    throw new AppError(401, "UNAUTHENTICATED", "This account cannot start a session.");
  }
  const user = toAuthenticatedUser(userRecord);
  const refreshTokenNext = randomToken(48);
  const nextHash = await sha256(refreshTokenNext);
  const nextId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000).toISOString();
  const rotated = await database(env).execute<{ id: string }>(sql`
    with locked as (
      select id from public.refresh_tokens
      where id = ${current.id}::uuid and revoked_at is null and expires_at > now()
      for update
    ), inserted as (
      insert into public.refresh_tokens (
        id, user_id, token_hash, family_id, expires_at,
        device_label, ip_address, user_agent, last_used_at
      )
      select ${nextId}::uuid, ${user.id}::uuid, ${nextHash}, ${current.family_id}::uuid,
        ${expiresAt}::timestamptz, ${metadata.deviceLabel ?? null},
        ${metadata.ipAddress ?? null}::inet, ${metadata.userAgent ?? null}, now()
      from locked
      returning id
    ), consumed as (
      update public.refresh_tokens set revoked_at = now(), last_used_at = now(),
        replaced_by_token_id = ${nextId}::uuid
      where id in (select id from locked) and exists (select 1 from inserted)
      returning id
    )
    select inserted.id from inserted join consumed on true
  `);
  if (!firstRow(rotated)) {
    await database(env).execute(sql`
      update public.refresh_tokens set revoked_at = coalesce(revoked_at, now())
      where family_id = ${current.family_id}::uuid
    `);
    throw new AppError(401, "UNAUTHENTICATED", "This session was already used. Sign in again.");
  }
  return {
    accessToken: await issueAccessToken(env, user),
    refreshToken: refreshTokenNext,
    expiresIn: 15 * 60,
    refreshExpiresIn: REFRESH_TOKEN_SECONDS,
    user,
  };
}

export async function revokeSession(env: Bindings, refreshToken: string) {
  const hash = await sha256(refreshToken);
  await database(env).execute(sql`
    update public.refresh_tokens set revoked_at = coalesce(revoked_at, now()) where token_hash = ${hash}
  `);
}
