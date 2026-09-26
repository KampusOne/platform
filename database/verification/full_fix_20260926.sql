begin;
set local statement_timeout='30s';
set local lock_timeout='5s';
do $$
declare campus uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
 source uuid:=gen_random_uuid(); post uuid:=gen_random_uuid(); parent uuid:=gen_random_uuid(); reply uuid:=gen_random_uuid();
 conversation uuid:=gen_random_uuid(); file uuid:=gen_random_uuid(); family uuid:=gen_random_uuid(); challenge uuid:=gen_random_uuid(); outcome text;
 schedule_request uuid:=gen_random_uuid(); schedule_action uuid:=gen_random_uuid();
begin
 insert into public.universities(id,name,slug,updated_at) values(campus,'Full fix verification','full-fix-'||campus::text,now());
 insert into public.users(id,email,password_hash,updated_at) values(a,a::text||'@test.invalid','fixture',now()),(b,b::text||'@test.invalid','fixture',now()),(c,c::text||'@test.invalid','fixture',now());
 insert into public.profiles(id,user_id,university_id,username,display_name,updated_at)
 select gen_random_uuid(),u,campus,'test_'||left(u::text,8),'Fixture student',now() from unnest(array[a,b,c]) u;
 insert into public.content_sources(id,university_id,name) values(source,campus,'Fixture source');
 insert into public.feed_posts(id,university_id,source_id,author_user_id,category,title,summary,body,status,published_at)
 values(post,campus,source,a,'UPDATE','Fixture post','Fixture summary','Fixture body','PUBLISHED',now());
 insert into public.feed_likes(post_id,user_id,institution_id) values(post,b,campus);
 if not exists(select 1 from public.in_app_notifications where user_id=a and category='likes' and dedupe_key='feed-like:'||post||':'||b) then raise exception 'POST_LIKE_RECIPIENT_FAILED';end if;
 insert into public.feed_likes(post_id,user_id,institution_id) values(post,b,campus) on conflict do nothing;
 if (select count(*) from public.in_app_notifications where dedupe_key='feed-like:'||post||':'||b)<>1 then raise exception 'NOTIFICATION_DEDUPE_FAILED';end if;
 if exists(select 1 from app_private.notification_outbox where user_id=a and channel='PUSH') then raise exception 'DEFAULT_SOCIAL_PUSH_NOT_SILENT';end if;
 insert into public.feed_likes(post_id,user_id,institution_id) values(post,a,campus);
 if exists(select 1 from public.in_app_notifications where dedupe_key='feed-like:'||post||':'||a) then raise exception 'SELF_NOTIFICATION_CREATED';end if;
 insert into public.feed_comments(id,post_id,institution_id,author_user_id,body,client_request_id) values(parent,post,campus,b,'Parent comment',gen_random_uuid());
 insert into public.feed_comments(id,post_id,institution_id,author_user_id,body,parent_comment_id,client_request_id) values(reply,post,campus,c,'Reply comment',parent,gen_random_uuid());
 if not exists(select 1 from public.in_app_notifications where user_id=b and category='replies' and dedupe_key='comment-reply:'||reply) then raise exception 'REPLY_RECIPIENT_FAILED';end if;
 insert into public.feed_comment_likes(comment_id,user_id,institution_id) values(parent,c,campus);
 if not exists(select 1 from public.in_app_notifications where user_id=b and category='commentLikes' and dedupe_key='comment-like:'||parent||':'||c) then raise exception 'COMMENT_LIKE_RECIPIENT_FAILED';end if;
 update public.profiles set settings='{"notificationChannels":{"likes":{"in_app_enabled":false,"push_enabled":true}}}' where user_id=a;
 insert into public.feed_likes(post_id,user_id,institution_id) values(post,c,campus);
 if not exists(select 1 from app_private.notification_outbox o join public.in_app_notifications n on o.dedupe_key='activity:'||n.id::text where n.user_id=a and n.dedupe_key='feed-like:'||post||':'||c and not n.in_app_visible) then raise exception 'INDEPENDENT_PUSH_CHANNEL_FAILED';end if;
 insert into public.direct_threads(id,institution_id,initiator_id,recipient_id,status) values(conversation,campus,a,b,'ACCEPTED');
 insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name) values(file,a,campus,'message','verification/'||file,'image/png',100,'fixture.png');
 insert into public.direct_messages(id,thread_id,sender_id,body,media_id) values(gen_random_uuid(),conversation,a,'Attachment',file);
 if not exists(select 1 from public.in_app_notifications where user_id=b and category='messages') then raise exception 'MESSAGE_NOTIFICATION_FAILED';end if;
 insert into app_private.ai_requests(user_id,idempotency_key,request_hash,mode,status,result)
 values(a,schedule_request,repeat('a',64),'study','COMPLETED',jsonb_build_object('text','Review activity','actions',jsonb_build_array(jsonb_build_object('id',schedule_action,'type','timetable','entry',jsonb_build_object('title','Revision','dayOfWeek',2,'startsAt','15:00','endsAt','16:00','reminderMinutes',15,'reminderEnabled',true)))));
 select r.outcome into outcome from app_private.apply_ai_schedule_action(a,schedule_request,schedule_action,false) r;
 if outcome<>'SAVED' then raise exception 'SCHEDULE_CONFIRM_FAILED';end if;
 select r.outcome into outcome from app_private.apply_ai_schedule_action(b,schedule_request,schedule_action,true) r;
 if outcome<>'NOT_FOUND' then raise exception 'SCHEDULE_UNDO_ISOLATION_FAILED';end if;
 select r.outcome into outcome from app_private.apply_ai_schedule_action(a,schedule_request,schedule_action,true) r;
 if outcome<>'UNDONE' or exists(select 1 from public.student_alarms where timetable_entry_id=schedule_action) then raise exception 'SCHEDULE_UNDO_FAILED';end if;
 insert into app_private.account_deletion_codes(id,user_id,session_family_id,token_hash) values(challenge,a,family,'fixture-hash');
 outcome:=app_private.delete_own_account(a,family,challenge,'wrong','verification');
 if outcome<>'INVALID_CODE' or exists(select 1 from public.users where id=a and deleted_at is not null) then raise exception 'DELETION_REAUTH_FAILED';end if;
 outcome:=app_private.delete_own_account(a,family,challenge,'fixture-hash','verification');
 if outcome<>'DELETED' then raise exception 'DELETION_FAILED';end if;
 if not exists(select 1 from public.users where id=a and status::text='DEACTIVATED' and email='deleted+'||a||'@account.invalid') then raise exception 'IDENTITY_ERASURE_FAILED';end if;
 if not exists(select 1 from app_private.account_media_erasure where media_id=file) then raise exception 'MEDIA_ERASURE_QUEUE_FAILED';end if;
 if not exists(select 1 from public.users where id=b and deleted_at is null and status::text='ACTIVE') then raise exception 'DELETION_ISOLATION_FAILED';end if;
end $$;
rollback;
