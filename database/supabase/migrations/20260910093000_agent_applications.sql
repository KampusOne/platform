begin;

create table public.agent_applications (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete restrict,
  applicant_user_id uuid not null references auth.users(id) on delete restrict,
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  email text not null check (char_length(email) between 5 and 254 and email = lower(email)),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
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

create unique index agent_applications_one_open_per_user
  on public.agent_applications (institution_id, applicant_user_id)
  where status in ('draft', 'submitted', 'under_review', 'needs_information', 'approved');

create index agent_applications_queue_idx
  on public.agent_applications (institution_id, status, submitted_at desc nulls last);
create index agent_applications_applicant_idx
  on public.agent_applications (applicant_user_id, updated_at desc);

create table public.agent_application_documents (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null,
  application_id uuid not null,
  kind text not null check (kind in ('government_id', 'student_id', 'proof_of_address', 'portrait', 'other')),
  object_path text not null unique check (object_path !~ '(^|/)\.\.(/|$)'),
  original_filename text not null check (char_length(original_filename) between 1 and 180),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes bigint not null check (size_bytes between 1 and 15728640),
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  upload_status text not null default 'uploaded' check (upload_status in ('uploaded', 'quarantined', 'ready', 'removed')),
  verification_status text not null default 'pending' check (verification_status in ('pending', 'pass', 'review', 'fail')),
  extracted_name text check (extracted_name is null or char_length(extracted_name) <= 160),
  name_match_score numeric(5,4) check (name_match_score is null or name_match_score between 0 and 1),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (institution_id, application_id)
    references public.agent_applications(institution_id, id)
    on delete cascade
);

create index agent_application_documents_application_idx
  on public.agent_application_documents (application_id, verification_status);
create index agent_application_documents_institution_idx
  on public.agent_application_documents (institution_id, created_at desc);

create table app_private.agent_document_checks (
  id bigint generated always as identity primary key,
  institution_id uuid not null references public.institutions(id) on delete restrict,
  document_id uuid not null references public.agent_application_documents(id) on delete restrict,
  check_type text not null check (check_type in ('file_integrity', 'malware', 'ocr', 'name_match', 'identity_provider', 'human_review')),
  provider text not null check (char_length(provider) between 2 and 80),
  outcome text not null check (outcome in ('pass', 'review', 'fail', 'unavailable')),
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  signals jsonb not null default '{}'::jsonb check (jsonb_typeof(signals) = 'object'),
  provider_version text,
  requested_by uuid references auth.users(id) on delete set null,
  request_id text,
  checked_at timestamptz not null default now()
);

create index agent_document_checks_document_idx
  on app_private.agent_document_checks (document_id, checked_at desc);
create index agent_document_checks_institution_idx
  on app_private.agent_document_checks (institution_id, checked_at desc);
create index agent_document_checks_requested_by_idx
  on app_private.agent_document_checks (requested_by);

create table app_private.agent_application_reviews (
  id bigint generated always as identity primary key,
  institution_id uuid not null references public.institutions(id) on delete restrict,
  application_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  decision text not null check (decision in ('started', 'request_information', 'approve', 'reject', 'suspend', 'reinstate')),
  reason text not null check (char_length(trim(reason)) between 4 and 1200),
  application_snapshot jsonb not null check (jsonb_typeof(application_snapshot) = 'object'),
  request_id text,
  created_at timestamptz not null default now(),
  foreign key (institution_id, application_id)
    references public.agent_applications(institution_id, id)
    on delete restrict
);

create index agent_application_reviews_application_idx
  on app_private.agent_application_reviews (application_id, created_at desc);
create index agent_application_reviews_institution_idx
  on app_private.agent_application_reviews (institution_id, created_at desc);
create index agent_application_reviews_actor_idx
  on app_private.agent_application_reviews (actor_user_id);

create trigger agent_applications_updated_at before update on public.agent_applications
for each row execute function app_private.set_updated_at();
create trigger agent_application_documents_updated_at before update on public.agent_application_documents
for each row execute function app_private.set_updated_at();
create trigger agent_document_checks_append_only before update or delete on app_private.agent_document_checks
for each row execute function app_private.prevent_append_only_mutation();
create trigger agent_application_reviews_append_only before update or delete on app_private.agent_application_reviews
for each row execute function app_private.prevent_append_only_mutation();

alter table public.agent_applications enable row level security;
alter table public.agent_applications force row level security;
alter table public.agent_application_documents enable row level security;
alter table public.agent_application_documents force row level security;
alter table app_private.agent_document_checks enable row level security;
alter table app_private.agent_document_checks force row level security;
alter table app_private.agent_application_reviews enable row level security;
alter table app_private.agent_application_reviews force row level security;

create policy agent_applications_applicant_read on public.agent_applications
for select to authenticated
using (applicant_user_id = (select auth.uid()));

create policy agent_applications_operator_read on public.agent_applications
for select to authenticated
using (
  app_private.has_any_role(
    institution_id,
    array['platform_operator', 'institution_admin', 'verification_agent']
  )
);

create policy agent_applications_applicant_insert on public.agent_applications
for insert to authenticated
with check (
  applicant_user_id = (select auth.uid())
  and status = 'draft'
  and submitted_at is null
);

create policy agent_applications_applicant_update on public.agent_applications
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

create policy agent_application_documents_applicant_read on public.agent_application_documents
for select to authenticated
using (
  exists (
    select 1 from public.agent_applications application
    where application.id = agent_application_documents.application_id
      and application.applicant_user_id = (select auth.uid())
  )
);

create policy agent_application_documents_operator_read on public.agent_application_documents
for select to authenticated
using (
  app_private.has_any_role(
    institution_id,
    array['platform_operator', 'institution_admin', 'verification_agent']
  )
);

create policy agent_application_documents_applicant_insert on public.agent_application_documents
for insert to authenticated
with check (
  verification_status = 'pending'
  and upload_status = 'uploaded'
  and exists (
    select 1 from public.agent_applications application
    where application.id = agent_application_documents.application_id
      and application.institution_id = agent_application_documents.institution_id
      and application.applicant_user_id = (select auth.uid())
      and application.status in ('draft', 'needs_information')
  )
);

create policy agent_document_checks_clients_denied on app_private.agent_document_checks
for all to anon, authenticated using (false) with check (false);
create policy agent_application_reviews_clients_denied on app_private.agent_application_reviews
for all to anon, authenticated using (false) with check (false);

revoke all on table public.agent_applications from anon, authenticated;
revoke all on table public.agent_application_documents from anon, authenticated;
grant select, insert on table public.agent_applications to authenticated;
grant update (
  full_name, email, phone, applicant_type, programme, current_level,
  matriculation_number, desired_roles, statement, status, submitted_at
) on table public.agent_applications to authenticated;
grant select, insert on table public.agent_application_documents to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agent-evidence',
  'agent-evidence',
  false,
  15728640,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy agent_evidence_applicant_upload on storage.objects
for insert to authenticated
with check (
  bucket_id = 'agent-evidence'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.agent_applications application
    where application.id::text = (storage.foldername(name))[2]
      and application.applicant_user_id = (select auth.uid())
      and application.status in ('draft', 'needs_information')
  )
);

