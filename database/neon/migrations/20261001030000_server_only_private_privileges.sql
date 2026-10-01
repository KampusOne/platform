begin;

-- Private functions already sit behind a schema without PUBLIC usage. Remove
-- default execute grants as well, including trigger helpers and legacy checks.
-- The owner/runtime role retains its ownership permissions. No rows change.
revoke all on schema app_private from public;
revoke all on all tables in schema app_private from public;
revoke all on all sequences in schema app_private from public;
revoke all on all functions in schema app_private from public;
alter default privileges in schema app_private revoke execute on functions from public;

do $private_client_roles$
declare
  client_role record;
begin
  for client_role in select rolname from pg_roles where rolname in ('anon', 'anonymous', 'authenticated') loop
    execute format('revoke all on schema app_private from %I', client_role.rolname);
    execute format('revoke all on all tables in schema app_private from %I', client_role.rolname);
    execute format('revoke all on all sequences in schema app_private from %I', client_role.rolname);
    execute format('revoke all on all functions in schema app_private from %I', client_role.rolname);
  end loop;
end;
$private_client_roles$;

commit;
