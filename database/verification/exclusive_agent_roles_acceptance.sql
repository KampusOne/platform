-- All synthetic applicants, applications, approvals and notices roll back in
-- one subtransaction. Existing production records and campaign state are kept.
do $acceptance$
declare
  campus uuid := gen_random_uuid();
  applicant uuid := gen_random_uuid();
  reviewer uuid := gen_random_uuid();
  invite_hash text;
  role_type text;
  request_id uuid;
  payload jsonb;
  application uuid;
  revision text;
  outcome text;
  before_counts jsonb;
  after_counts jsonb;
  checked_roles integer := 0;
begin
  select jsonb_build_array(
    (select count(*) from public.users),
    (select count(*) from public.agent_applications),
    (select count(*) from public.agent_profiles),
    (select count(*) from app_private.trusted_vendor_intakes),
    (select count(*) from app_private.trusted_vendor_invites),
    (select count(*) from app_private.notification_outbox),
    (select count(*) from app_private.audit_events)
  ) into before_counts;
  begin
    insert into public.universities(id,name,slug,updated_at)
      values(campus,'Exclusive acceptance fixture','exclusive-acceptance-'||campus::text,now());
    insert into public.users(id,email,password_hash,email_verified_at,updated_at) values
      (applicant,'exclusive-applicant-'||applicant::text||'@example.invalid','test-only',now(),now()),
      (reviewer,'exclusive-reviewer-'||reviewer::text||'@example.invalid','test-only',now(),now());
    update app_private.agent_campaign_controls set enabled=true where campaign_key='exclusive';
    foreach role_type in array array['VENDOR','TUTOR','RIDER'] loop
      invite_hash := 'exclusive-acceptance-'||gen_random_uuid()::text;
      request_id := gen_random_uuid();
      insert into app_private.trusted_vendor_invites(institution_id,email,token_hash,created_by,reason,expires_at)
        values(campus,'exclusive-applicant-'||applicant::text||'@example.invalid',invite_hash,reviewer,'Synthetic Exclusive acceptance fixture',now()+interval '1 hour');
      payload := jsonb_build_object(
        'agentType',role_type,'businessName','Exclusive fixture '||role_type,
        'legalName','Exclusive fixture agent','birthDate','2000-01-01',
        'phone','+2348012345678','description','Reliable student products and campus services.',
        'address','12 Fixture Road, Campus service area','campus','Fixture campus',
        'category',case role_type when 'TUTOR' then 'Tutoring' when 'RIDER' then 'Delivery' else 'Other' end,
        'operations',jsonb_build_object('primaryOffer','Synthetic campus service')
      );
      -- An already-open vendor form can omit agentType.
      if role_type='VENDOR' then payload := payload-'agentType'; end if;
      application := app_private.submit_trusted_vendor_with_acquisition(applicant,invite_hash,request_id,payload,'{"source":"FRIENDS"}'::jsonb);
      if not exists(select 1 from public.agent_applications where id=application and agent_type=role_type and university_id=campus and user_id=applicant) then
        raise exception 'Exclusive submission lost its selected role: %',role_type;
      end if;
      if app_private.submit_trusted_vendor_with_acquisition(applicant,invite_hash,request_id,payload,'{"source":"FRIENDS"}'::jsonb)<>application then
        raise exception 'Exclusive retry created a different application';
      end if;
      select updated_at::text into revision from public.agent_applications where id=application;
      outcome := app_private.review_trusted_vendor(applicant,application,revision,'APPROVED','Synthetic applicant must not approve their own profile.','exclusive-acceptance');
      if outcome<>'INVALID' then raise exception 'Self approval was allowed'; end if;
      outcome := app_private.review_trusted_vendor(reviewer,application,revision,'APPROVED','Synthetic service and contact review for acceptance testing.','exclusive-acceptance');
      if outcome<>'REVIEWED' or not exists(select 1 from public.agent_profiles where application_id=application and agent_type=role_type and status='ACTIVE') then
        raise exception 'Exclusive approval lost its selected role: %',role_type;
      end if;
      if not exists(select 1 from app_private.user_acquisition where user_id=applicant and context=role_type) then
        raise exception 'Exclusive acquisition lost its selected role';
      end if;
      if not exists(select 1 from app_private.notification_outbox where dedupe_key='trusted-vendor-submitted:'||application::text and subject='We received your '||lower(role_type)||' profile') then
        raise exception 'Exclusive submission notice used the wrong role';
      end if;
      checked_roles := checked_roles+1;
    end loop;
    raise sqlstate 'PZ001' using message='Rollback synthetic Exclusive acceptance fixtures';
  exception when sqlstate 'PZ001' then null;
  end;
  select jsonb_build_array(
    (select count(*) from public.users),
    (select count(*) from public.agent_applications),
    (select count(*) from public.agent_profiles),
    (select count(*) from app_private.trusted_vendor_intakes),
    (select count(*) from app_private.trusted_vendor_invites),
    (select count(*) from app_private.notification_outbox),
    (select count(*) from app_private.audit_events)
  ) into after_counts;
  if checked_roles<>3 or before_counts<>after_counts then
    raise exception 'Exclusive role acceptance or fixture rollback failed';
  end if;
end
$acceptance$;
