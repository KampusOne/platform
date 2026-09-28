import { sql } from "drizzle-orm";
import { database, firstRow } from "../lib/database";
import type { Bindings } from "../types";

type PublishedProfilePost = {
  author_user_id: string | null;
  university_id: string;
  author_name: string;
  author_username: string | null;
  body: string;
  title: string;
  public_visibility: boolean;
  notify_all_in_app: boolean;
  notify_all_push: boolean;
};

function isKampusOneNewsletter(name: string, username: string | null) {
  const normalizedName = name.trim().toLowerCase();
  const normalizedUsername = (username ?? "")
    .replace(/^@/, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
  return (
    normalizedName === "kampusone newsletter" ||
    normalizedUsername === "kampusonenewsletter"
  );
}

/**
 * Fan out a newly published post from an account that is explicitly configured
 * to notify everyone. The official KampusOne Newsletter remains a safe fallback
 * so its post alerts cannot silently disappear if the policy row is missing.
 *
 * One bulk INSERT creates durable inbox rows; a second bulk INSERT creates push
 * outbox work. There is no per-recipient API loop in the publish request.
 */
export async function notifyProfilePostPublished(
  env: Bindings,
  postId: string,
) {
  if (env.UNIFIED_SCHEMA_READY !== "true") return;

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
          posts.audience->>'visibility' = 'PUBLIC' as public_visibility,
          coalesce(policy.notify_all_in_app, false) as notify_all_in_app,
          coalesce(policy.notify_all_push, false) as notify_all_push
        from public.feed_posts posts
        join public.profiles author
          on author.user_id = posts.author_user_id
         and author.deleted_at is null
        join public.users author_account
          on author_account.id = author.user_id
         and author_account.status::text = 'ACTIVE'
         and author_account.deleted_at is null
        left join public.profile_social_policies policy
          on policy.user_id = posts.author_user_id
        where posts.id = ${postId}::uuid
          and posts.author_user_id is not null
          and posts.status in ('PUBLISHED','CORRECTED')
          and posts.published_at <= now()
        limit 1
      `),
    );

    if (!post?.author_user_id) return;

    const newsletter = isKampusOneNewsletter(
      post.author_name,
      post.author_username,
    );
    const notifyInApp = post.notify_all_in_app || newsletter;
    const notifyPush = post.notify_all_push || newsletter;
    if (!notifyInApp && !notifyPush) return;

    const title = `${post.author_name} posted`;
    const body =
      (post.body || post.title || "Tap to view the new post.")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180) || "Tap to view the new post.";
    const path = `/post?id=${postId}`;
    const prefix = `profile-post:${postId}:`;
    const audience = post.public_visibility
      ? sql`true`
      : sql`recipient.university_id = ${post.university_id}::uuid`;

    // Push notifications are mirrored into the in-app inbox so tapping a phone
    // alert always has a durable notification record and a canonical post path.
    if (notifyInApp || notifyPush) {
      await db.execute(sql`
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
        from public.profiles recipient
        join public.users account
          on account.id = recipient.user_id
         and account.status::text = 'ACTIVE'
         and account.deleted_at is null
        where recipient.deleted_at is null
          and recipient.user_id <> ${post.author_user_id}::uuid
          and ${audience}
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
        on conflict do nothing
      `);
    }

    if (notifyPush) {
      await db.execute(sql`
        insert into app_private.notification_outbox(
          user_id,channel,subject,body,dedupe_key
        )
        select
          notice.user_id,
          'PUSH',
          notice.title,
          notice.body,
          notice.dedupe_key
        from public.in_app_notifications notice
        where notice.actor_user_id = ${post.author_user_id}::uuid
          and notice.dedupe_key = ${prefix} || notice.user_id::text
        on conflict do nothing
      `);
    }
  } catch (error) {
    // A notification failure must never turn a successfully published post into
    // a failed/duplicate post. Delivery can be inspected and retried separately.
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
