-- Run on the fresh production child and in the approved production transaction.
-- All fixtures are rolled back by an exception subtransaction; no provider calls.
DO $experience_acceptance$
declare
 school uuid := gen_random_uuid(); other_school uuid := gen_random_uuid();
 owner uuid := gen_random_uuid(); member uuid := gen_random_uuid(); pro_user uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
 request uuid := gen_random_uuid(); plan uuid := gen_random_uuid(); offer uuid := gen_random_uuid(); odd_plan uuid := gen_random_uuid();
 old_checkout app_private.kira_checkouts; checkout app_private.kira_checkouts; replay app_private.kira_checkouts;
 group_id uuid := gen_random_uuid(); normal_post uuid := gen_random_uuid(); urgent_post uuid := gen_random_uuid();
 study uuid := gen_random_uuid(); invite uuid := gen_random_uuid(); application uuid; token text := repeat(md5(gen_random_uuid()::text),2);
 expense app_private.operations_expenses; same_expense app_private.operations_expenses; first_receipt text; second_receipt text;
 completed boolean := false; blocked boolean; n integer; before_users bigint; before_journals bigint;
begin
 select count(*) into before_users from public.users;
 select count(*) into before_journals from public.ledger_transactions;
 begin
  insert into public.universities(id,name,slug,updated_at) values
   (school,'Experience acceptance fixture','experience-'||school::text,now()),
   (other_school,'Other acceptance fixture','experience-'||other_school::text,now());
  insert into public.users(id,email,password_hash,email_verified_at,updated_at)
   select id,id::text||'@fixture.invalid','non-login-fixture',now(),now() from unnest(array[owner,member,pro_user,outsider]) id;
  insert into public.profiles(id,user_id,university_id,username,display_name,updated_at)
   select gen_random_uuid(),id,case when id=outsider then other_school else school end,
    'ef_'||left(replace(id::text,'-',''),24),'Acceptance fixture',now() from unnest(array[owner,member,pro_user,outsider]) id;

  -- The shared Standard budget counts one parse once, with a three-calendar cap.
  if app_private.reserve_academic_import(owner,school,request,'calendar',5,3)<>'RESERVED'
   or app_private.reserve_academic_import(owner,school,request,'calendar',5,3)<>'REPLAY' then raise exception 'EXPERIENCE_IMPORT_REPLAY';end if;
  for n in 1..2 loop
   if app_private.reserve_academic_import(owner,school,gen_random_uuid(),'calendar',5,3)<>'RESERVED' then raise exception 'EXPERIENCE_CALENDAR_RESERVATION';end if;
  end loop;
  if app_private.reserve_academic_import(owner,school,gen_random_uuid(),'calendar',5,3)<>'CALENDAR_LIMIT' then raise exception 'EXPERIENCE_CALENDAR_LIMIT';end if;
  perform app_private.reserve_academic_import(owner,school,gen_random_uuid(),'timetable',5,3);
  perform app_private.reserve_academic_import(owner,school,gen_random_uuid(),'image',5,3);
  if app_private.reserve_academic_import(owner,school,gen_random_uuid(),'document',5,3)<>'WEEK_LIMIT' then raise exception 'EXPERIENCE_STANDARD_LIMIT';end if;
  for n in 1..30 loop
   if app_private.reserve_academic_import(pro_user,school,gen_random_uuid(),'document',30,30)<>'RESERVED' then raise exception 'EXPERIENCE_PRO_RESERVATION';end if;
  end loop;
  if app_private.reserve_academic_import(pro_user,school,gen_random_uuid(),'image',30,30)<>'WEEK_LIMIT' then raise exception 'EXPERIENCE_PRO_LIMIT';end if;

  -- New offers leave prior snapshots intact and settle a verified month once.
  insert into app_private.kira_price_plans(id,university_id,version,amount_kobo,listed_amount_kobo,discount_percent,collection,estimated_processing_kobo,approved_by,approval_note,source_url)
   values(plan,school,'FIXTURE_ORIGINAL',600000,600000,0,'{}',19000,owner,'Self-cleaning acceptance fixture','https://paystack.com/pricing');
  insert into app_private.active_kira_price_plans(university_id,plan_id) values(school,plan);
  old_checkout := app_private.create_kira_checkout(gen_random_uuid(),owner,school,gen_random_uuid(),'ef-old:'||owner::text);
  insert into app_private.kira_price_plans(id,university_id,version,amount_kobo,listed_amount_kobo,discount_percent,collection,estimated_processing_kobo,approved_by,approval_note,source_url)
   values(offer,school,'FIXTURE_OFFER',600000,800000,25,'{}',19000,owner,'Self-cleaning acceptance fixture','https://paystack.com/pricing');
  update app_private.active_kira_price_plans set plan_id=offer where university_id=school;
  request:=gen_random_uuid();
  checkout := app_private.create_kira_checkout(gen_random_uuid(),member,school,request,'ef-offer:'||member::text);
  replay := app_private.create_kira_checkout(gen_random_uuid(),member,school,request,'unused-replay');
  if checkout.id<>replay.id or checkout.amount_kobo<>600000 or checkout.listed_amount_kobo<>800000 or checkout.offer_discount_percent<>25
   or (select listed_amount_kobo from app_private.kira_checkouts where id=old_checkout.id)<>600000 then raise exception 'EXPERIENCE_KIRA_SNAPSHOT';end if;
  blocked:=false;begin
   perform app_private.create_discounted_kira_checkout(gen_random_uuid(),pro_user,school,gen_random_uuid(),'ef-stack:'||pro_user::text,'EXTRA20');
  exception when others then if sqlerrm='DISCOUNT_CANNOT_COMBINE' then blocked:=true;else raise;end if;end;
  if not blocked then raise exception 'EXPERIENCE_STACKED_DISCOUNT_ALLOWED';end if;
  blocked:=false;begin
   perform app_private.create_kira_checkout(gen_random_uuid(),outsider,school,gen_random_uuid(),'ef-foreign:'||outsider::text);
  exception when others then if sqlerrm='BUYER_TENANT_MISMATCH' then blocked:=true;else raise;end if;end;
  if not blocked then raise exception 'EXPERIENCE_KIRA_TENANT';end if;
  blocked:=false;begin update app_private.kira_checkouts set offer_discount_percent=10 where id=checkout.id;
  exception when others then if sqlerrm='KIRA_CHECKOUT_SNAPSHOT_IMMUTABLE' then blocked:=true;else raise;end if;end;
  if not blocked then raise exception 'EXPERIENCE_KIRA_SNAPSHOT_MUTABLE';end if;
  first_receipt:=app_private.record_kira_receipt(checkout.provider_reference,600000,19000,now());
  second_receipt:=app_private.record_kira_receipt(checkout.provider_reference,600000,19000,now());
  if first_receipt<>'PAID' or second_receipt<>'ALREADY_PAID'
   or (select count(*) from app_private.kira_billing_periods where checkout_id=checkout.id)<>1
   or not exists(select 1 from app_private.ai_subscriptions where user_id=member and status='ACTIVE' and current_period_end>now()+interval '27 days') then raise exception 'EXPERIENCE_KIRA_RECEIPT';end if;
  insert into app_private.kira_price_plans(id,university_id,version,amount_kobo,listed_amount_kobo,discount_percent,collection,estimated_processing_kobo,approved_by,approval_note,source_url)
   values(odd_plan,school,'FIXTURE_ODD_KOBO',67001,100001,33,'{}',1000,owner,'Self-cleaning acceptance fixture','https://paystack.com/pricing');
  update app_private.active_kira_price_plans set plan_id=odd_plan where university_id=school;
  checkout := app_private.create_kira_checkout(gen_random_uuid(),pro_user,school,gen_random_uuid(),'ef-odd:'||pro_user::text);
  if checkout.amount_kobo<>67001 then raise exception 'EXPERIENCE_INTEGER_KOBO';end if;

  -- Study updates stay in their group; urgent updates queue one member push.
  insert into public.student_groups(id,institution_id,owner_user_id,kind,name,request_id) values(group_id,school,owner,'STUDY_GROUP','Self-cleaning study fixture',gen_random_uuid());
  insert into public.student_group_members(group_id,institution_id,user_id,role) values(group_id,school,owner,'ADMIN'),(group_id,school,member,'MEMBER');
  insert into public.student_group_posts(id,group_id,institution_id,author_user_id,request_id,title,body) values(normal_post,group_id,school,member,gen_random_uuid(),'Study fixture','Osmosis revision fixture');
  if (select count(*) from public.in_app_notifications where dedupe_key='community-post:'||normal_post::text||':'||owner::text)<>1
   or exists(select 1 from app_private.notification_outbox where dedupe_key like 'community-post:'||normal_post::text||':%') then raise exception 'EXPERIENCE_NORMAL_STUDY_NOTIFICATION';end if;
  insert into public.student_group_posts(id,group_id,institution_id,author_user_id,request_id,title,body,urgent,venue) values(urgent_post,group_id,school,owner,gen_random_uuid(),'Urgent fixture','Venue changed fixture',true,'LT 2');
  if (select count(*) from app_private.notification_outbox where dedupe_key='community-urgent:'||urgent_post::text||':'||member::text and channel='PUSH' and state='PENDING')<>1 then raise exception 'EXPERIENCE_URGENT_PUSH';end if;
  blocked:=false;begin
   insert into public.student_group_members(group_id,institution_id,user_id) values(group_id,other_school,outsider);
  exception when foreign_key_violation then blocked:=true;end;
  if not blocked then raise exception 'EXPERIENCE_GROUP_FOREIGN_TENANT';end if;
  insert into public.student_group_study_sessions(id,group_id,institution_id,user_id,request_id,started_at) values(study,group_id,school,member,gen_random_uuid(),now()-interval '35 minutes');
  blocked:=false;begin
   insert into public.student_group_study_sessions(group_id,institution_id,user_id,request_id) values(group_id,school,member,gen_random_uuid());
  exception when unique_violation then blocked:=true;end;
  if not blocked then raise exception 'EXPERIENCE_DUPLICATE_STUDY_TIMER';end if;
  update public.student_group_study_sessions set ended_at=now() where id=study;
  if (select extract(epoch from ended_at-started_at) from public.student_group_study_sessions where id=study)<>2100 then raise exception 'EXPERIENCE_STUDY_DURATION';end if;

  -- Exclusive intake has no document; disabling its campaign blocks submissions.
  insert into app_private.trusted_vendor_invites(id,institution_id,email,token_hash,created_by,reason,expires_at)
   values(invite,school,pro_user::text||'@fixture.invalid',token,owner,'Self-cleaning business acceptance fixture',now()+interval '1 hour');
  application:=app_private.submit_trusted_vendor(pro_user,token,gen_random_uuid(),jsonb_build_object('birthDate','2000-01-01','businessName','Fixture shop','description','Self-cleaning business fixture','legalName','Fixture Owner','phone','+2348000000001','address','Fixture campus','category','Food','campus','Ugbowo','operations',jsonb_build_object('service','pickup')));
  if not exists(select 1 from app_private.trusted_vendor_intakes where application_id=application and document_media_id is null and business_details->>'service'='pickup') then raise exception 'EXPERIENCE_EXCLUSIVE_DOCUMENT_OR_DETAILS';end if;
  update app_private.agent_campaign_controls set enabled=false where campaign_key='exclusive';
  blocked:=false;begin perform app_private.submit_trusted_vendor(pro_user,token,gen_random_uuid(),'{}');
  exception when others then if sqlerrm='TRUSTED_CAMPAIGN_DISABLED' then blocked:=true;else raise;end if;end;
  if not blocked then raise exception 'EXPERIENCE_DISABLED_CAMPAIGN';end if;

  -- Expenses are balanced immutable journals, with exact idempotent replay.
  request:=gen_random_uuid();
  expense:=app_private.record_operations_expense(owner,request,school,'Hosting','Self-cleaning expense',10000,(now()at time zone 'Africa/Lagos')::date);
  same_expense:=app_private.record_operations_expense(owner,request,school,'Hosting','Self-cleaning expense',10000,(now()at time zone 'Africa/Lagos')::date);
  if expense.id<>same_expense.id or not app_private.validate_balanced_ledger_transaction(expense.journal_id) then raise exception 'EXPERIENCE_EXPENSE_IDEMPOTENCY_OR_BALANCE';end if;
  blocked:=false;begin
   perform app_private.record_operations_expense(owner,request,school,'Hosting','Self-cleaning expense',20000,(now()at time zone 'Africa/Lagos')::date);
  exception when others then if sqlerrm='EXPENSE_REQUEST_CONFLICT' then blocked:=true;else raise;end if;end;
  if not blocked then raise exception 'EXPERIENCE_CHANGED_EXPENSE_REPLAY';end if;
  blocked:=false;begin update app_private.operations_expenses set amount_kobo=1 where id=expense.id;
  exception when others then if sqlerrm='operations_expenses is append-only' then blocked:=true;else raise;end if;end;
  if not blocked then raise exception 'EXPERIENCE_MUTABLE_EXPENSE';end if;
  set constraints all immediate;
  completed:=true;
  raise exception using errcode='P0397',message='ROLLBACK_EXPERIENCE_ACCEPTANCE_FIXTURES';
 exception when sqlstate 'P0397' then if not completed then raise;end if;end;
 if (select count(*) from public.users)<>before_users or (select count(*) from public.ledger_transactions)<>before_journals
  or exists(select 1 from public.universities where id in(school,other_school))
  or exists(select 1 from app_private.kira_price_plans where id in(plan,offer,odd_plan))
  or exists(select 1 from public.student_groups where id=group_id)
  or exists(select 1 from app_private.trusted_vendor_invites where id=invite)
  or exists(select 1 from app_private.academic_import_usage where user_id in(owner,pro_user)) then raise exception 'EXPERIENCE_FIXTURE_ROLLBACK';end if;
end $experience_acceptance$;
