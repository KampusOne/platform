begin;
-- Individual staff credentials, private operations documents and measured
-- activity. No provider calls, staff grants or broadcast identities are seeded.
create table if not exists app_private.staff_account_provisions(
 actor_user_id uuid not null references public.users(id),request_id uuid not null,
 request_digest text not null check(request_digest ~ '^[a-f0-9]{64}$'),
 user_id uuid not null unique references public.users(id),created_at timestamptz not null default now(),
 primary key(actor_user_id,request_id)
);
revoke all on app_private.staff_account_provisions from public;
create or replace function app_private.provision_staff_account(p_actor uuid,p_request uuid,p_digest text,p_email text,p_password_hash text,p_name text,p_permissions text[],p_universities uuid[],p_all boolean,p_reason text)
returns table(user_id uuid,reused boolean)language plpgsql set search_path='' as $$
declare previous app_private.staff_account_provisions%rowtype;target uuid:=gen_random_uuid();
begin
 perform pg_advisory_xact_lock(hashtextextended('staff-provision:'||p_actor::text||':'||p_request::text,0));
 if not exists(select 1 from public.operator_roles r join public.users u on u.id=r.user_id where r.user_id=p_actor and r.role='PLATFORM_ADMIN'and(r.expires_at is null or r.expires_at>now())and u.deleted_at is null and u.status::text='ACTIVE')then raise exception using errcode='P0001',message='STAFF_PROVISION_FORBIDDEN';end if;
 select * into previous from app_private.staff_account_provisions where actor_user_id=p_actor and request_id=p_request;
 if found then
  if previous.request_digest<>p_digest then raise exception using errcode='P0001',message='STAFF_PROVISION_REQUEST_CHANGED';end if;
  return query select previous.user_id,true;return;
 end if;
 if p_email<>lower(trim(p_email))or length(p_name)<2 or p_password_hash not like '$pbkdf2-sha256$%'or cardinality(p_permissions)<1 or cardinality(p_permissions)>50 or length(p_reason)<10 or(not p_all and cardinality(p_universities)=0)then raise exception using errcode='P0001',message='STAFF_PROVISION_INVALID';end if;
 if exists(select 1 from public.users where lower(email)=p_email)then raise exception using errcode='P0001',message='STAFF_EMAIL_EXISTS';end if;
 if exists(select 1 from unnest(p_universities) school where not exists(select 1 from public.universities u where u.id=school and u.deleted_at is null))then raise exception using errcode='P0001',message='STAFF_UNIVERSITY_UNAVAILABLE';end if;
 insert into public.users(id,email,password_hash,roles,email_verified_at,updated_at)values(target,p_email,p_password_hash,'{}',now(),now());
 insert into public.profiles(id,user_id,username,display_name,updated_at)values(gen_random_uuid(),target,'staff_'||left(replace(target::text,'-',''),24),p_name,now());
 insert into app_private.staff_access(user_id,permissions,university_ids,all_universities,updated_by)values(target,p_permissions,p_universities,p_all,p_actor);
 insert into app_private.staff_account_provisions(actor_user_id,request_id,request_digest,user_id)values(p_actor,p_request,p_digest,target);
 insert into app_private.audit_events(actor_user_id,action,target_type,target_id,request_id,outcome,metadata)
 values(p_actor,'staff.account.created','user',target::text,p_request::text,'succeeded',jsonb_build_object('permissions',p_permissions,'universityIds',p_universities,'allUniversities',p_all,'reason',p_reason,'emailTrust','ADMIN_PROVISIONED'));
 return query select target,false;
end;$$;
revoke all on function app_private.provision_staff_account(uuid,uuid,text,text,text,text,text[],uuid[],boolean,text)from public;

