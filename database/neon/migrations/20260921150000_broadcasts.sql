begin;

-- Campaigns use their own reviewed outbox. Existing authentication/transactional email is unchanged.
create table if not exists app_private.email_personas (
 id uuid primary key default gen_random_uuid(), display_name text not null check(char_length(display_name) between 2 and 80),
 active boolean not null default true, created_by uuid references public.users(id), created_at timestamptz not null default now()
);
insert into app_private.email_personas(id,display_name) values('00000000-0000-4000-8000-000000000052','KampusOne') on conflict do nothing;
create table if not exists app_private.email_preferences (
 user_id uuid primary key references public.users(id), marketing_opt_in boolean not null default false,
 consent_version text, updated_at timestamptz not null default now()
);
create table if not exists app_private.email_preference_events (
 id bigint generated always as identity primary key,user_id uuid not null references public.users(id),
 marketing_opt_in boolean not null,source text not null,consent_version text,occurred_at timestamptz not null default now()
);
create table if not exists app_private.email_suppressions (
 email text primary key check(email=lower(email)),reason text not null,provider_email_id text,created_at timestamptz not null default now()
);
create table if not exists app_private.email_delivery_controls (
 singleton boolean primary key default true check(singleton),enabled boolean not null default true,
 max_per_day integer not null default 1000 check(max_per_day between 1 and 10000),
 max_per_minute integer not null default 30 check(max_per_minute between 1 and 100),
 postal_address text,updated_by uuid references public.users(id),updated_at timestamptz not null default now()
);
insert into app_private.email_delivery_controls(singleton) values(true) on conflict do nothing;
create table if not exists app_private.email_rate_windows (
 kind text not null check(kind in('day','minute')),window_start timestamptz not null,attempts integer not null default 0,primary key(kind,window_start)
);
create table if not exists app_private.email_campaigns (
 id uuid primary key default gen_random_uuid(),institution_id uuid references public.universities(id),
 created_by uuid not null references public.users(id),updated_by uuid not null references public.users(id),
 persona_id uuid not null references app_private.email_personas(id),kind text not null check(kind in('OPERATIONAL','MARKETING')),
 subject text not null check(char_length(subject) between 3 and 160),body text not null check(char_length(body) between 5 and 20000),
 segment jsonb not null default '{}',revision integer not null default 1,
 status text not null default 'DRAFT' check(status in('DRAFT','REVIEWED','QUEUED','SENDING','COMPLETED','CANCELLED')),
 scheduled_at timestamptz,reviewed_snapshot_id uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists email_campaign_scope_idx on app_private.email_campaigns(institution_id,created_at desc);
create table if not exists app_private.email_audience_snapshots (
 id uuid primary key default gen_random_uuid(),campaign_id uuid not null references app_private.email_campaigns(id),
 revision integer not null,reviewed_by uuid not null references public.users(id),content jsonb not null,
 eligible_count integer not null check(eligible_count between 0 and 10000),excluded_count integer not null default 0,
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '30 minutes'
);
create table if not exists app_private.email_recipients (
 id uuid primary key default gen_random_uuid(),campaign_id uuid not null references app_private.email_campaigns(id),
 campaign_revision integer not null,snapshot_id uuid references app_private.email_audience_snapshots(id),requested_by uuid not null references public.users(id),user_id uuid not null references public.users(id),
 institution_id uuid references public.universities(id),email text not null,kind text not null check(kind in('OPERATIONAL','MARKETING')),
 is_test boolean not null default false,request_id uuid,unsubscribe_token uuid not null default gen_random_uuid(),
 payload jsonb not null, status text not null default 'PREVIEW' check(status in('PREVIEW','PENDING','PROCESSING','ACCEPTED','DELIVERED','BOUNCED','COMPLAINED','FAILED','SKIPPED','UNKNOWN')),
 attempts integer not null default 0,first_attempt_at timestamptz,lease_until timestamptz,next_attempt_at timestamptz not null default now(),
 provider_email_id text unique,last_error_code text,accepted_at timestamptz,delivered_at timestamptz,created_at timestamptz not null default now(),
 unique(snapshot_id,user_id),unique(campaign_id,request_id),unique(unsubscribe_token)
);
create index if not exists email_recipients_queue_idx on app_private.email_recipients(next_attempt_at) where status in('PENDING','PROCESSING');
create table if not exists app_private.email_delivery_events (
 event_id text primary key,provider_email_id text not null,event_type text not null,occurred_at timestamptz not null,
 recipient_email text,received_at timestamptz not null default now()
);

-- Atomic leases and reservation limits also apply when cron executions overlap.
create or replace function app_private.claim_broadcast_deliveries()
returns setof app_private.email_recipients language plpgsql set search_path='' as $$
declare controls app_private.email_delivery_controls; allowance integer; n integer; day_start timestamptz; minute_start timestamptz;
begin
 select * into controls from app_private.email_delivery_controls where singleton for update;
 if not found or not controls.enabled then return;end if;
 day_start:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';minute_start:=date_trunc('minute',now());
 insert into app_private.email_rate_windows(kind,window_start) values('day',day_start),('minute',minute_start) on conflict do nothing;
 select least(10,controls.max_per_day-(select attempts from app_private.email_rate_windows where kind='day' and window_start=day_start),
 controls.max_per_minute-(select attempts from app_private.email_rate_windows where kind='minute' and window_start=minute_start)) into allowance;
 -- A provider may have accepted an interrupted attempt. Never retry beyond its 24h deduplication window.
 update app_private.email_recipients set status='UNKNOWN',last_error_code='RECONCILIATION_REQUIRED',lease_until=null
 where status in('PENDING','PROCESSING') and first_attempt_at<now()-interval '23 hours';
 if allowance<=0 then return;end if;
 return query with ready as(
  select r.id from app_private.email_recipients r join app_private.email_campaigns c on c.id=r.campaign_id
  where r.status in('PENDING','PROCESSING') and r.next_attempt_at<=now() and(r.lease_until is null or r.lease_until<=now())
  and r.attempts<6 and(r.first_attempt_at is null or r.first_attempt_at>=now()-interval '23 hours')
  and((r.is_test and c.status<>'CANCELLED') or(not r.is_test and c.status in('QUEUED','SENDING') and(c.scheduled_at is null or c.scheduled_at<=now())))
  order by r.next_attempt_at,r.id limit allowance for update of r skip locked
 ) update app_private.email_recipients r set status='PROCESSING',attempts=r.attempts+1,first_attempt_at=coalesce(r.first_attempt_at,now()),lease_until=now()+interval '5 minutes'
 from ready where r.id=ready.id returning r.*;
 get diagnostics n=row_count;
 update app_private.email_rate_windows set attempts=attempts+n where(kind='day' and window_start=day_start)or(kind='minute' and window_start=minute_start);
end;$$;

commit;
