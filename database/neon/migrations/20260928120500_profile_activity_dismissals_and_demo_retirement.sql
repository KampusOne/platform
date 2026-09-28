begin;

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

-- Retire the old Phase-2 demo catalogue. Keep historical rows for auditability,
-- but make every demo listing/resource unavailable to students.
update public.tutorial_availability_windows windows
set status = 'CANCELLED', updated_at = now()
where windows.listing_id in (
  select listings.id
  from public.tutorial_listings listings
  where listings.is_demo
) and windows.status = 'OPEN';

update public.tutorial_bookings bookings
set status = 'CANCELLED',
    cancellation_reason = coalesce(bookings.cancellation_reason, 'Legacy demo tutorial retired.'),
    cancelled_at = coalesce(bookings.cancelled_at, now()),
    earnings_state = 'NOT_EARNED',
    updated_at = now()
where bookings.listing_id in (
  select listings.id
  from public.tutorial_listings listings
  where listings.is_demo
)
and bookings.status in ('PENDING_PAYMENT', 'CONFIRMED')
and coalesce(bookings.scheduled_for, now() + interval '1 second') > now();

update public.tutorial_listings
set status = 'ARCHIVED',
    deleted_at = coalesce(deleted_at, now()),
    updated_at = now()
where is_demo;

update public.tutorial_resources
set status = 'ARCHIVED',
    deleted_at = coalesce(deleted_at, now()),
    updated_at = now()
where is_demo;

-- Demo content is retired and must not be re-seeded.
drop function if exists app_private.seed_tutorial_demo(uuid, uuid);

commit;
