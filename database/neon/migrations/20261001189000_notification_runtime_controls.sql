begin;
create table if not exists app_private.notification_runtime_controls(
 scope_key text primary key,institution_id uuid references public.universities(id),
 push_enabled boolean not null default true,alarms_enabled boolean not null default true,
 newsletter_enabled boolean not null default true,announcements_enabled boolean not null default true,
 campus_updates_enabled boolean not null default true,email_enabled boolean not null default true,
 updated_by uuid not null references public.users(id),updated_at timestamptz not null default now(),
 check(scope_key=coalesce(institution_id::text,'global'))
);
alter table app_private.notification_runtime_controls enable row level security;
revoke all on app_private.notification_runtime_controls from public;
commit;
