begin;
create table if not exists app_private.timetable_import_requests (
 user_id uuid not null references public.users(id),request_id uuid not null,request_hash text not null,
 institution_id uuid not null references public.universities(id),entry_ids uuid[] not null default '{}',created_at timestamptz not null default now(),primary key(user_id,request_id)
);
revoke all on app_private.timetable_import_requests from public;
create or replace function app_private.import_timetable_entries(p_user uuid,p_institution uuid,p_request uuid,p_hash text,p_entries jsonb)
returns table(outcome text,imported integer) language plpgsql set search_path='' as $$
declare existing app_private.timetable_import_requests%rowtype;entry jsonb;entry_id uuid;ids uuid[]:='{}';
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text||'-timetable',0));
 select * into existing from app_private.timetable_import_requests where user_id=p_user and request_id=p_request;
 if found then
  if existing.request_hash<>p_hash or existing.institution_id<>p_institution then return query select 'CONFLICT'::text,0;else return query select 'EXISTING'::text,cardinality(existing.entry_ids);end if;
  return;
 end if;
 if not exists(select 1 from public.profiles where user_id=p_user and university_id=p_institution and deleted_at is null)then return query select 'FORBIDDEN'::text,0;return;end if;
 if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)<1 or jsonb_array_length(p_entries)>40 then raise exception 'INVALID_IMPORT';end if;
 for entry in select value from jsonb_array_elements(p_entries) loop
  entry_id:=gen_random_uuid();
  insert into public.timetable_entries(id,user_id,university_id,title,course_code,venue,lecturer,day_of_week,starts_at,ends_at,reminder_minutes,reminder_enabled)
  values(entry_id,p_user,p_institution,entry->>'title',upper(entry->>'courseCode'),entry->>'venue',entry->>'lecturer',(entry->>'dayOfWeek')::smallint,(entry->>'startsAt')::time,(entry->>'endsAt')::time,(entry->>'reminderMinutes')::integer,(entry->>'reminderEnabled')::boolean)
  on conflict do nothing returning id into entry_id;
  if entry_id is null then
   select id into entry_id from public.timetable_entries where user_id=p_user and day_of_week=(entry->>'dayOfWeek')::smallint and starts_at=(entry->>'startsAt')::time and title=entry->>'title' and (to_jsonb(timetable_entries)->>'occurs_on') is null;
  end if;
  ids:=array_append(ids,entry_id);
 end loop;
 insert into app_private.timetable_import_requests(user_id,request_id,request_hash,institution_id,entry_ids)values(p_user,p_request,p_hash,p_institution,ids);
 return query select 'CREATED'::text,cardinality(ids);
end;$$;
revoke all on function app_private.import_timetable_entries(uuid,uuid,uuid,text,jsonb) from public;
commit;
