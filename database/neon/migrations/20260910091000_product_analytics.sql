begin;

create schema if not exists kampusone_analytics;
revoke all on schema kampusone_analytics from public;

create table kampusone_analytics.events (
  id bigint generated always as identity primary key,
  event_id uuid not null unique,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  institution_id uuid not null,
  subject_id uuid,
  anonymous_id uuid,
  session_id uuid not null,
  event_name text not null check (event_name ~ '^[a-z][a-z0-9_.]{1,79}$'),
  surface text not null check (surface in ('mobile', 'web', 'agent_portal', 'operations_portal')),
  route text check (route is null or char_length(route) between 1 and 240),
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 86400000),
  platform text not null check (platform in ('ios', 'android', 'web', 'server')),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  consent_scope text not null check (consent_scope in ('essential', 'product_analytics')),
  properties jsonb not null default '{}'::jsonb check (
    jsonb_typeof(properties) = 'object'
    and pg_column_size(properties) <= 8192
  ),
  check (subject_id is not null or anonymous_id is not null),
  check (occurred_at <= received_at + interval '5 minutes'),
  check (occurred_at >= received_at - interval '30 days')
);

comment on table kampusone_analytics.events is
  'Allow-listed, consent-aware product events received only through the authenticated Cloudflare Worker.';
comment on column kampusone_analytics.events.properties is
  'Must not contain email, phone, NIN, matriculation number, document/message content or precise coordinates.';

create index analytics_events_institution_time_idx
  on kampusone_analytics.events (institution_id, occurred_at desc);
create index analytics_events_subject_time_idx
  on kampusone_analytics.events (subject_id, occurred_at desc)
  where subject_id is not null;
create index analytics_events_name_time_idx
  on kampusone_analytics.events (event_name, occurred_at desc);
create index analytics_events_session_time_idx
  on kampusone_analytics.events (session_id, occurred_at);

create table kampusone_analytics.subject_suppressions (
  subject_id uuid primary key,
  reason text not null check (reason in ('analytics_opt_out', 'account_closed', 'legal_restriction')),
  suppressed_at timestamptz not null default now(),
  expires_at timestamptz,
  source_request_id text,
  check (expires_at is null or expires_at > suppressed_at)
);

comment on table kampusone_analytics.subject_suppressions is
  'Subjects whose optional analytics events must be rejected. Essential security logging remains in the Supabase private schema.';

create view kampusone_analytics.daily_surface_metrics as
select
  institution_id,
  date_trunc('day', occurred_at) as metric_day,
  surface,
  event_name,
  count(*) as event_count,
  count(distinct subject_id) filter (where subject_id is not null) as active_subjects,
  percentile_cont(0.5) within group (order by duration_ms)
    filter (where duration_ms is not null) as median_duration_ms
from kampusone_analytics.events
where consent_scope = 'product_analytics'
group by institution_id, date_trunc('day', occurred_at), surface, event_name;

comment on view kampusone_analytics.daily_surface_metrics is
  'Aggregate reporting view. Access remains server-only and purpose-scoped.';

commit;
