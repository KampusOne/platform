begin;
alter table public.academic_source_claims add column if not exists reviewed_by uuid references public.users(id);
alter table public.academic_source_claims add column if not exists reviewed_at timestamptz;
alter table public.academic_source_claims add column if not exists review_note text;
alter table public.academic_source_claims add column if not exists primary_source_url text;
alter table public.academic_source_claims add column if not exists institution_id uuid references public.universities(id);
alter table public.institution_guidelines add column if not exists faculty_id uuid references public.faculties(id);
alter table public.institution_guidelines add column if not exists source_key text references public.academic_source_documents(source_key);
alter table public.institution_guidelines add column if not exists source_page integer check(source_page>0);
alter table public.institution_guidelines add column if not exists source_excerpt text;
alter table public.institution_guidelines add column if not exists issuing_institution text;
alter table public.institution_guidelines add column if not exists document_date date;
alter table public.institution_guidelines add column if not exists effective_from date;
alter table public.institution_guidelines add column if not exists session_label text;
alter table public.institution_guidelines add column if not exists programme_name text;
alter table public.institution_guidelines add column if not exists family_id uuid not null default gen_random_uuid();
alter table public.institution_guidelines add column if not exists version integer not null default 1 check(version>0);
create unique index if not exists guideline_family_version_idx on public.institution_guidelines(family_id,version);
create index if not exists claims_review_idx on public.academic_source_claims(review_status,claim_kind,source_key);
create or replace function app_private.publish_academic_institution(
 p_claim uuid,p_actor uuid,p_institution uuid,p_existing boolean,p_name text,p_slug text,p_url text,p_reason text,p_request text
) returns table(outcome text,published_institution_id uuid) language plpgsql set search_path='' as $$
declare claim public.academic_source_claims%rowtype;
begin
 select * into claim from public.academic_source_claims where id=p_claim for update;
 if not found or claim.claim_kind<>'institution' then return query select 'NOT_FOUND'::text,null::uuid;return;end if;
 if claim.review_status<>'PENDING' then return query select 'CONFLICT'::text,claim.institution_id;return;end if;
 if p_existing then
  if not exists(select 1 from public.universities where id=p_institution and deleted_at is null) then return query select 'NOT_FOUND'::text,null::uuid;return;end if;
 else
  if exists(select 1 from public.universities where slug=p_slug or lower(name)=lower(p_name)) then return query select 'DUPLICATE'::text,null::uuid;return;end if;
  insert into public.universities(id,name,slug,updated_at)values(p_institution,p_name,p_slug,now());
 end if;
 insert into public.institution_config(institution_id,status,grading_scale,source_url)values(p_institution,'CATALOGUED','{}'::jsonb,p_url) on conflict(institution_id)do nothing;
 update public.academic_source_claims set review_status='APPROVED',reviewed_by=p_actor,reviewed_at=now(),review_note=p_reason,primary_source_url=p_url,institution_id=p_institution where id=p_claim;
 insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata)values(p_actor,p_institution,'academic.institution.published','academic_source_claim',p_claim::text,p_request,'succeeded',jsonb_build_object('reason',p_reason,'primarySourceUrl',p_url,'sourceClaimId',p_claim,'newInstitution',not p_existing));
 return query select 'CREATED'::text,p_institution;
end;$$;
revoke all on function app_private.publish_academic_institution(uuid,uuid,uuid,boolean,text,text,text,text,text) from public;

commit;
