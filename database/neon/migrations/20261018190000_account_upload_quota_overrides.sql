begin;

-- An administrator-owned account override. The mobile client cannot set these values.
-- Other accounts retain the established 12 large uploads/hour and 2 GiB/24h.
create table if not exists app_private.upload_quota_overrides (
  user_id uuid primary key references public.users(id) on delete cascade,
  max_large_uploads_per_hour integer not null check (max_large_uploads_per_hour between 12 and 120),
  max_private_bytes_per_24h bigint not null check (max_private_bytes_per_24h between 2147483648 and 21474836480),
  max_tutorial_videos_per_hour integer not null check (max_tutorial_videos_per_hour between 12 and 120),
  max_tutorial_video_bytes_per_24h bigint not null check (max_tutorial_video_bytes_per_24h between 2147483648 and 21474836480),
  updated_at timestamptz not null default now()
);
alter table app_private.upload_quota_overrides enable row level security;
revoke all on app_private.upload_quota_overrides from public;
comment on table app_private.upload_quota_overrides is 'Server-only, per-account upload allowances; never derive from client-editable profile metadata.';

create or replace function app_private.consume_request_rate_limit(
  p_scope text, p_key_hash text, p_limit integer, p_window_seconds integer, p_block_seconds integer
) returns boolean
language plpgsql
set search_path = ''
as $body$
declare
  selected app_private.request_rate_limits%rowtype;
  effective_limit integer := p_limit;
begin
  if p_limit < 1 or p_window_seconds < 1 or p_block_seconds < 1 then
    raise exception using errcode = '22023', message = 'INVALID_RATE_LIMIT_CONFIGURATION';
  end if;

  -- Only the authenticated account's large-file scope may use this override.
  -- Other API rate limits are deliberately unchanged.
  if p_scope = 'MESSAGE_LARGE_UPLOAD' then
    select greatest(p_limit, quota.max_large_uploads_per_hour)
      into effective_limit
      from app_private.upload_quota_overrides quota
      where quota.user_id::text = p_key_hash;
    effective_limit := coalesce(effective_limit, p_limit);
  end if;

  select limits.* into selected
  from app_private.request_rate_limits limits
  where limits.scope = p_scope and limits.key_hash = p_key_hash
  for update;

  if not found then
    insert into app_private.request_rate_limits (scope, key_hash)
    values (p_scope, p_key_hash);
    return true;
  end if;

  if selected.blocked_until is not null and selected.blocked_until > now() then
    update app_private.request_rate_limits set updated_at = now()
    where scope = p_scope and key_hash = p_key_hash;
    return false;
  end if;

  if selected.window_started_at <= now() - pg_catalog.make_interval(secs => p_window_seconds) then
    update app_private.request_rate_limits
    set window_started_at = now(), attempts = 1, blocked_until = null, updated_at = now()
    where scope = p_scope and key_hash = p_key_hash;
    return true;
  end if;

  if selected.attempts >= effective_limit then
    update app_private.request_rate_limits
    set blocked_until = now() + pg_catalog.make_interval(secs => p_block_seconds), updated_at = now()
    where scope = p_scope and key_hash = p_key_hash;
    return false;
  end if;

  update app_private.request_rate_limits
  set attempts = attempts + 1, updated_at = now()
  where scope = p_scope and key_hash = p_key_hash;
  return true;
end;
$body$;
revoke all on function app_private.consume_request_rate_limit(text,text,integer,integer,integer) from public;

create or replace function app_private.reserve_private_upload(
  p_id uuid,p_user uuid,p_uni uuid,p_key text,p_multipart text,p_name text,p_type text,p_size bigint,p_kind text
) returns app_private.media_upload_sessions
language plpgsql
set search_path = ''
as $body$
declare
  saved app_private.media_upload_sessions;
  used bigint;
  daily_limit bigint;
