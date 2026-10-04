-- Invoke with run_sql_transaction. All generated accounts, applications,
-- identity records and audits are rolled back before the outer commit.
savepoint oct4_agent_approval_fixture;
do $$
declare
 fixture_actor uuid:=gen_random_uuid();fixture_applicant uuid:=gen_random_uuid();fixture_minor uuid:=gen_random_uuid();
 fixture_application uuid:=gen_random_uuid();fixture_underage uuid:=gen_random_uuid();
 fixture_identity uuid:=gen_random_uuid();fixture_portrait uuid:=gen_random_uuid();
 fixture_campus uuid;fixture_revision text;result jsonb;
begin
 select id into fixture_campus from public.universities where deleted_at is null order by id limit 1;
 if fixture_campus is null then raise exception 'Agent acceptance requires an existing campus';end if;
 insert into public.users(id,email,password_hash,email_verified_at,updated_at)
 values(fixture_actor,fixture_actor::text||'@example.invalid','isolated-acceptance-only',now(),now()),
       (fixture_applicant,fixture_applicant::text||'@example.invalid','isolated-acceptance-only',now(),now()),
       (fixture_minor,fixture_minor::text||'@example.invalid','isolated-acceptance-only',now(),now());
 insert into public.operator_roles(user_id,role)values(fixture_actor,'PLATFORM_ADMIN');
 insert into public.media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name)
 values(fixture_identity,fixture_applicant,fixture_campus,'kyc','isolated-fixture/'||fixture_identity,'image/jpeg',100,'Isolated identity fixture'),
       (fixture_portrait,fixture_applicant,fixture_campus,'kyc','isolated-fixture/'||fixture_portrait,'image/jpeg',100,'Isolated portrait fixture');
 insert into public.agent_applications(id,university_id,user_id,agent_type,display_name,phone_e164,statement,legal_name,address_text,terms_version,terms_accepted_at)
 values(fixture_application,fixture_campus,fixture_applicant,'VENDOR','Isolated vendor fixture','+2348012345678','Isolated acceptance only','Isolated vendor fixture','Isolated campus','acceptance-only',now());
 insert into public.agent_application_details(application_id,birth_date,is_student,identity_document_id,portrait_document_id,terms_version)
 values(fixture_application,'2000-01-01',false,fixture_identity,fixture_portrait,'acceptance-only');
 select updated_at::text into fixture_revision from public.agent_applications where id=fixture_application;
 result:=app_private.approve_reviewed_agent(fixture_applicant,fixture_application,fixture_revision,false,'Isolated self-review rejection check.','oct4-acceptance');
 if result->>'outcome'<>'SELF_REVIEW' then raise exception 'Self-review accepted';end if;
 result:=app_private.approve_reviewed_agent(fixture_actor,fixture_application,'stale-version',false,'Isolated stale-revision rejection check.','oct4-acceptance');
 if result->>'outcome'<>'STALE' then raise exception 'Stale application approved';end if;
 result:=app_private.approve_reviewed_agent(fixture_actor,fixture_application,fixture_revision,false,'Isolated incomplete-identity rejection check.','oct4-acceptance');
 if result->>'outcome'<>'INCOMPLETE' then raise exception 'Incomplete application bypassed owner exception';end if;
 result:=app_private.approve_reviewed_agent(fixture_actor,fixture_application,fixture_revision,true,'Isolated owner reviewed the submitted details and explicitly approved incomplete fields.','oct4-acceptance');
 if result->>'outcome'<>'APPROVED' then raise exception 'Reviewed owner approval failed: %',result->>'outcome';end if;
 if not exists(select 1 from app_private.agent_manual_approvals where application_id=fixture_application and actor_user_id=fixture_actor and override_incomplete and missing_fields @> array['Identity number'])then raise exception 'Owner exception audit missing';end if;
 if not exists(select 1 from public.agent_applications where id=fixture_application and status='APPROVED' and bank_status='NOT_STARTED')then raise exception 'Approval changed bank verification';end if;
 if exists(select 1 from app_private.verified_people where user_id=fixture_applicant)then raise exception 'Approval fabricated a verified identity number';end if;
 result:=app_private.approve_reviewed_agent(fixture_actor,fixture_application,fixture_revision,true,'Isolated repeated owner approval must be idempotent.','oct4-acceptance');
 if result->>'outcome'<>'EXISTING' or(select count(*)from app_private.agent_manual_approvals where application_id=fixture_application)<>1 then raise exception 'Owner approval duplicated its audit';end if;

 insert into public.agent_applications(id,university_id,user_id,agent_type,display_name,phone_e164,statement,legal_name,address_text,terms_version,terms_accepted_at)
 values(fixture_underage,fixture_campus,fixture_minor,'VENDOR','Isolated age fixture','+2348012345678','Isolated acceptance only','Isolated age fixture','Isolated campus','acceptance-only',now());
 insert into public.agent_application_details(application_id,birth_date,is_student,identity_document_id,portrait_document_id,terms_version)
 values(fixture_underage,(now()at time zone'Africa/Lagos')::date-interval'10 years',false,fixture_identity,fixture_portrait,'acceptance-only');
 select updated_at::text into fixture_revision from public.agent_applications where id=fixture_underage;
 result:=app_private.approve_reviewed_agent(fixture_actor,fixture_underage,fixture_revision,true,'Isolated minimum-age restriction cannot be overridden.','oct4-acceptance');
 if result->>'outcome'<>'AGE_REQUIRED' then raise exception 'Minimum age bypassed';end if;
end $$;
select 'passed' as reviewed_agent_approval_atomicity_and_limits;
rollback to savepoint oct4_agent_approval_fixture;
