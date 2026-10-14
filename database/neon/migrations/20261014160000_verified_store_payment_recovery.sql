begin;

alter table public.orders add column if not exists cancelled_by_user_id uuid references public.users(id) on delete restrict;

create or replace function app_private.cancel_vendor_order(
  p_order_id uuid,
  p_vendor_user_id uuid
) returns table (order_id uuid, university_id uuid)
language plpgsql
set search_path = ''
as $$
declare
  selected public.orders%rowtype;
begin
  select orders.* into selected
  from public.orders orders
  join public.agent_profiles profiles on profiles.id = orders.vendor_profile_id
  where orders.id = p_order_id and profiles.user_id = p_vendor_user_id
    and profiles.status = 'ACTIVE'
  for update of orders;

  if not found or selected.status <> 'PENDING_PAYMENT' then
    raise exception using errcode = 'P0001', message = 'ORDER_NOT_CANCELLABLE';
  end if;

  update public.vendor_products products
  set stock_quantity = products.stock_quantity + reservations.quantity,
      updated_at = now()
  from public.inventory_reservations reservations
  where reservations.order_id = selected.id
    and reservations.product_id = products.id
    and reservations.status = 'HELD';

  update public.inventory_reservations
  set status = 'RELEASED'
  where inventory_reservations.order_id = selected.id and inventory_reservations.status = 'HELD';

  update public.delivery_jobs
  set status = 'CANCELLED', updated_at = now()
  where delivery_jobs.order_id = selected.id and delivery_jobs.status = 'PAYMENT_PENDING';

  update public.orders
  set status = 'CANCELLED', cancelled_by_user_id=p_vendor_user_id, updated_at = now()
  where id = selected.id and status = 'PENDING_PAYMENT';

  return query select selected.id, selected.university_id;
end;
$$;


