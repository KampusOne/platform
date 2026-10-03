begin;
alter table app_private.notification_outbox add column if not exists last_error_code text;
alter table app_private.notification_outbox add column if not exists completed_at timestamptz;
alter table app_private.community_push_deliveries add column if not exists attempts integer not null default 1 check(attempts between 1 and 6);
alter table app_private.community_push_deliveries add column if not exists next_attempt_at timestamptz not null default now();
alter table app_private.community_push_deliveries add column if not exists updated_at timestamptz not null default now();
alter table app_private.community_push_deliveries add column if not exists observed_at timestamptz;
create index if not exists community_push_retry on app_private.community_push_deliveries(next_attempt_at) where status='FAILED';
-- Previously skipped rows were marked SENT even though no device was contacted.
update app_private.notification_outbox o set state='PENDING',attempts=0,next_attempt_at=now(),last_error_code='LEGACY_NO_DEVICE'
where o.channel='PUSH' and o.state='SENT' and o.created_at>now()-interval '1 day'
and not exists(select 1 from app_private.community_push_deliveries d where d.outbox_id=o.id);
commit;
