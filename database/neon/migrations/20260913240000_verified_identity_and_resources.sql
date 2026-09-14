begin;
alter table public.tutorial_resources add column if not exists media_object_id uuid references public.media_objects(id);
create index if not exists resources_media_idx on public.tutorial_resources(media_object_id) where media_object_id is not null;
create table if not exists app_private.verified_people(
 user_id uuid primary key references public.users(id),identity_fingerprint text not null unique,
 verified_by uuid not null references public.users(id),verified_at timestamptz not null default now()
);
revoke all on app_private.verified_people from public;
commit;
