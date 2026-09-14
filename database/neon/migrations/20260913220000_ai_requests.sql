begin;
create table if not exists app_private.ai_requests(
 user_id uuid not null references public.users(id),idempotency_key uuid not null,
 request_hash text not null,mode text not null,status text not null default 'PROCESSING' check(status in('PROCESSING','COMPLETED','FAILED')),
 result jsonb,created_at timestamptz not null default now(),primary key(user_id,idempotency_key)
);
revoke all on app_private.ai_requests from public;
create index if not exists ai_requests_expiry_idx on app_private.ai_requests(created_at);
commit;
