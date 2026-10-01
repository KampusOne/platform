import { sql } from "drizzle-orm";
import { database, firstRow } from "../lib/database";
import type { Bindings } from "../types";
import {adminWorkspaceReady}from'../lib/admin-workspace';

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

type PublishedProfilePost = {
  author_user_id: string | null;
  university_id: string;
  author_name: string;
  author_username: string | null;
  body: string;
  title: string;
  public_visibility: boolean;
};

/**
 * Normal accounts use explicit subscriptions. Notify-all authority is a
 * reviewed immutable user ID and scope, never an editable name or username.
 * Delivery-time preferences still let each recipient mute newsletter push.
 */
export async function notifyProfilePostPublished(
  env: Bindings,
  postId: string,
  expectedAuthorUserId?: string,
) {
  if (!(await profilePostNotificationsReady(env))) return;

  try {
    const db = database(env);
    const post = firstRow(
      await db.execute<PublishedProfilePost>(sql`
        select
          posts.author_user_id,
          posts.university_id,
          coalesce(author.display_name, author.username, 'KampusOne') as author_name,
          author.username as author_username,
          posts.body,
          posts.title,
          posts.audience->>'visibility' = 'PUBLIC' as public_visibility
        from public.feed_posts posts
        join public.profiles author
          on author.user_id = posts.author_user_id
         and author.deleted_at is null
        join public.users author_account
          on author_account.id = author.user_id
         and author_account.status::text = 'ACTIVE'
         and author_account.deleted_at is null
        where posts.id = ${postId}::uuid
          and (${expectedAuthorUserId ?? null}::uuid is null
            or posts.author_user_id = ${expectedAuthorUserId ?? null}::uuid)
          and posts.author_user_id is not null
          and posts.status in ('PUBLISHED','CORRECTED')
          and posts.published_at <= now()
          and not exists(select 1 from public.account_restrictions r where r.user_id=posts.author_user_id and r.revoked_at is null and r.starts_at<=now()and(r.ends_at is null or r.ends_at>now()))
        limit 1
      `),
    );

    if (!post?.author_user_id) return;

    const managed=await adminWorkspaceReady(env)?firstRow(await db.execute<{scope:string}>(sql`select app_private.reserve_managed_publisher_post(${post.author_user_id}::uuid,${postId}::uuid)scope`))?.scope:'ORDINARY';
    const newsletter=managed==='GLOBAL'||managed==='CAMPUS';
    const blocksReady =
      firstRow(
        await db.execute<{ ready: boolean }>(sql`
          select to_regclass('public.user_blocks') is not null as ready
        `),
      )?.ready === true;
    const blockGuard = blocksReady
      ? sql`
          and not exists(
            select 1 from public.user_blocks blocked
            where (
              blocked.blocker_id = recipient.user_id
              and blocked.blocked_id = ${post.author_user_id}::uuid
            ) or (
              blocked.blocker_id = ${post.author_user_id}::uuid
              and blocked.blocked_id = recipient.user_id
            )
          )
        `
      : sql``;

    const title = `${post.author_name} posted`;
    const body =
      (post.body || post.title || "Tap to view the new post.")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180) || "Tap to view the new post.";
    const path = `/post?id=${postId}`;
    const prefix = `${newsletter?'managed-profile-post':'profile-post'}:${postId}:`;
    const audience = post.public_visibility
      ? sql`true`
      : sql`recipient.university_id = ${post.university_id}::uuid`;

    await db.execute(sql`
      with recipients as (
        select
          recipient.user_id,
          recipient.university_id,
          exists(
            select 1
            from public.profile_post_notification_subscriptions subscription
            where subscription.subscriber_id = recipient.user_id
              and subscription.target_user_id = ${post.author_user_id}::uuid
          ) as subscribed
        from public.profiles recipient
        join public.users account
          on account.id = recipient.user_id
         and account.status::text = 'ACTIVE'
         and account.deleted_at is null
        where recipient.deleted_at is null
          and recipient.user_id <> ${post.author_user_id}::uuid
          and not exists(select 1 from public.in_app_notifications n where n.user_id=recipient.user_id and n.dedupe_key in('profile-post:'||${postId}::text||':'||recipient.user_id::text,'managed-profile-post:'||${postId}::text||':'||recipient.user_id::text))
          and coalesce(recipient.settings->>'notifications','true')='true'
          and ${audience}
          and (
            (${newsletter}::boolean and(${managed==='GLOBAL'}::boolean or recipient.university_id=${post.university_id}::uuid))
            or exists(
              select 1
              from public.profile_post_notification_subscriptions subscription
              where subscription.subscriber_id = recipient.user_id
                and subscription.target_user_id = ${post.author_user_id}::uuid
            )
          )
          ${blockGuard}
          and not exists(select 1 from public.account_restrictions r where r.user_id=recipient.user_id and r.revoked_at is null and r.starts_at<=now()and(r.ends_at is null or r.ends_at>now()))
      ), notices as (
        insert into public.in_app_notifications(
          user_id,institution_id,actor_user_id,title,body,path,dedupe_key
        )
        select
          recipient.user_id,
          recipient.university_id,
          ${post.author_user_id}::uuid,
          ${title},
          ${body},
          ${path},
          ${prefix} || recipient.user_id::text
        from recipients recipient
        on conflict(dedupe_key) do nothing
        returning user_id,title,body,dedupe_key
      ), pushes as (
        insert into app_private.notification_outbox(
          user_id,channel,subject,body,dedupe_key
        )
        select
          notice.user_id,
          'PUSH',
          notice.title,
          notice.body,
          notice.dedupe_key
        from notices notice
        join recipients recipient on recipient.user_id=notice.user_id
        where ${newsletter}::boolean or recipient.subscribed
        on conflict(dedupe_key) do nothing
        returning id
      )
      select count(*)::int as notifications_created from notices
    `);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "profile_post.notification_enqueue_failed",
        postId,
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
  }
}
