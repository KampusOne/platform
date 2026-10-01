begin;
create table if not exists app_private.foreground_usage_samples(
 id uuid primary key,user_id uuid not null references public.users(id),institution_id uuid not null references public.universities(id),
 platform text not null check(platform in('android','ios','web')),screen text not null check(length(screen) between 1 and 100),
 started_at timestamptz not null,ended_at timestamptz not null,seconds numeric(7,3) not null check(seconds>0 and seconds<=60),created_at timestamptz not null default now(),
 check(ended_at>started_at and ended_at<=started_at+interval '61 seconds')
);
create index if not exists foreground_usage_day on app_private.foreground_usage_samples(institution_id,ended_at,user_id);
alter table app_private.foreground_usage_samples enable row level security;
revoke all on app_private.foreground_usage_samples from public;
commit;
