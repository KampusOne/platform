begin;

-- Reconcile two missing prerequisites on the October 1 live baseline.
-- The message media kind already exists in production. Do not replay the older
-- sound migration's narrower media check, which rejects existing message files.
-- Do not replay demo retirement: it would cancel existing tutorial bookings.
-- Existing media, bookings, earnings and academic relationships stay intact.

create table if not exists public.notification_sounds (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid references public.universities(id),
  name text not null check (length(name) between 2 and 80),
  media_id uuid not null references public.media_objects(id),
  is_default boolean not null default false,
  active boolean not null default true,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  unique (media_id)
);
create unique index if not exists notification_sounds_default
  on public.notification_sounds (
    coalesce(institution_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where active and is_default;
alter table public.notification_sounds enable row level security;
revoke all on public.notification_sounds from public;

create table if not exists public.student_activity_dismissals (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  activity_kind text not null check (activity_kind in ('TUTORIAL_BOOKING', 'ORDER')),
  resource_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, activity_kind, resource_id)
);
create index if not exists student_activity_dismissals_user_idx
  on public.student_activity_dismissals (user_id, created_at desc);
alter table public.student_activity_dismissals enable row level security;
revoke all on public.student_activity_dismissals from public;

commit;
