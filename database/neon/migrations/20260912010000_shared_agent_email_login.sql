begin;

-- Passwordless portal access is attached to the existing KampusOne user. The
-- private challenge table is separate from account-verification and password-
-- reset tokens so one flow can never consume or invalidate another.
create table if not exists app_private.email_login_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  last_sent_at timestamptz not null default now(),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists email_login_codes_active_user_idx
  on app_private.email_login_codes (user_id)
  where used_at is null;

create index if not exists email_login_codes_user_history_idx
  on app_private.email_login_codes (user_id, created_at desc);

revoke all on table app_private.email_login_codes from public;

commit;
