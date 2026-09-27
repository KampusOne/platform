begin;
create table if not exists public.marketplace_promotions (
 vendor_profile_id uuid primary key references public.agent_profiles(id) on delete cascade,
 institution_id uuid not null references public.universities(id) on delete cascade,
 active boolean not null default true,
 sort_order integer not null default 0 check(sort_order between 0 and 10000),
 starts_at timestamptz not null default now(), ends_at timestamptz,
 updated_by uuid not null references public.users(id), updated_at timestamptz not null default now(),
 check(ends_at is null or ends_at > starts_at)
);
create index if not exists marketplace_promotions_campus_idx on public.marketplace_promotions(institution_id,sort_order) where active;
revoke all on public.marketplace_promotions from public;
alter table public.tutorial_resources drop constraint if exists tutorial_resources_resource_type_check;
alter table public.tutorial_resources add constraint tutorial_resources_resource_type_check check(resource_type in ('PAST_QUESTION','NOTE','PDF','AUDIOBOOK','VIDEO'));
commit;
