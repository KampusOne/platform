begin;

-- Preserve the full approved price and provider rule on new bookings only.
-- Historical bookings keep their original amounts and settlement records.
create or replace function app_private.create_priced_tutorial_booking(
  p_id uuid,p_uni uuid,p_user uuid,p_listing uuid,p_window uuid,p_request uuid,p_policy uuid,p_base integer,p_price jsonb
) returns table(id uuid,amount_kobo integer,status text) language plpgsql set search_path='' as $$
declare previous app_private.tutorial_booking_prices%rowtype; selected_listing public.tutorial_listings%rowtype;
  tutor_user uuid; created record;
begin
  perform pg_advisory_xact_lock(hashtextextended('tutorial-checkout:'||p_user::text||':'||p_request::text,0));
  select * into previous from app_private.tutorial_booking_prices where student_user_id=p_user and request_id=p_request;
  if found then
    if (previous.university_id,previous.listing_id,previous.availability_window_id) is distinct from(p_uni,p_listing,p_window) then raise exception 'QUOTE_REQUEST_CONFLICT'; end if;
    return query select b.id,b.amount_kobo,b.status from public.tutorial_bookings b where b.id=previous.booking_id; return;
  end if;
  if not exists(select 1 from public.profiles where user_id=p_user and university_id=p_uni and deleted_at is null) or
    not exists(select 1 from app_private.commerce_fee_policies cp where cp.id=p_policy and cp.university_id=p_uni and cp.kind='TUTORIAL') then raise exception 'TUTORIAL_UNAVAILABLE'; end if;
  select l.* into selected_listing from public.tutorial_listings l where l.id=p_listing and l.university_id=p_uni and l.status='PUBLISHED'
    and l.review_status='APPROVED' and not l.is_demo and l.deleted_at is null for update;
  if not found then raise exception 'TUTORIAL_UNAVAILABLE'; end if;
  select a.user_id into tutor_user from public.agent_profiles a where a.id=selected_listing.tutor_profile_id and a.university_id=p_uni and a.agent_type='TUTOR' and a.status='ACTIVE';
  if tutor_user is null then raise exception 'TUTORIAL_UNAVAILABLE'; end if;
  if selected_listing.price_kobo is distinct from p_base or p_base<=0 then raise exception 'QUOTE_PRICE_CHANGED'; end if;
  if (p_price->>'baseKobo')::integer is distinct from p_base or (p_price->>'fareKobo')::integer is distinct from 0 or
    (p_price->>'payableKobo')::integer<=0 or (p_price->>'payableKobo')::integer>(p_price->>'listedItemsKobo')::integer then raise exception 'INVALID_QUOTE'; end if;
  select * into created from app_private.create_tutorial_booking(p_id,p_uni,p_listing,p_window,p_user);
  update public.tutorial_bookings set amount_kobo=(p_price->>'payableKobo')::integer,pricing_formula_version='INCLUSIVE_V1' where tutorial_bookings.id=p_id;
  insert into app_private.tutorial_booking_prices(booking_id,university_id,student_user_id,tutor_user_id,listing_id,availability_window_id,
    request_id,policy_id,base_kobo,listed_kobo,payable_kobo,seller_net_kobo,estimated_processing_kobo,pricing_context)
  values(p_id,p_uni,p_user,tutor_user,p_listing,p_window,p_request,p_policy,p_base,(p_price->>'listedItemsKobo')::integer,
    (p_price->>'payableKobo')::integer,(p_price->>'sellerNetKobo')::integer,(p_price->>'estimatedProcessingKobo')::integer,p_price);
  return query select b.id,b.amount_kobo,b.status from public.tutorial_bookings b where b.id=p_id;
end; $$;

revoke all on function app_private.create_priced_tutorial_booking(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb) from public;
commit;
