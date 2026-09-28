begin;

create table if not exists public.profile_post_notification_subscriptions (
  subscriber_id uuid not null references public.users(id) on delete cascade,
  target_user_id uuid not null references public.users(id) on delete cascade,
  institution_id uuid not null references public.universities(id),
  created_at timestamptz not null default now(),
  primary key(subscriber_id,target_user_id),
  check(subscriber_id<>target_user_id)
);
create index if not exists profile_post_notification_target_idx
  on public.profile_post_notification_subscriptions(target_user_id,subscriber_id);

alter table public.profile_post_notification_subscriptions enable row level security;
revoke all on public.profile_post_notification_subscriptions from public;

commit;
