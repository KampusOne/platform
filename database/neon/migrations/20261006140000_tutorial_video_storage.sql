begin;
create table app_private.tutorial_storage_controls(singleton boolean primary key default true check(singleton),bunny_after integer not null default 25 check(bunny_after between 1 and 10000),updated_at timestamptz not null default now(),updated_by uuid references public.users(id));
insert into app_private.tutorial_storage_controls(singleton) values(true);
create table app_private.tutorial_video_assets(
 id uuid primary key,owner_user_id uuid not null references public.users(id) on delete cascade,
 institution_id uuid not null references public.universities(id),provider text not null check(provider in('R2','BUNNY','VDOCIPHER','CLOUDINARY')),
 provider_video_id text,provider_library_id text,original_name text not null,content_type text not null check(content_type in('video/mp4','video/webm')),
 expected_bytes bigint not null check(expected_bytes between 1 and 524288000),
 state text not null default 'RESERVED' check(state in('RESERVED','CREATING','UPLOADED','READY','FAILED')),
 media_id uuid unique references public.media_objects(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '24 hours'
);
create index tutorial_video_storage_count_idx on app_private.tutorial_video_assets(provider,state,expires_at);
alter table app_private.tutorial_storage_controls enable row level security;
alter table app_private.tutorial_video_assets enable row level security;
revoke all on app_private.tutorial_storage_controls,app_private.tutorial_video_assets from public;
create function app_private.reserve_tutorial_video(p_id uuid,p_user uuid,p_uni uuid,p_name text,p_mime text,p_bytes bigint,p_bunny_ready boolean)
 returns app_private.tutorial_video_assets language plpgsql set search_path='' as $$
declare saved app_private.tutorial_video_assets;used integer;threshold integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('tutorial-video-storage',0));
 if not exists(select 1 from public.agent_profiles where user_id=p_user and university_id=p_uni and agent_type='TUTOR' and status='ACTIVE' and verified_at is not null) then raise exception 'VIDEO_TUTOR_FORBIDDEN';end if;
 select * into saved from app_private.tutorial_video_assets where id=p_id;
 if found then
  if saved.owner_user_id is distinct from p_user or saved.institution_id is distinct from p_uni or saved.original_name<>p_name or saved.content_type<>p_mime or saved.expected_bytes<>p_bytes then raise exception 'VIDEO_UPLOAD_CONFLICT';end if;
  if saved.expires_at<=now() and saved.media_id is null then raise exception 'VIDEO_UPLOAD_EXPIRED';end if;
  return saved;
 end if;
 if (select coalesce(sum(expected_bytes),0) from app_private.tutorial_video_assets where owner_user_id=p_user and created_at>now()-interval '1 day' and state<>'FAILED')+p_bytes>2147483648 then raise exception 'VIDEO_DAILY_ALLOWANCE';end if;
 if (select count(*) from app_private.tutorial_video_assets where owner_user_id=p_user and created_at>now()-interval '1 hour' and state<>'FAILED')>=12 then raise exception 'VIDEO_DAILY_ALLOWANCE';end if;
 select bunny_after into threshold from app_private.tutorial_storage_controls where singleton;
 select count(*) into used from app_private.tutorial_video_assets where provider<>'BUNNY' and state<>'FAILED' and(media_id is not null or expires_at>now());
 used=used+(select count(distinct media_object_id) from public.tutorial_resources where resource_type='VIDEO' and deleted_at is null and media_object_id is not null and not exists(select 1 from app_private.tutorial_video_assets where media_id=tutorial_resources.media_object_id));
 if used>=threshold and not p_bunny_ready then raise exception 'VIDEO_BUNNY_REQUIRED';end if;
 insert into app_private.tutorial_video_assets(id,owner_user_id,institution_id,provider,original_name,content_type,expected_bytes)
 values(p_id,p_user,p_uni,case when used>=threshold then 'BUNNY' else 'R2' end,p_name,p_mime,p_bytes) returning * into saved;
 return saved;
end $$;
revoke all on function app_private.reserve_tutorial_video(uuid,uuid,uuid,text,text,bigint,boolean) from public;
commit;
