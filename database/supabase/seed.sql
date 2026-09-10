-- Development sample only. Do not run this file against production.
insert into public.institutions (
  id,
  slug,
  name,
  short_name,
  status,
  timezone,
  country_code
)
values (
  '10000000-0000-4000-8000-000000000001',
  'uniben',
  'University of Benin',
  'UNIBEN',
  'active',
  'Africa/Lagos',
  'NG'
)
on conflict (slug) do nothing;

insert into public.campuses (
  id,
  institution_id,
  slug,
  name,
  locality,
  is_primary
)
values (
  '11000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'ugbowo',
  'Ugbowo Campus',
  'Benin City',
  true
)
on conflict (institution_id, slug) do nothing;

insert into public.feature_flags (institution_id, key, enabled, client_visible)
values
  (null, 'academic.core', true, true),
  (null, 'social.feed', false, true),
  (null, 'marketplace', false, true),
  (null, 'payments', false, true),
  (null, 'ai.assistant', false, true)
on conflict do nothing;

insert into app_private.provider_controls (
  institution_id,
  provider,
  feature,
  enabled,
  per_user_daily_limit,
  global_daily_limit,
  alert_at_percent
)
values
  (null, 'resend', 'critical_email', false, 5, 100, 60),
  (null, 'ai_gateway', 'student_assistance', false, 0, 0, 50),
  (null, 'sms_provider', 'sms', false, 0, 0, 50)
on conflict do nothing;
