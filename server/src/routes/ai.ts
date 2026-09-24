import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z, timetableEntrySchema } from "@kampusone/contracts";
import { database, firstRow, sqlClient } from "../lib/database";
import { input } from "../lib/input";
import { sha256 } from "../lib/security";
import { AppError } from "../lib/errors";
import { requireAuth, currentUser } from "../middleware/auth";
import { aiDay, AI_HISTORY_DAYS, AI_MIME_TYPES, MAX_AI_MEDIA_BYTES, AIProviderError, assertAIConfiguration, generateAI, parseTimetableJSON, providerConfiguration, selectAIProvider, type AIMedia, type AITurn, type AIProvider } from "../lib/ai-provider";
import { aiAllowance, resolveAIQuota } from "../lib/ai-quota";
import type { Bindings, Variables } from "../types";

export const aiRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();
aiRoutes.use("/*", requireAuth);
aiRoutes.use("/*", async (c, next) => { c.header("Cache-Control", "private, no-store"); await next(); });
const modes = z.enum(["study", "summary", "quiz", "notes", "timetable"]);
const requestSchema = z.object({ mode: modes, provider: z.enum(["gemini", "huggingface"]).optional(), prompt: z.string().trim().max(20000), mediaId: z.string().uuid().optional(), replyTo: z.string().uuid().optional(), idempotencyKey: z.string().uuid(), consent: z.literal(true) });
type Saved = { version?: number; text?: string; entries?: unknown[]; warnings?: string[]; prompt?: string; mediaId?: string; fileName?: string; threadId?: string; provider?: string; deleted?: boolean; reason?: string; message?: string };
type RequestRow = { idempotency_key: string; request_hash: string; status: string; result: Saved | null; created_at: string };
function requireSchema(env: Bindings) {
  if (env.UNIFIED_SCHEMA_READY !== "true") throw new AppError(503, "PROVIDER_UNAVAILABLE", "AI storage is not ready. Your draft has not been submitted.", { reason: "AI_SCHEMA_NOT_READY" });
}
function publicResult(id: string, value: Saved) {
  return { requestId: id, threadId: value.threadId ?? id, provider: value.provider, ...(typeof value.text === "string" ? { text: value.text } : {}), ...(Array.isArray(value.entries) ? { entries: value.entries, warnings: value.warnings ?? [] } : {}) };
}
function replay(row: RequestRow, hash: string) {
  if (row.request_hash !== hash) throw new AppError(409, "CONFLICT", "This request reference belongs to a different draft.", { reason: "AI_REQUEST_CONFLICT" });
  if (row.result?.version === 2 && Date.now() - new Date(row.created_at).getTime() > AI_HISTORY_DAYS * 86400000) throw new AppError(410, "NOT_FOUND", "This AI result has expired. Start a new request.", { reason: "AI_EXPIRED", retryWithNewKey: true });
  if (row.result?.deleted) throw new AppError(410, "NOT_FOUND", "This saved result has been deleted.", { reason: "AI_DELETED", retryWithNewKey: true });
  if (row.status === "COMPLETED" && row.result) return publicResult(row.idempotency_key, row.result);
  if (row.status === "FAILED") throw new AppError(503, "PROVIDER_UNAVAILABLE", row.result?.message ?? "That attempt did not finish. Start a new attempt when ready.", { reason: row.result?.reason ?? "AI_FAILED", retryWithNewKey: true });
  const stale = Date.now() - new Date(row.created_at).getTime() > 120000;
  throw new AppError(409, "CONFLICT", stale ? "That attempt did not finish in time. You can start a new attempt; the earlier reservation still counts toward today's allowance." : "This request is still processing. Retry to check the same attempt; do not submit it again.", { reason: stale ? "AI_STALE_REQUEST" : "AI_PROCESSING", retryWithNewKey: stale });
}
function providerFailure(error: AIProviderError) {
  return new AppError(error.status, error.status === 429 ? "RATE_LIMITED" : error.status === 400 || error.status === 422 ? "BAD_REQUEST" : "PROVIDER_UNAVAILABLE", error.message, { reason: error.reason, retryWithNewKey: true });
}
function capabilities(env: Bindings) {
  const safe = (mode: "study" | "timetable", mime?: string, requested?: AIProvider) => {
    const { provider, configured, missing } = providerConfiguration(env, mode, mime, requested);
    return { provider, configured, missing };
  };
  return { study: safe("study"), studyHuggingFace: safe("study", undefined, "huggingface"), timetableText: safe("timetable"), timetableImage: safe("timetable", "image/jpeg"), timetablePdf: safe("timetable", "application/pdf") };
}
aiRoutes.get("/status", async c => {
  const caps = capabilities(c.env), quota = await resolveAIQuota(c.env, currentUser(c)), day = aiDay();
  const enabled = c.env.AI_ASSISTANT_ENABLED === "true" && c.env.UNIFIED_SCHEMA_READY === "true";
  let used = 0, globalUsed = 0;
  if (c.env.UNIFIED_SCHEMA_READY === "true") {
    const row = firstRow(await database(c.env).execute<{ used: number; total: number }>(sql`select count(*) filter (where user_id=${currentUser(c).id}::uuid)::int as used,count(*)::int as total from app_private.ai_requests where created_at>=${day.startsAt}::timestamptz and created_at<${day.resetsAt}::timestamptz`));
    used = Number(row?.used ?? 0); globalUsed = Number(row?.total ?? 0);
  }
  return c.json({ enabled, providers: caps, historyDays: AI_HISTORY_DAYS, maxFileBytes: MAX_AI_MEDIA_BYTES, allowance: aiAllowance(quota, used, globalUsed, day.resetsAt) });
});
aiRoutes.get("/history", async c => {
  requireSchema(c.env);
  const q = z.string().trim().max(120).safeParse(c.req.query("q") ?? "");
  const offset = z.coerce.number().int().min(0).max(10000).safeParse(c.req.query("offset") ?? "0");
  if (!q.success || !offset.success) throw new AppError(400, "BAD_REQUEST", "Use a shorter history search.");
  const rows = await database(c.env).execute(sql`select idempotency_key as id,mode,created_at,left(coalesce(nullif(result->>'prompt',''),result->>'fileName',mode),160) as title,result->>'fileName' as source_name from app_private.ai_requests where user_id=${currentUser(c).id}::uuid and mode<>'timetable' and status='COMPLETED' and result ? 'text' and created_at>now()-interval '90 days' and (${q.data}='' or strpos(lower(coalesce(result->>'prompt','') || ' ' || coalesce(result->>'text','')),lower(${q.data}))>0) order by created_at desc,idempotency_key desc limit 50 offset ${offset.data}`);
  return c.json({ sessions: rows.rows, nextOffset: rows.rows.length === 50 ? offset.data + 50 : null });
});
aiRoutes.get("/history/:id", async c => {
  requireSchema(c.env);
  const id = z.string().uuid().safeParse(c.req.param("id"));
  if (!id.success) throw new AppError(400, "BAD_REQUEST", "Invalid study session.");
  const row = firstRow(await database(c.env).execute<{ result: Saved; mode: string; created_at: string }>(sql`select result,mode,created_at from app_private.ai_requests where user_id=${currentUser(c).id}::uuid and idempotency_key=${id.data}::uuid and status='COMPLETED' and result ? 'text' and created_at>now()-interval '90 days'`));
  if (!row || row.result.deleted) throw new AppError(404, "NOT_FOUND", "Study session not found.");
  return c.json({ ...publicResult(id.data, row.result), mode: row.mode, prompt: row.result.prompt ?? "", mediaId: row.result.mediaId, fileName: row.result.fileName, createdAt: row.created_at });
});
aiRoutes.delete("/history/:id", async c => {
  requireSchema(c.env);
  const id = z.string().uuid().safeParse(c.req.param("id"));
  if (!id.success) throw new AppError(400, "BAD_REQUEST", "Invalid study session.");
  // Keep a content-free tombstone until the allowance window expires, so deletion
  // cannot be used to buy more provider calls or replay deleted private content.
  await database(c.env).execute(sql`update app_private.ai_requests set result='{"deleted":true,"version":2}'::jsonb where user_id=${currentUser(c).id}::uuid and idempotency_key=${id.data}::uuid and status<>'PROCESSING'`);
  return c.json({ deleted: true });
});
aiRoutes.post("/", async c => {
  requireSchema(c.env);
  const d = await input(c, requestSchema);
  if (!d.prompt && !d.mediaId) throw new AppError(400, "BAD_REQUEST", "Add a question or document.");
  if (d.mode === "timetable" && d.provider) throw new AppError(400, "BAD_REQUEST", "Provider selection is only available for study tools.", { reason: "AI_PROVIDER_SELECTION" });
  const u = currentUser(c), db = database(c.env);
  // Preserve hashes for all legacy requests and explicit Gemini requests. Only
  // the new, explicitly selected HF study route has an extra hash discriminator.
  const hash = await sha256(JSON.stringify([d.mode,d.prompt,d.mediaId ?? null,d.replyTo ?? null,...(d.mode !== "timetable" && d.provider === "huggingface" ? ["huggingface"] : [])]));
  const findRequest = async () => firstRow(await db.execute<RequestRow>(sql`select idempotency_key,request_hash,status,result,created_at from app_private.ai_requests where user_id=${u.id}::uuid and idempotency_key=${d.idempotencyKey}::uuid`));
  const cached = await findRequest();
  if (cached) return c.json(replay(cached, hash));
  let prompt = d.prompt, media: AIMedia | undefined, fileName: string | undefined;
  if (d.mediaId) {
    const m = firstRow(await db.execute<{ object_key: string; content_type: string; size_bytes: number; original_name: string }>(sql`select object_key,content_type,size_bytes,original_name from public.media_objects where id=${d.mediaId}::uuid and owner_user_id=${u.id}::uuid and kind='resource' and deleted_at is null`));
    if (!m || !c.env.PRIVATE_BUCKET) throw new AppError(404, "NOT_FOUND", "The attached document is not available. Reattach your source.");
    const mime = (m.content_type.split(";")[0] ?? "").toLowerCase();
    if (!AI_MIME_TYPES.has(mime)) throw new AppError(400, "BAD_REQUEST", "Use a PDF, JPEG, PNG, WebP or plain-text file for AI.");
    if (m.size_bytes > MAX_AI_MEDIA_BYTES) throw new AppError(413, "BAD_REQUEST", "Use a file smaller than 8 MB, or split it into smaller sections.");
    try { assertAIConfiguration(c.env, d.mode, mime, d.provider); } catch (e) { if (e instanceof AIProviderError) throw providerFailure(e); throw e; }
    const obj = await c.env.PRIVATE_BUCKET.get(m.object_key);
    if (!obj) throw new AppError(404, "NOT_FOUND", "The source file could not be found. Reattach it.");
    if (obj.size > MAX_AI_MEDIA_BYTES) throw new AppError(413, "BAD_REQUEST", "Use a file smaller than 8 MB.");
    const bytes = new Uint8Array(await obj.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_AI_MEDIA_BYTES) throw new AppError(400, "BAD_REQUEST", "This source file is empty or too large.");
    fileName = m.original_name;
    if (mime === "text/plain") {
      try { prompt += "\n\nAttached source material:\n" + new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new AppError(400, "BAD_REQUEST", "Use a UTF-8 text file or a PDF."); }
    } else {
      let binary = "";
      for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
      media = { mimeType: mime, data: btoa(binary) };
    }
  }
  try { assertAIConfiguration(c.env, d.mode, media?.mimeType, d.provider); } catch (e) { if (e instanceof AIProviderError) throw providerFailure(e); throw e; }
  const selectedProvider = selectAIProvider(d.mode, media?.mimeType, d.provider);
  let threadId = d.idempotencyKey;
  const history: AITurn[] = [];
  if (d.replyTo && d.mode !== "timetable") {
    const parent = firstRow(await db.execute<{ result: Saved }>(sql`select result from app_private.ai_requests where user_id=${u.id}::uuid and idempotency_key=${d.replyTo}::uuid and mode<>'timetable' and status='COMPLETED' and result ? 'text' and created_at>now()-interval '90 days'`));
    if (!parent || parent.result.deleted) throw new AppError(404, "NOT_FOUND", "The earlier study session is no longer available. Start a new session.");
    if ((parent.result.provider ?? "gemini") !== selectedProvider) throw new AppError(400, "BAD_REQUEST", "Start a new study when changing providers. Your previous conversation has not been shared with another provider.", { reason: "AI_PROVIDER_CONTEXT" });
    threadId = parent.result.threadId ?? d.replyTo;
    const turns = await db.execute<{ prompt: string; text: string }>(sql`select left(coalesce(result->>'prompt',''),2000) as prompt,left(result->>'text',4000) as text from app_private.ai_requests where user_id=${u.id}::uuid and coalesce(result->>'threadId',idempotency_key::text)=${threadId} and coalesce(result->>'provider','gemini')=${selectedProvider} and status='COMPLETED' and result ? 'text' and created_at>now()-interval '90 days' order by created_at desc limit 6`);
    history.push(...turns.rows.reverse());
  }
  if (new TextEncoder().encode(prompt + JSON.stringify(history)).length > 60000) throw new AppError(413, "BAD_REQUEST", "This study context is too long. Use a shorter source or start a new session.");
  const quota = await resolveAIQuota(c.env, u), day = aiDay();
  const saved: Saved = { version: 2, provider: selectedProvider, prompt: d.prompt, threadId, ...(d.mediaId ? { mediaId: d.mediaId } : {}), ...(fileName ? { fileName } : {}) };
  const client = sqlClient(c.env);
  // The lock is a separate statement: READ COMMITTED obtains a fresh snapshot
  // AFTER any wait. Putting lock + count in one CTE would race on stale snapshots.
  // Both allowance checks and the idempotency claim commit before provider I/O.
  // Exempt accounts skip only the personal daily cap, never the shared budget.
  const reservation = await client.transaction([
    client`select pg_advisory_xact_lock(734241)`,
    client`insert into app_private.ai_requests(user_id,idempotency_key,request_hash,mode,result)
      select ${u.id}::uuid,${d.idempotencyKey}::uuid,${hash},${d.mode},${JSON.stringify(saved)}::jsonb
      where (select count(*) from app_private.ai_requests where created_at>=(date_trunc('day',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos') and created_at<((date_trunc('day',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos') + interval '1 day'))<${quota.global}
      and (${quota.unlimited}::boolean or (select count(*) from app_private.ai_requests where user_id=${u.id}::uuid and created_at>=(date_trunc('day',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos') and created_at<((date_trunc('day',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos') + interval '1 day'))<${quota.user})
      on conflict do nothing returning idempotency_key`,
  ], { isolationLevel: "ReadCommitted" });
  if (!reservation[1]?.length) {
    const existing = await findRequest();
    if (existing) return c.json(replay(existing, hash));
    throw new AppError(429, "RATE_LIMITED", quota.unlimited ? "The shared AI service allowance has been reached. Your account has no personal daily cap, and your draft is kept." : "The daily AI allowance has been reached. Your draft is kept.", { reason: quota.unlimited ? "AI_GLOBAL_LIMIT" : "AI_DAILY_LIMIT", resetsAt: day.resetsAt });
  }
  const job = (async () => {
    try {
      const generated = await generateAI(c.env, { mode: d.mode, prompt, history, ...(d.provider ? { provider: d.provider } : {}), ...(media ? { media } : {}) });
      let result: Saved = { ...saved, provider: generated.provider };
      if (d.mode === "timetable") {
        const extracted = parseTimetableJSON(generated.text);
        const entries: unknown[] = [], warnings = [...extracted.warnings];
        for (const [i, raw] of extracted.entries.entries()) {
          if (!raw || typeof raw !== "object") { warnings.push(`Class ${i+1} was unreadable and needs manual entry.`); continue; }
          const r = raw as Record<string, unknown>;
          const normalized = { ...r, courseCode: r.courseCode ?? "", venue: r.venue ?? "", lecturer: r.lecturer ?? "", reminderMinutes: 15, reminderEnabled: true };
          const valid = timetableEntrySchema.safeParse(normalized);
          if (!valid.success || typeof r.startsAt !== "string" || typeof r.endsAt !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.startsAt) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.endsAt) || r.endsAt <= r.startsAt) {
            warnings.push(`Class ${i+1} has missing or invalid details; add or correct it manually.`); continue;
          }
          entries.push(valid.data);
        }
        result = { ...result, entries, warnings };
      } else result.text = generated.text;
      await db.execute(sql`update app_private.ai_requests set status='COMPLETED',result=${JSON.stringify(result)}::jsonb where user_id=${u.id}::uuid and idempotency_key=${d.idempotencyKey}::uuid and status='PROCESSING'`);
      return publicResult(d.idempotencyKey, result);
    } catch (caught) {
      const failure = caught instanceof AIProviderError ? caught : new AIProviderError(503, "AI_SAVE_FAILED", "The AI result could not be saved. Retry this same attempt to check for a saved result before starting another.");
      console.warn(JSON.stringify({ event: "ai.request.failed", requestId: c.get("requestId"), mode: d.mode, reason: failure.reason }));
      // A lost acknowledgement must not overwrite a result already committed.
      await db.execute(sql`update app_private.ai_requests set status='FAILED',result=${JSON.stringify({ ...saved, reason: failure.reason, message: failure.message })}::jsonb where user_id=${u.id}::uuid and idempotency_key=${d.idempotencyKey}::uuid and status='PROCESSING'`).catch(() => undefined);
      const error = providerFailure(failure);
      if (failure.reason === "AI_SAVE_FAILED") throw new AppError(error.status, error.code, error.message, { reason: failure.reason, retryWithNewKey: false });
      throw error;
    }
  })();
  try { c.executionCtx.waitUntil(job.catch(() => undefined)); } catch { /* Unit-test/request runtimes may not provide an execution context. */ }
  return c.json(await job);
});
