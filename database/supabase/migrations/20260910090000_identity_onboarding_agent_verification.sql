begin;

-- First live tenant. Broader academic catalog imports remain separately reviewed.
insert into public.institutions (id, slug, name, short_name, status, timezone, country_code)
values (
  '10000000-0000-4000-8000-000000000001',
  'uniben',
  'University of Benin',
  'UNIBEN',
  'active',
  'Africa/Lagos',
  'NG'
)
on conflict (id) do update
set name = excluded.name,
    short_name = excluded.short_name,
    status = excluded.status,
    timezone = excluded.timezone,
    country_code = excluded.country_code;

insert into public.campuses (id, institution_id, slug, name, locality, is_primary)
values (
  '11000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'ugbowo',
  'Ugbowo Campus',
  'Benin City',
  true
)
on conflict (id) do update
set name = excluded.name,
    locality = excluded.locality,
    is_primary = excluded.is_primary;

create table public.onboarding_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete restrict,
  current_step smallint not null default 1 check (current_step between 1 and 14),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  permission_preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(permission_preferences) = 'object'),
  privacy_notice_version text,
  analytics_consent boolean not null default false,
  personalisation_consent boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'completed') = (completed_at is not null)),
  check (status <> 'completed' or privacy_notice_version is not null)
);

comment on table public.onboarding_progress is
  'User-owned resumable onboarding answers and explicit optional consent choices. Trusted roles are never derived from this table.';

create table public.device_registrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id uuid not null,
  platform text not null check (platform in ('ios', 'android', 'web')),
  notifications_permission text not null default 'unknown'
    check (notifications_permission in ('unknown', 'prompt', 'granted', 'denied', 'provisional')),
  location_permission text not null default 'unknown'
    check (location_permission in ('unknown', 'prompt', 'approximate', 'precise', 'denied')),
  push_token text,
  push_token_updated_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, installation_id)
);

comment on table public.device_registrations is
  'Per-installation permission health and push routing. Location coordinates never belong in this table.';

-- This table already exists in the connected project from earlier agent-foundation work.
-- IF NOT EXISTS makes that work reproducible without replacing or renaming it.
create table if not exists public.agent_applications (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete restrict,
  applicant_user_id uuid not null references auth.users(id) on delete restrict,
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  email text not null check (char_length(email) between 5 and 254 and email = lower(email)),
  phone text not null check (phone ~ '^\\+[1-9][0-9]{7,14}$'),
  applicant_type text not null check (applicant_type in ('student', 'non_student')),
  programme text check (programme is null or char_length(programme) between 2 and 160),
  current_level smallint check (current_level is null or current_level between 100 and 900),
  matriculation_number text check (matriculation_number is null or char_length(matriculation_number) between 3 and 40),
  desired_roles text[] not null check (
    cardinality(desired_roles) between 1 and 4
    and desired_roles <@ array['verification', 'campus_support', 'vendor_support', 'events']::text[]
  ),
  statement text not null check (char_length(trim(statement)) between 40 and 1200),
  status text not null default 'draft' check (
    status in ('draft', 'submitted', 'under_review', 'needs_information', 'approved', 'rejected', 'withdrawn')
  ),
  status_reason text check (status_reason is null or char_length(status_reason) <= 600),
  submitted_at timestamptz,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'draft' and submitted_at is null) or status <> 'draft'),
  unique (institution_id, id)
);

create index if not exists agent_applications_applicant_time_idx
  on public.agent_applications (applicant_user_id, created_at desc);
create index if not exists agent_applications_review_queue_idx
  on public.agent_applications (institution_id, status, submitted_at)
  where status in ('submitted', 'under_review', 'needs_information');

