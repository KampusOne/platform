-- Synthetic acceptance fixtures only. Run inside a savepoint and roll it back.
do $$
declare
 u uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); campus uuid:=gen_random_uuid();
 request uuid:=gen_random_uuid(); paper uuid; event uuid:=gen_random_uuid(); upload uuid:=gen_random_uuid();
 day date:=(now() at time zone 'Africa/Lagos')::date+20; ids uuid[]; n integer; replay boolean;
begin
 insert into public.universities(id,name,slug,updated_at) values(campus,'Followup fixture',campus::text,now());
 insert into public.users(id,email,password_hash,updated_at) values
  (u,u::text||'@example.invalid','fixture-only',now()),(other_user,other_user::text||'@example.invalid','fixture-only',now());
 insert into public.profiles(id,user_id,username,display_name,university_id,updated_at) values
  (u,u,'fixture_'||right(u::text,12),'Fixture',campus,now()),
  (other_user,other_user,'fixture_'||right(other_user::text,12),'Fixture',campus,now());
 select imported,replayed into n,replay from app_private.add_personal_assessment(u,campus,request,'fixture','TEST',
  jsonb_build_object('title','Private class test','courseCode','','date',day,'startsAt','14:00','endsAt','15:00','venue',''));
 if n<>1 or replay then raise exception 'PERSONAL_TEST_IMPORT_FAILED';end if;
 select imported,replayed into n,replay from app_private.add_personal_assessment(u,campus,request,'fixture','TEST',
  jsonb_build_object('title','Private class test','courseCode','','date',day,'startsAt','14:00','endsAt','15:00','venue',''));
 if n<>1 or not replay then raise exception 'PERSONAL_TEST_REPLAY_FAILED';end if;
 select id into paper from public.student_exams where user_id=u;
 select array_agg(id) into ids from public.student_alarms where user_id=u;
 if cardinality(ids)<>4 then raise exception 'EXAM_LEADS_FAILED';end if;
 if app_private.clear_student_alarms(other_user,ids)<>0 then raise exception 'ALARM_OWNER_BOUNDARY_FAILED';end if;
 if app_private.clear_student_alarms(u,ids)<>4 then raise exception 'ALARM_CLEAR_FAILED';end if;
 if not exists(select 1 from public.student_exams where id=paper and not reminders_enabled) then raise exception 'PAPER_PRESERVATION_FAILED';end if;
 perform app_private.import_exam_alarms(u,array[paper]);perform app_private.import_exam_alarms(u,array[paper]);
 if (select count(*) from public.student_alarms where user_id=u)<>4 then raise exception 'EXAM_REIMPORT_DUPLICATES';end if;
 perform app_private.import_exam_schedule(u,campus,gen_random_uuid(),'timetable-fixture',jsonb_build_array(
  jsonb_build_object('title','Timetable paper','courseCode','CSC 201','date',day,'startsAt','09:00','endsAt','11:00','venue','')));
 if not exists(select 1 from public.student_exams where id=paper and is_personal and assessment_kind='TEST') then raise exception 'PERSONAL_TEST_REPLACED';end if;
 request=gen_random_uuid();
 insert into public.calendar_imports(user_id,request_id,request_hash)values(u,request,'calendar-fixture');
 insert into public.student_calendar_events(id,user_id,institution_id,title,starts_on,ends_on,semester,import_id,row_number)
 values(event,u,campus,'Registration closes',day,day,'First',request,0);
 if app_private.import_calendar_alarms(other_user,array[event],'08:00')<>0 then raise exception 'CALENDAR_OWNER_BOUNDARY_FAILED';end if;
 perform app_private.import_calendar_alarms(u,array[event],'08:00');perform app_private.import_calendar_alarms(u,array[event],'08:00');
 if (select count(*) from public.student_alarms where calendar_event_id=event)<>1 then raise exception 'CALENDAR_REIMPORT_DUPLICATES';end if;
 if not exists(select 1 from public.student_alarms where calendar_event_id=event and fires_at=(day+time '08:00') at time zone 'Africa/Lagos') then raise exception 'CALENDAR_TIMEZONE_FAILED';end if;
 perform app_private.reserve_private_upload(upload,u,campus,'post-direct/direct/post/'||u::text||'/'||upload::text,'fixture-multipart','clip.mp4','video/mp4',52428800,'post');
 if not exists(select 1 from app_private.media_upload_sessions where id=upload and transport='direct') then raise exception 'DIRECT_TRANSPORT_FAILED';end if;
 perform app_private.reserve_private_upload(upload,u,campus,'ignored-retry-key','ignored-retry-upload','clip.mp4','video/mp4',52428800,'post');
 begin
  perform app_private.reserve_private_upload(upload,other_user,campus,'ignored','ignored','clip.mp4','video/mp4',52428800,'post');
  raise exception 'UPLOAD_OWNER_BOUNDARY_FAILED';
 exception when others then if sqlerrm<>'UPLOAD_SESSION_CONFLICT' then raise;end if;end;
 begin
  perform app_private.reserve_private_upload(gen_random_uuid(),u,campus,'direct/post/fixture','fixture','clip.mp4','video/mp4',52428801,'post');
  raise exception 'UPLOAD_SIZE_BOUNDARY_FAILED';
 exception when others then if sqlerrm<>'UPLOAD_SIZE_INVALID' then raise;end if;end;
end $$;
