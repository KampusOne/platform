-- Read-only Phase 1 post-migration evidence. Run after the migration and review every row.

select
  information_table.table_schema,
  information_table.table_name,
  relation.relrowsecurity as row_security,
  relation.relforcerowsecurity as force_row_security
from information_schema.tables information_table
join pg_namespace namespace
  on namespace.nspname = information_table.table_schema
join pg_class relation
  on relation.relnamespace = namespace.oid
  and relation.relname = information_table.table_name
where (information_table.table_schema, information_table.table_name) in (
  ('public', 'onboarding_progress'),
  ('public', 'device_registrations'),
  ('public', 'agent_applications'),
  ('public', 'verification_documents'),
  ('public', 'agent_review_decisions'),
  ('app_private', 'agent_verification_cases'),
  ('app_private', 'verification_checks')
)
order by information_table.table_schema, information_table.table_name;

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where (schemaname, tablename) in (
  ('public', 'onboarding_progress'),
  ('public', 'device_registrations'),
  ('public', 'agent_applications'),
  ('public', 'verification_documents'),
  ('public', 'agent_review_decisions'),
  ('app_private', 'agent_verification_cases'),
  ('app_private', 'verification_checks'),
  ('storage', 'objects')
)
order by schemaname, tablename, policyname;

select grantee, table_schema, table_name, privilege_type
from information_schema.role_table_grants
where grantee in ('anon', 'authenticated')
  and (table_schema, table_name) in (
    ('public', 'onboarding_progress'),
    ('public', 'device_registrations'),
    ('public', 'agent_applications'),
    ('public', 'verification_documents'),
    ('public', 'agent_review_decisions'),
    ('app_private', 'agent_verification_cases'),
    ('app_private', 'verification_checks')
  )
order by table_schema, table_name, grantee, privilege_type;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'verification-documents';

select id, slug, name, short_name, status
from public.institutions
where id = '10000000-0000-4000-8000-000000000001';
