begin;
-- A human review is one action. Exceptional incomplete applications remain
-- identifiable and cannot gain payout eligibility through this approval.
create table app_private.agent_manual_approvals(
 id uuid primary key default gen_random_uuid(),application_id uuid not null references public.agent_applications(id),
 institution_id uuid not null references public.universities(id),actor_user_id uuid not null references public.users(id),
 source_revision text not null,details_hash text not null,missing_fields text[] not null default '{}',
 override_incomplete boolean not null default false,reason text not null check(length(reason)>=10),created_at timestamptz not null default now(),
 unique(application_id,source_revision)
);
create trigger agent_manual_approvals_immutable before update or delete on app_private.agent_manual_approvals for each row execute function app_private.prevent_append_only_mutation();
revoke all on app_private.agent_manual_approvals from public;

create function app_private.approve_reviewed_agent(p_actor uuid,p_application uuid,p_revision text,p_override boolean,p_note text,p_request text)
returns jsonb language plpgsql set search_path='' as $$
declare a public.agent_applications;d public.agent_application_details;s app_private.agent_identity_submissions;years integer;docs integer;business_ids uuid[];missing text[]='{}';
begin
 select * into a from public.agent_applications where id=p_application for update;
 if not found then return jsonb_build_object('outcome','NOT_FOUND');end if;
 if a.user_id=p_actor then return jsonb_build_object('outcome','SELF_REVIEW');end if;
 if a.status='APPROVED' then return jsonb_build_object('outcome','EXISTING');end if;
 if a.updated_at::text<>p_revision or a.status not in('SUBMITTED','IN_REVIEW','NEEDS_CORRECTION','REJECTED') then return jsonb_build_object('outcome','STALE');end if;
 if length(trim(p_note))<10 then return jsonb_build_object('outcome','INVALID');end if;
 select * into d from public.agent_application_details where application_id=a.id for update;
 if not found then return jsonb_build_object('outcome','BIRTH_DATE_REQUIRED');end if;
 years=extract(year from age((now() at time zone 'Africa/Lagos')::date,d.birth_date));
 if years is null or years<16 or years>110 then return jsonb_build_object('outcome','AGE_REQUIRED');end if;
 if years<18 and(d.guardian_consent_at is null or d.guardian_reviewed_by is null)then return jsonb_build_object('outcome','GUARDIAN_REQUIRED');end if;
 select count(*) into docs from public.media_objects m where m.owner_user_id=a.user_id and(m.institution_id is null or m.institution_id=a.university_id)and m.kind='kyc'and m.deleted_at is null and m.id in(d.identity_document_id,d.portrait_document_id,case when d.is_student then d.student_document_id else null end);
 if docs<>(case when d.is_student then 3 else 2 end)then missing=array_append(missing,'Identity or student documents');end if;
 select * into s from app_private.agent_identity_submissions where application_id=a.id and user_id=a.user_id and institution_id=a.university_id and client_request_id::text=d.role_details->>'clientRequestId';
 if s.id is null and not exists(select 1 from app_private.verified_people where user_id=a.user_id)then missing=array_append(missing,'Identity number');end if;
 if s.id is not null and exists(select 1 from app_private.verified_people where identity_fingerprint=s.nin_fingerprint and user_id<>a.user_id)then return jsonb_build_object('outcome','IDENTITY_CONFLICT');end if;
 if s.id is not null and exists(select 1 from app_private.verified_people where user_id=a.user_id and identity_fingerprint<>s.nin_fingerprint)then return jsonb_build_object('outcome','IDENTITY_CONFLICT');end if;
 if a.agent_type='VENDOR' and d.role_details->>'intakeVersion'='2'then
  select coalesce(array_agg(value::uuid),'{}'::uuid[])into business_ids from jsonb_array_elements_text(coalesce(d.role_details->'businessDocumentIds','[]'::jsonb));
  select count(*)into docs from public.media_objects m where m.id=any(business_ids)and m.owner_user_id=a.user_id and(m.institution_id is null or m.institution_id=a.university_id)and m.kind='kyc'and m.deleted_at is null;
  if cardinality(business_ids)=0 or docs<>cardinality(business_ids)then missing=array_append(missing,'Business documents');end if;
 end if;
 if nullif(trim(a.phone_e164),'')is null then missing=array_append(missing,'Phone number');end if;
 if a.terms_accepted_at is null then missing=array_append(missing,'Agent terms');end if;
 if cardinality(missing)>0 and not p_override then return jsonb_build_object('outcome','INCOMPLETE','missingFields',to_jsonb(missing));end if;
 insert into app_private.agent_manual_approvals(application_id,institution_id,actor_user_id,source_revision,details_hash,missing_fields,override_incomplete,reason)
 values(a.id,a.university_id,p_actor,p_revision,md5(to_jsonb(d)::text),missing,p_override,p_note);
 if s.id is not null then
  insert into app_private.verified_people(user_id,identity_fingerprint,verified_by)values(a.user_id,s.nin_fingerprint,p_actor)on conflict do nothing;
 end if;
 update public.agent_applications set status='APPROVED',kyc_status='MANUALLY_VERIFIED',kyc_provider='MANUAL_DOCUMENT_REVIEW',phone_verified_at=case when nullif(trim(phone_e164),'')is not null then now()else phone_verified_at end,reviewer_user_id=p_actor,review_note=p_note,reviewed_at=now(),updated_at=now()where id=a.id;
 insert into public.agent_profiles(university_id,user_id,application_id,agent_type,display_name,verified_at)values(a.university_id,a.user_id,a.id,a.agent_type,a.display_name,now())
 on conflict(university_id,user_id,agent_type)do update set application_id=excluded.application_id,display_name=excluded.display_name,verified_at=now(),status='ACTIVE',updated_at=now();
 insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata)values(p_actor,a.university_id,'agent.application.approved','agent_application',a.id::text,p_request,'succeeded',jsonb_build_object('reason',p_note,'overrideIncomplete',p_override,'missingFields',to_jsonb(missing),'bankVerified',false));
 return jsonb_build_object('outcome','APPROVED','missingFields',to_jsonb(missing));
