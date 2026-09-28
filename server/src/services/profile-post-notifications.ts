import { sql } from "drizzle-orm";
import { database, firstRow } from "../lib/database";
import type { Bindings } from "../types";

const readyCache = new WeakMap<object, { ready: boolean; expires: number }>();

export async function profilePostNotificationsReady(env: Bindings) {
  if (env.UNIFIED_SCHEMA_READY !== "true") return false;
  const saved = readyCache.get(env);
  if (saved && saved.expires > Date.now()) return saved.ready;
  const row = firstRow(
    await database(env).execute<{ ready: boolean }>(sql`
      select to_regclass('public.profile_post_notification_subscriptions') is not null as ready
    `),
  );
  const ready = row?.ready === true;
  readyCache.set(env, { ready, expires: Date.now() + (ready ? 60_000 : 5_000) });
  return ready;
}

export async function notifyProfilePostPublished(
  env: Bindings,
  postId: string,
  authorUserId: string,
) {
  if (!(await profilePostNotificationsReady(env))) return;

  try {
    const db = database(env);
    const post = firstRow(
      await db.execute<{
        id: string;
        author_user_id: string | null;
        university_id: string;
        author_name: string;
        post_body: string;
        visibility: string;
      }>(sql`
        select posts.id,posts.author_user_id,posts.university_id,
          coalesce(author.display_name,author.username,'Someone') as author_name,
          left(coalesce(nullif(btrim(posts.body),''),'New post'),160) as post_body,
          coalesce(posts.audience->>'visibility','CAMPUS') as visibility
        from public.feed_posts posts
        left join public.profiles author
          on author.user_id=posts.author_user_id and author.deleted_at is null
        where posts.id=${postId}::uuid
          and posts.author_user_id=${authorUserId}::uuid
          and posts.status in ('PUBLISHED','CORRECTED')
          and posts.published_at<=now()
        limit 1
      `),
    );

    if (!post?.author_user_id) return;
    const title = `${post.author_name} posted`;
    const path = `/post?id=${post.id}`;

    await db.execute(sql`
      with eligible as (
        select subscriptions.subscriber_id as user_id,recipient.university_id as institution_id
        from public.profile_post_notification_subscriptions subscriptions
        join public.profiles recipient
          on recipient.user_id=subscriptions.subscriber_id and recipient.deleted_at is null
        join public.users account
          on account.id=subscriptions.subscriber_id
          and account.deleted_at is null and account.status::text='ACTIVE'
        where subscriptions.target_user_id=${authorUserId}::uuid
          and subscriptions.subscriber_id<>${authorUserId}::uuid
          and coalesce(recipient.settings->>'notifications','true')='true'
          and (${post.visibility}='PUBLIC' or recipient.university_id=${post.university_id}::uuid)
          and not exists(
            select 1 from public.user_blocks blocks
            where (blocks.blocker_id=subscriptions.subscriber_id and blocks.blocked_id=${authorUserId}::uuid)
               or (blocks.blocked_id=subscriptions.subscriber_id and blocks.blocker_id=${authorUserId}::uuid)
          )
      ), notices as (
        insert into public.in_app_notifications(
          user_id,institution_id,actor_user_id,title,body,path,dedupe_key
        )
        select
          eligible.user_id,eligible.institution_id,${authorUserId}::uuid,
          ${title},${post.post_body},${path},
          'profile-post:'||${postId}::text||':'||eligible.user_id::text
        from eligible
        on conflict(dedupe_key) do nothing
        returning user_id,title,body,dedupe_key
      )
      insert into app_private.notification_outbox(
        user_id,channel,subject,body,dedupe_key
      )
      select user_id,'PUSH',title,body,dedupe_key from notices
      on conflict(dedupe_key) do nothing
    `);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "profile_post.notification.enqueue_failed",
        postId,
        authorUserId,
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
  }
}
