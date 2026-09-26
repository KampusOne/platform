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

    // Likes, replies and reposts stay in the inbox. They never interrupt other apps.
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

/** Ordinary profile subscriptions are inbox-only; only an admin policy enables a push. */
export async function notifyPublishedPost(env: Bindings, postId: string) {
  if (env.UNIFIED_SCHEMA_READY !== 'true') return;
  const db=database(env);
  try {
    await db.execute(sql`
      with post as (
        select f.id,f.author_user_id,f.university_id,left(coalesce(nullif(f.body,''),f.title,''),240) as body,
          coalesce(p.display_name,p.username,'A profile you follow') as author,
          coalesce(policy.notify_all_in_app,false) as notify_all,
          coalesce(policy.notify_all_push,false) as push_all,policy.institution_id as scope
        from public.feed_posts f join public.profiles p on p.user_id=f.author_user_id and p.deleted_at is null
        left join public.profile_social_policies policy on policy.user_id=f.author_user_id
        where f.id=${postId}::uuid and f.status in ('PUBLISHED','CORRECTED')
      ), recipients as (
        select p.user_id,p.university_id as recipient_institution,post.* from post join public.profiles p
          on (post.scope is null or p.university_id=post.scope) and p.user_id<>post.author_user_id and p.deleted_at is null
        where not exists(select 1 from public.user_blocks block where (block.blocker_id=p.user_id and block.blocked_id=post.author_user_id) or (block.blocked_id=p.user_id and block.blocker_id=post.author_user_id)) and (post.notify_all or post.push_all or exists(select 1 from public.profile_post_subscriptions sub where sub.follower_id=p.user_id and sub.target_id=post.author_user_id))
      ), notices as (
        insert into public.in_app_notifications(user_id,institution_id,title,body,path,dedupe_key,push_permitted,in_app_visible)
        select user_id,recipients.recipient_institution,author||' posted',body,'/post?id='||id::text,
          (case when push_all then 'official-post:' else 'profile-post:' end)||id::text||':'||user_id::text,push_all,(notify_all or exists(select 1 from public.profile_post_subscriptions s where s.follower_id=recipients.user_id and s.target_id=recipients.author_user_id))
        from recipients where (select count(*) from public.in_app_notifications recent where recent.user_id=recipients.user_id and recent.created_at>now()-interval '1 hour' and recent.dedupe_key like 'official-post:%')<3 on conflict do nothing returning user_id
      ) select count(*) from notices
    `);
  } catch(error) { console.error(JSON.stringify({event:'profile.notification.enqueue_failed',postId,message:error instanceof Error?error.message:'unknown'})); }
}
