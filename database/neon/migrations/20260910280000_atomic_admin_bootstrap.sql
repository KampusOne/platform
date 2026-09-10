begin;

create or replace function app_private.bootstrap_platform_admin(
  p_user_id uuid
) returns boolean
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kampusone:platform-admin-bootstrap', 0)
  );

  if exists (select 1 from public.operator_roles) then
    raise exception using errcode = 'P0001', message = 'ADMIN_BOOTSTRAP_ALREADY_COMPLETED';
  end if;

  if not exists (
    select 1 from public.users users
    where users.id = p_user_id
      and users.deleted_at is null
      and users.status::text = 'ACTIVE'
      and users.email_verified_at is not null
  ) then
    raise exception using errcode = 'P0002', message = 'ADMIN_BOOTSTRAP_USER_UNAVAILABLE';
  end if;

  insert into public.operator_roles (user_id, university_id, role, granted_by)
  values (p_user_id, null, 'PLATFORM_ADMIN', p_user_id);

  return true;
end;
$$;

revoke all on function app_private.bootstrap_platform_admin(uuid) from public;

commit;
