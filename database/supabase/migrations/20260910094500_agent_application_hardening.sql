begin;

-- Privileged verification decisions cross the Cloudflare Worker boundary. Signed-in
-- browsers may read their scoped queues through RLS but cannot execute definer RPCs.
revoke execute on function public.review_agent_document(uuid, text, text) from authenticated;
revoke execute on function public.review_agent_application(uuid, text, text) from authenticated;
drop function public.review_agent_document(uuid, text, text);
drop function public.review_agent_application(uuid, text, text);

create or replace function public.review_agent_document(
  target_document_id uuid,
  review_outcome text,
  review_reason text,
  actor_id uuid
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

  if target_document.id is null then raise exception 'Document not found'; end if;
  if not app_private.has_any_role(
    target_document.institution_id,
    array['platform_operator', 'institution_admin', 'verification_agent'],
    actor_id
  ) then raise exception 'Not authorised'; end if;

  insert into app_private.agent_document_checks (
    institution_id, document_id, check_type, provider, outcome,
    confidence, signals, requested_by
  ) values (
    target_document.institution_id, target_document.id, 'human_review',
    'kampusone-operator', review_outcome, null,
    jsonb_build_object('reason', trim(review_reason)), actor_id
  );

  update public.agent_application_documents
  set verification_status = review_outcome, checked_at = now()
  where id = target_document.id
  returning * into target_document;

  insert into app_private.audit_events (
    actor_user_id, institution_id, action, target_type, target_id, outcome, metadata
  ) values (
    actor_id, target_document.institution_id, 'agent_document.reviewed',
    'agent_application_document', target_document.id::text, 'succeeded',
    jsonb_build_object('review_outcome', review_outcome, 'reason', trim(review_reason))
  );

  return target_document;
end;
$$;

create or replace function public.review_agent_application(
  target_application_id uuid,
  review_decision text,
  review_reason text,
  actor_id uuid
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

  if target_application.id is null then raise exception 'Application not found'; end if;
  if not app_private.has_any_role(
    target_application.institution_id,
    array['platform_operator', 'institution_admin', 'verification_agent'],
    actor_id
  ) then raise exception 'Not authorised'; end if;

  next_status := case review_decision
    when 'started' then 'under_review'
    when 'request_information' then 'needs_information'
    when 'approve' then 'approved'
    when 'reject' then 'rejected'
  end;

  insert into app_private.agent_application_reviews (
    institution_id, application_id, actor_user_id, decision, reason, application_snapshot
  ) values (
    target_application.institution_id, target_application.id, actor_id,
    review_decision, trim(review_reason), to_jsonb(target_application)
  );

  update public.agent_applications
  set status = next_status, status_reason = trim(review_reason), last_reviewed_at = now()
  where id = target_application.id
  returning * into target_application;

  if review_decision = 'approve' then
    insert into public.institution_memberships (
      institution_id, user_id, member_type, status, verified_at, verified_by
    ) values (
      target_application.institution_id, target_application.applicant_user_id,
      'agent', 'active', now(), actor_id
    )
    on conflict (institution_id, user_id) do update set
      status = 'active', verified_at = now(), verified_by = actor_id;

    insert into public.role_assignments (institution_id, user_id, role, assigned_by)
    select distinct
      target_application.institution_id,
      target_application.applicant_user_id,
      case when requested_role = 'verification' then 'verification_agent' else 'support_agent' end,
      actor_id
    from unnest(target_application.desired_roles) as requested_role
    on conflict do nothing;
  end if;

  insert into app_private.audit_events (
    actor_user_id, institution_id, action, target_type, target_id, outcome, metadata
  ) values (
    actor_id, target_application.institution_id,
    'agent_application.' || review_decision, 'agent_application',
    target_application.id::text, 'succeeded',
    jsonb_build_object('next_status', next_status, 'reason', trim(review_reason))
  );

  return target_application;
end;
$$;

revoke all on function public.review_agent_document(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.review_agent_application(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.review_agent_document(uuid, text, text, uuid) to service_role;
grant execute on function public.review_agent_application(uuid, text, text, uuid) to service_role;

drop policy agent_applications_applicant_read on public.agent_applications;
drop policy agent_applications_operator_read on public.agent_applications;
create policy agent_applications_authorized_read on public.agent_applications
for select to authenticated
using (
  applicant_user_id = (select auth.uid())
  or app_private.has_any_role(
    institution_id,
    array['platform_operator', 'institution_admin', 'verification_agent']
  )
);

drop policy agent_application_documents_applicant_read on public.agent_application_documents;
drop policy agent_application_documents_operator_read on public.agent_application_documents;
create policy agent_application_documents_authorized_read on public.agent_application_documents
for select to authenticated
using (
  exists (
    select 1 from public.agent_applications application
    where application.id = agent_application_documents.application_id
      and application.applicant_user_id = (select auth.uid())
  )
  or app_private.has_any_role(
    institution_id,
    array['platform_operator', 'institution_admin', 'verification_agent']
  )
);

drop policy agent_evidence_applicant_read on storage.objects;
drop policy agent_evidence_operator_read on storage.objects;
create policy agent_evidence_authorized_read on storage.objects
for select to authenticated
using (
  bucket_id = 'agent-evidence'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1 from public.agent_application_documents document
      where document.object_path = storage.objects.name
        and app_private.has_any_role(
          document.institution_id,
          array['platform_operator', 'institution_admin', 'verification_agent']
        )
    )
  )
);

create index agent_application_documents_tenant_application_idx
  on public.agent_application_documents (institution_id, application_id);
create index agent_application_reviews_tenant_application_idx
  on app_private.agent_application_reviews (institution_id, application_id);

comment on function public.review_agent_document(uuid, text, text, uuid) is 'Server-only document review transaction. Callable only with the Worker service credential.';
comment on function public.review_agent_application(uuid, text, text, uuid) is 'Server-only agent decision transaction. Callable only with the Worker service credential.';

commit;