create table public.verification_documents (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete restrict,
  application_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  document_type text not null check (
    document_type in ('student_identity', 'admission_evidence', 'portrait', 'government_identity', 'supporting_evidence')
  ),
  storage_path text not null unique check (char_length(storage_path) between 12 and 900),
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  file_sha256 text check (file_sha256 is null or file_sha256 ~ '^[a-f0-9]{64}$'),
  verification_state text not null default 'uploaded' check (
    verification_state in ('uploaded', 'checking', 'clear', 'pending_manual_review', 'needs_replacement', 'rejected')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, document_type),
  foreign key (institution_id, application_id)
    references public.agent_applications(institution_id, id)
    on delete cascade
);

create index verification_documents_owner_idx
  on public.verification_documents (owner_user_id, created_at desc);
create index verification_documents_application_idx
  on public.verification_documents (institution_id, application_id);

create table app_private.agent_verification_cases (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete restrict,
  application_id uuid not null,
  automated_outcome text not null default 'not_run'
    check (automated_outcome in ('not_run', 'in_progress', 'clear', 'needs_manual_review', 'provider_error')),
  risk_score numeric(5,4) check (risk_score is null or risk_score between 0 and 1),
  assigned_reviewer_user_id uuid references auth.users(id) on delete set null,
  identity_provider text,
  identity_provider_case_reference text,
  masked_identifier text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id),
  foreign key (institution_id, application_id)
    references public.agent_applications(institution_id, id)
    on delete cascade
);

comment on table app_private.agent_verification_cases is
  'Server-only verification orchestration. Store provider references and masked identifiers, never plaintext NIN.';

create index agent_verification_cases_queue_idx
  on app_private.agent_verification_cases (institution_id, automated_outcome, updated_at);
create index agent_verification_cases_reviewer_idx
  on app_private.agent_verification_cases (assigned_reviewer_user_id, updated_at desc);

create table app_private.verification_checks (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete restrict,
  application_id uuid not null,
  document_id uuid references public.verification_documents(id) on delete cascade,
  provider text not null check (char_length(provider) between 2 and 80),
  check_type text not null check (char_length(check_type) between 2 and 80),
  outcome text not null check (outcome in ('clear', 'pending', 'mismatch', 'provider_error')),
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  reason_codes text[] not null default '{}',
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  occurred_at timestamptz not null default now(),
  request_id text,
  foreign key (institution_id, application_id)
    references public.agent_applications(institution_id, id)
    on delete cascade
);

comment on table app_private.verification_checks is
  'Server-only check summaries. Do not store raw NIN, document images, full OCR payloads or model prompts here.';

create index verification_checks_application_time_idx
  on app_private.verification_checks (application_id, occurred_at desc);
create index verification_checks_document_time_idx
  on app_private.verification_checks (document_id, occurred_at desc);

create table public.agent_review_decisions (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete restrict,
  application_id uuid not null,
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  previous_status text not null,
  decision text not null check (decision in ('under_review', 'needs_information', 'approved', 'rejected')),
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  note text check (note is null or char_length(note) <= 2000),
  request_id text,
  created_at timestamptz not null default now(),
  foreign key (institution_id, application_id)
    references public.agent_applications(institution_id, id)
    on delete restrict
);

create index agent_review_decisions_application_time_idx
  on public.agent_review_decisions (application_id, created_at desc);
create index agent_review_decisions_reviewer_time_idx
  on public.agent_review_decisions (reviewer_user_id, created_at desc);

create or replace function app_private.apply_agent_review_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  select application.status
  into current_status
  from public.agent_applications application
  where application.id = new.application_id
    and application.institution_id = new.institution_id
  for update;

  if current_status is null then
    raise exception 'Agent application does not exist';
  end if;

  new.previous_status := current_status;

  update public.agent_applications
  set status = new.decision,
      status_reason = new.note,
      last_reviewed_at = now(),
      updated_at = now()
  where id = new.application_id;

  update app_private.agent_verification_cases
  set assigned_reviewer_user_id = new.reviewer_user_id,
      updated_at = now()
  where application_id = new.application_id;

  insert into app_private.audit_events (
    actor_user_id,
    institution_id,
    action,
    target_type,
    target_id,
    request_id,
    outcome,
    metadata
  ) values (
    new.reviewer_user_id,
    new.institution_id,
    'agent_application.reviewed',
    'agent_application',
    new.application_id::text,
    new.request_id,
    'succeeded',
    jsonb_build_object(
      'previous_status', current_status,
      'decision', new.decision,
      'reason_code', new.reason_code
    )
  );

  return new;
