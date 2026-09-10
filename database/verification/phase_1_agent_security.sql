-- Read-only acceptance assertions for the Phase 1 agent application boundary.
do $$
declare
  application_rls boolean;
  application_force_rls boolean;
  document_rls boolean;
  document_force_rls boolean;
  evidence_public boolean;
begin
  select relrowsecurity, relforcerowsecurity
  into application_rls, application_force_rls
  from pg_class
  where oid = 'public.agent_applications'::regclass;

  select relrowsecurity, relforcerowsecurity
  into document_rls, document_force_rls
  from pg_class
  where oid = 'public.agent_application_documents'::regclass;

  if not application_rls or not application_force_rls then
    raise exception 'agent_applications must enable and force RLS';
  end if;
  if not document_rls or not document_force_rls then
    raise exception 'agent_application_documents must enable and force RLS';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.review_agent_application(uuid,text,text,uuid)',
    'execute'
  ) then
    raise exception 'authenticated clients must not execute privileged application reviews';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.review_agent_document(uuid,text,text,uuid)',
    'execute'
  ) then
    raise exception 'authenticated clients must not execute privileged document reviews';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.review_agent_application(uuid,text,text,uuid)',
    'execute'
  ) then
    raise exception 'the Worker service role must execute application reviews';
  end if;

  select public into evidence_public
  from storage.buckets
  where id = 'agent-evidence';

  if evidence_public is distinct from false then
    raise exception 'agent evidence bucket must exist and remain private';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'agent_application_reviews_append_only'
      and not tgisinternal
  ) then
    raise exception 'agent application reviews must remain append-only';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'agent_application_status_transition'
      and not tgisinternal
  ) then
    raise exception 'agent application status transitions must remain guarded';
  end if;
end;
$$;
