import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z, timetableEntrySchema } from "@kampusone/contracts";
import { database, firstRow, sqlClient } from "../lib/database";
import { input } from "../lib/input";
import { sha256 } from "../lib/security";
import { AppError } from "../lib/errors";
import { requireAuth, currentUser } from "../middleware/auth";
import { aiDay, AI_HISTORY_DAYS, AI_MIME_TYPES, MAX_AI_MEDIA_BYTES, AIProviderError, assertAIConfiguration, generateAI, parseTimetableJSON, providerConfiguration, selectAIProvider, type AIMedia, type AITurn } from "../lib/ai-provider";
import { isStudyGeneration, studentAIPolicy, studentAIUsage, studentExperienceReady } from "../lib/student-ai-policy";
import { extractAIPdf } from "../lib/ai-document";
import { runStudentAssistant, classDraftSchema, type AICard, type AIAction } from "../lib/student-ai-tools";
import type { Bindings, Variables } from "../types";

export const aiRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();
aiRoutes.use("/*", requireAuth);
aiRoutes.use("/*", async (c, next) => { c.header("Cache-Control", "private, no-store"); await next(); });
const modes = z.enum(["study", "summary", "quiz", "notes", "timetable"]);
const requestSchema = z.object({ mode: modes, provider: z.literal("huggingface").optional(), tier: z.enum(["standard", "pro"]).default("standard"), prompt: z.string().trim().max(20000), mediaId: z.string().uuid().optional(), replyTo: z.string().uuid().optional(), idempotencyKey: z.string().uuid(), consent: z.literal(true) }).strict();
type Saved = { tier?: string; cards?: AICard[]; actions?: AIAction[]; version?: number; text?: string; entries?: unknown[]; warnings?: string[]; prompt?: string; mediaId?: string; fileName?: string; threadId?: string; provider?: string; deleted?: boolean; reason?: string; message?: string };
type RequestRow = { idempotency_key: string; request_hash: string; status: string; result: Saved | null; created_at: string };
function requireSchema(env: Bindings) {
  if (env.UNIFIED_SCHEMA_READY !== "true") throw new AppError(503, "PROVIDER_UNAVAILABLE", "AI storage is not ready. Your draft has not been submitted.", { reason: "AI_SCHEMA_NOT_READY" });
}
function publicResult(id: string, value: Saved) {
  return { requestId: id, threadId: value.threadId ?? id, tier: value.tier ?? "standard", cards: value.cards ?? [], actions: value.actions ?? [], ...(typeof value.text === "string" ? { text: value.text } : {}), ...(Array.isArray(value.entries) ? { entries: value.entries, warnings: value.warnings ?? [] } : {}) };
}
function replay(row: RequestRow, hash: string) {
  if (row.request_hash !== hash) throw new AppError(409, "CONFLICT", "This request reference belongs to a different draft.", { reason: "AI_REQUEST_CONFLICT" });
  if ((row.result?.version ?? 0) >= 2 && Date.now() - new Date(row.created_at).getTime() > AI_HISTORY_DAYS * 86400000) throw new AppError(410, "NOT_FOUND", "This AI result has expired. Start a new request.", { reason: "AI_EXPIRED", retryWithNewKey: true });
  if (row.result?.deleted) throw new AppError(410, "NOT_FOUND", "This saved result has been deleted.", { reason: "AI_DELETED", retryWithNewKey: true });
  if (row.status === "COMPLETED" && row.result) return publicResult(row.idempotency_key, row.result);
  if (row.status === "FAILED") throw new AppError(503, "PROVIDER_UNAVAILABLE", row.result?.message ?? "That attempt did not finish. Start a new attempt when ready.", { reason: row.result?.reason ?? "AI_FAILED", retryWithNewKey: true });
  const stale = Date.now() - new Date(row.created_at).getTime() > 120000;
  throw new AppError(409, "CONFLICT", stale ? "That attempt did not finish in time. Your draft is kept; try again." : "This request is still processing. Retry to check the same attempt; do not submit it again.", { reason: stale ? "AI_STALE_REQUEST" : "AI_PROCESSING", retryWithNewKey: stale });
}
function providerFailure(error: AIProviderError) {
  return new AppError(error.status, error.status === 429 ? "RATE_LIMITED" : error.status === 400 || error.status === 422 ? "BAD_REQUEST" : "PROVIDER_UNAVAILABLE", error.message, { reason: error.reason, retryWithNewKey: true });
}
aiRoutes.get("/status", async c => {
  const ready = await studentExperienceReady(c.env);
  const enabled = c.env.AI_ASSISTANT_ENABLED === "true" && ready;
  const quota = await studentAIPolicy(c.env, currentUser(c));
  const usage = c.env.UNIFIED_SCHEMA_READY === "true" ? await studentAIUsage(c.env, currentUser(c).id) : null;
  // Provider credentials, model IDs, internal limits and normal Ask counters never leave the Worker.
  return c.json({ enabled, historyDays: AI_HISTORY_DAYS, maxFileBytes: MAX_AI_MEDIA_BYTES,
    capabilities: { text: enabled && providerConfiguration(c.env,"study").configured,
      images: enabled && providerConfiguration(c.env,"study","image/jpeg").configured,
      documents: enabled && providerConfiguration(c.env,"summary").configured },
    tier: quota.pro ? "pro" : "standard",
    study: { limit: quota.study, remaining: quota.unlimited || quota.pro ? null : Math.max(0,quota.study-Number(usage?.study_used ?? 0)) },
    subscription: { cadence: "monthly", checkoutEnabled: false, available: false },
  });
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
aiRoutes.get("/thread/:id", async c => {
  requireSchema(c.env);
  const id = z.string().uuid().safeParse(c.req.param("id"));
  if (!id.success) throw new AppError(400,"BAD_REQUEST","Invalid conversation.");
  const user = currentUser(c);
  const parent = firstRow(await database(c.env).execute<{ result: Saved }>(sql`select result from app_private.ai_requests where user_id=${user.id}::uuid and idempotency_key=${id.data}::uuid and status='COMPLETED' and result ? 'text' and created_at>now()-interval '90 days'`));
  if (!parent) throw new AppError(404,"NOT_FOUND","Conversation not found.");
  const rows = await database(c.env).execute<{ idempotency_key: string; result: Saved; mode: string }>(sql`select idempotency_key,result,mode from app_private.ai_requests where user_id=${user.id}::uuid and coalesce(result->>'threadId',idempotency_key::text)=${parent.result.threadId ?? id.data} and status='COMPLETED' and result ? 'text' and created_at>now()-interval '90 days' order by created_at desc,idempotency_key desc limit 60`);
  return c.json({ turns: rows.rows.reverse().map(row=>({...publicResult(row.idempotency_key,row.result),prompt:row.result.prompt ?? "",fileName:row.result.fileName,mediaId:row.result.mediaId,mode:row.mode})) });
});
// Mutations accept only the IDs of a server-stored proposal. No client-supplied account,
// arbitrary tool, SQL, URL, course contents, or permission claims can be executed.
aiRoutes.post("/actions/confirm", async c => {
  requireSchema(c.env);
  if (c.env.AI_ASSISTANT_ENABLED!=="true" || !await studentExperienceReady(c.env)) throw new AppError(503,"PROVIDER_UNAVAILABLE","Timetable actions are not available right now.");
  const d = await input(c,z.object({requestId:z.string().uuid(),actionId:z.string().uuid()}).strict());
  const u=currentUser(c);
  if (!u.universityId) throw new AppError(400,"BAD_REQUEST","Complete your university profile first.");
  const saved=firstRow(await database(c.env).execute<{result:Saved}>(sql`select result from app_private.ai_requests where user_id=${u.id}::uuid and idempotency_key=${d.requestId}::uuid and mode='study' and status='COMPLETED' and created_at>now()-interval '1 day' and result ? 'text'`));
  const action=saved?.result.actions?.find(a=>a.id===d.actionId && a.type==='timetable');
  if(!action) throw new AppError(404,"NOT_FOUND","This class preview has expired or was deleted. Ask again to create a new one.");
  const valid=classDraftSchema.safeParse(action.entry);
  if(!valid.success) throw new AppError(400,"BAD_REQUEST","This class preview is invalid. Nothing was changed.");
  const e=valid.data;
  // Idempotent confirmation returns success even when the class time has since passed.
  const existing=firstRow(await database(c.env).execute(sql`select id from public.timetable_entries where id=${d.actionId}::uuid and user_id=${u.id}::uuid`));
  if(existing) return c.json({saved:true,id:d.actionId});
  if(e.date && Date.parse(e.date+'T'+e.startsAt+':00+01:00')<=Date.now()) throw new AppError(400,"BAD_REQUEST","This class start time has passed. Ask for a new preview.");
  const client=sqlClient(c.env);
  const results=await client.transaction([
    client`select pg_advisory_xact_lock(hashtextextended(${u.id},241))`,
    client`insert into public.timetable_entries(id,university_id,user_id,title,course_code,venue,lecturer,day_of_week,starts_at,ends_at,reminder_minutes,reminder_enabled,occurs_on)
      select ${d.actionId}::uuid,${u.universityId}::uuid,${u.id}::uuid,${e.title},${e.courseCode ?? ''},${e.venue ?? ''},${e.lecturer ?? ''},${e.dayOfWeek},${e.startsAt}::time,${e.endsAt}::time,${e.reminderMinutes},${e.reminderEnabled},${e.date ?? null}::date
      where exists(select 1 from app_private.ai_requests where user_id=${u.id}::uuid and idempotency_key=${d.requestId}::uuid and result ? 'text')
      on conflict do nothing returning id`,
    client`select id from public.timetable_entries where id=${d.actionId}::uuid and user_id=${u.id}::uuid`,
  ],{isolationLevel:'ReadCommitted'});
  if(!results[2]?.length) throw new AppError(409,"CONFLICT","A matching class already exists, or the preview was removed. Check your timetable before adding another.");
  // The timetable insert is the authoritative success; a lost confirmation response
  // can be retried safely using the same action ID.
  return c.json({saved:true,id:d.actionId});
});
aiRoutes.delete("/history/:id", async c => {
  requireSchema(c.env);
  const id = z.string().uuid().safeParse(c.req.param("id"));
  if (!id.success) throw new AppError(400, "BAD_REQUEST", "Invalid study session.");
  // Keep a content-free tombstone until the allowance window expires, so deletion
  // cannot be used to buy more provider calls or replay deleted private content.
  await database(c.env).execute(sql`update app_private.ai_requests set result='{"deleted":true,"version":3}'::jsonb where user_id=${currentUser(c).id}::uuid and idempotency_key=${id.data}::uuid and status<>'PROCESSING'`);
  return c.json({ deleted: true });
});
aiRoutes.post("/", async c => {
  requireSchema(c.env);
  const d = await input(c, requestSchema);
  if (!d.prompt && !d.mediaId) throw new AppError(400, "BAD_REQUEST", "Add a question or document.");
  if(!await studentExperienceReady(c.env)) throw new AppError(503,"PROVIDER_UNAVAILABLE","AI is being updated. Your draft is kept.");
  const u = currentUser(c), db = database(c.env);
  const hash = await sha256(JSON.stringify([3,d.mode,d.prompt,d.mediaId ?? null,d.replyTo ?? null,d.tier]));
  const findRequest = async () => firstRow(await db.execute<RequestRow>(sql`select idempotency_key,request_hash,status,result,created_at from app_private.ai_requests where user_id=${u.id}::uuid and idempotency_key=${d.idempotencyKey}::uuid`));
  const cached = await findRequest();
  if (cached) return c.json(replay(cached, hash));
  const quota = await studentAIPolicy(c.env, u), day = aiDay();
  if(d.tier==='pro' && !quota.pro) throw new AppError(403,"FORBIDDEN","Pro requires an active monthly plan.",{reason:"AI_PRO_REQUIRED",upgrade:true});
  try { assertAIConfiguration(c.env,d.mode,undefined,undefined,d.tier); } catch(e) {if(e instanceof AIProviderError)throw providerFailure(e);throw e;}
  const preflight=firstRow(await db.execute<{allowed:boolean}>(sql`select app_private.consume_request_rate_limit('AI_INPUT',${await sha256(u.id)},${quota.unlimited?180:quota.pro?120:60},900,900) as allowed`));
  if(!preflight?.allowed){c.header('Retry-After','900');throw new AppError(429,"RATE_LIMITED","Too many attempts. Your draft is kept; try again shortly.",{reason:"AI_INPUT_LIMIT",resetsAt:new Date(Date.now()+900000).toISOString(),retryAfter:900});}
  let prompt = d.prompt, media: AIMedia | undefined, fileName: string | undefined;
  if (d.mediaId) {
    const m = firstRow(await db.execute<{ object_key: string; content_type: string; size_bytes: number; original_name: string }>(sql`select object_key,content_type,size_bytes,original_name from public.media_objects where id=${d.mediaId}::uuid and owner_user_id=${u.id}::uuid and kind='resource' and deleted_at is null`));
    if (!m || !c.env.PRIVATE_BUCKET) throw new AppError(404, "NOT_FOUND", "The attached document is not available. Reattach your source.");
    const mime = (m.content_type.split(";")[0] ?? "").toLowerCase();
    if (!AI_MIME_TYPES.has(mime)) throw new AppError(400, "BAD_REQUEST", "Use a PDF, JPEG, PNG, WebP or plain-text file for AI.");
    if (m.size_bytes > MAX_AI_MEDIA_BYTES) throw new AppError(413, "BAD_REQUEST", "Use a file smaller than 8 MB, or split it into smaller sections.");
    try { assertAIConfiguration(c.env, d.mode, mime, undefined,d.tier); } catch (e) { if (e instanceof AIProviderError) throw providerFailure(e); throw e; }
    const obj = await c.env.PRIVATE_BUCKET.get(m.object_key);
    if (!obj) throw new AppError(404, "NOT_FOUND", "The source file could not be found. Reattach it.");
    if (obj.size > MAX_AI_MEDIA_BYTES) throw new AppError(413, "BAD_REQUEST", "Use a file smaller than 8 MB.");
    const bytes = new Uint8Array(await obj.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_AI_MEDIA_BYTES) throw new AppError(400, "BAD_REQUEST", "This source file is empty or too large.");
    fileName = m.original_name;
    if (mime === "application/pdf") {
      try { prompt += "\n\nAttached source material (untrusted):\n" + await extractAIPdf(bytes); }
      catch(e) { if(e instanceof AIProviderError) throw providerFailure(e); throw e; }
    } else if (mime === "text/plain") {
      try { prompt += "\n\nAttached source material:\n" + new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { throw new AppError(400, "BAD_REQUEST", "Use a UTF-8 text file or a PDF."); }
    } else {
      let binary = "";
      for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
      media = { mimeType: mime, data: btoa(binary) };
    }
  }
  try { assertAIConfiguration(c.env, d.mode, media?.mimeType, undefined,d.tier); } catch (e) { if (e instanceof AIProviderError) throw providerFailure(e); throw e; }
  const selectedProvider = selectAIProvider(d.mode, media?.mimeType, d.provider);
  let threadId = d.idempotencyKey;
  const history: AITurn[] = [];
  if (d.replyTo && d.mode !== "timetable") {
    const parent = firstRow(await db.execute<{ result: Saved }>(sql`select result from app_private.ai_requests where user_id=${u.id}::uuid and idempotency_key=${d.replyTo}::uuid and mode<>'timetable' and status='COMPLETED' and result ? 'text' and created_at>now()-interval '90 days'`));
    if (!parent || parent.result.deleted) throw new AppError(404, "NOT_FOUND", "The earlier study session is no longer available. Start a new session.");
    if (parent.result.provider !== selectedProvider) throw new AppError(400, "BAD_REQUEST", "Start a new conversation to use the updated AI. Your previous conversation has not been forwarded.", { reason: "AI_PROVIDER_CONTEXT" });
    threadId = parent.result.threadId ?? d.replyTo;
    const turns = await db.execute<{ prompt: string; text: string }>(sql`select left(coalesce(result->>'prompt',''),2000) as prompt,left(result->>'text',4000) as text from app_private.ai_requests where user_id=${u.id}::uuid and coalesce(result->>'threadId',idempotency_key::text)=${threadId} and result->>'provider'=${selectedProvider} and status='COMPLETED' and result ? 'text' and created_at>now()-interval '90 days' order by created_at desc limit 6`);
    history.push(...turns.rows.reverse());
  }
  if (new TextEncoder().encode(prompt + JSON.stringify(history)).length > 60000) throw new AppError(413, "BAD_REQUEST", "This study context is too long. Use a shorter source or start a new session.");
  const saved: Saved = { version: 3, tier: d.tier, provider: selectedProvider, prompt: d.prompt, threadId, ...(d.mediaId ? { mediaId: d.mediaId } : {}), ...(fileName ? { fileName } : {}) };
  const client = sqlClient(c.env);
  // The lock is a separate statement: READ COMMITTED obtains a fresh snapshot
  // AFTER any wait. Putting lock + count in one CTE would race on stale snapshots.
  // Both allowance checks and the idempotency claim commit before provider I/O.
  // Exempt accounts skip only the personal daily cap, never the shared budget.
  const reservation = await client.transaction([
    client`select pg_advisory_xact_lock(734241)`,
    client`update app_private.ai_requests set status='FAILED',result=result || '{"reason":"AI_TIMEOUT","message":"This attempt timed out. Your draft is kept."}'::jsonb where user_id=${u.id}::uuid and status='PROCESSING' and created_at<now()-interval '2 minutes'`,
    client`insert into app_private.ai_requests(user_id,idempotency_key,request_hash,mode,result)
      select ${u.id}::uuid,${d.idempotencyKey}::uuid,${hash},${d.mode},${JSON.stringify(saved)}::jsonb
      where (select count(*) from app_private.ai_requests where created_at>=${day.startsAt}::timestamptz)<${quota.global}
      and (${quota.unlimited}::boolean or (
        (select count(*) from app_private.ai_requests where user_id=${u.id}::uuid and created_at>now()-interval '15 minutes')<${quota.pro ? 90 : 30}
        and (${d.mode!=='study'}::boolean or (select count(*) from app_private.ai_requests where user_id=${u.id}::uuid and mode='study' and created_at>now()-interval '15 minutes')<${quota.pro ? 60 : quota.chat})
        and (${!isStudyGeneration(d.mode)}::boolean or (select count(*) from app_private.ai_requests where user_id=${u.id}::uuid and mode in ('summary','notes','quiz') and status in ('COMPLETED','PROCESSING') and (not ${quota.pro}::boolean or created_at>=date_trunc('month',now())))<${quota.pro ? 100 : quota.study})
        and (${d.mode!=='timetable'}::boolean or (select count(*) from app_private.ai_requests where user_id=${u.id}::uuid and mode='timetable' and created_at>=${day.startsAt}::timestamptz)<${quota.user})
      )) on conflict do nothing returning idempotency_key`,
  ], { isolationLevel: "ReadCommitted" });
  if (!reservation[2]?.length) {
    const existing = await findRequest();
    if (existing) return c.json(replay(existing, hash));
    const usage=await studentAIUsage(c.env,u.id);
    if(Number(usage.total)>=quota.global) throw new AppError(429,"RATE_LIMITED","AI is at capacity for today. Your draft is kept.",{reason:"AI_GLOBAL_LIMIT",resetsAt:day.resetsAt});
    if(!quota.unlimited && !quota.pro && isStudyGeneration(d.mode) && Number(usage.study_used)>=quota.study) throw new AppError(429,"RATE_LIMITED",`You've used your ${quota.study} study trials. Summary and Notes share the same allowance.`,{reason:"AI_STUDY_LIMIT",upgrade:true});
    if(!quota.unlimited && d.mode==='timetable' && Number(usage.timetable_used)>=quota.user) throw new AppError(429,"RATE_LIMITED","Today's timetable import allowance is used. You can still add classes manually.",{reason:"AI_TIMETABLE_LIMIT",resetsAt:day.resetsAt});
    if(!quota.unlimited && quota.pro && isStudyGeneration(d.mode) && Number(usage.month_used)>=100) {const date=new Date();const nextMonth=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1));throw new AppError(429,"RATE_LIMITED","This month's study allowance is used. Your saved studies remain available.",{reason:"AI_STUDY_MONTH_LIMIT",resetsAt:nextMonth.toISOString()});}
    const resetsAt=d.mode==='study' && Number(usage.chat_used)>=(quota.pro?60:quota.chat) && usage.chat_resets_at ? new Date(usage.chat_resets_at).toISOString() : usage.burst_resets_at ? new Date(usage.burst_resets_at).toISOString() : new Date(Date.now()+15*60000).toISOString();
    const retryAfter=Math.max(1,Math.ceil((Date.parse(resetsAt)-Date.now())/1000));
    c.header('Retry-After',String(retryAfter));
    throw new AppError(429,"RATE_LIMITED","You've reached your current usage limit. Your draft is kept.",{reason:"AI_CHAT_LIMIT",resetsAt,retryAfter,upgrade:!quota.pro});
  }
  const job = (async () => {
    try {
      const aiInput={mode:d.mode,prompt,history,tier:d.tier,...(media ? {media} : {})};
      const generated = d.mode==='study' ? await runStudentAssistant(c.env,u,aiInput) : await generateAI(c.env,aiInput);
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
      } else {
        result.text = generated.text;
        if ('cards' in generated) result.cards=generated.cards as AICard[];
        if ('actions' in generated) result.actions=generated.actions as AIAction[];
      }
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
