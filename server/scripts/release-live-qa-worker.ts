import { neon } from "@neondatabase/serverless";
import { SignJWT } from "jose";

type Env = {
  DATABASE_URL?: string;
  JWT_SECRET?: string;
  PRIVATE_BUCKET?: R2Bucket;
  QA_TOKEN?: string;
  QA_EXPIRES_AT?: string;
};

function constantTime(expected: string, supplied: string) {
  if (!/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return difference === 0;
}

async function hexSha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const supplied = request.headers.get("x-qa-token") ?? "";
    const expiry = Number(env.QA_EXPIRES_AT);
    if (
      request.method !== "POST" ||
      typeof env.QA_TOKEN !== "string" ||
      !constantTime(env.QA_TOKEN, supplied) ||
      !Number.isFinite(expiry) ||
      expiry <= Date.now() ||
      expiry > Date.now() + 240000
    ) return new Response(null, { status: 404 });

    const reply = (body: unknown, status = 200) =>
      Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

    if (!env.DATABASE_URL || !env.JWT_SECRET || env.JWT_SECRET.length < 32 || !env.PRIVATE_BUCKET) {
      return reply({ ok: false, stage: "configuration" }, 503);
    }
    const sql = neon(env.DATABASE_URL, { fetchOptions: { cache: "no-store" } });

    if (url.pathname === "/__release_live_qa/setup") {
      const userId = crypto.randomUUID();
      const refreshId = crypto.randomUUID();
      const familyId = crypto.randomUUID();
      const email = `release.qa.${userId.replaceAll("-", "")}@example.invalid`;
      try {
        await sql`
          insert into public.users (id, email, password_hash, email_verified_at, created_at, updated_at)
          values (
            ${userId}::uuid,
            ${email},
            '$pbkdf2-sha256$100000$cmVsZWFzZS1xYS1zYWx0LTE$cmVsZWFzZS1xYS1ub3QtbG9naW4taGFzaC0wMDAwMDAwMDA',
            now(),
            now(),
            now()
          )
        `;
        await sql`
          insert into public.refresh_tokens (
            id, user_id, token_hash, family_id, expires_at, device_label, last_used_at
          ) values (
            ${refreshId}::uuid, ${userId}::uuid, ${crypto.randomUUID().replaceAll("-", "")},
            ${familyId}::uuid, now() + interval '30 minutes', 'release-qa', now()
          )
        `;
        const accessToken = await new SignJWT({
          email,
          roles: [],
          universityId: null,
          operatorRoles: [],
          sid: familyId,
        })
          .setProtectedHeader({ alg: "HS256", typ: "JWT" })
          .setSubject(userId)
          .setAudience("kampusone-clients")
          .setIssuer("kampusone-api")
          .setIssuedAt()
          .setExpirationTime("10m")
          .sign(new TextEncoder().encode(env.JWT_SECRET));
        return reply({ ok: true, userId, accessToken });
      } catch {
        await sql`delete from public.refresh_tokens where user_id=${userId}::uuid`.catch(() => undefined);
        await sql`delete from public.users where id=${userId}::uuid`.catch(() => undefined);
        return reply({ ok: false, stage: "setup" }, 500);
      }
    }

    if (url.pathname === "/__release_live_qa/cleanup") {
      const body = await request.json().catch(() => null) as { userId?: string; mediaId?: string } | null;
      const userId = body?.userId ?? "";
      const mediaId = body?.mediaId;
      if (!/^[0-9a-f-]{36}$/.test(userId)) return reply({ ok: false, stage: "cleanup_input" }, 400);
      try {
        const records = await sql`
          select email from public.users
          where id=${userId}::uuid and email like 'release.qa.%@example.invalid'
          limit 1
        `;
        if (!records[0]) return reply({ ok: false, stage: "cleanup_identity" }, 403);
        if (mediaId && /^[0-9a-f-]{36}$/.test(mediaId)) {
          await env.PRIVATE_BUCKET.delete(`${userId}/resource/${mediaId}`);
        }
        const aiKey = await hexSha256(userId);
        await sql`select app_private.clear_request_rate_limit('AI_INPUT', ${aiKey})`.catch(() => undefined);
        await sql`select app_private.clear_request_rate_limit('MEDIA_UPLOAD', ${userId})`.catch(() => undefined);
        await sql`delete from app_private.ai_requests where user_id=${userId}::uuid`.catch(() => undefined);
        await sql`delete from public.media_objects where owner_user_id=${userId}::uuid`.catch(() => undefined);
        await sql`delete from public.refresh_tokens where user_id=${userId}::uuid`.catch(() => undefined);
        await sql`delete from public.profiles where user_id=${userId}::uuid`.catch(() => undefined);
        await sql`delete from public.users where id=${userId}::uuid`;
        const residual = await sql`
          select
            exists(select 1 from public.users where id=${userId}::uuid) as user_exists,
            exists(select 1 from public.refresh_tokens where user_id=${userId}::uuid) as session_exists,
            exists(select 1 from public.media_objects where owner_user_id=${userId}::uuid) as media_exists,
            exists(select 1 from app_private.ai_requests where user_id=${userId}::uuid) as ai_exists
        `;
        const row = residual[0] as Record<string, unknown> | undefined;
        const clean = row?.user_exists === false && row?.session_exists === false && row?.media_exists === false && row?.ai_exists === false;
        return reply({ ok: clean, cleanup: clean }, clean ? 200 : 500);
      } catch {
        return reply({ ok: false, stage: "cleanup" }, 500);
      }
    }

    return new Response(null, { status: 404 });
  },
};
