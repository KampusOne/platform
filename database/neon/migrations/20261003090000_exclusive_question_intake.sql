begin;

-- Exclusive is a campaign-controlled, question-only invitation route.
-- Ordinary agent identity documents and verified-bank payout rules are unchanged.
create table if not exists app_private.agent_campaign_controls (
  campaign_key text primary key check(campaign_key='exclusive'),
  enabled boolean not null default true,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
insert into app_private.agent_campaign_controls(campaign_key,enabled)
values('exclusive',true) on conflict(campaign_key) do nothing;
alter table app_private.agent_campaign_controls enable row level security;
revoke all on app_private.agent_campaign_controls from public;
alter table app_private.trusted_vendor_intakes
  add column if not exists business_details jsonb not null default '{}'::jsonb;

create or replace function app_private.submit_trusted_vendor(
  p_user uuid,
  p_hash text,
  p_request uuid,
  p_data jsonb
)
returns uuid
language plpgsql
set search_path=''
as $$
declare
  invite app_private.trusted_vendor_invites;
  account public.users;
  application uuid;
  campaign_enabled boolean;
begin
  select enabled into campaign_enabled from app_private.agent_campaign_controls
  where campaign_key='exclusive' for share;
  if not coalesce(campaign_enabled,false) then raise exception 'TRUSTED_CAMPAIGN_DISABLED'; end if;
  select * into invite
  from app_private.trusted_vendor_invites
  where token_hash=p_hash
  for update;

  select * into account
  from public.users
  where id=p_user
    and status='ACTIVE'
    and deleted_at is null;

  if invite.id is null
    or account.id is null
    or lower(account.email)<>lower(invite.email)
    or account.email_verified_at is null
    or invite.revoked_at is not null
  then
    raise exception 'TRUSTED_INVITE_UNAVAILABLE';
  end if;

  if invite.application_id is not null then
    if invite.claimed_user_id=p_user
      and exists(
        select 1
        from app_private.trusted_vendor_intakes t
        where t.application_id=invite.application_id
          and t.request_id=p_request
          and t.form_hash=md5(p_data::text)
      )
    then
      return invite.application_id;
    end if;
    raise exception 'TRUSTED_INVITE_USED';
  end if;

  if invite.expires_at<=now() then
    raise exception 'TRUSTED_INVITE_EXPIRED';
  end if;

  if date_part('year',age(current_date,(p_data->>'birthDate')::date)) not between 18 and 110 then
    raise exception 'TRUSTED_ADULT_REQUIRED';
  end if;

  if p_data->>'profileMediaId' is not null
    and not exists(
      select 1
      from public.media_objects m
      where m.id=(p_data->>'profileMediaId')::uuid
        and m.owner_user_id=p_user
        and m.kind='avatar'
        and m.deleted_at is null
        and m.content_type like 'image/%'
    )
  then
    raise exception 'TRUSTED_PROFILE_REQUIRED';
  end if;

  if jsonb_typeof(p_data->'operations') is distinct from 'object' then
    raise exception 'TRUSTED_BUSINESS_DETAILS_REQUIRED';
  end if;

  insert into public.agent_applications(
    university_id,
    user_id,
    agent_type,
    display_name,
    phone_e164,
    statement,
    legal_name,
    address_text,
    terms_version,
    terms_accepted_at,
    kyc_status
  )
  values(
    invite.institution_id,
    p_user,
    'VENDOR',
    p_data->>'businessName',
    p_data->>'phone',
    p_data->>'description',
    p_data->>'legalName',
    p_data->>'address',
    '2026-10-03-exclusive-questions',
    now(),
    'PENDING'
  )
  returning id into application;

  insert into app_private.trusted_vendor_intakes(
    application_id,
    invite_id,
    request_id,
    form_hash,
    birth_date,
    business_name,
    description,
    address,
    category,
    campus,
    profile_media_id,
    document_media_id,
    business_details,
    whatsapp_phone
  )
  values(
    application,
    invite.id,
    p_request,
    md5(p_data::text),
    (p_data->>'birthDate')::date,
    p_data->>'businessName',
    p_data->>'description',
    p_data->>'address',
    p_data->>'category',
    p_data->>'campus',
    nullif(p_data->>'profileMediaId','')::uuid,
    null,
    p_data->'operations',
    p_data->>'whatsapp'
  );

  update app_private.trusted_vendor_invites
  set claimed_user_id=p_user,
      application_id=application
  where id=invite.id;

  insert into app_private.notification_outbox(
    user_id,
    channel,
    subject,
    body,
    dedupe_key
  )
  values(
    p_user,
    'EMAIL',
    'We received your vendor profile',
    'Your invited business profile and service details are under review. We will email the decision.',
    'trusted-vendor-submitted:'||application::text
  )
  on conflict(dedupe_key) do nothing;

  return application;
end
$$;

create or replace function app_private.review_trusted_vendor(
  p_actor uuid,
  p_application uuid,
  p_revision text,
  p_decision text,
  p_note text,
  p_request text
)
returns text
language plpgsql
set search_path=''
as $$
declare
  application public.agent_applications;
  intake app_private.trusted_vendor_intakes;
begin
  select * into application
  from public.agent_applications
  where id=p_application
  for update;

  select * into intake
  from app_private.trusted_vendor_intakes
  where application_id=p_application
  for update;

  if application.id is null or intake.application_id is null then
    return 'NOT_FOUND';
  end if;

  if application.user_id=p_actor
    or length(trim(p_note))<20
    or p_decision not in('APPROVED','REJECTED')
  then
    return 'INVALID';
  end if;

  if application.status=p_decision
    and intake.reviewed_by=p_actor
    and intake.review_note=p_note
  then
    return 'EXISTING';
  end if;

  if application.status not in('SUBMITTED','IN_REVIEW')
    or application.updated_at::text<>p_revision
  then
    return 'STALE';
  end if;

  if not exists(
    select 1
    from app_private.trusted_vendor_invites i
    join public.users u
      on u.id=application.user_id
     and lower(u.email)=lower(i.email)
     and u.status='ACTIVE'
     and u.deleted_at is null
    where i.id=intake.invite_id
      and i.institution_id=application.university_id
      and i.claimed_user_id=application.user_id
      and i.revoked_at is null
  )
  then
    return 'INVITE_REVOKED';
  end if;

  update public.agent_applications
  set status=p_decision,
      reviewer_user_id=p_actor,
      review_note=p_note,
      reviewed_at=now(),
      updated_at=now(),
      kyc_status=case
        when p_decision='APPROVED' then 'MANUALLY_VERIFIED'
        else kyc_status
      end,
      phone_verified_at=case
        when p_decision='APPROVED' then now()
        else phone_verified_at
      end
  where id=p_application;

  update app_private.trusted_vendor_intakes
  set reviewed_by=p_actor,
      review_note=p_note,
      approved_at=case when p_decision='APPROVED' then now() end
  where application_id=p_application;

  if p_decision='APPROVED' then
    insert into public.agent_profiles(
      university_id,
      user_id,
      application_id,
      agent_type,
      display_name,
      verified_at
    )
    values(
      application.university_id,
      application.user_id,
      p_application,
      'VENDOR',
      application.display_name,
      now()
    )
    on conflict(university_id,user_id,agent_type)
    do update
      set application_id=excluded.application_id,
          display_name=excluded.display_name,
          verified_at=now(),
          status='ACTIVE',
          updated_at=now();
  end if;

  insert into app_private.notification_outbox(
    user_id,
    channel,
    subject,
    body,
    dedupe_key
  )
  values(
    application.user_id,
    'EMAIL',
    'KampusOne vendor profile: '||lower(p_decision),
    p_note||case
      when p_decision='APPROVED'
      then ' Open your agent dashboard to set up your shop and bank account.'
      else ''
    end,
    'trusted-vendor-review:'||p_application::text||':'||p_decision
  )
  on conflict(dedupe_key) do nothing;

  insert into app_private.audit_events(
    actor_user_id,
    university_id,
    action,
    target_type,
    target_id,
    request_id,
    outcome,
    metadata
  )
  values(
    p_actor,
    application.university_id,
    'trusted_vendor.reviewed',
    'agent_application',
    p_application::text,
    p_request,
    'succeeded',
    jsonb_build_object(
      'decision',p_decision,
      'reason',p_note,
      'documentWaiver',true,
      'intakeMethod','EXCLUSIVE_QUESTIONS',
      'inviteId',intake.invite_id
    )
  );

  return 'REVIEWED';
end
$$;

revoke all on function app_private.submit_trusted_vendor(uuid,text,uuid,jsonb) from public;
revoke all on function app_private.review_trusted_vendor(uuid,uuid,text,text,text,text) from public;

commit;
