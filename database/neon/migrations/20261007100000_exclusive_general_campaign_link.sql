begin;

-- The Exclusive campaign now uses one reusable public URL:
-- https://agents.kampusone.app/exclusive
-- Applicants are scoped to the university on their signed-in KampusOne profile.
-- A private synthetic invite row is still created per submission so existing
-- review, audit and payout verification rules retain their current guarantees.

create or replace function app_private.submit_exclusive_vendor(
  p_user uuid,
  p_request uuid,
  p_data jsonb
)
returns uuid
language plpgsql
set search_path=''
as $$
declare
  account_email text;
  account_verified timestamptz;
  campus uuid;
  application uuid;
  existing_application uuid;
  invite uuid;
  campaign_enabled boolean;
  synthetic_hash text;
begin
  select enabled into campaign_enabled
  from app_private.agent_campaign_controls
  where campaign_key='exclusive'
  for share;

  if not coalesce(campaign_enabled,false) then
    raise exception 'TRUSTED_CAMPAIGN_DISABLED';
  end if;

  select u.email,u.email_verified_at
  into account_email,account_verified
  from public.users u
  where u.id=p_user
    and u.status='ACTIVE'
    and u.deleted_at is null;

  if account_email is null or account_verified is null then
    raise exception 'TRUSTED_ACCOUNT_UNAVAILABLE';
  end if;

  select p.university_id
  into campus
  from public.profiles p
  where p.user_id=p_user
    and p.deleted_at is null
  limit 1;

  if campus is null then
    raise exception 'TRUSTED_UNIVERSITY_REQUIRED';
  end if;

  select a.id
  into existing_application
  from public.agent_applications a
  where a.university_id=campus
    and a.user_id=p_user
    and a.agent_type='VENDOR'
  order by a.created_at desc
  limit 1;

  if existing_application is not null then
    if exists(
      select 1
      from app_private.trusted_vendor_intakes t
      where t.application_id=existing_application
        and t.request_id=p_request
        and t.form_hash=md5(p_data::text)
    ) then
      return existing_application;
    end if;
    raise exception 'TRUSTED_APPLICATION_EXISTS';
  end if;

  if date_part('year',age(current_date,(p_data->>'birthDate')::date)) not between 18 and 110 then
    raise exception 'TRUSTED_ADULT_REQUIRED';
  end if;

  if jsonb_typeof(p_data->'operations') is distinct from 'object' then
    raise exception 'TRUSTED_BUSINESS_DETAILS_REQUIRED';
  end if;

  synthetic_hash :=
    md5(gen_random_uuid()::text || p_user::text || p_request::text || clock_timestamp()::text)
    || md5(gen_random_uuid()::text || lower(account_email));

  insert into app_private.trusted_vendor_invites(
    institution_id,
    email,
    token_hash,
    created_by,
    reason,
    expires_at,
    claimed_user_id
  )
  values(
    campus,
    lower(account_email),
    synthetic_hash,
    p_user,
    'Shared Exclusive campaign link',
    now()+interval '100 years',
    p_user
  )
  returning id into invite;

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
    campus,
    p_user,
    'VENDOR',
    p_data->>'businessName',
    p_data->>'phone',
    p_data->>'description',
    p_data->>'legalName',
    p_data->>'address',
    '2026-10-07-exclusive-general-link',
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
    invite,
    p_request,
    md5(p_data::text),
    (p_data->>'birthDate')::date,
    p_data->>'businessName',
    p_data->>'description',
    p_data->>'address',
    p_data->>'category',
    p_data->>'campus',
    null,
    null,
    p_data->'operations',
    p_data->>'whatsapp'
  );

  update app_private.trusted_vendor_invites
  set application_id=application
  where id=invite;

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
    'Your Exclusive business profile and service details are under review. We will email the decision.',
    'trusted-vendor-submitted:'||application::text
  )
  on conflict(dedupe_key) do nothing;

  return application;
exception
  when unique_violation then
    raise exception 'TRUSTED_APPLICATION_EXISTS';
end
$$;

create or replace function app_private.submit_exclusive_vendor_with_acquisition(
  p_user uuid,
  p_request uuid,
  p_values jsonb,
  p_acquisition jsonb
)
returns uuid
language plpgsql
set search_path=''
as $$
declare
  application uuid;
  campus uuid;
begin
  application=app_private.submit_exclusive_vendor(p_user,p_request,p_values);

  if p_acquisition is not null and p_acquisition<>'null'::jsonb then
    select university_id into campus
    from public.agent_applications
    where id=application and user_id=p_user;

    insert into app_private.user_acquisition(
      user_id,
      institution_id,
      context,
      source,
      other_text
    )
    values(
      p_user,
      campus,
      'VENDOR',
      p_acquisition->>'source',
      case
        when p_acquisition->>'source'='OTHER' then p_acquisition->>'other'
        else ''
      end
    )
    on conflict(user_id,context) do nothing;
  end if;

  return application;
end
$$;

revoke all on function app_private.submit_exclusive_vendor(uuid,uuid,jsonb) from public;
revoke all on function app_private.submit_exclusive_vendor_with_acquisition(uuid,uuid,jsonb,jsonb) from public;

commit;
