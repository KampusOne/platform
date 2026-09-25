import { Hono, type Context } from "hono";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { input, id } from "../lib/input";
import { sha256 } from "../lib/security";
import { AppError } from "../lib/errors";
import { currentUser, requireAuth } from "../middleware/auth";
import type { Bindings, Variables } from "../types";

type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;
type PublishingPost = { id: string; format: "POLL" | "QA" | "ANONYMOUS_QA"; body: string; closes_at: string | null; author_user_id: string; published_at: string };
export const publishingRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();
publishingRoutes.use("/publishing/*", requireAuth);
function school(c: AppContext) {
  const university = currentUser(c).universityId;
  if (!university) throw new AppError(409, "CONFLICT", "Complete your university profile before publishing.");
  return university;
}
async function post(c: AppContext) {
  const row = firstRow(await database(c.env).execute<PublishingPost>(sql`select p.id,x.format,p.body,x.closes_at,p.author_user_id,p.published_at from public.publishing_posts x join public.feed_posts p on p.id=x.post_id where p.id=${id(c.req.param("id") ?? "")}::uuid and p.university_id=${school(c)}::uuid and x.institution_id=${school(c)}::uuid and p.status in ('PUBLISHED','CORRECTED') and p.published_at<=now()`));
  if (!row) throw new AppError(404, "NOT_FOUND", "Post not found.");
  return row;
}
function ensureOwner(c: AppContext, row: PublishingPost) {
  if (row.author_user_id !== currentUser(c).id) throw new AppError(403, "FORBIDDEN", "Only the publisher can open this inbox or publish a response.");
}
const format = z.enum(["POLL", "QA", "ANONYMOUS_QA"]);
function failOutcome(outcome: string | undefined) {
  if (outcome === "FORBIDDEN") throw new AppError(403, "FORBIDDEN", "This publishing format has not been enabled for your account.");
  if (outcome === "LIMIT") throw new AppError(429, "RATE_LIMITED", "Please wait before submitting again.");
  if (outcome === "NOT_FOUND") throw new AppError(404, "NOT_FOUND", "Post not found.");
  if (outcome === "CLOSED") throw new AppError(409, "CONFLICT", "This post has closed for new responses.");
  if (outcome === "WRONG_FORMAT") throw new AppError(400, "BAD_REQUEST", "This post does not accept answers.");
  if (outcome === "CONFLICT") throw new AppError(409, "CONFLICT", "That request reference belongs to different content.");
  if (!outcome || !["CREATED", "EXISTING"].includes(outcome)) throw new AppError(503, "PROVIDER_UNAVAILABLE", "Your submission could not be saved.");
}

