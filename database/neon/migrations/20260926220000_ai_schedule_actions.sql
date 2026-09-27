begin;
-- The proposal, timetable mutation and receipt commit together. The Worker passes
-- authenticated IDs only; model output is a stored draft, never executable SQL.
create or replace function app_private.apply_ai_schedule_action(
  p_user uuid, p_request uuid, p_action uuid, p_undo boolean default false
) returns table(outcome text, entry_id uuid)
language plpgsql set search_path='' as $$
declare
  saved jsonb; proposal jsonb; draft jsonb; before_row jsonb;
  slot integer; target uuid; stamp timestamptz; current_row public.timetable_entries%rowtype;
  institution uuid; request_time timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,241));
  select result,created_at into saved,request_time from app_private.ai_requests
    where user_id=p_user and idempotency_key=p_request and mode='study' and status='COMPLETED'
      and result ? 'text' and created_at>now()-interval '90 days' for update;
  if saved is null then return query select 'NOT_FOUND'::text,null::uuid; return; end if;
  select value,ordinality::integer-1 into proposal,slot from jsonb_array_elements(coalesce(saved->'actions','[]'::jsonb)) with ordinality
    where value->>'id'=p_action::text and value->>'type'='timetable' limit 1;
  if proposal is null then return query select 'NOT_FOUND'::text,null::uuid; return; end if;
  target:=coalesce((proposal->>'entryId')::uuid,p_action);
  if p_undo and coalesce((proposal->>'undone')::boolean,false) then
    return query select 'UNDONE'::text,target; return;
  end if;
  if not p_undo and coalesce((proposal->>'confirmed')::boolean,false) then
    return query select 'SAVED'::text,target; return;
  end if;
  if request_time<=now()-interval '1 day' then return query select 'EXPIRED'::text,target; return; end if;
  if not p_undo and coalesce((proposal->>'undone')::boolean,false) then
    return query select 'EXPIRED'::text,target; return;
  end if;
  if p_undo then
    if not coalesce((proposal->>'confirmed')::boolean,false) then return query select 'NOT_APPLIED'::text,target; return; end if;
    select * into current_row from public.timetable_entries where id=target and user_id=p_user for update;
    if current_row.id is null or current_row.updated_at is distinct from (proposal->>'appliedUpdatedAt')::timestamptz then
      return query select 'CHANGED'::text,target; return;
    end if;
    if proposal->>'operation'='update' then
      before_row:=proposal->'before';
      update public.timetable_entries set title=before_row->>'title',course_code=before_row->>'course_code',venue=before_row->>'venue',
        lecturer=before_row->>'lecturer',day_of_week=(before_row->>'day_of_week')::smallint,
        starts_at=(before_row->>'starts_at')::time,ends_at=(before_row->>'ends_at')::time,
        reminder_minutes=(before_row->>'reminder_minutes')::integer,reminder_enabled=(before_row->>'reminder_enabled')::boolean,
        occurs_on=(before_row->>'occurs_on')::date,updated_at=clock_timestamp()
        where id=target and user_id=p_user;
    else
      update public.timetable_entries set status='ARCHIVED',updated_at=clock_timestamp() where id=target and user_id=p_user;
    end if;
    proposal:=(proposal-'before')||jsonb_build_object('confirmed',false,'undone',true);
  else
    draft:=proposal->'entry';
    select university_id into institution from public.profiles where user_id=p_user and deleted_at is null;
    if institution is null then return query select 'NOT_FOUND'::text,target; return; end if;
    if (draft->>'date') is not null and ((draft->>'date')::date+(draft->>'startsAt')::time) at time zone 'Africa/Lagos'<=now() then
      return query select 'EXPIRED'::text,target; return;
    end if;
    if proposal->>'operation'='update' then
      select * into current_row from public.timetable_entries where id=target and user_id=p_user and university_id=institution and status='ACTIVE' for update;
      if current_row.id is null or current_row.updated_at is distinct from (proposal->>'expectedUpdatedAt')::timestamptz then
        return query select 'CHANGED'::text,target; return;
      end if;
      before_row:=to_jsonb(current_row);
      update public.timetable_entries set title=draft->>'title',course_code=coalesce(draft->>'courseCode',''),venue=coalesce(draft->>'venue',''),
        lecturer=coalesce(draft->>'lecturer',''),day_of_week=(draft->>'dayOfWeek')::smallint,
        starts_at=(draft->>'startsAt')::time,ends_at=(draft->>'endsAt')::time,
        reminder_minutes=coalesce((draft->>'reminderMinutes')::integer,15),reminder_enabled=coalesce((draft->>'reminderEnabled')::boolean,true),
        occurs_on=(draft->>'date')::date,updated_at=clock_timestamp()
        where id=target and user_id=p_user returning updated_at into stamp;
      proposal:=proposal||jsonb_build_object('before',before_row);
    else
      insert into public.timetable_entries(id,university_id,user_id,title,course_code,venue,lecturer,day_of_week,starts_at,ends_at,reminder_minutes,reminder_enabled,occurs_on)
        values(target,institution,p_user,draft->>'title',coalesce(draft->>'courseCode',''),coalesce(draft->>'venue',''),coalesce(draft->>'lecturer',''),
        (draft->>'dayOfWeek')::smallint,(draft->>'startsAt')::time,(draft->>'endsAt')::time,
        coalesce((draft->>'reminderMinutes')::integer,15),coalesce((draft->>'reminderEnabled')::boolean,true),(draft->>'date')::date)
        on conflict do nothing returning updated_at into stamp;
      if stamp is null then return query select 'CHANGED'::text,target; return; end if;
    end if;
    proposal:=proposal||jsonb_build_object('confirmed',true,'undone',false,'appliedUpdatedAt',stamp);
  end if;
  update app_private.ai_requests set result=jsonb_set(saved,array['actions',slot::text],proposal)
    where user_id=p_user and idempotency_key=p_request;
  return query select case when p_undo then 'UNDONE' else 'SAVED' end,target;
end $$;
revoke all on function app_private.apply_ai_schedule_action(uuid,uuid,uuid,boolean) from public;
commit;
