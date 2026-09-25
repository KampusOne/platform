import { sql } from "drizzle-orm";
import { database, firstRow } from "../lib/database";
import type { Bindings } from "../types";

export type FeedInteraction = "like" | "repost" | "comment";

export async function notifyFeedInteraction(
  env: Bindings,
  postId: string,
  actorUserId: string,
  kind: FeedInteraction,
) {
  if (env.UNIFIED_SCHEMA_READY !== "true") return;

  try {
    const db = database(env);
    const target = firstRow(
      await db.execute<{
        author_user_id: string | null;
        university_id: string;
        post_title: string;
        actor_name: string;
      }>(sql`
        select posts.author_user_id, posts.university_id,
          left(coalesce(nullif(btrim(posts.title), ''), 'your post'), 120) as post_title,
          coalesce(actor.display_name, actor.username, 'Someone') as actor_name
        from public.feed_posts posts
        left join public.profiles actor
          on actor.user_id = ${actorUserId}::uuid and actor.deleted_at is null
        where posts.id = ${postId}::uuid
          and posts.author_user_id is not null
          and posts.status in ('PUBLISHED','CORRECTED')
        limit 1
      `),
    );

    if (!target?.author_user_id || target.author_user_id === actorUserId) return;

    const verb =
      kind === "like" ? "liked" : kind === "repost" ? "reposted" : "replied to";
    const title = `${target.actor_name} ${verb} your post`;
    const body = target.post_title;
    const path = `/post?id=${postId}`;
    const dedupe = `feed-${kind}:${postId}:${actorUserId}`;

    await db.execute(sql`
      insert into public.in_app_notifications(
        user_id,institution_id,title,body,path,dedupe_key
      ) values(
        ${target.author_user_id}::uuid,${target.university_id}::uuid,
        ${title},${body},${path},${dedupe}
      ) on conflict do nothing
    `);

    await db.execute(sql`
      insert into app_private.notification_outbox(
        user_id,channel,subject,body,dedupe_key
      ) values(
        ${target.author_user_id}::uuid,'PUSH',${title},${body},${dedupe}
      ) on conflict do nothing
    `);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "feed.notification.enqueue_failed",
        kind,
        postId,
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
  }
}
