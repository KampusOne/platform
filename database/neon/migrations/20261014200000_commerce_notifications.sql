-- Durable commerce notices share the transaction that confirms each event.
-- No ledger, balance, payment, order or historical notification is rewritten.
begin;
set local lock_timeout='5s';

create or replace function app_private.queue_commerce_notice(
  p_user uuid,p_uni uuid,p_actor uuid,p_title text,p_body text,p_path text,p_key text
) returns void language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.users u join public.profiles p on p.user_id=u.id
    where u.id=p_user and u.status::text='ACTIVE' and u.deleted_at is null
      and p.university_id=p_uni and p.deleted_at is null) then return; end if;
  insert into public.in_app_notifications(user_id,institution_id,actor_user_id,title,body,path,dedupe_key)
    values(p_user,p_uni,p_actor,p_title,p_body,p_path,p_key) on conflict(dedupe_key) do nothing;
  insert into app_private.notification_outbox(user_id,channel,subject,body,dedupe_key)
    values(p_user,'PUSH',p_title,p_body,p_key) on conflict(dedupe_key) do nothing;
end; $$;

create or replace function app_private.notify_verified_commerce_payment()
returns trigger language plpgsql set search_path='' as $$
declare purchase record; seller uuid; destination text; prefix text;
begin
  if new.status<>'SUCCEEDED' or (tg_op='UPDATE' and old.status='SUCCEEDED') then return new; end if;
  if not exists(select 1 from app_private.verified_collection_receipts r
    where r.provider_reference=new.provider_reference) then return new; end if;
  prefix:='commerce:paid:'||new.resource_type||':'||new.resource_id::text;
  if new.resource_type='STORE_ORDER' then
    select o.buyer_user_id,a.user_id seller,o.status into purchase
      from public.orders o join public.agent_profiles a on a.id=o.vendor_profile_id and a.university_id=o.university_id
      where o.id=new.resource_id and o.university_id=new.university_id and o.buyer_user_id=new.user_id;
    if not found or purchase.status not in('PAID','ACCEPTED','READY','IN_DELIVERY','DELIVERED') then return new; end if;
    destination:='/order-detail?id='||new.resource_id::text;
    perform app_private.queue_commerce_notice(new.user_id,new.university_id,purchase.seller,
      'Payment received','We have received your payment. The store will contact you soon. Track your order in KampusOne.',destination,prefix||':buyer');
    perform app_private.queue_commerce_notice(purchase.seller,new.university_id,new.user_id,
      'New paid order','A customer has paid for your product. Open the order to accept it and contact the buyer.','/vendor-orders',prefix||':seller');
  elsif new.resource_type='TUTORIAL_BOOKING' then
    select b.student_user_id,a.user_id seller,b.status,l.title into purchase
      from public.tutorial_bookings b join public.tutorial_listings l on l.id=b.listing_id and l.university_id=b.university_id
      join public.agent_profiles a on a.id=l.tutor_profile_id and a.university_id=b.university_id
      where b.id=new.resource_id and b.university_id=new.university_id and b.student_user_id=new.user_id;
    if not found or purchase.status not in('CONFIRMED','COMPLETED') then return new; end if;
    perform app_private.queue_commerce_notice(new.user_id,new.university_id,purchase.seller,
      'Course payment received','Your booking for '||purchase.title||' is confirmed. Your tutor will contact you soon.','/purchases',prefix||':buyer');
    perform app_private.queue_commerce_notice(purchase.seller,new.university_id,new.user_id,
      'New paid course booking','A student has paid for '||purchase.title||'. Open your learners to view the booking.','/tutor-learners',prefix||':seller');
  elsif new.resource_type='TUTORIAL_PURCHASE' then
    select p.student_user_id,p.tutor_user_id seller,p.status,p.title into purchase
      from app_private.tutorial_material_purchases p where p.id=new.resource_id and p.university_id=new.university_id and p.student_user_id=new.user_id;
    if not found or purchase.status<>'PAID' then return new; end if;
    perform app_private.queue_commerce_notice(new.user_id,new.university_id,purchase.seller,
      'Your course is ready','Payment received for '||purchase.title||'. Open your library to start learning.','/learning-library',prefix||':buyer');
    perform app_private.queue_commerce_notice(purchase.seller,new.university_id,new.user_id,
      'New course purchase','A student has paid for '||purchase.title||'. Your sale is recorded in Earnings.','/earnings',prefix||':seller');
  end if;
  return new;
