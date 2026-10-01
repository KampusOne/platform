begin;
create table if not exists app_private.trusted_vendor_invites(
 id uuid primary key default gen_random_uuid(),institution_id uuid not null references public.universities(id),email text not null,token_hash text not null unique,
 created_by uuid not null references public.users(id),reason text not null check(length(reason)>=10),created_at timestamptz not null default now(),expires_at timestamptz not null,
 revoked_at timestamptz,claimed_user_id uuid references public.users(id),application_id uuid references public.agent_applications(id)
);
create table if not exists app_private.trusted_vendor_intakes(
 application_id uuid primary key references public.agent_applications(id),invite_id uuid not null unique references app_private.trusted_vendor_invites(id),
 request_id uuid not null unique,form_hash text not null,birth_date date not null,business_name text not null,description text not null,address text not null,category text not null,
 campus text not null,profile_media_id uuid references public.media_objects(id),whatsapp_phone text,
 reviewed_by uuid references public.users(id),review_note text,approved_at timestamptz,created_at timestamptz not null default now()
);
alter table app_private.trusted_vendor_invites enable row level security;
alter table app_private.trusted_vendor_intakes enable row level security;
revoke all on app_private.trusted_vendor_invites,app_private.trusted_vendor_intakes from public;
create or replace function app_private.submit_trusted_vendor(p_user uuid,p_hash text,p_request uuid,p_data jsonb)
returns uuid language plpgsql set search_path='' as $$
declare invite app_private.trusted_vendor_invites;account public.users;application uuid;
begin
 select * into invite from app_private.trusted_vendor_invites where token_hash=p_hash for update;
 select * into account from public.users where id=p_user and status='ACTIVE' and deleted_at is null;
 if invite.id is null or account.id is null or lower(account.email)<>lower(invite.email) or account.email_verified_at is null or invite.revoked_at is not null then raise exception 'TRUSTED_INVITE_UNAVAILABLE';end if;
 if invite.application_id is not null then
  if invite.claimed_user_id=p_user and exists(select 1 from app_private.trusted_vendor_intakes t where t.application_id=invite.application_id and t.request_id=p_request and t.form_hash=md5(p_data::text)) then return invite.application_id;end if;
  raise exception 'TRUSTED_INVITE_USED';
 end if;
 if invite.expires_at<=now() then raise exception 'TRUSTED_INVITE_EXPIRED';end if;
 if date_part('year',age(current_date,(p_data->>'birthDate')::date)) not between 18 and 110 then raise exception 'TRUSTED_ADULT_REQUIRED';end if;
 if p_data->>'profileMediaId' is not null and not exists(select 1 from public.media_objects m where m.id=(p_data->>'profileMediaId')::uuid and m.owner_user_id=p_user and m.kind='avatar' and m.deleted_at is null and m.content_type like 'image/%') then raise exception 'TRUSTED_PROFILE_REQUIRED';end if;
 insert into public.agent_applications(university_id,user_id,agent_type,display_name,phone_e164,statement,legal_name,address_text,terms_version,terms_accepted_at,kyc_status)
 values(invite.institution_id,p_user,'VENDOR',p_data->>'businessName',p_data->>'phone',p_data->>'description',p_data->>'legalName',p_data->>'address','2026-10-01-trusted-vendor',now(),'PENDING') returning id into application;
 insert into app_private.trusted_vendor_intakes(application_id,invite_id,request_id,form_hash,birth_date,business_name,description,address,category,campus,profile_media_id,whatsapp_phone)
 values(application,invite.id,p_request,md5(p_data::text),(p_data->>'birthDate')::date,p_data->>'businessName',p_data->>'description',p_data->>'address',p_data->>'category',p_data->>'campus',nullif(p_data->>'profileMediaId','')::uuid,p_data->>'whatsapp');
 update app_private.trusted_vendor_invites set claimed_user_id=p_user,application_id=application where id=invite.id;
 insert into app_private.notification_outbox(user_id,channel,subject,body,dedupe_key)values(p_user,'EMAIL','We received your vendor profile','Your invited business profile is under review. Your ordinary application documents were waived for this invitation. We will email the decision.','trusted-vendor-submitted:'||application::text)on conflict(dedupe_key)do nothing;
 return application;
end $$;
create or replace function app_private.review_trusted_vendor(p_actor uuid,p_application uuid,p_revision text,p_decision text,p_note text,p_request text)
returns text language plpgsql set search_path='' as $$
declare application public.agent_applications;intake app_private.trusted_vendor_intakes;
begin
 select * into application from public.agent_applications where id=p_application for update;
 select * into intake from app_private.trusted_vendor_intakes where application_id=p_application for update;
 if application.id is null or intake.application_id is null then return 'NOT_FOUND';end if;
 if application.user_id=p_actor or length(trim(p_note))<20 or p_decision not in('APPROVED','REJECTED') then return 'INVALID';end if;
 if application.status=p_decision and intake.reviewed_by=p_actor and intake.review_note=p_note then return 'EXISTING';end if;
 if application.status not in('SUBMITTED','IN_REVIEW') or application.updated_at::text<>p_revision then return 'STALE';end if;
 if not exists(select 1 from app_private.trusted_vendor_invites i join public.users u on u.id=application.user_id and lower(u.email)=lower(i.email) and u.status='ACTIVE' and u.deleted_at is null where i.id=intake.invite_id and i.institution_id=application.university_id and i.claimed_user_id=application.user_id and i.revoked_at is null) then return 'INVITE_REVOKED';end if;
 update public.agent_applications set status=p_decision,reviewer_user_id=p_actor,review_note=p_note,reviewed_at=now(),updated_at=now(),kyc_status=case when p_decision='APPROVED' then 'MANUALLY_VERIFIED' else kyc_status end,phone_verified_at=case when p_decision='APPROVED' then now() else phone_verified_at end where id=p_application;
 update app_private.trusted_vendor_intakes set reviewed_by=p_actor,review_note=p_note,approved_at=case when p_decision='APPROVED' then now() end where application_id=p_application;
 if p_decision='APPROVED' then
  insert into public.agent_profiles(university_id,user_id,application_id,agent_type,display_name,verified_at)values(application.university_id,application.user_id,p_application,'VENDOR',application.display_name,now())on conflict(university_id,user_id,agent_type)do update set application_id=excluded.application_id,display_name=excluded.display_name,verified_at=now(),status='ACTIVE',updated_at=now();
 end if;
 insert into app_private.notification_outbox(user_id,channel,subject,body,dedupe_key)values(application.user_id,'EMAIL','KampusOne vendor profile: '||lower(p_decision),p_note||case when p_decision='APPROVED' then ' Open your agent dashboard to set up your shop and bank account.' else '' end,'trusted-vendor-review:'||p_application::text||':'||p_decision)on conflict(dedupe_key)do nothing;
 insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata)values(p_actor,application.university_id,'trusted_vendor.reviewed','agent_application',p_application::text,p_request,'succeeded',jsonb_build_object('decision',p_decision,'reason',p_note,'documentWaiver',true,'inviteId',intake.invite_id));
 return 'REVIEWED';
end $$;
revoke all on function app_private.submit_trusted_vendor(uuid,text,uuid,jsonb),app_private.review_trusted_vendor(uuid,uuid,text,text,text,text) from public;
commit;
