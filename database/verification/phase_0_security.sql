-- Run after the Phase 0 migration. Every query should return zero rows unless noted.

-- 1. Client-visible public tables missing RLS.
select schemaname, tablename
from pg_tables
where schemaname = 'public'
  and tablename in (
    'institutions', 'campuses', 'faculties', 'departments', 'programmes',
    'profiles', 'institution_memberships', 'role_assignments', 'student_profiles',
    'academic_terms', 'courses', 'course_offerings', 'course_enrollments',
    'timetable_events', 'feature_flags'
  )
  and not rowsecurity;

-- 2. Anonymous privileges on KampusOne application tables.
select table_schema, table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon'
  and table_schema in ('public', 'app_private')
  and table_name in (
    'institutions', 'campuses', 'faculties', 'departments', 'programmes',
    'profiles', 'institution_memberships', 'role_assignments', 'student_profiles',
    'academic_terms', 'courses', 'course_offerings', 'course_enrollments',
    'timetable_events', 'feature_flags', 'audit_events', 'provider_controls',
    'usage_events', 'idempotency_records'
  );

-- 3. Client privileges in the server-only schema.
select table_schema, table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'app_private'
  and grantee in ('anon', 'authenticated');

-- 4. Expected policy inventory. Review the returned rows; this query is informational.
select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'institutions', 'campuses', 'faculties', 'departments', 'programmes',
    'profiles', 'institution_memberships', 'role_assignments', 'student_profiles',
    'academic_terms', 'courses', 'course_offerings', 'course_enrollments',
    'timetable_events', 'feature_flags'
  )
order by tablename, policyname;

-- 5. Definer functions must pin an empty search_path. Should return zero rows.
select namespace.nspname as schema_name, procedure.proname
from pg_proc procedure
join pg_namespace namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'app_private'
  and procedure.prosecdef
  and not coalesce(procedure.proconfig, '{}'::text[]) @> array['search_path='];
