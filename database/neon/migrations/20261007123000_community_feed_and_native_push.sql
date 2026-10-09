begin;

alter table app_private.push_devices
  add column if not exists native_token text;
create index if not exists push_devices_native_token_idx
  on app_private.push_devices(native_token)
  where native_token is not null and active;

alter table public.student_group_posts
  add column if not exists media_id uuid references public.media_objects(id) on delete set null;
alter table public.student_group_posts
  drop constraint if exists student_group_posts_body_check;
alter table public.student_group_posts
  add constraint student_group_posts_body_check
  check (length(body) <= 5000 and (length(trim(body)) >= 1 or media_id is not null));

alter table public.student_group_comments
  add column if not exists media_id uuid references public.media_objects(id) on delete set null;
alter table public.student_group_comments
  drop constraint if exists student_group_comments_body_check;
alter table public.student_group_comments
  add constraint student_group_comments_body_check
  check (length(body) <= 2000 and (length(trim(body)) >= 1 or media_id is not null));

create table if not exists public.student_group_post_likes (
  post_id uuid not null,
  group_id uuid not null,
  institution_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(post_id,user_id),
  foreign key(post_id,group_id) references public.student_group_posts(id,group_id) on delete cascade,
  foreign key(group_id,institution_id) references public.student_groups(id,institution_id) on delete cascade
);
create index if not exists student_group_post_likes_group_idx
  on public.student_group_post_likes(group_id,post_id);

commit;
