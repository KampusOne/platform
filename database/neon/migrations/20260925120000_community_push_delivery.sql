begin;
create table if not exists app_private.community_push_deliveries(
 id uuid primary key default gen_random_uuid(), outbox_id uuid not null references app_private.notification_outbox(id),
 device_id uuid not null references app_private.push_devices(id), user_id uuid not null references public.users(id),
 institution_id uuid references public.universities(id), status text not null check(status in ('SENDING','ACCEPTED','RECEIPT_OK','FAILED','UNKNOWN')),
 ticket_id text,error_code text,created_at timestamptz not null default now(),checked_at timestamptz,
 unique(outbox_id,device_id)
);
create index if not exists community_push_receipts on app_private.community_push_deliveries(status,created_at);
revoke all on app_private.community_push_deliveries from public;
commit;
