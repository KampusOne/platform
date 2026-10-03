begin;
set local lock_timeout='5s';

-- Daily reports are stored summaries, never a substitute for financial journals.
create table if not exists app_private.daily_app_reports (
  scope_key text not null, institution_id uuid references public.universities(id),
  day date not null, report jsonb not null check(jsonb_typeof(report)='object'),
  generated_at timestamptz not null default now(),
  primary key(scope_key,day),
  check(scope_key=coalesce(institution_id::text,'all'))
);
create table if not exists app_private.daily_report_runs (
  run_key text primary key, started_at timestamptz not null default now()
);
create table if not exists app_private.reporting_collection (
  key text primary key, started_at timestamptz not null default now()
);
insert into app_private.reporting_collection(key) values('record_changes') on conflict do nothing;
create table if not exists app_private.admin_record_events (
  id bigint generated always as identity primary key,
  institution_id uuid not null references public.universities(id),
  event_name text not null check(event_name in('post_published','product_created','product_updated','sale_paid','agent_approved','coupon_created')),
  subject_id uuid not null, occurred_at timestamptz not null default now()
);
create index if not exists admin_record_events_day on app_private.admin_record_events(institution_id,occurred_at,event_name);
create unique index if not exists admin_record_events_once on app_private.admin_record_events(event_name,subject_id)
 where event_name in('post_published','product_created','sale_paid','agent_approved','coupon_created');
create trigger admin_record_events_append_only before update or delete on app_private.admin_record_events
 for each row execute function app_private.prevent_append_only_mutation();

create or replace function app_private.record_admin_entity_event() returns trigger
 language plpgsql set search_path='' as $$
declare event text; school uuid;
begin
  school := (to_jsonb(new)->>'university_id')::uuid;
  if tg_table_name='discount_codes' then school:=new.institution_id;event:='coupon_created';
  elsif tg_table_name='vendor_products' then
    if tg_op='INSERT' then event:='product_created';
    elsif (new.name,new.description,new.category,new.price_kobo,new.stock_quantity,new.image_url,new.status)
      is distinct from (old.name,old.description,old.category,old.price_kobo,old.stock_quantity,old.image_url,old.status) then event:='product_updated';end if;
  elsif tg_table_name='feed_posts' and new.status in('PUBLISHED','CORRECTED') then
    if tg_op='INSERT' then event:='post_published';
    elsif old.status not in('PUBLISHED','CORRECTED') then event:='post_published';end if;
  elsif tg_table_name='orders' and new.status in('PAID','ACCEPTED','READY','IN_DELIVERY','DELIVERED') then
    if tg_op='INSERT' then event:='sale_paid';
    elsif old.status not in('PAID','ACCEPTED','READY','IN_DELIVERY','DELIVERED') then event:='sale_paid';end if;
  elsif tg_table_name='agent_applications' and new.status='APPROVED' then
    if tg_op='INSERT' then event:='agent_approved';
    elsif old.status<>'APPROVED' then event:='agent_approved';end if;
  end if;
  if event is not null and school is not null then
    insert into app_private.admin_record_events(institution_id,event_name,subject_id)
      values(school,event,new.id) on conflict do nothing;
  end if;
  return new;
end; $$;
create trigger report_product_changes after insert or update on public.vendor_products for each row execute function app_private.record_admin_entity_event();
create trigger report_post_publication after insert or update on public.feed_posts for each row execute function app_private.record_admin_entity_event();
create trigger report_paid_sales after insert or update on public.orders for each row execute function app_private.record_admin_entity_event();
create trigger report_agent_approval after insert or update on public.agent_applications for each row execute function app_private.record_admin_entity_event();
do $$ begin
 if to_regclass('app_private.discount_codes') is not null then
  execute 'create trigger report_coupon_creation after insert on app_private.discount_codes for each row execute function app_private.record_admin_entity_event()';
 end if;
end $$;

create table if not exists app_private.operations_expenses (
  id uuid primary key default gen_random_uuid(), institution_id uuid not null references public.universities(id),
  request_id uuid not null, created_by uuid not null references public.users(id),
  category text not null check(category in('Hosting','Marketing','Transport','Equipment','Staff','Other')),
  description text not null check(length(description) between 3 and 1000),
  amount_kobo bigint not null check(amount_kobo between 1 and 200000000000),
  incurred_on date not null, journal_id uuid not null unique references public.ledger_transactions(id),
  recorded_at timestamptz not null default now(), unique(created_by,request_id)
);
create trigger operations_expenses_append_only before update or delete on app_private.operations_expenses
 for each row execute function app_private.prevent_append_only_mutation();
