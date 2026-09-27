-- Attach the person who caused a notification so the inbox can render their profile.
begin;
set local lock_timeout='5s';

alter table public.in_app_notifications
  add column if not exists actor_user_id uuid references public.users(id) on delete set null;
create index if not exists notifications_actor_idx
  on public.in_app_notifications(actor_user_id,created_at desc)
  where actor_user_id is not null;

-- Backfill feed interactions whose dedupe key already contains the actor UUID.
update public.in_app_notifications n
set actor_user_id=split_part(n.dedupe_key,':',3)::uuid
where n.actor_user_id is null
  and n.dedupe_key ~ '^feed-(like|repost|comment):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  and exists(
    select 1 from public.users u
    where u.id=split_part(n.dedupe_key,':',3)::uuid
  );

-- Existing message notifications can be linked to their sender.
update public.in_app_notifications n
set actor_user_id=m.sender_id
from public.direct_messages m
where n.actor_user_id is null
  and n.dedupe_key='message:'||m.id::text;

-- Existing course-rep announcements can be linked to their author.
update public.in_app_notifications n
set actor_user_id=a.author_id
from public.community_announcements a
where n.actor_user_id is null
  and n.dedupe_key like 'announcement:'||a.id::text||':%';

create or replace function app_private.publish_community_announcement(
  target_community uuid,
  actor uuid,
  heading text,
  message text,
  request_id uuid
)
returns uuid language plpgsql set search_path='' as $$
declare cc public.cohort_communities; begin
  select * into cc from public.cohort_communities where id=target_community for update;
  if cc.id is null or cc.archived_at is not null or cc.rep_user_id is distinct from actor then raise exception 'COURSE_REP_REQUIRED'; end if;
  if char_length(heading) not between 3 and 140 or char_length(message) not between 3 and 4000 then raise exception 'INVALID_ANNOUNCEMENT'; end if;
  if exists(select 1 from public.community_announcements where id=request_id and community_id=cc.id and author_id=actor and title=heading and body=message) then return request_id; end if;
  if (select count(*) from public.community_announcements where community_id=cc.id and created_at>now()-interval '1 hour')>=10 then raise exception 'ANNOUNCEMENT_LIMIT'; end if;
  insert into public.community_announcements(id,community_id,author_id,title,body) values(request_id,cc.id,actor,heading,message);
  insert into public.in_app_notifications(user_id,institution_id,actor_user_id,title,body,path,dedupe_key)
    select m.user_id,cc.institution_id,actor,heading,message,'/community?id='||cc.id,'announcement:'||request_id||':'||m.user_id
    from public.community_members m where m.community_id=cc.id;
  insert into app_private.notification_outbox(user_id,channel,subject,body,dedupe_key)
    select m.user_id,'PUSH',heading,message,'announcement-push:'||request_id||':'||m.user_id
    from public.community_members m where m.community_id=cc.id;
  return request_id;
end $$;
revoke all on function app_private.publish_community_announcement(uuid,uuid,text,text,uuid) from public;

commit;
