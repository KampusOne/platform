begin;
alter table public.vendor_storefronts add column pickup_place_id uuid references public.campus_places(id);
create or replace function app_private.guard_storefront_material_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(
    new.display_name,
    new.description,
    new.contact_phone_e164,
    new.pickup_location, new.pickup_place_id,
    new.pickup_instructions,
    new.opening_hours,
    new.default_preparation_minutes
  ) is distinct from row(
    old.display_name,
    old.description,
    old.contact_phone_e164,
    old.pickup_location, old.pickup_place_id,
    old.pickup_instructions,
    old.opening_hours,
    old.default_preparation_minutes
  ) then
    new.listing_revision := old.listing_revision + 1;
    new.reviewed_by_user_id := null;
    new.reviewed_at := null;
    new.moderated_revision := null;

    if old.status = 'APPROVED' then
      new.status := 'NEEDS_CORRECTION';
      new.submitted_at := coalesce(old.submitted_at, now());
      new.review_note := 'Material storefront changes require a new review.';
    elsif old.status = 'SUBMITTED' then
      new.status := 'DRAFT';
      new.submitted_at := null;
      new.review_note := null;
    end if;
  end if;
  return new;
end;
$$;
create or replace function app_private.price_store_order(p_id uuid) returns void language plpgsql set search_path='' as $$
declare o public.orders%rowtype; delivery jsonb; buyer jsonb; commission jsonb; gross integer; distance integer; pickup_lat double precision;pickup_lon double precision;drop_lat double precision;drop_lon double precision;
begin
  select * into o from public.orders where id=p_id for update;
  if o.status<>'PENDING_PAYMENT' or o.fee_snapshot<>'{}'::jsonb then raise exception 'ORDER_ALREADY_PRICED'; end if;
  select p.latitude,p.longitude,d.latitude,d.longitude into pickup_lat,pickup_lon,drop_lat,drop_lon
    from public.vendor_storefronts v join public.campus_places p on p.id=v.pickup_place_id and p.university_id=o.university_id and p.status='PUBLISHED'
    join public.order_delivery_snapshots d on d.order_id=o.id where v.vendor_profile_id=o.vendor_profile_id;
  if pickup_lat is not null and pickup_lon is not null and drop_lat is not null and drop_lon is not null then
    distance:=round(12742000*asin(sqrt(least(1.0,greatest(0.0,power(sin(radians(drop_lat-pickup_lat)/2),2)+cos(radians(pickup_lat))*cos(radians(drop_lat))*power(sin(radians(drop_lon-pickup_lon)/2),2))))))::integer;
  end if;
  delivery:=app_private.quote_fee(o.university_id,'DELIVERY',0,o.delivery_zone_id,distance)
    ||jsonb_build_object('distanceBasis',case when distance is null then 'ZONE_FALLBACK' else 'CAMPUS_MAP_ESTIMATE' end);
  gross:=(delivery->>'feeKobo')::integer;
  buyer:=app_private.quote_fee(o.university_id,'BUYER_SERVICE',o.subtotal_kobo);
  commission:=app_private.quote_fee(o.university_id,'RIDER_COMMISSION',gross);
  if (commission->>'feeKobo')::integer>gross then raise exception 'INVALID_COMMISSION'; end if;
  update public.orders set delivery_fee_kobo=gross,buyer_fee_kobo=(buyer->>'feeKobo')::integer,
    pricing_formula_version=delivery->>'version',fee_snapshot=jsonb_build_object('delivery',delivery,'buyer',buyer,'rider',commission) where id=p_id;
  update public.delivery_jobs set rider_earning_kobo=gross-(commission->>'feeKobo')::integer,
    commission_kobo=(commission->>'feeKobo')::integer,earning_formula_version=commission->>'version',fee_snapshot=jsonb_build_object('delivery',delivery,'commission',commission) where order_id=p_id;