create table if not exists app_private.operations_documents(
 id uuid primary key default gen_random_uuid(),institution_id uuid references public.universities(id),
 media_id uuid not null unique references public.media_objects(id),title text not null check(length(title)between 2 and 160),
 collection text not null check(length(collection)between 2 and 60),description text not null default '' check(length(description)<=2000),
 created_by uuid not null references public.users(id),created_at timestamptz not null default now(),
 archived_at timestamptz,archived_by uuid references public.users(id)
);
create index if not exists operations_document_scope_idx on app_private.operations_documents(institution_id,created_at desc,id)where archived_at is null;
revoke all on app_private.operations_documents from public;
alter table public.media_objects drop constraint if exists media_objects_kind_check;
alter table public.media_objects add constraint media_objects_kind_check check(kind in('avatar','cover','product','post','resource','kyc','support','notification-sound','message','operations-document')) not valid;
alter table public.media_objects validate constraint media_objects_kind_check;

alter table public.product_events add column if not exists platform text check(platform is null or platform in('android','ios','web'));
alter table public.product_events add column if not exists action text check(action is null or action ~ '^[a-z0-9][a-z0-9_-]{0,99}$');
alter table public.product_events add column if not exists component text check(component is null or component ~ '^[a-z0-9][a-z0-9_-]{0,99}$');
alter table public.product_events add column if not exists percent_scrolled smallint check(percent_scrolled is null or percent_scrolled in(25,50,75,90));
alter table public.product_events drop constraint if exists product_events_event_name_check;
alter table public.product_events add constraint product_events_event_name_check check(event_name in('screen_view','feature_started','feature_completed','feature_failed','timetable_import','study_session','application_submitted','ui_interaction','content_action','scroll_depth'));
create index if not exists product_events_platform_scope_idx on public.product_events(institution_id,platform,created_at desc);

create table if not exists app_private.managed_publishers(
 user_id uuid primary key references public.users(id),institution_id uuid not null references public.universities(id),
 all_universities boolean not null default false,active boolean not null default true,
 daily_limit smallint not null default 4 check(daily_limit between 1 and 10),
 reviewed_by uuid not null references public.users(id),reason text not null check(length(reason)between 10 and 1000),updated_at timestamptz not null default now()
);
create table if not exists app_private.managed_publisher_posts(
 post_id uuid primary key references public.feed_posts(id),user_id uuid not null references public.users(id),
 created_at timestamptz not null default now()
);
create index if not exists managed_publisher_daily_idx on app_private.managed_publisher_posts(user_id,created_at);
revoke all on app_private.managed_publishers,app_private.managed_publisher_posts from public;
create or replace function app_private.reserve_managed_publisher_post(p_user uuid,p_post uuid)
returns text language plpgsql set search_path='' as $$
declare publisher app_private.managed_publishers%rowtype;post public.feed_posts%rowtype;used integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('managed-publisher:'||p_user::text,0));
 select * into publisher from app_private.managed_publishers where user_id=p_user and active for share;
 if not found then return 'ORDINARY';end if;
 select * into post from public.feed_posts where id=p_post and author_user_id=p_user and university_id=publisher.institution_id and status in('PUBLISHED','CORRECTED')and published_at<=now()and published_at>=publisher.updated_at;
 if not found then return 'ORDINARY';end if;
 if exists(select 1 from app_private.managed_publisher_posts where post_id=p_post and user_id=p_user)then return case when publisher.all_universities then 'GLOBAL'else 'CAMPUS'end;end if;
 select count(*)into used from app_private.managed_publisher_posts where user_id=p_user and(created_at at time zone 'Africa/Lagos')::date=(now()at time zone 'Africa/Lagos')::date;
 if used>=publisher.daily_limit then return 'LIMIT_REACHED';end if;
 insert into app_private.managed_publisher_posts(post_id,user_id)values(p_post,p_user);
 return case when publisher.all_universities then 'GLOBAL'else 'CAMPUS'end;
end;$$;
revoke all on function app_private.reserve_managed_publisher_post(uuid,uuid)from public;
commit;
