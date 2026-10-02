import { Hono } from "hono";
import { sql, type SQL } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { requireAuth, currentUser } from "../middleware/auth";
import { AppError } from "../lib/errors";
import { sha256 } from "../lib/security";
import {
  commentRepliesSchemaReady,
  socialSchemaReady,
  visiblePost,
} from "../lib/feed-social";
import { feedExperienceReady } from "../lib/feed-experience";
import { profileSafetyReady, unblockedAuthor } from "../lib/profile-safety";
import { feedPostProjection, feedPostJoins, publishingFeedReady } from "./feed-social";
import type { Bindings, Variables } from "../types";
export const discoveryRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();
const date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (v) =>
        Number.isFinite(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v,
    ),
  querySchema = z
    .object({
      q: z.string().trim().max(200).default(""),
      tab: z.enum(["TOP", "LATEST", "PEOPLE", "MEDIA"]).default("TOP"),
      from: z
        .string()
        .trim()
        .regex(/^@?[A-Za-z0-9_.]{1,40}$/)
        .optional(),
      since: date.optional(),
      until: date.optional(),
      language: z
        .enum(["ANY", "en", "pcm", "yo", "ig", "ha", "und"])
        .default("ANY"),
      activity: z
        .enum(["ALL", "FOLLOWING", "LIKED", "REPLIED", "REPOSTED"])
        .default("ALL"),
      excludeReplies: z.enum(["true", "false"]).default("false"),
      cursor: z.string().max(1200).optional(),
    })
    .strict();
