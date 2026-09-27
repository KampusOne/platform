begin;
set local lock_timeout='5s';
alter table public.in_app_notifications add column if not exists category text not null default 'campusUpdates';
alter table public.in_app_notifications add column if not exists in_app_visible boolean not null default true;
alter table public.in_app_notifications add column if not exists push_permitted boolean not null default true;
create index if not exists notification_unread_idx on public.in_app_notifications(user_id,created_at desc,id) where read_at is null and in_app_visible;

create or replace function app_private.notification_category(key text) returns text
language sql immutable set search_path='' as $$ select case
 when key like 'feed-like:%' then 'likes' when key like 'comment-like:%' then 'commentLikes'
 when key like 'comment-reply:%' then 'replies' when key like 'feed-comment:%' then 'comments'
 when key like 'feed-repost:%' then 'reposts' when key like 'feed-quote:%' then 'quotes'
 when key like 'follow:%' then 'follows' when key like 'message:%' then 'messages'
 when key like 'profile-post:%' then 'profilePosts' when key like 'alarm:%' or key like 'class:%' then 'classReminders'
 when key like 'announcement:%' then 'announcements' when key like 'security:%' then 'security'
 else 'campusUpdates' end $$;

create or replace function app_private.notification_enabled(actor uuid, category text, channel text) returns boolean
language sql stable set search_path='' as $$
 select case when category='security' then true else coalesce((
   select case when channel='push' and coalesce(p.settings->>'notifications','true')='false' then false
   else coalesce((p.settings->'notificationChannels'->category->>(case when channel='push' then 'push_enabled' else 'in_app_enabled' end))::boolean,
     case when channel='in_app' then coalesce((p.settings->'notificationPreferences'->>category)::boolean,true)
     when category='announcements' then coalesce((p.settings->'notificationPreferences'->>'pushAnnouncements')::boolean,true)
     when category='campusUpdates' then coalesce((p.settings->'notificationPreferences'->>'pushCampusUpdates')::boolean,true)
     when category='classReminders' then true else false end) end
   from public.profiles p join public.users u on u.id=p.user_id where p.user_id=actor and p.deleted_at is null and u.deleted_at is null
 ),false) end
$$;
update public.in_app_notifications set category=app_private.notification_category(dedupe_key);

create or replace function app_private.prepare_notification() returns trigger
language plpgsql set search_path='' as $$
begin
 new.category:=app_private.notification_category(new.dedupe_key);
 new.in_app_visible:=new.in_app_visible and app_private.notification_enabled(new.user_id,new.category,'in_app');
 if not new.in_app_visible and not (new.push_permitted and app_private.notification_enabled(new.user_id,new.category,'push')) then return null; end if;
 if not exists(select 1 from public.users where id=new.user_id and deleted_at is null and status::text='ACTIVE') then return null; end if;
 return new;
end $$;
drop trigger if exists prepare_notification on public.in_app_notifications;
create trigger prepare_notification before insert on public.in_app_notifications for each row execute function app_private.prepare_notification();
create or replace function app_private.queue_notification_push() returns trigger
language plpgsql set search_path='' as $$
begin
 -- Alarm ringing is device scheduled, not duplicated by a remote push.
 -- Existing community announcement delivery retains its own dedupe identity.
 if new.push_permitted and new.dedupe_key not like 'alarm:%' and new.dedupe_key not like 'announcement:%'
 and app_private.notification_enabled(new.user_id,new.category,'push') then
   insert into app_private.notification_outbox(user_id,channel,subject,body,dedupe_key)
   values(new.user_id,'PUSH',new.title,new.body,'activity:'||new.id::text) on conflict do nothing;
 end if;
 return new;
end $$;
drop trigger if exists queue_notification_push on public.in_app_notifications;
create trigger queue_notification_push after insert on public.in_app_notifications for each row execute function app_private.queue_notification_push();

