begin;
create table if not exists app_private.application_checks (
 id uuid primary key default gen_random_uuid(),application_id uuid not null references public.agent_applications(id),institution_id uuid not null references public.universities(id),
 source_revision text not null,check_version text not null,result_schema_version integer not null default 1,
 status text not null check(status in('QUEUED','RUNNING','COMPLETED','FAILED')),review_group text check(review_group in('COMPLETE','NEEDS_REVIEW')),
 flags jsonb not null default '[]',coverage jsonb not null default '{}',attempts integer not null default 1 check(attempts between 1 and 3),
 requested_by uuid references public.users(id),error_code text,created_at timestamptz not null default now(),started_at timestamptz,completed_at timestamptz,
 unique(application_id,source_revision,check_version)
);
create index if not exists application_check_lookup_idx on app_private.application_checks(application_id,created_at desc);
revoke all on app_private.application_checks from public;
create table if not exists app_private.agent_review_previews (
 id uuid primary key default gen_random_uuid(),actor_user_id uuid not null references public.users(id),decision text not null check(decision in('APPROVED','NEEDS_CORRECTION','REJECTED')),
 snapshots jsonb not null,created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '10 minutes',confirmed_at timestamptz,
 check(jsonb_typeof(snapshots)='array' and jsonb_array_length(snapshots) between 1 and 25)
);
revoke all on app_private.agent_review_previews from public;
create or replace function app_private.review_agent_application(p_actor uuid,p_application uuid,p_decision text,p_note text,p_request text,p_revision text)
returns text language plpgsql set search_path='' as $$
declare application public.agent_applications%rowtype;details public.agent_application_details%rowtype;years integer;docs integer;
begin
 select * into application from public.agent_applications where id=p_application for update;
 if not found then return 'NOT_FOUND';end if;
 if p_decision not in('APPROVED','NEEDS_CORRECTION','REJECTED') or length(trim(p_note))<3 then return 'INVALID';end if;
 if application.status not in('SUBMITTED','IN_REVIEW') or application.updated_at::text<>p_revision then return 'STALE';end if;
 if p_decision='APPROVED' then
  select * into details from public.agent_application_details where application_id=p_application;
  if not found then return 'KYC_REQUIRED';end if;
  years:=extract(year from age((now() at time zone 'Africa/Lagos')::date,details.birth_date));
  select count(*)::int into docs from public.media_objects m where m.owner_user_id=application.user_id and m.deleted_at is null and m.kind='kyc' and m.id in(details.identity_document_id,details.portrait_document_id,case when details.is_student then details.student_document_id else null end);
  if years<16 or years>110 or docs<>(case when details.is_student then 3 else 2 end) or application.kyc_status not in('VERIFIED','MANUALLY_VERIFIED') or application.phone_verified_at is null or application.terms_accepted_at is null or not exists(select 1 from app_private.verified_people where user_id=application.user_id)then return 'KYC_REQUIRED';end if;
  if years<18 and(details.guardian_consent_at is null or details.guardian_reviewed_by is null)then return 'GUARDIAN_REQUIRED';end if;
 end if;
 update public.agent_applications set status=p_decision,reviewer_user_id=p_actor,review_note=p_note,reviewed_at=now(),updated_at=now() where id=p_application;
 if p_decision='APPROVED'then
  insert into public.agent_profiles(university_id,user_id,application_id,agent_type,display_name,verified_at)values(application.university_id,application.user_id,p_application,application.agent_type,application.display_name,now())
  on conflict(university_id,user_id,agent_type)do update set application_id=excluded.application_id,display_name=excluded.display_name,verified_at=now(),status='ACTIVE',updated_at=now();
 end if;
 insert into app_private.notification_outbox(user_id,channel,subject,body,dedupe_key)values(application.user_id,'EMAIL','KampusOne application: '||lower(replace(p_decision,'_',' ')),p_note||case when p_decision='NEEDS_CORRECTION'then ' Open your agent application, correct these details and submit again.'else ''end,'agent-review:'||p_application::text||':'||p_revision||':'||p_decision)on conflict(dedupe_key)do nothing;
 insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata)values(p_actor,application.university_id,'agent.application.reviewed','agent_application',p_application::text,p_request,'succeeded',jsonb_build_object('decision',p_decision,'agentType',application.agent_type,'reason',p_note));
 return 'REVIEWED';
end;$$;
revoke all on function app_private.review_agent_application(uuid,uuid,text,text,text,text) from public;
create or replace function app_private.confirm_agent_review_preview(p_preview uuid,p_actor uuid,p_note text,p_request text)
returns text language plpgsql set search_path='' as $$
declare preview app_private.agent_review_previews%rowtype;item jsonb;result text;
begin
 select * into preview from app_private.agent_review_previews where id=p_preview and actor_user_id=p_actor for update;
 if not found then return 'NOT_FOUND';end if;
 if preview.confirmed_at is not null then return 'EXISTING';end if;
 if preview.expires_at<=now()then return 'EXPIRED';end if;
 begin
  for item in select value from jsonb_array_elements(preview.snapshots)order by value->>'id'loop
   result:=app_private.review_agent_application(p_actor,(item->>'id')::uuid,preview.decision,p_note,p_request,item->>'revision');
   if result<>'REVIEWED'then raise exception using errcode='P0001',message='STALE_REVIEW_SELECTION';end if;
  end loop;
  update app_private.agent_review_previews set confirmed_at=now()where id=p_preview;
 exception when sqlstate 'P0001'then return 'STALE';end;
 return 'CONFIRMED';
end;$$;
revoke all on function app_private.confirm_agent_review_preview(uuid,uuid,text,text)from public;

commit;
