begin;
set local lock_timeout='5s';
alter table public.media_objects drop constraint if exists media_objects_kind_check;
alter table public.media_objects add constraint media_objects_kind_check check(kind in('avatar','cover','product','post','resource','kyc','support','notification-sound','message')) not valid;
alter table public.media_objects validate constraint media_objects_kind_check;
alter table public.direct_messages add column if not exists media_id uuid references public.media_objects(id);
create index if not exists direct_messages_media_idx on public.direct_messages(media_id) where media_id is not null;
create index if not exists direct_messages_page_idx on public.direct_messages(thread_id,created_at desc,id desc);
commit;