end;
$$;

revoke all on function app_private.apply_agent_review_decision() from public, anon, authenticated;

create trigger onboarding_progress_updated_at
before update on public.onboarding_progress
for each row execute function app_private.set_updated_at();
create trigger device_registrations_updated_at
before update on public.device_registrations
for each row execute function app_private.set_updated_at();
create trigger agent_applications_phase1_updated_at
before update on public.agent_applications
for each row execute function app_private.set_updated_at();
create trigger verification_documents_updated_at
before update on public.verification_documents
for each row execute function app_private.set_updated_at();
create trigger agent_verification_cases_updated_at
before update on app_private.agent_verification_cases
for each row execute function app_private.set_updated_at();
create trigger agent_review_decisions_apply
before insert on public.agent_review_decisions
for each row execute function app_private.apply_agent_review_decision();
create trigger agent_review_decisions_append_only
before update or delete on public.agent_review_decisions
for each row execute function app_private.prevent_append_only_mutation();
create trigger verification_checks_append_only
before update or delete on app_private.verification_checks
for each row execute function app_private.prevent_append_only_mutation();

alter table public.onboarding_progress enable row level security;
alter table public.device_registrations enable row level security;
alter table public.agent_applications enable row level security;
alter table public.verification_documents enable row level security;
alter table public.agent_review_decisions enable row level security;
alter table app_private.agent_verification_cases enable row level security;
alter table app_private.verification_checks enable row level security;

alter table public.onboarding_progress force row level security;
alter table public.device_registrations force row level security;
alter table public.agent_applications force row level security;
alter table public.verification_documents force row level security;
alter table public.agent_review_decisions force row level security;
alter table app_private.agent_verification_cases force row level security;
alter table app_private.verification_checks force row level security;

create policy onboarding_progress_self_read on public.onboarding_progress
for select to authenticated using (user_id = (select auth.uid()));
create policy onboarding_progress_self_insert on public.onboarding_progress
for insert to authenticated with check (user_id = (select auth.uid()));
create policy onboarding_progress_self_update on public.onboarding_progress
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy device_registrations_self_read on public.device_registrations
for select to authenticated using (user_id = (select auth.uid()));
create policy device_registrations_self_insert on public.device_registrations
for insert to authenticated with check (user_id = (select auth.uid()));
create policy device_registrations_self_update on public.device_registrations
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
create policy device_registrations_self_delete on public.device_registrations
for delete to authenticated using (user_id = (select auth.uid()));

create policy phase1_agent_applications_authorized_read on public.agent_applications
for select to authenticated
using (
  applicant_user_id = (select auth.uid())
  or app_private.has_any_role(
    institution_id,
    array['platform_operator', 'institution_admin', 'verification_agent']
  )
);
create policy phase1_agent_applications_applicant_insert on public.agent_applications
for insert to authenticated
with check (
  applicant_user_id = (select auth.uid())
  and status = 'draft'
  and submitted_at is null
);
create policy phase1_agent_applications_applicant_update on public.agent_applications
for update to authenticated
using (
  applicant_user_id = (select auth.uid())
  and status in ('draft', 'needs_information')
)
with check (
  applicant_user_id = (select auth.uid())
  and status in ('draft', 'submitted')
  and (
    (status = 'draft' and submitted_at is null)
    or (status = 'submitted' and submitted_at is not null)
  )
);