end $$;
revoke all on function app_private.price_store_order(uuid) from public;
create or replace function app_private.create_tutor_purchase(p_id uuid,p_institution uuid,p_student uuid,p_resource uuid,p_listing uuid,p_expected jsonb)
returns public.tutorial_purchases language plpgsql set search_path='' as $$
declare q jsonb; existing public.tutorial_purchases%rowtype;
begin
  perform 1 from public.profiles where user_id=p_student and university_id=p_institution and deleted_at is null for update;
  if not found then raise exception 'BUYER_TENANT_MISMATCH'; end if;
  select * into existing from public.tutorial_purchases where id=p_id;
  if found then
    if existing.student_user_id<>p_student or existing.resource_id is distinct from p_resource or existing.listing_id is distinct from p_listing then raise exception 'PURCHASE_ID_CONFLICT'; end if;
    if existing.status='PENDING_PAYMENT' and (existing.amount_kobo is distinct from (p_expected->>'amountKobo')::integer or existing.fee_snapshot is distinct from p_expected->'fees') then raise exception 'SAVED_PURCHASE_PRICE'; end if;
    return existing;
  end if;
  update public.tutorial_purchases set status='EXPIRED',updated_at=now() where student_user_id=p_student and status='PENDING_PAYMENT' and payment_expires_at<=now();
  select * into existing from public.tutorial_purchases where student_user_id=p_student and
    ((resource_id=p_resource and status in ('PAID','PENDING_PAYMENT')) or (listing_id=p_listing and status='PENDING_PAYMENT')) order by created_at desc limit 1;
  if found then
    if existing.status='PENDING_PAYMENT' and (existing.amount_kobo is distinct from (p_expected->>'amountKobo')::integer or existing.fee_snapshot is distinct from p_expected->'fees') then raise exception 'SAVED_PURCHASE_PRICE'; end if;
    return existing;
  end if;
  q:=app_private.tutor_quote(p_institution,p_student,p_resource,p_listing);
  if q is distinct from p_expected then raise exception 'PRICE_CHANGED'; end if;
  if p_listing is not null then
    perform 1 from public.tutorial_listings where id=p_listing for update;
    if not exists(select 1 from public.tutorial_purchases where student_user_id=p_student and listing_id=p_listing and status='PAID' and access_ends_at>now())
      and (select count(distinct student_user_id) from public.tutorial_purchases where listing_id=p_listing and ((status='PAID' and access_ends_at>now()) or(status='PENDING_PAYMENT' and payment_expires_at>now()))) >= (select capacity from public.tutorial_listings where id=p_listing) then
      raise exception 'TUTORIAL_FULL';
    end if;
  end if;
  insert into public.tutorial_purchases(id,institution_id,student_user_id,tutor_profile_id,resource_id,listing_id,title,package_days,price_kobo,buyer_fee_kobo,commission_kobo,fee_snapshot)
    values(p_id,p_institution,p_student,(q->>'tutorProfileId')::uuid,p_resource,p_listing,q->>'title',(q->>'packageDays')::integer,
      (q->>'priceKobo')::integer,(q->>'buyerFeeKobo')::integer,(q->>'commissionKobo')::integer,q->'fees');
  if (q->>'amountKobo')::integer=0 then perform app_private.activate_tutor_purchase(p_id); end if;
  select * into existing from public.tutorial_purchases where id=p_id;
  return existing;
end $$;
create function app_private.maintain_tutor_commerce() returns jsonb language plpgsql set search_path='' as $$
declare expired integer; released integer;
begin
  update public.tutorial_purchases set status='EXPIRED',updated_at=now() where status='PENDING_PAYMENT' and payment_expires_at<=now();get diagnostics expired=row_count;
  update public.payment_attempts a set status='EXPIRED',failure_code='CHECKOUT_EXPIRED',updated_at=now() from public.tutorial_purchases p where a.resource_type='TUTORIAL_PURCHASE' and a.resource_id=p.id and p.status='EXPIRED' and a.status in ('CREATED','INITIALIZED');
  update public.tutorial_purchases set earnings_state='AVAILABLE',updated_at=now() where status='PAID' and earnings_state='PENDING' and release_at<=now();get diagnostics released=row_count;
  return jsonb_build_object('expired',expired,'released',released);
end $$;
revoke all on function app_private.maintain_tutor_commerce(),app_private.create_tutor_purchase(uuid,uuid,uuid,uuid,uuid,jsonb) from public;
commit;

