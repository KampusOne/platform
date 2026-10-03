import { sql } from "drizzle-orm";
import { database } from "../lib/database";
import type { Bindings } from "../types";

/** Resolve handles against trusted profiles, keep post visibility and block policy. */
export async function notifyPostMentions(env:Bindings,postId:string,actorId:string){
  if(env.UNIFIED_SCHEMA_READY!=="true")return;
  try{
    await database(env).execute(sql`
      with targets as(
        select distinct recipient.user_id,recipient.university_id,
          coalesce(actor.display_name,actor.username,'Someone')||' tagged you in a post' as title,
          left(posts.body,180) as body,'/post?id='||posts.id::text as path,
          'post-mention:'||posts.id::text||':'||recipient.user_id::text as dedupe
        from public.feed_posts posts
        join public.profiles actor on actor.user_id=posts.author_user_id and actor.deleted_at is null
        cross join lateral regexp_matches(posts.body,'(^|[^[:alnum:]_@])@([a-zA-Z0-9_]{1,30})','g') as mention(parts)
        join public.profiles recipient on lower(recipient.username)=lower((mention.parts)[2])
        join public.users account on account.id=recipient.user_id and account.status::text='ACTIVE' and account.deleted_at is null
        where posts.id=${postId}::uuid and posts.author_user_id=${actorId}::uuid
          and posts.status in('PUBLISHED','CORRECTED') and posts.published_at<=now()
          and recipient.deleted_at is null and recipient.user_id<>${actorId}::uuid
          and(recipient.university_id=posts.university_id or posts.audience->>'visibility'='PUBLIC')
          and not exists(select 1 from public.user_blocks b where(b.blocker_id=recipient.user_id and b.blocked_id=${actorId}::uuid)or(b.blocker_id=${actorId}::uuid and b.blocked_id=recipient.user_id))
      ), notices as(
        insert into public.in_app_notifications(user_id,institution_id,actor_user_id,title,body,path,dedupe_key)
        select user_id,university_id,${actorId}::uuid,title,body,path,dedupe from targets
        on conflict do nothing returning user_id,title,body,dedupe_key
      )
      insert into app_private.notification_outbox(user_id,channel,subject,body,dedupe_key)
      select user_id,'PUSH',title,body,dedupe_key from notices on conflict do nothing
    `);
  }catch(error){console.error('kampusone.mention.enqueue_failed',{postId,message:error instanceof Error?error.message:'unknown'});}
}
