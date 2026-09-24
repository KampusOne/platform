import { neon } from "@neondatabase/serverless";
import { SignJWT } from "jose";

type Env = {
  DATABASE_URL?: string;
  JWT_SECRET?: string;
  PRIVATE_BUCKET?: R2Bucket;
  QA_TOKEN?: string;
  QA_EXPIRES_AT?: string;
  API_ORIGIN?: string;
};

const RED_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAX0lEQVR4nO3PQQ0AIBDAMMC/50MEj4ZkVbDtWX87OuBVA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA9oFUoUBf3Xr7AgAAAAASUVORK5CYII=";

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

async function jsonResponse(response: Response) {
  const value = await response.json().catch(() => null);
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

export default {
  async fetch(request: Request, env: Env) {
    const supplied = request.headers.get("x-qa-token") ?? "";
    const expiry = Number(env.QA_EXPIRES_AT);
    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== "/__release_live_qa" ||
      typeof env.QA_TOKEN !== "string" ||
      !constantTime(env.QA_TOKEN, supplied) ||
      !Number.isFinite(expiry) ||
      expiry <= Date.now() ||
      expiry > Date.now() + 240000
    ) return new Response(null, { status: 404 });

    const reply = (body: unknown, status = 200) =>
      Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

    if (!env.DATABASE_URL || !env.JWT_SECRET || env.JWT_SECRET.length < 32 || !env.PRIVATE_BUCKET || !env.API_ORIGIN) {
      return reply({ ok: false, stage: "configuration" }, 503);
    }

    const sql = neon(env.DATABASE_URL, { fetchOptions: { cache: "no-store" } });
    const userId = crypto.randomUUID();
    const refreshId = crypto.randomUUID();
    const familyId = crypto.randomUUID();
    const email = `release.qa.${userId.replaceAll("-", "")}@example.invalid`;
    const api = env.API_ORIGIN.replace(/\/$/, "");
    let mediaId: string | undefined;
    let stage = "setup";
    let textPassed = false;
    let imagePassed = false;
    let statusPassed = false;
    let cleanupPassed = false;
    let textChars = 0;
    let imageChars = 0;
    let statusHttp = 0;
    let statusEnabled = false;
    let statusTextCapability = false;
    let statusImageCapability = false;
    let failureStage: string | undefined;
    let failureReason: string | undefined;

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

      const authHeaders = { Authorization: `Bearer ${accessToken}` };

      stage = "status";
      const statusResponse = await fetch(api + "/v1/ai/status", {
        headers: authHeaders,
        signal: AbortSignal.timeout(30000),
      });
      const statusBody = await jsonResponse(statusResponse);
      statusHttp = statusResponse.status;
      statusEnabled = statusBody.enabled === true;
      statusTextCapability = statusBody.capabilities?.text === true;
      statusImageCapability = statusBody.capabilities?.images === true;
      statusPassed =
        statusHttp === 200 &&
        statusEnabled &&
        statusTextCapability &&
        statusImageCapability &&
        !JSON.stringify(statusBody).toLowerCase().includes("hugging face") &&
        !JSON.stringify(statusBody).toLowerCase().includes("qwen");
      if (!statusPassed) throw new Error("status_contract");

      stage = "text_inference";
      const textKey = crypto.randomUUID();
      const textResponse = await fetch(api + "/v1/ai/", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "study",
          tier: "standard",
          prompt: "Reply with one short sentence that explicitly includes the words voltage, current, and resistance while stating Ohm's law.",
          idempotencyKey: textKey,
          consent: true,
        }),
        signal: AbortSignal.timeout(45000),
      });
      const textBody = await jsonResponse(textResponse);
      const textValue = typeof textBody.text === "string" ? textBody.text.trim() : "";
      textChars = textValue.length;
      const normalizedText = textValue.toLowerCase();
      textPassed =
        textResponse.status === 200 &&
        textChars >= 20 &&
        normalizedText.includes("voltage") &&
        normalizedText.includes("current") &&
        normalizedText.includes("resistance");
      if (!textPassed) throw new Error(`text_http_${textResponse.status}`);

      stage = "image_upload";
      const imageBytes = Uint8Array.from(atob(RED_PNG_BASE64), ch => ch.charCodeAt(0));
      const form = new FormData();
      form.set("kind", "resource");
      form.set("file", new File([imageBytes], "release-qa-red.png", { type: "image/png" }));
      const uploadResponse = await fetch(api + "/v1/media/", {
        method: "POST",
        headers: authHeaders,
        body: form,
        signal: AbortSignal.timeout(30000),
      });
      const uploadBody = await jsonResponse(uploadResponse);
      mediaId = typeof uploadBody.id === "string" ? uploadBody.id : undefined;
      if (uploadResponse.status !== 201 || !mediaId) throw new Error(`upload_http_${uploadResponse.status}`);

      stage = "image_inference";
      const imageKey = crypto.randomUUID();
      const imageResponse = await fetch(api + "/v1/ai/", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "study",
          tier: "standard",
          prompt: "Look at the attached image and answer with the single lowercase word for its dominant color.",
          mediaId,
          idempotencyKey: imageKey,
          consent: true,
        }),
        signal: AbortSignal.timeout(60000),
      });
      const imageBody = await jsonResponse(imageResponse);
      const imageValue = typeof imageBody.text === "string" ? imageBody.text.trim() : "";
      imageChars = imageValue.length;
      imagePassed = imageResponse.status === 200 && /\bred\b/i.test(imageValue);
      if (!imagePassed) throw new Error(`image_http_${imageResponse.status}`);

      stage = "cleanup";
    } catch (error) {
      failureStage = stage;
      failureReason = error instanceof Error && /^[a-z_]+(?:_[1-5][0-9]{2})?$/.test(error.message)
        ? error.message
        : "qa_failed";
    } finally {
      try {
        if (mediaId) await env.PRIVATE_BUCKET.delete(`${userId}/resource/${mediaId}`);
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
        cleanupPassed = row?.user_exists === false && row?.session_exists === false && row?.media_exists === false && row?.ai_exists === false;
      } catch {
        cleanupPassed = false;
      }
    }

    if (failureStage || !cleanupPassed) {
      return reply({
        ok: false,
        stage: failureStage ?? "cleanup",
        reason: failureReason ?? "cleanup_failed",
        statusHttp,
        statusEnabled,
        statusTextCapability,
        statusImageCapability,
        status: statusPassed,
        text: textPassed,
        image: imagePassed,
        textChars,
        imageChars,
        cleanup: cleanupPassed,
      }, 500);
    }

    return reply({
      ok: statusPassed && textPassed && imagePassed && cleanupPassed,
      stage: "verified",
      statusHttp,
      statusEnabled,
      statusTextCapability,
      statusImageCapability,
      status: statusPassed,
      text: textPassed,
      image: imagePassed,
      textChars,
      imageChars,
      cleanup: cleanupPassed,
    });
  },
};