begin
  if p_kind not in ('message','resource','tutorial','post') or p_size is null or p_size < 1
    or p_size > (case when p_kind = 'resource' then 104857600 when p_kind = 'post' then 52428800 else 524288000 end)
  then raise exception 'UPLOAD_SIZE_INVALID'; end if;

  perform pg_advisory_xact_lock(hashtextextended('message-upload:'||p_user::text,0));
  select * into saved from app_private.media_upload_sessions where id = p_id;
  if found then
    if saved.owner_user_id <> p_user or saved.institution_id is distinct from p_uni
      or saved.upload_kind <> p_kind or saved.original_name <> p_name
      or saved.declared_type <> p_type or saved.expected_bytes <> p_size
      or (saved.expires_at <= now() and saved.status <> 'COMPLETE')
    then raise exception 'UPLOAD_SESSION_CONFLICT'; end if;
    return saved;
  end if;

  select coalesce(quota.max_private_bytes_per_24h,2147483648)
    into daily_limit
    from (select 1) marker
    left join app_private.upload_quota_overrides quota on quota.user_id = p_user;

  select coalesce(sum(expected_bytes),0) into used
  from app_private.media_upload_sessions
  where owner_user_id = p_user and created_at > now() - interval '24 hours' and status <> 'ABORTED';
  if used + p_size > daily_limit then raise exception 'UPLOAD_ALLOWANCE_EXHAUSTED'; end if;

  insert into app_private.media_upload_sessions
    (id,owner_user_id,institution_id,object_key,multipart_id,original_name,declared_type,expected_bytes,upload_kind,transport)
  values (p_id,p_user,p_uni,p_key,p_multipart,p_name,p_type,p_size,p_kind,
    case when p_key like 'direct/%' or p_key like 'post-direct/direct/%' then 'direct' else 'proxy' end)
  returning * into saved;
  return saved;
end;
$body$;
revoke all on function app_private.reserve_private_upload(uuid,uuid,uuid,text,text,text,text,bigint,text) from public;

create or replace function app_private.reserve_tutorial_video(
  p_id uuid,p_user uuid,p_uni uuid,p_name text,p_mime text,p_bytes bigint,p_bunny_ready boolean
) returns app_private.tutorial_video_assets
language plpgsql
set search_path = ''
as $body$
declare
  saved app_private.tutorial_video_assets;
  used integer;
  threshold integer;
  hourly_limit integer;
  daily_limit bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('tutorial-video-storage',0));
  if not exists (
    select 1 from public.agent_profiles where user_id = p_user and university_id = p_uni
      and agent_type = 'TUTOR' and status = 'ACTIVE' and verified_at is not null
  ) then raise exception 'VIDEO_TUTOR_FORBIDDEN'; end if;

  select * into saved from app_private.tutorial_video_assets where id = p_id;
  if found then
    if saved.owner_user_id is distinct from p_user or saved.institution_id is distinct from p_uni
      or saved.original_name <> p_name or saved.content_type <> p_mime or saved.expected_bytes <> p_bytes
    then raise exception 'VIDEO_UPLOAD_CONFLICT'; end if;
    if saved.expires_at <= now() and saved.media_id is null then raise exception 'VIDEO_UPLOAD_EXPIRED'; end if;
    return saved;
  end if;

  select coalesce(quota.max_tutorial_videos_per_hour,12),
         coalesce(quota.max_tutorial_video_bytes_per_24h,2147483648)
    into hourly_limit,daily_limit
    from (select 1) marker
    left join app_private.upload_quota_overrides quota on quota.user_id = p_user;

  if (select coalesce(sum(expected_bytes),0) from app_private.tutorial_video_assets
      where owner_user_id = p_user and created_at > now()-interval '1 day' and state <> 'FAILED')
      + p_bytes > daily_limit
  then raise exception 'VIDEO_DAILY_ALLOWANCE'; end if;
  if (select count(*) from app_private.tutorial_video_assets
      where owner_user_id = p_user and created_at > now()-interval '1 hour' and state <> 'FAILED')
      >= hourly_limit
  then raise exception 'VIDEO_DAILY_ALLOWANCE'; end if;

  -- Preserve the platform-wide R2-to-Bunny threshold and provider protections.
  select bunny_after into threshold from app_private.tutorial_storage_controls where singleton;
  select count(*) into used from app_private.tutorial_video_assets
    where provider <> 'BUNNY' and state <> 'FAILED' and (media_id is not null or expires_at > now());
  used = used + (
    select count(distinct media_object_id) from public.tutorial_resources
    where resource_type = 'VIDEO' and deleted_at is null and media_object_id is not null
      and not exists (select 1 from app_private.tutorial_video_assets
                      where media_id = tutorial_resources.media_object_id)
  );
  if used >= threshold and not p_bunny_ready then raise exception 'VIDEO_BUNNY_REQUIRED'; end if;

  insert into app_private.tutorial_video_assets
    (id,owner_user_id,institution_id,provider,original_name,content_type,expected_bytes)
  values (p_id,p_user,p_uni,case when used >= threshold then 'BUNNY' else 'R2' end,
          p_name,p_mime,p_bytes)
  returning * into saved;
  return saved;
end;
$body$;
revoke all on function app_private.reserve_tutorial_video(uuid,uuid,uuid,text,text,bigint,boolean) from public;
commit;