create policy verification_documents_authorized_read on public.verification_documents
for select to authenticated
using (
  owner_user_id = (select auth.uid())
  or app_private.has_any_role(
    institution_id,
    array['platform_operator', 'institution_admin', 'verification_agent']
  )
);
create policy verification_documents_self_insert on public.verification_documents
for insert to authenticated
with check (
  owner_user_id = (select auth.uid())
  and exists (
    select 1
    from public.agent_applications application
    where application.id = verification_documents.application_id
      and application.applicant_user_id = (select auth.uid())
      and application.status in ('draft', 'needs_information')
  )
);
create policy verification_documents_self_delete on public.verification_documents
for delete to authenticated
using (
  owner_user_id = (select auth.uid())
  and exists (
    select 1
    from public.agent_applications application
    where application.id = verification_documents.application_id
      and application.applicant_user_id = (select auth.uid())
      and application.status in ('draft', 'needs_information')
  )
);

create policy agent_review_decisions_authorized_read on public.agent_review_decisions
for select to authenticated
using (
  exists (
    select 1
    from public.agent_applications application
    where application.id = agent_review_decisions.application_id
      and application.applicant_user_id = (select auth.uid())
  )
  or app_private.has_any_role(
    institution_id,
    array['platform_operator', 'institution_admin', 'verification_agent']
  )
);
create policy agent_review_decisions_operator_insert on public.agent_review_decisions
for insert to authenticated
with check (
  reviewer_user_id = (select auth.uid())
  and app_private.has_any_role(
    institution_id,
    array['platform_operator', 'institution_admin', 'verification_agent']
  )
);

create policy agent_verification_cases_clients_denied on app_private.agent_verification_cases
for all to anon, authenticated using (false) with check (false);
create policy verification_checks_clients_denied on app_private.verification_checks
for all to anon, authenticated using (false) with check (false);

revoke all on table public.onboarding_progress from anon, authenticated;
revoke all on table public.device_registrations from anon, authenticated;
revoke all on table public.agent_applications from anon, authenticated;
revoke all on table public.verification_documents from anon, authenticated;
revoke all on table public.agent_review_decisions from anon, authenticated;

grant select, insert, update on table public.onboarding_progress to authenticated;
grant select, insert, update, delete on table public.device_registrations to authenticated;
grant select, insert on table public.agent_applications to authenticated;
grant update (
  full_name,
  email,
  phone,
  applicant_type,
  programme,
  current_level,
  matriculation_number,
  desired_roles,
  statement,
  status,
  submitted_at
) on table public.agent_applications to authenticated;
grant select, insert, delete on table public.verification_documents to authenticated;
grant select, insert on table public.agent_review_decisions to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'verification-documents',
  'verification-documents',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;

create policy verification_storage_owner_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'verification-documents'
  and (storage.foldername(name))[1] = 'agent-applications'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (storage.foldername(name))[3] ~ '^[a-f0-9-]{36}$'
  and exists (
    select 1
    from public.agent_applications application
    where application.id = ((storage.foldername(name))[3])::uuid
      and application.applicant_user_id = (select auth.uid())
      and application.status in ('draft', 'needs_information')
  )
);
create policy verification_storage_owner_read on storage.objects
for select to authenticated
using (
  bucket_id = 'verification-documents'
  and (storage.foldername(name))[1] = 'agent-applications'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);
create policy verification_storage_owner_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'verification-documents'
  and (storage.foldername(name))[1] = 'agent-applications'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (storage.foldername(name))[3] ~ '^[a-f0-9-]{36}$'
  and exists (
    select 1
    from public.agent_applications application
    where application.id = ((storage.foldername(name))[3])::uuid
      and application.applicant_user_id = (select auth.uid())
      and application.status in ('draft', 'needs_information')
  )
);

insert into public.feature_flags (institution_id, key, enabled, client_visible)
values
  (null, 'identity.onboarding', true, true),
  (null, 'agents.application', true, true),
  (null, 'analytics.product', false, true)
on conflict do nothing;

commit;
