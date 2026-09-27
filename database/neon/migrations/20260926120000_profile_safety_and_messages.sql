-- Additive user safety and private direct messaging. Worker-only access.
begin;
create table if not exists public.profile_social_policies (
  user_id uuid primary key references public.users(id), institution_id uuid references public.universities(id),
  block_protected boolean not null default false, notify_all_in_app boolean not null default false,
  notify_all_push boolean not null default false, updated_by uuid references public.users(id), updated_at timestamptz not null default now()
);
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.users(id), blocked_id uuid not null references public.users(id),
  institution_id uuid references public.universities(id), reason text, details text,
  created_at timestamptz not null default now(), primary key(blocker_id,blocked_id),
  check(blocker_id <> blocked_id), check(length(reason)<=100), check(length(details)<=1000)
);
create index if not exists user_blocks_target_idx on public.user_blocks(blocked_id);
create table if not exists public.profile_reports (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
  reporter_id uuid not null references public.users(id), institution_id uuid references public.universities(id),
  reason text not null check(length(reason) between 1 and 100), details text check(length(details)<=1000),
  created_at timestamptz not null default now(), check(user_id<>reporter_id)
);
create index if not exists profile_reports_target_idx on public.profile_reports(user_id,created_at desc);
create table if not exists public.profile_post_subscriptions (
  follower_id uuid not null references public.users(id), target_id uuid not null references public.users(id),
  created_at timestamptz not null default now(), primary key(follower_id,target_id), check(follower_id<>target_id)
);
create table if not exists public.direct_threads (
  id uuid primary key default gen_random_uuid(), institution_id uuid references public.universities(id),
  initiator_id uuid not null references public.users(id), recipient_id uuid not null references public.users(id),
  status text not null default 'REQUESTED' check(status in ('REQUESTED','ACCEPTED','DECLINED')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(initiator_id<>recipient_id)
);
create unique index if not exists direct_threads_pair_idx on public.direct_threads(least(initiator_id,recipient_id),greatest(initiator_id,recipient_id));
create table if not exists public.direct_messages (
  id uuid primary key, thread_id uuid not null references public.direct_threads(id), sender_id uuid not null references public.users(id),
  request_preview boolean not null default false, body text not null check(length(body) between 1 and 5000), created_at timestamptz not null default now(), read_at timestamptz
);
create unique index if not exists direct_messages_request_idx on public.direct_messages(thread_id) where request_preview;
create index if not exists direct_messages_thread_idx on public.direct_messages(thread_id,created_at desc);
alter table public.profile_social_policies enable row level security;
alter table public.user_blocks enable row level security;
alter table public.profile_reports enable row level security;
alter table public.profile_post_subscriptions enable row level security;
alter table public.direct_threads enable row level security;
alter table public.direct_messages enable row level security;
revoke all on public.profile_social_policies,public.user_blocks,public.profile_reports,public.profile_post_subscriptions,public.direct_threads,public.direct_messages from public;
commit;
