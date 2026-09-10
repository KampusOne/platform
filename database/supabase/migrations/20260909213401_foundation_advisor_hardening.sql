begin;

-- Cover foreign keys used by deletes, tenant joins, and operator/audit lookups.
create index audit_events_actor_idx
  on app_private.audit_events (actor_user_id);
create index provider_controls_institution_idx
  on app_private.provider_controls (institution_id);
create index provider_controls_changed_by_idx
  on app_private.provider_controls (changed_by);
create index usage_events_institution_idx
  on app_private.usage_events (institution_id);
create index usage_events_user_idx
  on app_private.usage_events (user_id);
create index course_enrollments_institution_offering_idx
  on public.course_enrollments (institution_id, offering_id);
create index course_offerings_institution_course_idx
  on public.course_offerings (institution_id, course_id);
create index courses_institution_department_idx
  on public.courses (institution_id, department_id);
create index departments_institution_faculty_idx
  on public.departments (institution_id, faculty_id);
create index feature_flags_institution_idx
  on public.feature_flags (institution_id);
create index feature_flags_updated_by_idx
  on public.feature_flags (updated_by);
create index memberships_verified_by_idx
  on public.institution_memberships (verified_by);
create index profiles_active_institution_idx
  on public.profiles (active_institution_id);
create index programmes_institution_department_idx
  on public.programmes (institution_id, department_id);
create index role_assignments_institution_idx
  on public.role_assignments (institution_id);
create index role_assignments_assigned_by_idx
  on public.role_assignments (assigned_by);
create index student_profiles_institution_membership_idx
  on public.student_profiles (institution_id, membership_id);
create index timetable_events_institution_offering_idx
  on public.timetable_events (institution_id, offering_id);

-- Cache auth.uid() once per statement rather than re-evaluating it per row.
drop policy profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
for select to authenticated
using (id = (select auth.uid()));

drop policy profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy memberships_self_read on public.institution_memberships;
create policy memberships_self_read on public.institution_memberships
for select to authenticated
using (user_id = (select auth.uid()));

drop policy role_assignments_self_read on public.role_assignments;
create policy role_assignments_self_read on public.role_assignments
for select to authenticated
using (user_id = (select auth.uid()));

drop policy student_profiles_self_read on public.student_profiles;
create policy student_profiles_self_read on public.student_profiles
for select to authenticated
using (
  exists (
    select 1
    from public.institution_memberships membership
    where membership.id = student_profiles.membership_id
      and membership.user_id = (select auth.uid())
  )
);

drop policy course_enrollments_self_read on public.course_enrollments;
create policy course_enrollments_self_read on public.course_enrollments
for select to authenticated
using (user_id = (select auth.uid()));

drop policy timetable_events_relevant_read on public.timetable_events;
create policy timetable_events_relevant_read on public.timetable_events
for select to authenticated
using (
  app_private.is_active_member(institution_id)
  and (
    owner_user_id = (select auth.uid())
    or source = 'institution'
    or (source = 'course' and app_private.is_enrolled(offering_id))
  )
);

drop policy timetable_events_personal_insert on public.timetable_events;
create policy timetable_events_personal_insert on public.timetable_events
for insert to authenticated
with check (
  source = 'personal'
  and owner_user_id = (select auth.uid())
  and offering_id is null
  and app_private.is_active_member(institution_id)
);

drop policy timetable_events_personal_update on public.timetable_events;
create policy timetable_events_personal_update on public.timetable_events
for update to authenticated
using (source = 'personal' and owner_user_id = (select auth.uid()))
with check (
  source = 'personal'
  and owner_user_id = (select auth.uid())
  and offering_id is null
  and app_private.is_active_member(institution_id)
);

drop policy timetable_events_personal_delete on public.timetable_events;
create policy timetable_events_personal_delete on public.timetable_events
for delete to authenticated
using (source = 'personal' and owner_user_id = (select auth.uid()));

-- The schema is not exposed and has no client grants. Explicit false policies make
-- its fail-closed behavior visible to reviewers and database advisors as well.
create policy audit_events_clients_denied on app_private.audit_events
for all to anon, authenticated
using (false)
with check (false);

create policy provider_controls_clients_denied on app_private.provider_controls
for all to anon, authenticated
using (false)
with check (false);

create policy usage_events_clients_denied on app_private.usage_events
for all to anon, authenticated
using (false)
with check (false);

create policy idempotency_records_clients_denied on app_private.idempotency_records
for all to anon, authenticated
using (false)
with check (false);

commit;