-- Social events and their notifications commit together. Retries/re-likes deduplicate.
create or replace function app_private.notify_social_activity() returns trigger
language plpgsql set search_path='' as $$
#variable_conflict use_variable
declare actor uuid; recipient uuid; campus uuid; post_id uuid; comment_id uuid; label text; body text; key text; path text; actor_name text;
begin
 if tg_table_name='feed_likes' then
   actor:=new.user_id;post_id:=new.post_id;label:='liked your post';key:='feed-like:'||post_id||':'||actor;
 elsif tg_table_name='feed_reposts' then
   actor:=new.user_id;post_id:=new.post_id;label:='reposted your post';key:='feed-repost:'||post_id||':'||actor;
 elsif tg_table_name='feed_comment_likes' then
   actor:=new.user_id;comment_id:=new.comment_id;label:='liked your comment';key:='comment-like:'||comment_id||':'||actor;
   select c.post_id,c.author_user_id,left(c.body,180) into post_id,recipient,body from public.feed_comments c where c.id=comment_id and c.deleted_at is null;
   if recipient is null then return new;end if;
 elsif tg_table_name='feed_comments' then
   actor:=new.author_user_id;post_id:=new.post_id;comment_id:=new.id;body:=left(new.body,180);
   if new.parent_comment_id is not null then
     select c.author_user_id into recipient from public.feed_comments c where c.id=new.parent_comment_id and c.deleted_at is null;
     if recipient is null then return new; end if;
     label:='replied to your comment';key:='comment-reply:'||new.id;
   else label:='commented on your post';key:='feed-comment:'||new.id;end if;
 elsif tg_table_name='profile_follows' then
   actor:=new.follower_id;recipient:=new.followed_id;label:='followed you';key:='follow:'||recipient||':'||actor;path:='/student-profile?id='||actor;
 elsif tg_table_name='feed_posts' then
   if new.quoted_post_id is null or new.status not in ('PUBLISHED','CORRECTED') then return new;end if;
   actor:=new.author_user_id;post_id:=new.quoted_post_id;label:='quoted your post';key:='feed-quote:'||new.id;path:='/post?id='||new.id;
 elsif tg_table_name='direct_messages' then
   actor:=new.sender_id;select case when t.initiator_id=actor then t.recipient_id else t.initiator_id end into recipient from public.direct_threads t where t.id=new.thread_id and t.status in ('REQUESTED','ACCEPTED');
   label:=case when new.request_preview then 'sent you a message request' else 'sent you a message' end;
   key:='message:'||new.id;path:='/conversation?id='||new.thread_id;body:='Open your messages to reply.';
 end if;
 if post_id is not null then
   select coalesce(recipient,f.author_user_id),coalesce(body,left(coalesce(nullif(f.body,''),f.title),180)) into recipient,body from public.feed_posts f where f.id=post_id and f.status in ('PUBLISHED','CORRECTED');
   path:=coalesce(path,'/post?id='||post_id||case when comment_id is not null then '&commentId='||comment_id else '' end);
 end if;
 if actor is null or recipient is null or actor=recipient then return new;end if;
 if exists(select 1 from public.user_blocks b where (b.blocker_id=actor and b.blocked_id=recipient) or(b.blocker_id=recipient and b.blocked_id=actor)) then return new;end if;
 select coalesce(p.display_name,p.username,'Someone') into actor_name from public.profiles p where p.user_id=actor and p.deleted_at is null;
 if actor_name is null then return new;end if;
 select p.university_id into campus from public.profiles p where p.user_id=recipient and p.deleted_at is null;
 insert into public.in_app_notifications(user_id,institution_id,title,body,path,dedupe_key)
 values(recipient,campus,actor_name||' '||label,coalesce(body,''),path,key) on conflict do nothing;
 return new;
end $$;
do $$ declare t text;begin
 foreach t in array array['feed_likes','feed_reposts','feed_comment_likes','feed_comments','profile_follows','feed_posts','direct_messages'] loop
 execute format('drop trigger if exists notify_social_activity on public.%I',t);
 execute format('create trigger notify_social_activity after insert on public.%I for each row execute function app_private.notify_social_activity()',t);
 end loop;
end $$;
revoke all on function app_private.notification_category(text),app_private.notification_enabled(uuid,text,text),app_private.prepare_notification(),app_private.queue_notification_push(),app_private.notify_social_activity() from public;
commit;