-- Reconcile genuine on-time payments even when the provider callback arrives after expiry.
CREATE OR REPLACE FUNCTION app_private.record_priced_store_receipt(p_reference text, p_amount bigint, p_fee bigint, p_paid_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare attempt public.payment_attempts%rowtype; selected_order public.orders%rowtype; price app_private.order_price_snapshots%rowtype;
  seller_user uuid; journal uuid; lines jsonb; gross_margin bigint; digital_fare integer; principal bigint; recoverable boolean:=false; restock boolean:=false; reservation record;
begin
  select * into attempt from public.payment_attempts where provider_reference=p_reference and resource_type='STORE_ORDER';
  if not found then return 'UNKNOWN'; end if;
  select * into selected_order from public.orders where id=attempt.resource_id and pricing_formula_version='INCLUSIVE_V1' for update;
  if not found then return 'LEGACY'; end if;
  select * into price from app_private.order_price_snapshots where order_id=selected_order.id;
  if not found then raise exception 'PRICE_SNAPSHOT_MISSING'; end if;
  perform app_private.record_verified_paystack_receipt(selected_order.university_id,p_reference,'STORE_ORDER',selected_order.id,p_amount,p_fee,p_paid_at);
  if exists(select 1 from app_private.commerce_settlements where order_id=selected_order.id) then
    if exists(select 1 from app_private.commerce_settlements where order_id=selected_order.id and provider_reference=p_reference and amount_kobo=p_amount and provider_fee_kobo=p_fee) then return 'ALREADY_PAID'; end if;
    update public.payment_attempts set status='REQUIRES_REVIEW',failure_code='SECOND_SUCCESSFUL_PAYMENT',updated_at=now() where id=attempt.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason='SECOND_SUCCESSFUL_PAYMENT',updated_at=now()
      where provider=case when p_reference like 'K1-B-%' then 'BACHS' else 'PAYSTACK' end and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  -- Paid time, not webhook arrival time, establishes the original reservation.
  perform 1 from public.inventory_reservations where order_id=selected_order.id order by product_id for update;
  recoverable=selected_order.status in ('PENDING_PAYMENT','CANCELLED') and selected_order.cancelled_by_user_id is null
    and p_paid_at>=attempt.created_at and p_paid_at<=now()+interval '5 minutes'
    and exists(select 1 from public.inventory_reservations where order_id=selected_order.id)
    and not exists(select 1 from app_private.audit_events where target_id=selected_order.id::text
      and action='order.cancelled' and outcome='succeeded')
    and not exists(select 1 from public.inventory_reservations where order_id=selected_order.id
      and (status not in ('HELD','RELEASED') or p_paid_at>expires_at))
    and not exists(select 1 from public.order_status_events where order_id=selected_order.id
      and status in ('PAID','ACCEPTED','READY','IN_DELIVERY','DELIVERED','DISPUTED','REFUNDED'));
  if attempt.university_id is distinct from selected_order.university_id or attempt.user_id<>selected_order.buyer_user_id or
    (selected_order.status<>'PENDING_PAYMENT' and not recoverable) or attempt.status not in ('CREATED','INITIALIZED','REQUIRES_REVIEW') or
    (not recoverable and not exists(select 1 from public.inventory_reservations where order_id=selected_order.id and status='HELD' and expires_at>now())) or
    not app_private.collection_paid_price_matches(p_reference,p_amount,p_fee,price.payable_kobo) or attempt.amount_kobo<>price.payable_kobo or p_fee<0 or p_paid_at is null then
    update public.payment_attempts set status='REQUIRES_REVIEW',failure_code='PAYMENT_SNAPSHOT_OR_STATE_MISMATCH',updated_at=now() where id=attempt.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason='PAYMENT_SNAPSHOT_OR_STATE_MISMATCH',updated_at=now()
      where provider=case when p_reference like 'K1-B-%' then 'BACHS' else 'PAYSTACK' end and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  restock=recoverable and exists(select 1 from public.inventory_reservations where order_id=selected_order.id and status='RELEASED');
  if restock then
    perform 1 from public.vendor_products where id in (select product_id from public.inventory_reservations where order_id=selected_order.id and status='RELEASED') order by id for update;
    if exists(select 1 from public.inventory_reservations r join public.vendor_products p on p.id=r.product_id where r.order_id=selected_order.id and r.status='RELEASED' and p.stock_quantity<r.quantity) then
      update public.payment_attempts set status='REQUIRES_REVIEW',failure_code='PAID_ORDER_STOCK_UNAVAILABLE',updated_at=now() where id=attempt.id;
      update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason='PAID_ORDER_STOCK_UNAVAILABLE',updated_at=now() where provider_reference=p_reference;
      return 'REQUIRES_REVIEW';
    end if;
    for reservation in select * from public.inventory_reservations where order_id=selected_order.id and status='RELEASED' order by product_id loop
      update public.vendor_products set stock_quantity=stock_quantity-reservation.quantity,updated_at=now() where id=reservation.product_id;
    end loop;
  end if;
  select user_id into seller_user from public.agent_profiles where id=selected_order.vendor_profile_id;
  digital_fare=selected_order.delivery_fee_kobo-price.cash_due_kobo;
  principal=app_private.recover_customer_processing_fee(p_reference,p_amount,p_fee);
  gross_margin=principal-price.seller_net_kobo-digital_fare;
  if gross_margin<0 and not exists(select 1 from app_private.discount_redemptions where purchase_id=selected_order.id and discount_kobo>=-gross_margin) then raise exception 'INVALID_SETTLEMENT_MARGIN';end if;
  lines=jsonb_build_array(jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',principal));
  if price.seller_net_kobo>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','VENDOR_PENDING','type','LIABILITY','owner',seller_user,'direction','CREDIT','amount',price.seller_net_kobo)); end if;
  if digital_fare>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','DELIVERY_LIABILITY','type','LIABILITY','direction','CREDIT','amount',digital_fare)); end if;
  if gross_margin>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','PLATFORM_COMMISSION','type','REVENUE','direction','CREDIT','amount',gross_margin)); end if;
  if gross_margin<0 then lines=lines||jsonb_build_array(jsonb_build_object('code','PROMOTION_EXPENSE','type','EXPENSE','direction','DEBIT','amount',-gross_margin));end if;
  journal=app_private.post_finance_journal(selected_order.university_id,'STORE_ORDER',selected_order.id::text,'priced-payment:'||p_reference,'Verified inclusive store checkout',lines);
  insert into app_private.commerce_settlements(order_id,university_id,provider_reference,amount_kobo,seller_net_kobo,digital_fare_kobo,cash_fare_kobo,provider_fee_kobo,journal_id)
    values(selected_order.id,selected_order.university_id,p_reference,p_amount,price.seller_net_kobo,digital_fare,price.cash_due_kobo,p_fee,journal);
  update public.orders set status='PAID',provider_reference=coalesce(provider_reference,p_reference),updated_at=now() where id=selected_order.id;
  update public.inventory_reservations set status='CONVERTED' where order_id=selected_order.id and (status='HELD' or (recoverable and status='RELEASED'));
  update public.delivery_jobs set status='AVAILABLE',updated_at=now() where order_id=selected_order.id and (status='PAYMENT_PENDING' or (recoverable and status='CANCELLED'));
  update public.payment_attempts set status='SUCCEEDED',failure_code=null,completed_at=p_paid_at,updated_at=now() where id=attempt.id;
  update public.payment_provider_events set state='PROCESSED',processed_at=now(),updated_at=now()
    where provider=case when p_reference like 'K1-B-%' then 'BACHS' else 'PAYSTACK' end and provider_reference=p_reference;
  return 'PAID';
end; $function$
;


revoke all on function app_private.record_priced_store_receipt(text,bigint,bigint,timestamptz),app_private.cancel_vendor_order(uuid,uuid) from public;

create or replace function app_private.bachs_purchase_intent(p_reference text)
returns table("userId" uuid,"universityId" uuid,"resourceType" text,"resourceId" uuid,"amountKobo" bigint,snapshot jsonb,"expiresAt" timestamptz)
language sql stable set search_path='' as $$
 select k.user_id,k.university_id,'KIRA_SUBSCRIPTION',k.id,k.amount_kobo::bigint,jsonb_build_object('resourceType','KIRA_SUBSCRIPTION','resourceId',k.id,'planId',k.plan_id,'tier',k.tier,'amountKobo',k.amount_kobo,'quoteId',k.quote_id),k.expires_at
 from app_private.kira_checkouts k where k.provider_reference=p_reference and k.status in('CREATED','INITIALIZED')
 union all
 select a.user_id,a.university_id,a.resource_type,a.resource_id,a.amount_kobo,jsonb_build_object('resourceType',a.resource_type,'resourceId',a.resource_id,'amountKobo',a.amount_kobo,'price',coalesce(to_jsonb(os),to_jsonb(tp),to_jsonb(mp))),
 case when a.resource_type='STORE_ORDER' then (select min(expires_at) from public.inventory_reservations where order_id=a.resource_id and status='HELD') when a.resource_type='TUTORIAL_BOOKING' then (select payment_expires_at from public.tutorial_bookings where id=a.resource_id) else mp.payment_expires_at end
 from public.payment_attempts a left join app_private.order_price_snapshots os on a.resource_type='STORE_ORDER' and os.order_id=a.resource_id
 left join app_private.tutorial_booking_prices tp on a.resource_type='TUTORIAL_BOOKING' and tp.booking_id=a.resource_id
 left join app_private.tutorial_material_purchases mp on a.resource_type='TUTORIAL_PURCHASE' and mp.id=a.resource_id
 where a.provider_reference=p_reference and a.status in('CREATED','INITIALIZED') and (os.order_id is not null or tp.booking_id is not null or mp.id is not null)
 union all
 select c.user_id,c.university_id,'RIDER_COMMISSION',c.id,c.amount_kobo,
   jsonb_build_object('resourceType','RIDER_COMMISSION','resourceId',c.id,'amountKobo',c.amount_kobo,'charges',c.charges),c.expires_at
 from app_private.rider_commission_checkouts c where c.provider_reference=p_reference and c.status in ('CREATED','INITIALIZED')
$$;



revoke all on function app_private.bachs_purchase_intent(text) from public;
commit;
