begin;
alter table public.student_groups add column guidelines text not null default '' check(length(guidelines)<=5000);
alter table public.student_groups add column guidelines_version integer not null default 1 check(guidelines_version>0);
alter table public.student_group_members add column nickname text check(length(nickname)<=60);
alter table public.student_group_members alter column notifications_enabled set default true;
create table app_private.community_join_requests(
 id uuid primary key default gen_random_uuid(),group_id uuid not null,institution_id uuid not null,
 user_id uuid not null references public.users(id) on delete cascade,
 full_name text not null check(length(trim(full_name)) between 2 and 120),
 matriculation_number text not null check(length(trim(matriculation_number)) between 2 and 60),
 department text not null check(length(trim(department)) between 2 and 180),
 level text not null check(length(trim(level)) between 1 and 30),nickname text not null check(length(trim(nickname)) between 1 and 60),
 guidelines_version integer not null,guidelines_snapshot text not null,guidelines_accepted_at timestamptz not null default now(),
 status text not null default 'PENDING' check(status in('PENDING','APPROVED','DECLINED')),
 reviewed_by uuid references public.users(id),reviewed_at timestamptz,created_at timestamptz not null default now(),
 unique(group_id,user_id),foreign key(group_id,institution_id) references public.student_groups(id,institution_id) on delete cascade
);
create index community_join_pending_idx on app_private.community_join_requests(group_id,created_at,id) where status='PENDING';
alter table app_private.community_join_requests enable row level security;
revoke all on app_private.community_join_requests from public;
create or replace function app_private.review_community_join_requests(p_group uuid,p_admin uuid,p_institution uuid,p_ids uuid[],p_all boolean,p_decision text)
returns integer language plpgsql set search_path='' as $$
declare n integer;
begin
 if p_decision not in('APPROVED','DECLINED') or cardinality(p_ids)>200 then raise exception 'JOIN_REVIEW_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('community-review:'||p_group::text,0));
 if not exists(select 1 from public.student_group_members where group_id=p_group and user_id=p_admin and institution_id=p_institution and role='ADMIN') then raise exception 'JOIN_REVIEW_FORBIDDEN';end if;
 with reviewed as(
  update app_private.community_join_requests r set status=p_decision,reviewed_by=p_admin,reviewed_at=now()
  where r.group_id=p_group and r.institution_id=p_institution and r.status='PENDING' and (p_all or r.id=any(p_ids))
  and exists(select 1 from public.profiles p join public.users u on u.id=p.user_id where p.user_id=r.user_id and p.university_id=p_institution and p.deleted_at is null and u.status::text='ACTIVE' and u.deleted_at is null)
  returning r.*
 ),joined as(
  insert into public.student_group_members(group_id,institution_id,user_id,nickname,notifications_enabled)
  select group_id,institution_id,user_id,nickname,true from reviewed where status='APPROVED'
  on conflict(group_id,user_id) do nothing
 ) select count(*)::int into n from reviewed;
 return n;
end $$;
revoke all on function app_private.review_community_join_requests(uuid,uuid,uuid,uuid[],boolean,text) from public;
commit;
