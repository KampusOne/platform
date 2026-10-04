-- Run with run_sql_transaction on the isolated rehearsal branch. The savepoint
-- rolls back every fixture row before the outer transaction commits.
savepoint oct4_community_fixture;
do $$
declare
 owner_id uuid; follower_id uuid; campus_id uuid;
 fixture_group_id uuid:=gen_random_uuid(); post_id uuid;
 notification_key text;
begin
 select a.user_id,b.user_id,a.university_id into owner_id,follower_id,campus_id
 from public.profiles a join public.users ua on ua.id=a.user_id
 join public.profiles b on b.university_id=a.university_id and b.user_id<>a.user_id
 join public.users ub on ub.id=b.user_id
 where a.deleted_at is null and b.deleted_at is null
 and ua.deleted_at is null and ub.deleted_at is null
 and ua.status::text='ACTIVE' and ub.status::text='ACTIVE'
 and not exists(select 1 from public.account_restrictions r where r.user_id in(a.user_id,b.user_id) and r.revoked_at is null and r.starts_at<=now() and (r.ends_at is null or r.ends_at>now()))
 and not exists(select 1 from public.user_blocks x where (x.blocker_id=a.user_id and x.blocked_id=b.user_id) or (x.blocker_id=b.user_id and x.blocked_id=a.user_id))
 order by a.user_id,b.user_id limit 1;
 if owner_id is null or follower_id is null then raise exception 'Community acceptance needs two active same-campus accounts';end if;
 insert into public.student_groups(id,institution_id,owner_user_id,kind,name,request_id)
 values(fixture_group_id,campus_id,owner_id,'COMMUNITY','October 4 isolated acceptance',gen_random_uuid());
 if not(select members_can_post from public.student_groups where id=fixture_group_id) then raise exception 'New communities must permit member posting by default';end if;
 insert into public.student_group_members(group_id,institution_id,user_id,role)
 values(fixture_group_id,campus_id,owner_id,'ADMIN'),(fixture_group_id,campus_id,follower_id,'MEMBER');
 if exists(select 1 from public.student_group_members m where m.group_id=fixture_group_id and m.notifications_enabled) then raise exception 'New membership must leave notification permission opt-in';end if;

 post_id:=gen_random_uuid();notification_key:='community-post:'||post_id||':'||follower_id;
 insert into public.student_group_posts(id,group_id,institution_id,author_user_id,request_id,title,body,author_role)
 values(post_id,fixture_group_id,campus_id,owner_id,gen_random_uuid(),'Opt-out fixture','Notification opt-out must be respected.','ADMIN');
 if exists(select 1 from public.in_app_notifications where dedupe_key=notification_key) or exists(select 1 from app_private.notification_outbox where dedupe_key=notification_key) then raise exception 'Opt-out subscriber was notified';end if;

 update public.student_group_members m set notifications_enabled=true where m.group_id=fixture_group_id and m.user_id=follower_id;
 post_id:=gen_random_uuid();notification_key:='community-post:'||post_id||':'||follower_id;
 insert into public.student_group_posts(id,group_id,institution_id,author_user_id,request_id,title,body,author_role)
 values(post_id,fixture_group_id,campus_id,owner_id,gen_random_uuid(),'Opt-in fixture','Notification opt-in must receive the new update.','ADMIN');
 if not exists(select 1 from public.in_app_notifications where dedupe_key=notification_key) or not exists(select 1 from app_private.notification_outbox where dedupe_key=notification_key) then raise exception 'Opt-in subscriber did not receive both notification records';end if;

 insert into public.user_blocks(blocker_id,blocked_id) values(follower_id,owner_id);
 post_id:=gen_random_uuid();notification_key:='community-post:'||post_id||':'||follower_id;
 insert into public.student_group_posts(id,group_id,institution_id,author_user_id,request_id,title,body,author_role)
 values(post_id,fixture_group_id,campus_id,owner_id,gen_random_uuid(),'Block fixture','A blocked account must not trigger notifications.','ADMIN');
 if exists(select 1 from public.in_app_notifications where dedupe_key=notification_key) or exists(select 1 from app_private.notification_outbox where dedupe_key=notification_key) then raise exception 'Blocked account triggered a notification';end if;
end $$;
select 'passed' as community_notification_preferences_and_blocks;
rollback to savepoint oct4_community_fixture;