type Cursor = {
  key: string;
  score: number;
  at: string;
  id: string;
  kind: string;
  name?: string | undefined;
};
function cursor(value: string | undefined, key: string): Cursor | null {
  if (!value) return null;
  try {
    const p = z
      .object({
        key: z.literal(key),
        score: z.number().finite().min(0),
        at: z.string().datetime({ offset: true }),
        id: z.string().uuid(),
        kind: z.enum(["POST", "REPLY", "PERSON"]),
        name: z.string().max(200).optional(),
      })
      .strict()
      .parse(JSON.parse(atob(value)));
    return p;
  } catch {
    throw new AppError(
      400,
      "BAD_REQUEST",
      "That search page expired or its filters changed. Start the search again.",
    );
  }
}
const escaped = (v: string) => v.replace(/[\\%_]/g, "\\$&");
discoveryRoutes.get("/search", requireAuth, async (c) => {
  c.header("Cache-Control", "private, no-store");
  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "Check your search terms, date range and filters.",
    );
  const d = parsed.data,
    user = currentUser(c);
  if (!user.universityId)
    throw new AppError(409, "CONFLICT", "Choose your campus before searching.");
  if (d.since && d.until && d.since > d.until)
    throw new AppError(
      400,
      "BAD_REQUEST",
      "The start date must come before the end date.",
    );
  const readiness = await Promise.all([
    socialSchemaReady(c.env),
    profileSafetyReady(c.env),
    commentRepliesSchemaReady(c.env),
  ]);
  if (readiness.some((value) => !value))
    return c.json({
      ready: false,
      tab: d.q.startsWith("@") ? "PEOPLE" : d.tab,
      results: [],
      nextCursor: null,
    });
  const effectiveTab = d.q.startsWith("@") ? "PEOPLE" : d.tab,
    term = d.q.replace(/^@/, "").trim(),
    from = d.from?.replace(/^@/, "").toLowerCase() ?? null;
  const key = await sha256(
      JSON.stringify({
        user: user.id,
        campus: user.universityId,
        ...d,
        tab: effectiveTab,
        from,
        cursor: undefined,
      }),
    ),
    after = cursor(d.cursor, key);
  if (!d.q)
    return c.json({
      ready: true,
      tab: effectiveTab,
      results: [],
      nextCursor: null,
    });
  const allowed = firstRow(
    await database(c.env).execute<{ allowed: boolean }>(
      sql`select app_private.consume_request_rate_limit('FEED_SEARCH',${user.id},600,3600,3600) as allowed`,
    ),
  );
  if (!allowed?.allowed)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Please wait before searching again.",
    );
  const limit = 30;
  if (effectiveTab === "PEOPLE") {
    const prefix = d.q.startsWith("@"),
      pattern = prefix ? escaped(term) + "%" : "%" + escaped(term) + "%";
    const rows = await database(c.env).execute<{
      id: string;
      name_key: string;
      created_at: string;
      result: unknown;
    }>(sql`
   select p.user_id as id,lower(coalesce(p.username,p.user_id::text)) as name_key,u.created_at,
    jsonb_build_object('kind','PERSON','id',p.user_id,'name',p.display_name,'username',p.username,'avatarUrl',p.profile_image_url,'bio',p.biography,
     'verified',coalesce((to_jsonb(p)->>'public_badge_verified')::boolean,p.verification_status::text='VERIFIED',false),'university',university.name,
     'followed',exists(select 1 from public.profile_follows f where f.follower_id=${user.id}::uuid and f.followed_id=p.user_id)) as result
   from public.profiles p join public.users u on u.id=p.user_id and u.status::text='ACTIVE'
   left join public.universities university on university.id=p.university_id
   where p.deleted_at is null and ${unblockedAuthor(user.id, sql`p.user_id`)} and coalesce(p.settings->>'discoverable','true')<>'false'
    and(p.username ilike ${pattern} escape ${String.fromCharCode(92)} or(${!prefix} and p.display_name ilike ${pattern} escape ${String.fromCharCode(92)}))
    and(${after?.name ?? null}::text is null or(lower(coalesce(p.username,p.user_id::text)),p.user_id)>(${after?.name ?? null},${after?.id ?? null}::uuid))
   order by name_key,p.user_id limit ${limit + 1}`);
    const page = rows.rows.slice(0, limit),
      last = page.at(-1);
    return c.json({
      ready: true,
      tab: effectiveTab,
      results: page.map((r) => r.result),
      nextCursor:
        rows.rows.length > limit && last
          ? btoa(
              JSON.stringify({
                key,
                score: 0,
                at: new Date(last.created_at).toISOString(),
                id: last.id,
                kind: "PERSON",
                name: last.name_key,
              }),
            )
          : null,
    });
  }
  const match = (document: SQL) =>
    sql`(${document} @@ websearch_to_tsquery('simple',${term}) or ${document}::text ilike ${"%" + escaped(term) + "%"} escape ${String.fromCharCode(92)})`;
  const postDocument = sql`to_tsvector('simple',coalesce(posts.title,'')||' '||coalesce(posts.summary,'')||' '||coalesce(posts.body,''))`,
    replyDocument = sql`to_tsvector('simple',coalesce(comments.body,''))`;
  const score = (document: SQL) =>
    effectiveTab === "TOP"
      ? sql`round(ts_rank_cd(${document},websearch_to_tsquery('simple',${term}))::numeric,8)`
      : sql`0::numeric`;
  const dates = (at: SQL) =>
    sql`(${d.since ?? null}::date is null or ${at}>=${d.since ?? null}::date)and(${d.until ?? null}::date is null or ${at}<${d.until ?? null}::date+interval '1 day')`;
  const authorFilter = (who: SQL, username: SQL) =>
    sql`(${from}::text is null or lower(${username})=${from}) and(${d.activity !== "FOLLOWING"} or exists(select 1 from public.profile_follows f where f.follower_id=${user.id}::uuid and f.followed_id=${who}))`;
  const views = await feedExperienceReady(c.env),
    publishing = await publishingFeedReady(c.env),
    language = (value: SQL) =>
      sql`(${d.language === "ANY"} or coalesce(${value},'und')=${d.language})`;
  const rows = await database(c.env).execute<{
    id: string;
    kind: string;
    score: number;
    at: string;
    result: unknown;
  }>(sql`
 with matches as(
  select posts.id,'POST'::text as kind,posts.published_at as at,${score(postDocument)} as score,
   jsonb_build_object('kind','POST','id',posts.id,'post',(select to_jsonb(projection)from(select ${feedPostProjection(user, views, publishing)})projection))as result
  from public.feed_posts posts ${feedPostJoins(user, unblockedAuthor(user.id, sql`quoted.author_user_id`))}
  where ${visiblePost(user.universityId)} and ${unblockedAuthor(user.id, sql`posts.author_user_id`)} and ${match(postDocument)}
   and (posts.author_user_id is null or exists(select 1 from public.users post_user join public.profiles post_profile on post_profile.user_id=post_user.id where post_user.id=posts.author_user_id and post_user.status::text='ACTIVE' and post_profile.deleted_at is null))
   and ${dates(sql`posts.published_at`)} and ${authorFilter(sql`posts.author_user_id`, sql`author.username`)} and ${language(sql`posts.audience->>'language'`)}
   and(${effectiveTab !== "MEDIA"} or posts.image_url is not null or jsonb_array_length(coalesce(posts.audience->'media','[]'::jsonb))>0)
   and(${d.activity !== "LIKED"} or exists(select 1 from public.feed_likes f where f.user_id=${user.id}::uuid and f.post_id=posts.id))
   and(${d.activity !== "REPLIED"} or exists(select 1 from public.feed_comments r where r.author_user_id=${user.id}::uuid and r.post_id=posts.id and r.deleted_at is null))
   and(${d.activity !== "REPOSTED"} or exists(select 1 from public.feed_reposts r where r.user_id=${user.id}::uuid and r.post_id=posts.id))
  union all
  select comments.id,'REPLY',comments.created_at,${score(replyDocument)},
   jsonb_build_object('kind','REPLY','id',comments.id,'postId',posts.id,'body',comments.body,'name',reply_author.display_name,'username',reply_author.username,
    'userId',comments.author_user_id,'avatarUrl',reply_author.profile_image_url,'createdAt',comments.created_at,'parentTitle',posts.title)as result
  from public.feed_comments comments join public.feed_posts posts on posts.id=comments.post_id
   left join public.profiles author on author.user_id=posts.author_user_id and author.deleted_at is null
   join public.profiles reply_author on reply_author.user_id=comments.author_user_id and reply_author.deleted_at is null
   join public.users reply_user on reply_user.id=reply_author.user_id and reply_user.status::text='ACTIVE'
  where ${d.excludeReplies === "false"} and ${effectiveTab !== "MEDIA"} and comments.deleted_at is null and ${visiblePost(user.universityId)}
   and ${unblockedAuthor(user.id, sql`posts.author_user_id`)} and ${unblockedAuthor(user.id, sql`comments.author_user_id`)} and ${match(replyDocument)}
   and (posts.author_user_id is null or exists(select 1 from public.users post_user join public.profiles post_profile on post_profile.user_id=post_user.id where post_user.id=posts.author_user_id and post_user.status::text='ACTIVE' and post_profile.deleted_at is null))
   and ${dates(sql`comments.created_at`)} and ${authorFilter(sql`comments.author_user_id`, sql`reply_author.username`)} and ${language(sql`to_jsonb(comments)->>'language_code'`)}
   and(${d.activity !== "LIKED"} or exists(select 1 from public.feed_comment_likes f where f.user_id=${user.id}::uuid and f.comment_id=comments.id))
   and(${d.activity !== "REPLIED"} or exists(select 1 from public.feed_comments r where r.author_user_id=${user.id}::uuid and r.parent_comment_id=comments.id and r.deleted_at is null))
   and ${d.activity !== "REPOSTED"}
 )select * from matches where ${after === null} or (score,at,kind,id)<(${after?.score ?? 0}::numeric,${after?.at ?? null}::timestamptz,${after?.kind ?? null},${after?.id ?? null}::uuid)
 order by score desc,at desc,kind desc,id desc limit ${limit + 1}`);
  const page = rows.rows.slice(0, limit),
    last = page.at(-1);
  return c.json({
    ready: true,
    tab: effectiveTab,
    results: page.map((r) => r.result),
    nextCursor:
      rows.rows.length > limit && last
        ? btoa(
            JSON.stringify({
              key,
              score: Number(last.score),
              at: new Date(last.at).toISOString(),
              id: last.id,
              kind: last.kind,
            }),
          )
        : null,
  });
});
