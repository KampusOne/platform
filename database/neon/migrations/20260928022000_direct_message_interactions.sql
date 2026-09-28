-- Additive direct-message interaction model: replies, reactions, pins, reports, forwarding and unsend tombstones.
begin;
set local lock_timeout='5s';

alter table public.direct_messages
  add column if not exists reply_to_message_id uuid references public.direct_messages(id),
  add column if not exists forwarded_from_message_id uuid references public.direct_messages(id),
  add column if not exists unsent_at timestamptz,
  add column if not exists unsent_by uuid references public.users(id);

create index if not exists direct_messages_reply_idx
  on public.direct_messages(reply_to_message_id)
  where reply_to_message_id is not null;

create index if not exists direct_messages_forwarded_from_idx
  on public.direct_messages(forwarded_from_message_id)
  where forwarded_from_message_id is not null;

create table if not exists public.direct_message_reactions (
  message_id uuid not null references public.direct_messages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  institution_id uuid not null references public.universities(id),
  reaction text not null check(reaction in ('😂','❤️','👍','😮','😭','🔥')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(message_id,user_id)
);

create index if not exists direct_message_reactions_institution_idx
  on public.direct_message_reactions(institution_id,message_id);

create table if not exists public.direct_message_pins (
  thread_id uuid not null references public.direct_threads(id) on delete cascade,
  message_id uuid not null references public.direct_messages(id) on delete cascade,
  pinned_by uuid not null references public.users(id),
  institution_id uuid not null references public.universities(id),
  created_at timestamptz not null default now(),
  primary key(thread_id,message_id)
);

create index if not exists direct_message_pins_institution_idx
  on public.direct_message_pins(institution_id,thread_id,created_at desc);

create table if not exists public.direct_message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.direct_messages(id),
  reporter_id uuid not null references public.users(id),
  institution_id uuid not null references public.universities(id),
  reason text not null check(reason in ('SPAM','HARASSMENT','HATE_OR_ABUSE','SCAM','OTHER')),
  created_at timestamptz not null default now(),
  unique(message_id,reporter_id)
);

create index if not exists direct_message_reports_institution_idx
  on public.direct_message_reports(institution_id,created_at desc);

alter table public.direct_message_reactions enable row level security;
alter table public.direct_message_pins enable row level security;
alter table public.direct_message_reports enable row level security;

revoke all on public.direct_message_reactions, public.direct_message_pins, public.direct_message_reports from public;
commit;
