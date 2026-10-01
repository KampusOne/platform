begin;
alter table app_private.tutorial_material_purchases drop constraint if exists tutorial_material_purchases_seller_net_kobo_check;
alter table app_private.tutorial_material_purchases add constraint tutorial_material_purchases_seller_net_kobo_check check(seller_net_kobo>=0 and seller_net_kobo<=listed_kobo);
create or replace function app_private.create_discounted_material_quote(p_id uuid,p_uni uuid,p_user uuid,p_resource uuid,p_tutor uuid,p_media uuid,p_policy uuid,p_request uuid,p_title text,p_base integer,p_price jsonb,p_code text)
returns app_private.material_checkout_quotes language plpgsql set search_path='' as $$
declare saved app_private.material_checkout_quotes%rowtype;savings bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('discount-material:'||p_user::text||':'||p_request::text,0));
 select * into saved from app_private.material_checkout_quotes where student_user_id=p_user and request_id=p_request;
 if found then if saved.resource_id<>p_resource or coalesce(saved.pricing->>'couponCode','')<>coalesce(p_code,'') then raise exception 'DISCOUNT_REQUEST_CONFLICT';end if;return saved;end if;
 savings=app_private.reserve_commerce_discount(p_id,p_user,p_uni,'MATERIAL',p_code,(p_price->>'payableKobo')::bigint,now()+interval '15 minutes');
 if savings>0 then p_price=p_price||jsonb_build_object('payableKobo',(p_price->>'payableKobo')::bigint-savings,'discountKobo',(p_price->>'discountKobo')::bigint+savings,'couponCode',p_code);end if;
 insert into app_private.material_checkout_quotes(id,university_id,student_user_id,resource_id,tutor_user_id,media_object_id,policy_id,request_id,title,base_kobo,pricing)
 values(p_id,p_uni,p_user,p_resource,p_tutor,p_media,p_policy,p_request,p_title,p_base,p_price) returning * into saved;return saved;
end $$;
revoke all on function app_private.create_discounted_material_quote(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,jsonb,text) from public;
create or replace function app_private.record_material_receipt(p_reference text,p_amount bigint,p_fee bigint,p_paid_at timestamptz)
returns text language plpgsql set search_path='' as $$
declare attempt public.payment_attempts%rowtype; purchase app_private.tutorial_material_purchases%rowtype; lines jsonb; reason text;
begin
  select * into attempt from public.payment_attempts where provider_reference=p_reference and resource_type='TUTORIAL_PURCHASE';
  if not found then return 'UNKNOWN'; end if;
  select * into purchase from app_private.tutorial_material_purchases where id=attempt.resource_id for update;
  if not found then return 'UNKNOWN'; end if;
  perform app_private.record_verified_paystack_receipt(purchase.university_id,p_reference,'TUTORIAL_PURCHASE',purchase.id,p_amount,p_fee,p_paid_at);
  if purchase.provider_reference=p_reference then return 'ALREADY_PAID'; end if;
  reason=case when purchase.provider_reference is not null then 'SECOND_SUCCESSFUL_PAYMENT'
    when(attempt.university_id,attempt.user_id,attempt.amount_kobo) is distinct from(purchase.university_id,purchase.student_user_id,purchase.amount_kobo)
      or purchase.status<>'PENDING_PAYMENT' or purchase.payment_expires_at<=now() or attempt.status not in ('CREATED','INITIALIZED') or p_amount<>purchase.amount_kobo then 'PAYMENT_SNAPSHOT_OR_STATE_MISMATCH' else null end;
  if reason is not null then
    update public.payment_attempts set status='REQUIRES_REVIEW',failure_code=reason,updated_at=now() where id=attempt.id;
    update public.payment_provider_events set state='REQUIRES_REVIEW',review_reason=reason,updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
    return 'REQUIRES_REVIEW';
  end if;
  lines=jsonb_build_array(jsonb_build_object('code','PAYMENT_SUSPENSE','type','LIABILITY','direction','DEBIT','amount',p_amount));
  if purchase.seller_net_kobo>0 then lines=lines||jsonb_build_array(jsonb_build_object('code','TUTOR_PENDING','type','LIABILITY','owner',purchase.tutor_user_id,'direction','CREDIT','amount',purchase.seller_net_kobo)); end if;
  if p_amount>purchase.seller_net_kobo then lines=lines||jsonb_build_array(jsonb_build_object('code','PLATFORM_COMMISSION','type','REVENUE','direction','CREDIT','amount',p_amount-purchase.seller_net_kobo)); end if;
  if p_amount<purchase.seller_net_kobo then
    if not exists(select 1 from app_private.discount_redemptions where purchase_id=purchase.id and discount_kobo>=purchase.seller_net_kobo-p_amount) then raise exception 'INVALID_SETTLEMENT_MARGIN';end if;
    lines=lines||jsonb_build_array(jsonb_build_object('code','PROMOTION_EXPENSE','type','EXPENSE','direction','DEBIT','amount',purchase.seller_net_kobo-p_amount));
  end if;
  perform app_private.post_finance_journal(purchase.university_id,'TUTORIAL_PURCHASE',purchase.id::text,'material-payment:'||p_reference,'Verified inclusive learning material purchase',lines);
  update app_private.tutorial_material_purchases set status='PAID',earnings_state='PENDING',provider_reference=p_reference,paid_at=p_paid_at,release_at=now()+interval '7 days' where id=purchase.id;
  update public.payment_attempts set status='SUCCEEDED',failure_code=null,completed_at=now(),updated_at=now() where id=attempt.id;
  update public.payment_provider_events set state='PROCESSED',processed_at=now(),updated_at=now() where provider='PAYSTACK' and provider_reference=p_reference;
  return 'PAID';
end; $$;
commit;