create policy agent_evidence_applicant_read on storage.objects
for select to authenticated
using (
  bucket_id = 'agent-evidence'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy agent_evidence_operator_read on storage.objects
for select to authenticated
using (
  bucket_id = 'agent-evidence'
  and exists (
    select 1 from public.agent_application_documents document
    where document.object_path = storage.objects.name
      and app_private.has_any_role(
        document.institution_id,
        array['platform_operator', 'institution_admin', 'verification_agent']
      )
  )
);

create policy agent_evidence_applicant_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'agent-evidence'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.agent_applications application
    where application.id::text = (storage.foldername(name))[2]
      and application.applicant_user_id = (select auth.uid())
      and application.status = 'draft'
  )
);

create or replace function public.review_agent_document(
  target_document_id uuid,
  review_outcome text,
  review_reason text
)
returns public.agent_application_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_document public.agent_application_documents;
begin
  if review_outcome not in ('pass', 'review', 'fail') then
    raise exception 'Unsupported document review outcome';
  end if;
  if char_length(trim(review_reason)) < 4 then
    raise exception 'A review reason is required';
  end if;

  select * into target_document
  from public.agent_application_documents
  where id = target_document_id
  for update;

  if target_document.id is null then
    raise exception 'Document not found';
  end if;
  if not app_private.has_any_role(
    target_document.institution_id,
    array['platform_operator', 'institution_admin', 'verification_agent']
  ) then
    raise exception 'Not authorised';
  end if;

  insert into app_private.agent_document_checks (
    institution_id, document_id, check_type, provider, outcome,
    confidence, signals, requested_by
  ) values (
    target_document.institution_id,
    target_document.id,
    'human_review',
    'kampusone-operator',
    review_outcome,
    null,
    jsonb_build_object('reason', trim(review_reason)),
    auth.uid()
  );

  update public.agent_application_documents
  set verification_status = review_outcome,
      checked_at = now()
  where id = target_document.id
  returning * into target_document;

  insert into app_private.audit_events (
    actor_user_id, institution_id, action, target_type, target_id, outcome, metadata
  ) values (
    auth.uid(),
    target_document.institution_id,
    'agent_document.reviewed',
    'agent_application_document',
    target_document.id::text,
    'succeeded',
    jsonb_build_object('review_outcome', review_outcome, 'reason', trim(review_reason))
  );

  return target_document;
