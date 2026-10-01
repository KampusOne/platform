-- Approved agents share their student identity and follower graph.
-- Public presentation only: identity/KYC evidence never belongs in this column.
alter table public.agent_profiles
  add column if not exists public_details jsonb not null default '{}'::jsonb;

alter table public.agent_profiles
  add constraint agent_public_details_object check (jsonb_typeof(public_details) = 'object');

create index if not exists agent_profiles_public_lookup_idx
  on public.agent_profiles (university_id, user_id, agent_type) where status = 'ACTIVE';
