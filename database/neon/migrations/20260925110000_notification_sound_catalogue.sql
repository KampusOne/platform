begin;
alter table public.media_objects drop constraint if exists media_objects_kind_check;
alter table public.media_objects add constraint media_objects_kind_check check(kind in ('avatar','cover','product','post','resource','kyc','support','notification-sound'));
create table if not exists public.notification_sounds (
 id uuid primary key default gen_random_uuid(), institution_id uuid references public.universities(id),
 name text not null check(length(name) between 2 and 80), media_id uuid not null references public.media_objects(id),
 is_default boolean not null default false, active boolean not null default true,
 created_by uuid not null references public.users(id), created_at timestamptz not null default now(),
 unique(media_id)
);
create unique index if not exists notification_sounds_default on public.notification_sounds(coalesce(institution_id,'00000000-0000-0000-0000-000000000000'::uuid)) where active and is_default;
alter table public.notification_sounds enable row level security;
commit;
