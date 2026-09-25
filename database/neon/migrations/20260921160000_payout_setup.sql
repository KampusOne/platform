begin;
-- Provider references only: never persist full account numbers or provider payloads.
create table if not exists app_private.payout_account_setups (
 id uuid primary key, user_id uuid not null references public.users(id),
 agent_profile_id uuid not null references public.agent_profiles(id),
 application_id uuid not null references public.agent_applications(id),
 institution_id uuid not null references public.universities(id),
 request_hash text not null,
 status text not null check(status in ('RESOLVING','PENDING_REVIEW','APPROVED','REJECTED','FAILED','SUPERSEDED')),
 bank_code text not null, bank_name text, account_name text, account_last4 char(4),
 recipient_code text, provider_mode text not null check(provider_mode in ('test','live')),
 name_match text check(name_match in ('EXACT','REORDERED','REVIEW_REQUIRED')),
 review_note text, reviewed_by uuid references public.users(id), reviewed_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(status not in ('PENDING_REVIEW','APPROVED') or (recipient_code is not null and account_name is not null and account_last4 is not null))
);
create unique index if not exists payout_setup_inflight_idx on app_private.payout_account_setups(agent_profile_id) where status='RESOLVING';
create index if not exists payout_setup_scope_status_idx on app_private.payout_account_setups(institution_id,status,created_at desc);
revoke all on app_private.payout_account_setups from public;
commit;
