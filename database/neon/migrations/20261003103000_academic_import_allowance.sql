begin;
-- One reservation per parse; reviewing or saving the same result is free.
create table if not exists app_private.academic_import_usage (
 user_id uuid not null references public.users(id) on delete cascade,
 institution_id uuid,
 request_id uuid not null,
 kind text not null check (kind in ('calendar','timetable','image','document')),
 created_at timestamptz not null default now(),
 primary key (user_id,request_id)
);
revoke all on app_private.academic_import_usage from public;
create index if not exists academic_import_week_idx on app_private.academic_import_usage(user_id,created_at);

create or replace function app_private.reserve_academic_import(
 p_user_id uuid,p_institution_id uuid,p_request_id uuid,p_kind text,p_limit integer,p_calendar_limit integer
) returns text language plpgsql set search_path=pg_catalog,app_private as $$
declare week_start timestamptz;
begin
 if p_kind not in ('calendar','timetable','image','document') or p_limit<0 or p_calendar_limit<0 then return 'INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':academic-import',0));
 if exists(select 1 from app_private.academic_import_usage where user_id=p_user_id and request_id=p_request_id) then return 'REPLAY'; end if;
 week_start := date_trunc('week',now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
 if (select count(*) from app_private.academic_import_usage where user_id=p_user_id and created_at>=week_start)>=p_limit then return 'WEEK_LIMIT'; end if;
 if p_kind='calendar' and (select count(*) from app_private.academic_import_usage where user_id=p_user_id and kind='calendar' and created_at>=week_start)>=p_calendar_limit then return 'CALENDAR_LIMIT'; end if;
 insert into app_private.academic_import_usage(user_id,institution_id,request_id,kind) values(p_user_id,p_institution_id,p_request_id,p_kind);
 return 'RESERVED';
end $$;
revoke all on function app_private.reserve_academic_import(uuid,uuid,uuid,text,integer,integer) from public;
commit;
