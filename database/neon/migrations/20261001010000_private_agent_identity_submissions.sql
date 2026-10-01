begin;
-- Raw NIN values never belong in public profile/application JSON. The Worker
-- stores AES-256-GCM ciphertext bound to the applicant, campus and request.
alter table public.agent_application_drafts add column if not exists identity_envelope jsonb;
alter table public.agent_application_drafts add column if not exists nin_last4 text check(nin_last4 is null or nin_last4 ~ '^[0-9]{4}$');
create unique index if not exists agent_application_identity_scope_idx on public.agent_applications(id,university_id,user_id);
create table if not exists app_private.agent_identity_submissions (
 id uuid primary key default gen_random_uuid(), application_id uuid not null,
 institution_id uuid not null references public.universities(id), user_id uuid not null references public.users(id),
 client_request_id uuid not null, form_hash text not null check(form_hash ~ '^[a-f0-9]{64}$'),
 nin_fingerprint text not null check(nin_fingerprint ~ '^[a-f0-9]{64}$'),
 identity_envelope jsonb not null check(jsonb_typeof(identity_envelope)='object'),
 nin_last4 text not null check(nin_last4 ~ '^[0-9]{4}$'), created_at timestamptz not null default now(),
 unique(user_id,client_request_id),
 foreign key(application_id,institution_id,user_id)references public.agent_applications(id,university_id,user_id)
);
create index if not exists agent_identity_submission_application_idx on app_private.agent_identity_submissions(application_id,created_at desc,id);
revoke all on app_private.agent_identity_submissions from public;
create or replace function app_private.guard_agent_identity_submission()returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op<>'INSERT' then raise exception using errcode='P0001',message='IDENTITY_SUBMISSION_IMMUTABLE';end if;
 if coalesce(new.identity_envelope->>'version','')<>'v1' or coalesce(new.identity_envelope->>'requestId','')<>new.client_request_id::text or coalesce(new.identity_envelope->>'universityId','')<>new.institution_id::text
  or coalesce(new.identity_envelope->>'nonce','') !~ '^[A-Za-z0-9+/]{16}$' or coalesce(new.identity_envelope->>'ciphertext','') !~ '^[A-Za-z0-9+/]{36}$'
 then raise exception using errcode='P0001',message='IDENTITY_SUBMISSION_SCOPE';end if;
 return new;
end;$$;
create trigger agent_identity_submission_guard before insert or update or delete on app_private.agent_identity_submissions for each row execute function app_private.guard_agent_identity_submission();
revoke all on function app_private.guard_agent_identity_submission()from public;
create or replace function app_private.guard_current_agent_intake_approval()returns trigger language plpgsql set search_path='' as $$
declare details public.agent_application_details%rowtype;submission app_private.agent_identity_submissions%rowtype;document_ids uuid[];valid_documents integer;
begin
 if new.status='APPROVED' and old.status is distinct from new.status then
  select * into details from public.agent_application_details where application_id=new.id;
  if details.role_details->>'intakeVersion'='2' then
   select * into submission from app_private.agent_identity_submissions where application_id=new.id and user_id=new.user_id and institution_id=new.university_id and client_request_id::text=details.role_details->>'clientRequestId';
   if not found or new.reviewer_user_id is null or new.reviewer_user_id=new.user_id or not exists(select 1 from app_private.verified_people p where p.user_id=new.user_id and p.identity_fingerprint=submission.nin_fingerprint)then raise exception using errcode='P0001',message='CURRENT_IDENTITY_REVIEW_REQUIRED';end if;
   select coalesce(array_agg(value::uuid),'{}'::uuid[]) into document_ids from jsonb_array_elements_text(coalesce(details.role_details->'businessDocumentIds','[]'::jsonb));
   if new.agent_type='VENDOR' then
    select count(*)into valid_documents from public.media_objects m where m.id=any(document_ids)and m.owner_user_id=new.user_id and(m.institution_id is null or m.institution_id=new.university_id)and m.kind='kyc'and m.deleted_at is null;
    if cardinality(document_ids)=0 or valid_documents<>cardinality(document_ids)then raise exception using errcode='P0001',message='BUSINESS_EVIDENCE_REQUIRED';end if;
   end if;
  end if;
 end if;
 return new;
end;$$;
create trigger current_agent_intake_approval_guard before update of status on public.agent_applications for each row execute function app_private.guard_current_agent_intake_approval();
revoke all on function app_private.guard_current_agent_intake_approval()from public;
-- Public fields are populated only from the explicit presentation choices in a
-- newly reviewed application. Existing private telephone numbers stay private.
create or replace function app_private.seed_approved_business_presentation()returns trigger language plpgsql set search_path='' as $$
declare details public.agent_application_details%rowtype;application public.agent_applications%rowtype;
begin
 if tg_op='INSERT' then
  select * into application from public.agent_applications where id=new.application_id and status='APPROVED';
  select * into details from public.agent_application_details where application_id=new.application_id;
  if application.id is not null and details.role_details->>'intakeVersion'='2' then
   new.biography:=application.statement;
   new.public_details:=coalesce(new.public_details,'{}'::jsonb)||jsonb_build_object('categories',coalesce(details.role_details->'businessCategories','[]'::jsonb));
   if details.role_details->>'publishContacts'='true'then new.public_details:=new.public_details||jsonb_build_object('phone',application.phone_e164,'whatsapp',coalesce(details.role_details->>'whatsappPhone',application.phone_e164));end if;
  end if;
 end if;
 return new;
end;$$;
create trigger approved_business_presentation_seed before insert on public.agent_profiles for each row execute function app_private.seed_approved_business_presentation();
revoke all on function app_private.seed_approved_business_presentation()from public;
commit;
