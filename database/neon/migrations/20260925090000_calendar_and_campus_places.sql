begin;
create table if not exists public.calendar_imports (
  user_id uuid not null references public.users(id),
  request_id uuid not null, request_hash text not null,
  created_at timestamptz not null default now(), primary key(user_id, request_id)
);
create table if not exists public.student_calendar_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
  institution_id uuid not null references public.universities(id), title text not null check(length(title) between 1 and 160),
  starts_on date not null, ends_on date not null check(ends_on >= starts_on), semester text not null default '',
  import_id uuid not null, row_number smallint not null,
  created_at timestamptz not null default now(), unique(user_id, import_id, row_number),
  foreign key(user_id, import_id) references public.calendar_imports(user_id, request_id)
);
create index if not exists student_calendar_events_owner_dates on public.student_calendar_events(user_id, starts_on);
alter table public.calendar_imports enable row level security;
alter table public.student_calendar_events enable row level security;
commit;
