begin;
-- Match the streaming API without increasing the limits for identity evidence.
alter table public.media_objects drop constraint if exists media_objects_size_bytes_check;
alter table public.media_objects add constraint media_objects_size_bytes_check check(
 size_bytes >= 1 and size_bytes <= case
 when kind='message' then 524288000
 when kind='post' and content_type in('video/mp4','video/webm') then 52428800
 when kind='notification-sound' then 2097152
 else 10485760 end
);
alter table public.media_objects drop constraint if exists media_objects_kind_check;
alter table public.media_objects add constraint media_objects_kind_check check(kind in('avatar','cover','product','post','resource','kyc','support','notification-sound','message','operations-document','map-capture'));
create table if not exists app_private.campus_map_controls(
 campus_id uuid primary key references public.institution_campuses(id),
 three_d_enabled boolean not null default true,
 satellite_enabled boolean not null default false,
 capture_enabled boolean not null default true,
 updated_by uuid references public.users(id),updated_at timestamptz not null default now()
);
alter table app_private.campus_map_controls enable row level security;
revoke all on app_private.campus_map_controls from public;
alter table app_private.map_capture_missions add column if not exists completed_at timestamptz;
alter table app_private.map_capture_missions add constraint map_mission_status check(status in('OPEN','COMPLETE','CANCELLED'));
alter table app_private.map_capture_missions add constraint map_mission_kind check(kind in('PHOTO','ENTRANCE','PATH_CHECK','ACCESSIBILITY'));
alter table app_private.map_capture_submissions add column if not exists reviewer_user_id uuid references public.users(id);
alter table app_private.map_capture_submissions add column if not exists reviewed_at timestamptz;
alter table app_private.map_capture_submissions add column if not exists decision_note text;
alter table app_private.map_capture_submissions add constraint map_submission_status check(status in('PENDING','APPROVED','REJECTED'));
alter table app_private.map_capture_submissions add constraint map_capture_position check(latitude between -90 and 90 and longitude between -180 and 180 and accuracy_metres between 0 and 50 and (heading is null or heading between 0 and 360));
create unique index if not exists map_capture_media_once on app_private.map_capture_submissions(media_id);
alter table public.campus_place_media add column if not exists media_id uuid references public.media_objects(id);
create unique index if not exists campus_place_capture_once on public.campus_place_media(media_id) where media_id is not null;
commit;