publishingRoutes.get("/publishing/capabilities", async c => {
  const university = currentUser(c).universityId;
  if (!university) return c.json({ formats: [] });
  const rows = await database(c.env).execute<{ capability: string }>(sql`select capability from app_private.publishing_capabilities where user_id=${currentUser(c).id}::uuid and institution_id=${university}::uuid and revoked_at is null order by capability`);
  return c.json({ formats: rows.rows.map(r => r.capability) });
});
publishingRoutes.post("/publishing/posts", async c => {
  if (c.env.UNIFIED_SCHEMA_READY !== "true") throw new AppError(503, "PROVIDER_UNAVAILABLE", "Publishing is awaiting the server update.");
  const data = await input(c, z.object({ requestId: z.string().uuid(), format, body: z.string().trim().min(1).max(5000), options: z.array(z.string().trim().min(1).max(100)).min(2).max(6).optional(), closesAt: z.string().datetime({ offset: true }).optional() }).strict());
  if (data.format === "POLL" && (!data.options || new Set(data.options.map(x => x.toLowerCase())).size !== data.options.length)) throw new AppError(400, "BAD_REQUEST", "Add two to six distinct poll options.");
  if (data.format !== "POLL" && data.options) throw new AppError(400, "BAD_REQUEST", "Only polls have answer options.");
  if (data.closesAt && Date.parse(data.closesAt) > Date.now() + 30 * 86400000) throw new AppError(400, "BAD_REQUEST", "Choose a closing time within the next 30 days.");
  const closeTime = data.closesAt ? new Date(data.closesAt).toISOString() : null;
  const hash = await sha256(JSON.stringify([school(c), data.format, data.body, data.options ?? null, closeTime]));
  const saved = firstRow(await database(c.env).execute<{ outcome: string; id: string }>(sql`select * from app_private.create_publishing_post(${currentUser(c).id}::uuid,${school(c)}::uuid,${data.requestId}::uuid,${hash},${data.format},${data.body},${data.options ? JSON.stringify(data.options) : null}::jsonb,${closeTime}::timestamptz)`));
  failOutcome(saved?.outcome);
  return c.json({ id: saved!.id }, saved!.outcome === "CREATED" ? 201 : 200);
});
publishingRoutes.get("/publishing/posts/:id", async c => {
  const row = await post(c);
  const db = database(c.env);
  const options = row.format === "POLL" ? await db.execute(sql`select o.id,o.label,count(v.user_id)::int votes from public.poll_options o left join app_private.poll_votes v on v.post_id=o.post_id and v.option_id=o.id where o.post_id=${row.id}::uuid group by o.id,o.label order by o.id`) : { rows: [] };
  const vote = row.format === "POLL" ? firstRow(await db.execute<{ option_id: number }>(sql`select option_id from app_private.poll_votes where post_id=${row.id}::uuid and user_id=${currentUser(c).id}::uuid`)) : undefined;
  const answers = row.format !== "POLL" ? await db.execute(sql`select a.id,a.body,a.publisher_reply as reply,a.status,a.created_at,a.published_at,case when ${row.format}='ANONYMOUS_QA' then null else p.display_name end author_name from public.publishing_answers a join app_private.publishing_answer_owners o on o.answer_id=a.id left join public.profiles p on p.user_id=o.user_id and p.deleted_at is null where a.post_id=${row.id}::uuid and a.institution_id=${school(c)}::uuid and a.status='PUBLISHED' order by a.published_at desc,a.id limit 100`) : { rows: [] };
  return c.json({ post: { id: row.id, format: row.format, body: row.body, closes_at: row.closes_at, published_at: row.published_at, is_owner: row.author_user_id === currentUser(c).id }, options: options.rows, myVote: vote?.option_id ?? null, answers: answers.rows, disclosure: row.format === "ANONYMOUS_QA" ? "Your answer is private to the publisher until they choose to publish it with their reply. Your account name is hidden from the publisher and public. KampusOne keeps a protected account link for moderation. Avoid identifying yourself in your answer." : row.format === "QA" ? "Your answer and account name are visible to the publisher. They may publish your answer and name with their reply. Your answer remains private until then." : "One vote per account. Votes cannot be changed; only totals are displayed." });
});
publishingRoutes.post("/publishing/posts/:id/vote", async c => {
  const row = await post(c);
  if (row.format !== "POLL") throw new AppError(400, "BAD_REQUEST", "This post is not a poll.");
  const data = await input(c, z.object({ optionId: z.number().int().min(1).max(6) }).strict());
  const db = database(c.env);
  const existing = firstRow(await db.execute<{ option_id: number }>(sql`select option_id from app_private.poll_votes where post_id=${row.id}::uuid and user_id=${currentUser(c).id}::uuid`));
  if (existing) {
    if (existing.option_id !== data.optionId) throw new AppError(409, "CONFLICT", "You have already voted in this poll.");
    return c.json({ status: "voted", optionId: data.optionId });
  }
  const saved = firstRow(await db.execute<{ option_id: number }>(sql`insert into app_private.poll_votes(post_id,user_id,option_id) select o.post_id,${currentUser(c).id}::uuid,o.id from public.poll_options o join public.publishing_posts x on x.post_id=o.post_id join public.feed_posts p on p.id=x.post_id where o.post_id=${row.id}::uuid and o.id=${data.optionId} and x.institution_id=${school(c)}::uuid and p.university_id=${school(c)}::uuid and p.status in('PUBLISHED','CORRECTED') and (x.closes_at is null or x.closes_at>now()) on conflict(post_id,user_id) do update set option_id=app_private.poll_votes.option_id returning option_id`));
  if (!saved) throw new AppError(409, "CONFLICT", "The poll has closed or that option is unavailable.");
  if (saved.option_id !== data.optionId) throw new AppError(409, "CONFLICT", "You have already voted in this poll.");
  return c.json({ status: "voted", optionId: saved.option_id });
});
publishingRoutes.post("/publishing/posts/:id/answers", async c => {
  const data = await input(c, z.object({ body: z.string().trim().min(1).max(3000), requestId: z.string().uuid(), acceptPublication: z.literal(true) }).strict());
  const target = id(c.req.param("id") ?? "");
  const hash = await sha256(JSON.stringify([school(c), target, data.body]));
  const saved = firstRow(await database(c.env).execute<{ outcome: string; id: string }>(sql`select * from app_private.submit_publishing_answer(${currentUser(c).id}::uuid,${school(c)}::uuid,${target}::uuid,${data.requestId}::uuid,${hash},${data.body})`));
  failOutcome(saved?.outcome);
  const answer = firstRow(await database(c.env).execute<{ status: string }>(sql`select status from public.publishing_answers where id=${saved!.id}::uuid`));
  return c.json({ id: saved!.id, status: answer?.status ?? "PRIVATE" }, saved!.outcome === "CREATED" ? 201 : 200);
});
publishingRoutes.get("/publishing/posts/:id/inbox", async c => {
  const row = await post(c); ensureOwner(c, row);
  if (row.format === "POLL") throw new AppError(400, "BAD_REQUEST", "Polls do not have an answer inbox.");
  const answers = await database(c.env).execute(sql`select a.id,a.body,a.publisher_reply as reply,a.status,a.created_at,a.published_at,case when ${row.format}='ANONYMOUS_QA' then null else p.display_name end author_name from public.publishing_answers a join app_private.publishing_answer_owners o on o.answer_id=a.id left join public.profiles p on p.user_id=o.user_id and p.deleted_at is null where a.post_id=${row.id}::uuid and a.institution_id=${school(c)}::uuid and a.status<>'DELETED' order by a.created_at desc,a.id limit 100`);
  return c.json({ answers: answers.rows });
});
publishingRoutes.post("/publishing/posts/:id/answers/:answerId/publish", async c => {
  const row = await post(c); ensureOwner(c, row);
  const data = await input(c, z.object({ reply: z.string().trim().min(1).max(3000) }).strict());
  const saved = firstRow(await database(c.env).execute(sql`update public.publishing_answers set status='PUBLISHED',publisher_reply=${data.reply},published_at=coalesce(published_at,now()) where id=${id(c.req.param("answerId"))}::uuid and post_id=${row.id}::uuid and institution_id=${school(c)}::uuid and status<>'DELETED' and publication_consent_at is not null returning id,status`));
  if (!saved) throw new AppError(404, "NOT_FOUND", "Answer not found.");
  return c.json(saved);
});
publishingRoutes.delete("/publishing/posts/:id/answers/:answerId", async c => {
  const row = await post(c);
  const user = currentUser(c).id;
  const removed = firstRow(await database(c.env).execute(sql`update public.publishing_answers a set status='DELETED',body='[removed]',publisher_reply=null,deleted_at=coalesce(deleted_at,now()) where a.id=${id(c.req.param("answerId"))}::uuid and a.post_id=${row.id}::uuid and a.institution_id=${school(c)}::uuid and (${row.author_user_id}::uuid=${user}::uuid or exists(select 1 from app_private.publishing_answer_owners o where o.answer_id=a.id and o.user_id=${user}::uuid)) returning a.id`));
  if (!removed) throw new AppError(404, "NOT_FOUND", "Answer not found.");
  return c.json({ status: "deleted" });
});
