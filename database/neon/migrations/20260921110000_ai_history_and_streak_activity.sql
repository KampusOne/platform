begin;

-- Requirement IDs 121–126, 130–143, 231–237. New private data only;
-- existing request results and streak totals are preserved.
alter table app_private.ai_requests
 add column if not exists provider text,
 add column if not exists completed_at timestamptz,
 add column if not exists failure_code text,
 add column if not exists provider_status integer,
 add column if not exists allowance_day date;

create table if not exists app_private.ai_daily_usage (
 scope text not null check(scope in ('USER','GLOBAL')),
 scope_key text not null,
 day date not null,
 used integer not null default 0 check(used >= 0),
 primary key(scope,scope_key,day)
);
create table if not exists app_private.ai_study_sessions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.users(id),
 request_key uuid not null,
 mode text not null check(mode in ('study','summary','quiz')),
 prompt text not null,
 source_media_id uuid references public.media_objects(id),
 result jsonb not null,
 created_at timestamptz not null default now(),
 unique(user_id,request_key),
 foreign key(user_id,request_key) references app_private.ai_requests(user_id,idempotency_key)
);
create index if not exists ai_study_sessions_owner_idx
 on app_private.ai_study_sessions(user_id,created_at desc,id);
-- Earlier completed study outputs are retained. Their prompts/source references
-- were never stored, so those fields stay blank rather than being invented.
insert into app_private.ai_study_sessions(user_id,request_key,mode,prompt,result,created_at)
 select user_id,idempotency_key,mode,'',result,created_at from app_private.ai_requests
 where status='COMPLETED' and mode in ('study','summary','quiz') and result is not null
 on conflict(user_id,request_key) do nothing;
revoke all on app_private.ai_daily_usage,app_private.ai_study_sessions from public;

-- A single short database transaction reserves BOTH allowances and claims the
-- idempotency key. Concurrent duplicate requests cannot consume extra allowance.
-- Locks cover reservation only; no provider call holds a database lock.
create or replace function app_private.reserve_ai_request(
 target_user uuid, request_key uuid, content_hash text, request_mode text,
 request_provider text, user_limit integer, global_limit integer
) returns table(outcome text, cached_result jsonb, remaining integer, resets_at timestamptz)
language plpgsql set search_path='' as $$
declare
 today date := (now() at time zone 'Africa/Lagos')::date;
 existing app_private.ai_requests%rowtype;
 user_used integer;
 global_used integer;
begin
 if user_limit < 1 or global_limit < 1 or request_mode not in ('study','summary','quiz','timetable') then
   raise exception 'Invalid AI reservation policy';
 end if;
 perform pg_advisory_xact_lock(92121120000);
 resets_at := (today + 1)::timestamp at time zone 'Africa/Lagos';
 select * into existing from app_private.ai_requests
 where user_id=target_user and idempotency_key=request_key;
 -- The provider call has a 30-second deadline. An interrupted Worker may not
 -- finish its failure transaction; retrying that same key after two minutes
 -- releases its user reservation once while preserving the global attempt.
 if existing.status='PROCESSING' and existing.created_at < now()-interval '2 minutes' then
   perform app_private.finish_ai_request(target_user,request_key,false,null,'',null,'WORKER_INTERRUPTED',null);
   select * into existing from app_private.ai_requests
   where user_id=target_user and idempotency_key=request_key;
 end if;
 select coalesce((select used from app_private.ai_daily_usage
   where scope='USER' and scope_key=target_user::text and day=today),0) into user_used;
 remaining := greatest(user_limit-user_used,0);
 if existing.user_id is not null then
   outcome := case when existing.request_hash<>content_hash then 'CONFLICT' else existing.status end;
   cached_result := case when outcome='COMPLETED' then existing.result else null end;
   return next; return;
 end if;
 select coalesce((select used from app_private.ai_daily_usage
   where scope='GLOBAL' and scope_key='campusone' and day=today),0) into global_used;
 if user_used>=user_limit or global_used>=global_limit then
   outcome := case when user_used>=user_limit then 'USER_LIMIT' else 'GLOBAL_LIMIT' end;
   return next; return;
 end if;
 insert into app_private.ai_requests(user_id,idempotency_key,request_hash,mode,provider,allowance_day)
 values(target_user,request_key,content_hash,request_mode,request_provider,today);
 insert into app_private.ai_daily_usage(scope,scope_key,day,used)
 values('USER',target_user::text,today,1),('GLOBAL','campusone',today,1)
 on conflict(scope,scope_key,day) do update set used=app_private.ai_daily_usage.used+1;
 remaining := remaining-1;
 outcome := 'RESERVED';
 return next;