end;
$$;

create or replace function public.review_agent_application(
  target_application_id uuid,
  review_decision text,
  review_reason text
)
returns public.agent_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_application public.agent_applications;
  next_status text;
begin
  if review_decision not in ('started', 'request_information', 'approve', 'reject') then
    raise exception 'Unsupported application review decision';
  end if;
  if char_length(trim(review_reason)) < 4 then
    raise exception 'A review reason is required';
  end if;

  select * into target_application
  from public.agent_applications
  where id = target_application_id
  for update;

  if target_application.id is null then
    raise exception 'Application not found';
  end if;
  if not app_private.has_any_role(
    target_application.institution_id,
    array['platform_operator', 'institution_admin', 'verification_agent']
  ) then
    raise exception 'Not authorised';
  end if;

  next_status := case review_decision
    when 'started' then 'under_review'
    when 'request_information' then 'needs_information'
    when 'approve' then 'approved'
    when 'reject' then 'rejected'
  end;

  insert into app_private.agent_application_reviews (
    institution_id, application_id, actor_user_id, decision, reason, application_snapshot
  ) values (
    target_application.institution_id,
    target_application.id,
    auth.uid(),
    review_decision,
    trim(review_reason),
    to_jsonb(target_application)
  );

  update public.agent_applications
  set status = next_status,
      status_reason = trim(review_reason),
      last_reviewed_at = now()
  where id = target_application.id
  returning * into target_application;

  if review_decision = 'approve' then
    insert into public.institution_memberships (
      institution_id, user_id, member_type, status, verified_at, verified_by
    ) values (
      target_application.institution_id,
      target_application.applicant_user_id,
      'agent',
      'active',
      now(),
      auth.uid()
    )
    on conflict (institution_id, user_id) do update set
      status = 'active',
      verified_at = now(),
      verified_by = auth.uid();

    insert into public.role_assignments (institution_id, user_id, role, assigned_by)
    select distinct
      target_application.institution_id,
      target_application.applicant_user_id,
      case
        when requested_role = 'verification' then 'verification_agent'
        else 'support_agent'
      end,
      auth.uid()
    from unnest(target_application.desired_roles) as requested_role
    on conflict do nothing;
  end if;

  insert into app_private.audit_events (
    actor_user_id, institution_id, action, target_type, target_id, outcome, metadata
  ) values (
    auth.uid(),
    target_application.institution_id,
    'agent_application.' || review_decision,
    'agent_application',
    target_application.id::text,
    'succeeded',
    jsonb_build_object('next_status', next_status, 'reason', trim(review_reason))
  );

  return target_application;
end;
$$;

revoke all on function public.review_agent_document(uuid, text, text) from public, anon;
revoke all on function public.review_agent_application(uuid, text, text) from public, anon;
grant execute on function public.review_agent_document(uuid, text, text) to authenticated;
grant execute on function public.review_agent_application(uuid, text, text) to authenticated;

create or replace function app_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_name text;
begin
  requested_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), '')
  );
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(requested_name, 'Student'), 80))
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function app_private.handle_new_auth_user() from public, anon, authenticated;

comment on table public.agent_applications is 'Agent applications visible only to the applicant and scoped operational reviewers.';
comment on table public.agent_application_documents is 'Metadata for private agent evidence. Binary objects remain in the private agent-evidence bucket.';
comment on table app_private.agent_document_checks is 'Append-only automated and human document-check evidence. Unavailable checks are not failures.';
comment on table app_private.agent_application_reviews is 'Append-only operational decisions with reason and application snapshot.';

commit;