alter table public.ledger_transactions add column if not exists journal_payload jsonb;

-- A recorded expense debits operating expense and credits the amount payable.
-- This does not assert a bank payment or mutate any seller wallet balance.
create or replace function app_private.record_operations_expense(
 p_actor uuid,p_request uuid,p_uni uuid,p_category text,p_description text,p_amount bigint,p_day date
) returns app_private.operations_expenses language plpgsql set search_path='' as $$
declare previous app_private.operations_expenses%rowtype; saved app_private.operations_expenses%rowtype;
 journal uuid; expense_account uuid; payable_account uuid; target uuid:=gen_random_uuid();
begin
 perform pg_advisory_xact_lock(hashtextextended('expense:'||p_actor::text||':'||p_request::text,0));
 select * into previous from app_private.operations_expenses where created_by=p_actor and request_id=p_request;
 if found then
  if (previous.institution_id,previous.category,previous.description,previous.amount_kobo,previous.incurred_on)
   is distinct from(p_uni,p_category,p_description,p_amount,p_day) then raise exception 'EXPENSE_REQUEST_CONFLICT';end if;
  return previous;
 end if;
 if p_uni is null or p_actor is null or p_request is null or p_day is null or p_day>(now()at time zone 'Africa/Lagos')::date
  or p_amount is null or p_amount<1 or p_amount>200000000000 or p_category not in('Hosting','Marketing','Transport','Equipment','Staff','Other')
  or length(p_description)not between 3 and 1000 then raise exception 'INVALID_OPERATIONS_EXPENSE';end if;
 insert into public.ledger_accounts(university_id,account_code,account_type)
  values(p_uni,'OPERATIONS_EXPENSE','EXPENSE'),(p_uni,'OPERATIONS_PAYABLE','LIABILITY') on conflict do nothing;
 select id into expense_account from public.ledger_accounts where university_id=p_uni and owner_user_id is null and account_code='OPERATIONS_EXPENSE'and account_type='EXPENSE'and currency='NGN';
 select id into payable_account from public.ledger_accounts where university_id=p_uni and owner_user_id is null and account_code='OPERATIONS_PAYABLE'and account_type='LIABILITY'and currency='NGN';
 if expense_account is null or payable_account is null then raise exception 'JOURNAL_ACCOUNT_MISMATCH';end if;
 insert into public.ledger_transactions(university_id,reference_type,reference_id,idempotency_key,description,journal_payload)
  values(p_uni,'OPERATIONS_EXPENSE',target::text,'operations-expense:'||p_actor::text||':'||p_request::text,p_description,
   jsonb_build_object('universityId',p_uni,'type','OPERATIONS_EXPENSE','reference',target,'description',p_description,'lines',jsonb_build_array(
    jsonb_build_object('code','OPERATIONS_EXPENSE','type','EXPENSE','direction','DEBIT','amount',p_amount),
    jsonb_build_object('code','OPERATIONS_PAYABLE','type','LIABILITY','direction','CREDIT','amount',p_amount)))) returning id into journal;
 insert into public.ledger_lines(transaction_id,account_id,direction,amount_kobo)
  values(journal,expense_account,'DEBIT',p_amount),(journal,payable_account,'CREDIT',p_amount);
 insert into app_private.operations_expenses(id,institution_id,request_id,created_by,category,description,amount_kobo,incurred_on,journal_id)
  values(target,p_uni,p_request,p_actor,p_category,p_description,p_amount,p_day,journal) returning * into saved;
 insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata)
  values(p_actor,p_uni,'finance.expense.recorded','operations_expense',target::text,p_request::text,'succeeded',jsonb_build_object('amountKobo',p_amount,'incurredOn',p_day,'category',p_category));
 return saved;
end; $$;

create table if not exists app_private.admin_milestone_acknowledgements (
  user_id uuid not null references public.users(id),scope_key text not null,milestone_key text not null,
  acknowledged_at timestamptz not null default now(),primary key(user_id,scope_key,milestone_key)
);
alter table app_private.daily_app_reports enable row level security;
alter table app_private.admin_record_events enable row level security;
alter table app_private.operations_expenses enable row level security;
alter table app_private.admin_milestone_acknowledgements enable row level security;
revoke all on app_private.daily_app_reports,app_private.daily_report_runs,app_private.reporting_collection,
 app_private.admin_record_events,app_private.operations_expenses,app_private.admin_milestone_acknowledgements from public;
revoke all on function app_private.record_admin_entity_event(),app_private.record_operations_expense(uuid,uuid,uuid,text,text,bigint,date) from public;
commit;
