-- The immediate delivery-release trigger does not revisit orders completed
-- before its installation. Reconcile those orders through that same trigger;
-- never edit ledger balances or mark an undelivered order as delivered.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $release_guard$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.orders'::regclass
      and tgname = 'priced_store_earnings_release'
      and tgfoid = 'app_private.release_priced_store_earnings()'::regprocedure
      and tgenabled in ('O', 'A')
  ) then
    raise exception 'STORE_RELEASE_TRIGGER_REQUIRED';
  end if;
end;
$release_guard$;

update public.orders orders
set earnings_state = 'AVAILABLE', updated_at = now()
where orders.pricing_formula_version = 'INCLUSIVE_V1'
  and orders.status = 'DELIVERED'
  and orders.earnings_state = 'PENDING'
  and orders.completed_at is not null
  and exists (
    select 1
    from app_private.order_price_snapshots price
    join app_private.commerce_settlements settlement
      on settlement.order_id = price.order_id
      and settlement.university_id = price.university_id
      and settlement.seller_net_kobo = price.seller_net_kobo
    where price.order_id = orders.id
      and price.university_id = orders.university_id
  )
  and not exists (
    select 1 from public.disputes dispute
    where dispute.order_id = orders.id
      and dispute.status in ('OPEN', 'UNDER_REVIEW')
  )
  and not exists (
    select 1 from public.ledger_transactions journal
    where journal.idempotency_key = 'store-release:' || orders.id::text
  );

commit;
