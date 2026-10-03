begin;
-- Reapply the server-only boundary to functions created after the earlier
-- privilege migration. Trigger execution retains the owner's authority.
revoke execute on all functions in schema app_private from public;
alter default privileges in schema app_private revoke execute on functions from public;
do $$ declare client_role text; begin
 for client_role in select rolname from pg_roles where rolname in('anon','authenticated','web_anon','authenticator') loop
  execute format('revoke execute on all functions in schema app_private from %I',client_role);
 end loop;
end $$;
commit;
