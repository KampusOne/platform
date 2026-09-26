begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Confirmation is tied to both the signed-in account and its current session.
create table if not exists app_private.account_deletion_codes (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
 session_family_id uuid not null, token_hash text not null, attempts integer not null default 0,
 expires_at timestamptz not null default now()+interval '10 minutes', used_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists account_deletion_codes_user_idx on app_private.account_deletion_codes(user_id,created_at desc);
create table if not exists app_private.account_media_erasure (
 media_id uuid primary key references public.media_objects(id), object_key text not null,
 kind text not null, attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 erased_at timestamptz, created_at timestamptz not null default now()
);
revoke all on app_private.account_deletion_codes,app_private.account_media_erasure from public;

create or replace function app_private.delete_own_account(actor uuid, family uuid, challenge uuid, code_hash text, request_id text)
returns text language plpgsql security invoker set search_path='' as $$
declare verification app_private.account_deletion_codes%rowtype;
begin
 select * into verification from app_private.account_deletion_codes
 where id=challenge and user_id=actor and session_family_id=family for update;
 if not found or verification.used_at is not null or verification.expires_at<=now() or verification.attempts>=5 then return 'INVALID_CODE'; end if;
 update app_private.account_deletion_codes set attempts=attempts+1 where id=challenge;
 if verification.token_hash<>code_hash then return 'INVALID_CODE'; end if;
 perform 1 from public.users where id=actor and deleted_at is null for update;
 if not found then return 'DELETED'; end if;
 -- Identity tombstones preserve referential integrity of immutable transaction/audit records.
 -- Personal profile, study, social and session data are removed in this transaction.
 update app_private.account_deletion_codes set used_at=now(),token_hash='consumed' where user_id=actor;
 update public.refresh_tokens set revoked_at=coalesce(revoked_at,now()) where user_id=actor;
 update app_private.push_devices set active=false,token='deleted:'||id::text where user_id=actor;
 delete from public.verification_tokens where user_id=actor;
 delete from app_private.email_login_codes where user_id=actor;
 delete from app_private.pending_registrations where user_id=actor;
 delete from public.operator_roles where user_id=actor;
 update public.feed_posts set status='ARCHIVED',title='Deleted post',body='',image_url=null,updated_at=now() where author_user_id=actor;
 update public.feed_comments set body='[deleted]',deleted_at=coalesce(deleted_at,now()) where author_user_id=actor;
 delete from public.feed_comment_likes where user_id=actor;
 delete from public.feed_likes where user_id=actor;
 delete from public.feed_reposts where user_id=actor;
 delete from public.feed_bookmarks where user_id=actor;
 delete from public.profile_follows where follower_id=actor or followed_id=actor;
 delete from public.profile_post_subscriptions where follower_id=actor or target_id=actor;
 delete from public.user_blocks where blocker_id=actor or blocked_id=actor;
 delete from public.profile_social_policies where user_id=actor;
 update public.direct_messages set body='Message removed' where sender_id=actor;
 update public.direct_threads set status='DECLINED',updated_at=now() where initiator_id=actor or recipient_id=actor;
 delete from public.in_app_notifications where user_id=actor;
 update app_private.notification_outbox set state='FAILED',subject='Account deleted',body='' where user_id=actor;
 delete from public.gpa_terms where user_id=actor;
 delete from public.student_alarms where user_id=actor;
 delete from public.timetable_entries where user_id=actor;
 delete from public.course_drafts where user_id=actor;
 delete from public.student_calendar_events where user_id=actor;
 delete from public.calendar_imports where user_id=actor;
 delete from public.streak_activity_days where user_id=actor;
 delete from public.user_streaks where user_id=actor;
 delete from app_private.ai_study_sessions where user_id=actor;
 delete from app_private.ai_requests where user_id=actor;
 delete from app_private.ai_daily_usage where scope='USER' and scope_key=actor::text;
 -- Media is immediately inaccessible; object-store erasure retries separately.
 insert into app_private.account_media_erasure(media_id,object_key,kind)
 select id,object_key,kind from public.media_objects where owner_user_id=actor on conflict do nothing;
 update public.media_objects set deleted_at=coalesce(deleted_at,now()),original_name='deleted' where owner_user_id=actor;
 update public.agent_applications set display_name='Deleted account',phone_e164='0000000000',statement='Account deleted by its owner.',evidence='{}'::jsonb,legal_name=null,address_text=null,emergency_contact_name=null,emergency_contact_phone=null,status='SUSPENDED',updated_at=now() where user_id=actor;
 update public.agent_profiles set status='SUSPENDED',display_name='Deleted account',biography=null,updated_at=now() where user_id=actor;
 update public.profiles set username='deleted_'||replace(id::text,'-','')::varchar(22),display_name='Deleted account',
 first_name=null,last_name=null,biography=null,profile_image_url=null,cover_image_url=null,
 matriculation_number=null,university_id=null,faculty_id=null,department_id=null,course_id=null,current_level=null,
 settings='{}'::jsonb,deleted_at=now(),account_status='DEACTIVATED',updated_at=now() where user_id=actor;
 update public.users set email='deleted+'||id::text||'@account.invalid',password_hash='deleted',roles='{}',
 status='DEACTIVATED',deleted_at=now(),updated_at=now(),email_verified_at=null where id=actor;
 insert into app_private.audit_events(actor_user_id,action,target_type,target_id,request_id,outcome)
 values(actor,'account.deleted','user',actor::text,request_id,'succeeded');
 return 'DELETED';
end $$;
revoke all on function app_private.delete_own_account(uuid,uuid,uuid,text,text) from public;
commit;
