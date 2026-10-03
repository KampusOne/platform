-- Self-cleaning functional acceptance: no provider calls or durable fixtures.
do $kira_catalogue_acceptance$
declare
  campus uuid; actor uuid; collection jsonb; previous_standard uuid;
  student uuid:=gen_random_uuid(); plan uuid:=gen_random_uuid(); request uuid:=gen_random_uuid();
  coupon uuid:=gen_random_uuid(); q app_private.kira_subscription_quotes; k app_private.kira_checkouts;
  reference text:='K1-CATALOGUE-ACCEPTANCE-'||gen_random_uuid()::text;
  code text:='K1AC'||upper(substring(replace(gen_random_uuid()::text,'-',''),1,12));
  boundary timestamptz:=now()+interval '5 minutes'; blocked boolean; completed boolean:=false;
begin
  select p.university_id,p.approved_by,p.collection into campus,actor,collection
    from app_private.active_kira_price_plans a join app_private.kira_price_plans p on p.id=a.plan_id where a.tier='pro' limit 1;
  if campus is null then raise exception 'KIRA_ACCEPTANCE_REQUIRES_ONE_APPROVED_PRO_PLAN'; end if;
  select plan_id into previous_standard from app_private.active_kira_price_plans where university_id=campus and tier='standard';
  begin
    insert into public.users(id,email,password_hash,updated_at) values(student,student::text||'@acceptance.invalid','self-cleaning synthetic acceptance only',now());
    insert into public.profiles(id,user_id,university_id,username,display_name,updated_at)
      values(student,student,campus,'k1ac_'||substring(replace(student::text,'-',''),1,20),'Self-cleaning acceptance',now());
    insert into app_private.kira_price_plans(id,university_id,tier,plan_name,version,amount_kobo,listed_amount_kobo,discount_percent,collection,estimated_processing_kobo,approved_by,approval_note,source_url,model_access,offer_active,offer_starts_at,offer_ends_at)
      values(plan,campus,'standard','Kira Standard','ACCEPTANCE-'||plan::text,160000,200000,20,collection,3000,actor,'Self-cleaning scheduled Standard pricing fixture','https://paystack.com/pricing','standard',true,boundary,boundary+interval '1 hour');
    insert into app_private.active_kira_price_plans(university_id,tier,plan_id) values(campus,'standard',plan)
      on conflict(university_id,tier) do update set plan_id=excluded.plan_id;
    if app_private.kira_effective_discount((select p from app_private.kira_price_plans p where id=plan),boundary-interval '1 second')<>0
      or app_private.kira_effective_discount((select p from app_private.kira_price_plans p where id=plan),boundary)<>20
      or app_private.kira_effective_discount((select p from app_private.kira_price_plans p where id=plan),boundary+interval '1 hour')<>0 then
      raise exception 'KIRA_SCHEDULE_BOUNDARY_FAILED';
    end if;
    insert into app_private.discount_codes(id,institution_id,code,scope,percent,ends_at,max_uses,created_by)
      values(coupon,campus,code,'KIRA',10,now()+interval '3 minutes',1,actor);
    q=app_private.quote_kira_subscription(gen_random_uuid(),student,campus,request,'standard',code);
    if q.amount_kobo<>180000 or q.offer_discount_percent<>0 or q.coupon_discount_percent<>10
      or q.expires_at<>now()+interval '3 minutes' or q.expires_at>=boundary then raise exception 'KIRA_QUOTE_SCHEDULE_OR_COUPON_SNAPSHOT_FAILED'; end if;
    blocked:=false;
    begin
      perform app_private.create_quoted_kira_checkout(student,campus,gen_random_uuid(),reference,q.id,'standard',q.amount_kobo+1);
    exception when others then if sqlerrm='KIRA_PRICE_CHANGED' then blocked:=true; else raise; end if; end;
    if not blocked then raise exception 'KIRA_UNACCEPTED_TOTAL_NOT_BLOCKED'; end if;
    update app_private.discount_codes set active=false where id=coupon;
    blocked:=false;
    begin
      perform app_private.create_quoted_kira_checkout(student,campus,gen_random_uuid(),reference,q.id,'standard',q.amount_kobo);
    exception when others then if sqlerrm='KIRA_PRICE_CHANGED' then blocked:=true; else raise; end if; end;
    if not blocked then raise exception 'KIRA_CHANGED_COUPON_NOT_BLOCKED'; end if;
    blocked:=false;
    begin update app_private.kira_subscription_quotes set amount_kobo=1 where id=q.id;
    exception when others then if sqlerrm like '%append-only%' then blocked:=true; else raise; end if; end;
    if not blocked then raise exception 'KIRA_QUOTE_MUTATION_NOT_BLOCKED'; end if;
    q=app_private.quote_kira_subscription(gen_random_uuid(),student,campus,gen_random_uuid(),'standard','');
    k=app_private.create_quoted_kira_checkout(student,campus,gen_random_uuid(),reference,q.id,'standard',q.amount_kobo);
    if k.tier<>'standard' or k.amount_kobo<>200000 or k.quote_id<>q.id then raise exception 'KIRA_CHECKOUT_SNAPSHOT_FAILED'; end if;
    if app_private.record_kira_receipt(reference,k.amount_kobo,3000,now())<>'PAID'
      or app_private.record_kira_receipt(reference,k.amount_kobo,3000,now())<>'ALREADY_PAID' then raise exception 'KIRA_RECEIPT_IDEMPOTENCY_FAILED'; end if;
    if (select count(*) from app_private.kira_billing_periods where user_id=student)<>1
      or not exists(select 1 from app_private.kira_billing_periods where user_id=student and tier='standard' and starts_at<=now() and ends_at>now())
      or not exists(select 1 from app_private.ai_subscriptions where user_id=student and tier='standard' and status='ACTIVE') then
      raise exception 'KIRA_PAID_STANDARD_ENTITLEMENT_FAILED';
    end if;
    set constraints all immediate;
    completed:=true;
    raise exception using errcode='P0398',message='ROLLBACK_KIRA_CATALOGUE_ACCEPTANCE';
  exception when sqlstate 'P0398' then if not completed then raise; end if; end;
  if exists(select 1 from public.users where id=student)
    or exists(select 1 from app_private.kira_price_plans where id=plan)
    or exists(select 1 from app_private.verified_paystack_receipts where provider_reference=reference)
    or (select plan_id from app_private.active_kira_price_plans where university_id=campus and tier='standard') is distinct from previous_standard then
    raise exception 'KIRA_ACCEPTANCE_FIXTURE_CLEANUP_FAILED';
  end if;
end;
$kira_catalogue_acceptance$;
