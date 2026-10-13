-- Apply the user's requested product rate to tenant one as a new immutable policy.
-- The seller enters their base price; the buyer's display includes one 2.5% markup
-- and processing. No additional seller commission is applied.
do $repair$
declare
  campus uuid := '6a79211e-6e85-4d95-be24-976edb26ba58';
  actor uuid := 'd34f89d0-aa39-4a92-b52f-a16af84a0b1f';
  provider app_private.payment_fee_profiles;
  policy uuid;
  previous uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('commerce-policy:'||campus::text||':STORE',0));
  select policy_id into previous from app_private.active_commerce_fee_policies where university_id=campus and kind='STORE';
  if exists(select 1 from app_private.commerce_fee_policies where id=previous and version='STORE_20261013_2_5PCT'
    and buyer_basis_points=250 and buyer_flat_per_item_kobo=0 and seller_commission_basis_points=0) then return; end if;
  select * into provider from app_private.payment_fee_profiles
    where university_id=campus and transaction_class='LOCAL_COLLECTION'
      and channel='ANY' and card_network='ANY' and effective_from<=now()
    order by effective_from desc,approved_at desc,id desc limit 1;
  if not found or provider.status<>'APPROVED' or (provider.effective_to is not null and provider.effective_to<=now()) then
    raise exception 'No currently approved local collection profile';
  end if;
  if not exists(select 1 from public.users where id=actor and deleted_at is null and status='ACTIVE') then
    raise exception 'The requesting platform owner is unavailable';
  end if;
  insert into app_private.commerce_fee_policies(
    university_id,kind,version,buyer_basis_points,buyer_flat_per_item_kobo,
    seller_commission_basis_points,collection,checkout_savings,allow_processor_subsidy,
    source_url,approval_note,approved_by,policy_config
  ) values(
    campus,'STORE','STORE_20261013_2_5PCT',250,0,0,
    provider.collection||jsonb_build_object('providerProfileId',provider.id,'providerProfileVersion',provider.version,'transactionClass','LOCAL_COLLECTION'),
    true,false,provider.source_url,
    'User requested product commission of 2.5% on 13 October 2026: one buyer markup, processing included, no second seller commission. Preserve the approved processor rate.',
    actor,jsonb_build_object('feeBearer','INCLUDED_IN_PRICE','customerFeeDisplay','INCLUDED','providerProfileId',provider.id)
  ) returning id into policy;
  insert into app_private.active_commerce_fee_policies(university_id,kind,policy_id) values(campus,'STORE',policy)
    on conflict(university_id,kind) do update set policy_id=excluded.policy_id;
  insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata)
    values(actor,campus,'pricing.commerce.created','commerce_fee_policy',policy::text,'repair-marketplace-20261013','succeeded',
      jsonb_build_object('previousPolicyId',previous,'buyerBasisPoints',250,'buyerFlatPerItemKobo',0,'sellerCommissionBasisPoints',0,
        'providerProfileId',provider.id,'reason','User requested 2.5% product commission. Apply it once and retain the existing approved processor profile.'));
end $repair$;
