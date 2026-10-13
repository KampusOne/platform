begin;
-- A provider outage must not let the first twenty requests monopolize recovery.
-- This is an attempt schedule, separate from verified provider timestamps.
alter table app_private.agent_payout_settlements add column next_check_at timestamptz not null default now();
create index agent_payout_next_check on app_private.agent_payout_settlements(next_check_at,created_at) where initiated_at is not null;
commit;
