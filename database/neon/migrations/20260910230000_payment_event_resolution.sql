begin;

alter table public.payment_provider_events
  add column if not exists resolution_code text,
  add column if not exists resolution_note text,
  add column if not exists reviewer_user_id uuid references public.users(id) on delete set null,
  add column if not exists resolved_at timestamptz;

alter table public.payment_provider_events
  drop constraint if exists payment_provider_events_state_check;
alter table public.payment_provider_events
  add constraint payment_provider_events_state_check
  check (state in ('RECEIVED', 'PROCESSED', 'REQUIRES_REVIEW', 'RESOLVED'));

commit;