end $$;
revoke all on function app_private.approve_reviewed_agent(uuid,uuid,text,boolean,text,text)from public;

-- The exception applies only to the exact application revision and document
-- details reviewed by the actor inside the atomic function above.
create or replace function app_private.guard_current_agent_intake_approval()returns trigger language plpgsql set search_path='' as $$
declare details public.agent_application_details;submission app_private.agent_identity_submissions;document_ids uuid[];valid_documents integer;
begin
 if new.status='APPROVED' and old.status is distinct from new.status then
  select * into details from public.agent_application_details where application_id=new.id;
  if exists(select 1 from app_private.agent_manual_approvals r where r.application_id=new.id and r.institution_id=new.university_id and r.actor_user_id=new.reviewer_user_id and r.actor_user_id<>new.user_id and r.source_revision=old.updated_at::text and r.details_hash=md5(to_jsonb(details)::text))then return new;end if;
  if details.role_details->>'intakeVersion'='2'then
   select * into submission from app_private.agent_identity_submissions where application_id=new.id and user_id=new.user_id and institution_id=new.university_id and client_request_id::text=details.role_details->>'clientRequestId';
   if not found or new.reviewer_user_id is null or new.reviewer_user_id=new.user_id or not exists(select 1 from app_private.verified_people p where p.user_id=new.user_id and p.identity_fingerprint=submission.nin_fingerprint)then raise exception 'CURRENT_IDENTITY_REVIEW_REQUIRED';end if;
   select coalesce(array_agg(value::uuid),'{}'::uuid[])into document_ids from jsonb_array_elements_text(coalesce(details.role_details->'businessDocumentIds','[]'::jsonb));
   if new.agent_type='VENDOR'then
    select count(*)into valid_documents from public.media_objects m where m.id=any(document_ids)and m.owner_user_id=new.user_id and(m.institution_id is null or m.institution_id=new.university_id)and m.kind='kyc'and m.deleted_at is null;
    if cardinality(document_ids)=0 or valid_documents<>cardinality(document_ids)then raise exception 'BUSINESS_EVIDENCE_REQUIRED';end if;
   end if;
  end if;
 end if;
 return new;
end $$;
commit;
