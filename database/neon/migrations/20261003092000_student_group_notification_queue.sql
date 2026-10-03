begin;
create or replace function app_private.notify_student_group_post() returns trigger language plpgsql set search_path='' as $$
declare g public.student_groups; prefix text; begin
 select * into g from public.student_groups where id=new.group_id;
 prefix:=case when new.urgent then 'community-urgent:' else 'community-post:' end;
 insert into public.in_app_notifications(user_id,institution_id,actor_user_id,title,body,path,dedupe_key)
 select m.user_id,g.institution_id,new.author_user_id,case when new.urgent then 'Urgent · ' else '' end||new.title,left(new.body,2000),'/community?id='||g.id||'&kind='||g.kind,prefix||new.id||':'||m.user_id
 from public.student_group_members m join public.users u on u.id=m.user_id and u.status::text='ACTIVE' and u.deleted_at is null join public.profiles p on p.user_id=u.id and p.university_id=g.institution_id and p.deleted_at is null
 where m.group_id=g.id and m.user_id<>new.author_user_id and not exists(select 1 from public.account_restrictions r where r.user_id=u.id and r.revoked_at is null and r.starts_at<=now() and (r.ends_at is null or r.ends_at>now()))
 on conflict(dedupe_key) do nothing;
 if g.kind='COMMUNITY' or new.urgent then
 insert into app_private.notification_outbox(user_id,channel,subject,body,dedupe_key)
 select m.user_id,'PUSH',case when new.urgent then 'Urgent · ' else '' end||new.title,left(new.body,2000),prefix||new.id||':'||m.user_id
 from public.student_group_members m join public.users u on u.id=m.user_id and u.status::text='ACTIVE' and u.deleted_at is null join public.profiles p on p.user_id=u.id and p.university_id=g.institution_id and p.deleted_at is null
 where m.group_id=g.id and m.user_id<>new.author_user_id and not exists(select 1 from public.account_restrictions r where r.user_id=u.id and r.revoked_at is null and r.starts_at<=now() and (r.ends_at is null or r.ends_at>now()))
 on conflict(dedupe_key) do nothing;
 end if;return new;
end $$;
revoke all on function app_private.notify_student_group_post() from public;
create trigger student_group_post_notification after insert on public.student_group_posts for each row execute function app_private.notify_student_group_post();
commit;
