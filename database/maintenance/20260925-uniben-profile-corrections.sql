-- Explicit owner request, 25 September 2026. No schema changes or role changes.
-- UNIBEN primary sources:
-- https://eng.uniben.edu/course-structure-bachelor-of-engineering-computer-engineering/
-- https://eng.uniben.edu/course-structure-bachelor-of-engineering-electrical-electronic-engineering/
-- https://eng.uniben.edu/course-structure-bachelor-of-engineering-mechanical-engineering-2/
-- Joshua is NOT matched to Anibe David by assumption; that account remains unchanged.
DO $$
declare institution uuid:='6a79211e-6e85-4d95-be24-976edb26ba58';faculty uuid:='ff5d6c9e-2ba9-47e9-98c7-519ec4793d2d';department uuid;programme uuid;prior record;target uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('kampusone-uniben-profile-corrections-20260925',0));
 if not exists(select 1 from faculties f join universities u on u.id=f.university_id where f.id=faculty and u.id=institution and u.name='University of Benin' and f.name='Faculty of Engineering' and f.deleted_at is null) then raise exception 'University/faculty no longer matches the reviewed records';end if;
 for prior in select c.id,c.name,c.department_id from courses c where c.id in('26c01504-a2a4-45b3-a4eb-b507534ae6c8','5a1a35ea-fd74-4679-a7a2-bd8a9bd7dbec') and c.name in('BSc Computer Engineering','BSc Electrical Engineering') and c.deleted_at is null loop
  update courses set name=replace(prior.name,'BSc ','B.Eng '),updated_at=now() where id=prior.id;
  insert into app_private.audit_events(university_id,action,target_type,target_id,request_id,outcome,metadata) values(institution,'academic.programme.corrected','course',prior.id::text,'owner-request-20260925','succeeded',jsonb_build_object('beforeName',prior.name,'afterName',replace(prior.name,'BSc ','B.Eng '),'reason','Owner reported incorrect degree award; verified against UNIBEN Faculty of Engineering sources'));
 end loop;
 select id into department from departments where faculty_id=faculty and slug='mechatronics-engineering' and deleted_at is null;
 if department is null then
  department:=gen_random_uuid();insert into departments(id,faculty_id,name,slug,updated_at)values(department,faculty,'Mechatronics Engineering','mechatronics-engineering',now());
  insert into app_private.audit_events(university_id,action,target_type,target_id,request_id,outcome,metadata)values(institution,'academic.department.created','department',department::text,'owner-request-20260925','succeeded','{"source":"https://repository.uniben.edu/department-mechatronics-engineering","reason":"Missing verified UNIBEN department requested by owner"}');
 end if;
 select id into programme from courses where department_id=department and name='B.Eng Mechatronics Engineering' and deleted_at is null;
 if programme is null then programme:=gen_random_uuid();insert into courses(id,department_id,name,code,updated_at)values(programme,department,'B.Eng Mechatronics Engineering','MCE',now());end if;
 for prior in select user_id,username,current_level,department_id,course_id,faculty_id from profiles where university_id=institution and deleted_at is null and verification_status::text='VERIFIED' and ((user_id='d34f89d0-aa39-4a92-b52f-a16af84a0b1f' and username='warrior' and display_name='Gideon Igiehon') or (user_id='55c42d3d-86c6-4917-8c16-1834db22ec79' and username='peace' and display_name='Osariemen Orobosa')) for update loop
  if prior.current_level not in ('100','200') then raise exception 'Profile level changed since inspection';end if;
  if prior.current_level='200' and (prior.username='warrior' or prior.department_id=department) then continue;end if;
  update profiles set current_level='200',department_id=case when prior.username='peace' then department else prior.department_id end,course_id=case when prior.username='peace' then programme else prior.course_id end,faculty_id=faculty,updated_at=now() where user_id=prior.user_id;
  insert into app_private.audit_events(university_id,action,target_type,target_id,request_id,outcome,metadata)values(institution,'profile.academic.corrected','user',prior.user_id::text,'owner-request-20260925','succeeded',jsonb_build_object('before',to_jsonb(prior),'afterLevel','200','afterDepartmentId',case when prior.username='peace' then department else prior.department_id end,'reason','Explicit owner request for verified students academic correction'));
 end loop;
end $$;
