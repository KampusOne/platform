begin;

create or replace function app_private.enforce_agent_application_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = old.status then return new; end if;

  if not (
    (old.status = 'draft' and new.status in ('submitted', 'withdrawn'))
    or (old.status = 'submitted' and new.status in ('under_review', 'needs_information', 'approved', 'rejected', 'withdrawn'))
    or (old.status = 'under_review' and new.status in ('needs_information', 'approved', 'rejected'))
    or (old.status = 'needs_information' and new.status in ('submitted', 'withdrawn'))
  ) then
    raise exception 'Unsupported agent application transition: % to %', old.status, new.status;
  end if;

  return new;
end;
$$;

revoke all on function app_private.enforce_agent_application_transition() from public, anon, authenticated;

create trigger agent_application_status_transition
before update of status on public.agent_applications
for each row execute function app_private.enforce_agent_application_transition();

comment on function app_private.enforce_agent_application_transition() is 'Rejects invalid or reversible agent application status changes, including mutation of final decisions.';

commit;
