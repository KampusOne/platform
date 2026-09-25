-- Owner identified Joshua as @storm_x in the supplied profile screenshot.
-- Only this account's academic fields change; audit retains the previous values.
DO $$
declare prior record; department uuid; programme uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('kampusone-storm-x-academic-correction-20260925',0));
 select p.user_id,p.username,p.university_id,p.faculty_id,p.department_id,p.course_id,p.current_level
 into strict prior from public.profiles p
 where p.user_id='46bf74d7-8f15-422a-b24d-55bef02d6c3a' and p.username='storm_x'
 and p.university_id='6a79211e-6e85-4d95-be24-976edb26ba58' and p.deleted_at is null for update;
 select d.id,c.id into strict department,programme from public.departments d
 join public.faculties f on f.id=d.faculty_id join public.courses c on c.department_id=d.id
 where f.id='ff5d6c9e-2ba9-47e9-98c7-519ec4793d2d' and f.university_id=prior.university_id
 and d.slug='mechatronics-engineering' and c.name='B.Eng Mechatronics Engineering'
 and d.deleted_at is null and f.deleted_at is null and c.deleted_at is null;
 if prior.current_level='200' and prior.department_id=department and prior.course_id=programme then return;end if;
 if prior.current_level not in ('100','200') or prior.department_id not in ('4a30413f-cff8-4733-b1bc-682c8799d453'::uuid,department) then
  raise exception 'Academic profile changed since owner confirmation';end if;
 update public.profiles set current_level='200',faculty_id='ff5d6c9e-2ba9-47e9-98c7-519ec4793d2d',
 department_id=department,course_id=programme,updated_at=now() where user_id=prior.user_id;
 insert into app_private.audit_events(university_id,action,target_type,target_id,request_id,outcome,metadata)
 values(prior.university_id,'profile.academic.corrected','user',prior.user_id::text,'owner-joshua-confirmation-20260925','succeeded',
 jsonb_build_object('before',to_jsonb(prior),'afterLevel','200','afterDepartmentId',department,'afterCourseId',programme,
 'reason','Owner identified Joshua as @storm_x and requested 200 level Mechatronics Engineering'));
end $$;
