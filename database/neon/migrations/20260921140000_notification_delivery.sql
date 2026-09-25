-- Native push registrations are private; provider tickets are not device delivery proof.
begin;
create table if not exists app_private.push_devices (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.users(id),
 token text not null unique,
 session_family_id uuid not null,
 platform text not null check(platform in ('ios','android')),
 label text not null,
 build_version text not null,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists push_devices_user_idx on app_private.push_devices(user_id,active);
create table if not exists app_private.push_attempts (
 id uuid primary key,
 device_id uuid not null references app_private.push_devices(id),
 actor_user_id uuid not null references public.users(id),
 recipient_user_id uuid not null references public.users(id),
 institution_id uuid references public.universities(id),
 status text not null check(status in ('SENDING','ACCEPTED','RECEIPT_OK','FAILED','UNKNOWN')),
 ticket_id text,
 error_code text,
 observed_at timestamptz,
 created_at timestamptz not null default now(),
 checked_at timestamptz
);
create index if not exists push_attempts_device_idx on app_private.push_attempts(device_id,created_at desc);
revoke all on app_private.push_devices,app_private.push_attempts from public;
commit;