end; $$;

create or replace function app_private.notify_commerce_fulfilment()
returns trigger language plpgsql set search_path='' as $$
declare buyer uuid; seller uuid; kind text; destination text; verified boolean;
begin
  kind:=case when tg_table_name='orders' then 'STORE_ORDER' when tg_table_name='tutorial_bookings' then 'TUTORIAL_BOOKING' else 'TUTORIAL_PURCHASE' end;
  select exists(select 1 from public.payment_attempts p join app_private.verified_collection_receipts r on r.provider_reference=p.provider_reference
    where p.resource_type=kind and p.resource_id=new.id and p.university_id=new.university_id and p.status='SUCCEEDED') into verified;
  if not verified then return new; end if;
  if kind='STORE_ORDER' then
    buyer:=new.buyer_user_id;
    select a.user_id into seller from public.agent_profiles a where a.id=new.vendor_profile_id and a.university_id=new.university_id;
    destination:='/order-detail?id='||new.id::text;
    if new.status is distinct from old.status and new.status='ACCEPTED' then
      perform app_private.queue_commerce_notice(buyer,new.university_id,seller,'Order accepted',
        'The store has accepted your order and is preparing it. Open your order for updates.',destination,'commerce:accepted:'||new.id::text||':buyer');
    elsif new.status is distinct from old.status and new.status='DELIVERED' then
      perform app_private.queue_commerce_notice(buyer,new.university_id,seller,'Order delivered',
        'Your order has been delivered. Thank you for choosing KampusOne.',destination,'commerce:delivered:'||new.id::text||':buyer');
    end if;
  elsif kind='TUTORIAL_BOOKING' then
    buyer:=new.student_user_id;
    select a.user_id into seller from public.tutorial_listings l join public.agent_profiles a on a.id=l.tutor_profile_id and a.university_id=l.university_id
      where l.id=new.listing_id and l.university_id=new.university_id;
    destination:='/purchases';
    if new.status is distinct from old.status and new.status='COMPLETED' then
      perform app_private.queue_commerce_notice(buyer,new.university_id,seller,'Tutorial completed',
        'Your tutorial is complete. Thank you for choosing KampusOne.','/purchases','commerce:completed:'||kind||':'||new.id::text||':buyer');
    end if;
  else
    buyer:=new.student_user_id;seller:=new.tutor_user_id;destination:='/learning-library';
  end if;
  if new.earnings_state='AVAILABLE' and old.earnings_state in('PENDING','RESERVED') then
    perform app_private.queue_commerce_notice(seller,new.university_id,buyer,'Earnings available',
      'The payment has cleared and your earnings are now available in your wallet.','/earnings','commerce:cleared:'||kind||':'||new.id::text||':seller');
    perform app_private.queue_commerce_notice(buyer,new.university_id,seller,'Purchase completed',
      'Your purchase is complete. Thank you for choosing KampusOne.',destination,'commerce:cleared:'||kind||':'||new.id::text||':buyer');
  end if;
  return new;
end; $$;

create trigger verified_commerce_payment_notice after insert or update of status on public.payment_attempts
  for each row execute function app_private.notify_verified_commerce_payment();
create trigger store_fulfilment_notice after update of status,earnings_state on public.orders
  for each row execute function app_private.notify_commerce_fulfilment();
create trigger tutorial_fulfilment_notice after update of status,earnings_state on public.tutorial_bookings
  for each row execute function app_private.notify_commerce_fulfilment();
create trigger material_earnings_notice after update of earnings_state on app_private.tutorial_material_purchases
  for each row execute function app_private.notify_commerce_fulfilment();

revoke all on function app_private.queue_commerce_notice(uuid,uuid,uuid,text,text,text,text) from public;
revoke all on function app_private.notify_verified_commerce_payment() from public;
revoke all on function app_private.notify_commerce_fulfilment() from public;
commit;