end;
$$;

-- Failures refund the user's allowance once. The global attempt budget remains
-- charged because a failed/timed-out provider request may still incur a cost.
create or replace function app_private.finish_ai_request(
 target_user uuid, request_key uuid, success boolean, response_result jsonb,
 source_prompt text, source_media uuid, error_code text, http_status integer
) returns boolean language plpgsql set search_path='' as $$
declare request app_private.ai_requests%rowtype;
begin
 select * into request from app_private.ai_requests
 where user_id=target_user and idempotency_key=request_key for update;
 if request.user_id is null or request.status<>'PROCESSING' then return false; end if;
 update app_private.ai_requests
 set status=case when success then 'COMPLETED' else 'FAILED' end,
 result=case when success then response_result else null end,
 completed_at=now(),failure_code=error_code,provider_status=http_status
 where user_id=target_user and idempotency_key=request_key;
 if success and request.mode<>'timetable' then
   insert into app_private.ai_study_sessions(user_id,request_key,mode,prompt,source_media_id,result)
   values(target_user,request_key,request.mode,source_prompt,source_media,response_result);
 elsif not success and request.allowance_day is not null then
   update app_private.ai_daily_usage set used=greatest(used-1,0)
   where scope='USER' and scope_key=target_user::text and day=request.allowance_day;
 end if;
 return true;
end;
$$;
revoke all on function app_private.reserve_ai_request(uuid,uuid,text,text,text,integer,integer) from public;
revoke all on function app_private.finish_ai_request(uuid,uuid,boolean,jsonb,text,uuid,text,integer) from public;

create table if not exists public.streak_activity_days (
 user_id uuid not null references public.users(id),
 day date not null,
 source text not null default 'CHECK_IN' check(source='CHECK_IN'),
 created_at timestamptz not null default now(),
 primary key(user_id,day)
);
alter table public.streak_activity_days enable row level security;
revoke all on public.streak_activity_days from public;
-- Historical totals are kept, but historical activity days are never invented.
-- Qualifying activity is an explicit user check-in, midnight Africa/Lagos.
create or replace function app_private.check_in_streak(target_user uuid)
returns setof public.user_streaks language plpgsql set search_path='' as $$
declare today date := (now() at time zone 'Africa/Lagos')::date;
begin
 insert into public.streak_activity_days(user_id,day) values(target_user,today)
 on conflict(user_id,day) do nothing;
 return query
 insert into public.user_streaks(user_id,current_days,longest_days,last_day)
 values(target_user,1,1,today)
 on conflict(user_id) do update set
 current_days=case when user_streaks.last_day=excluded.last_day then user_streaks.current_days
   when user_streaks.last_day=excluded.last_day-1 then user_streaks.current_days+1 else 1 end,
 longest_days=greatest(user_streaks.longest_days,
   case when user_streaks.last_day=excluded.last_day then user_streaks.current_days
   when user_streaks.last_day=excluded.last_day-1 then user_streaks.current_days+1 else 1 end),
 last_day=excluded.last_day,updated_at=now()
 returning *;
end;
$$;
revoke all on function app_private.check_in_streak(uuid) from public;
commit;
