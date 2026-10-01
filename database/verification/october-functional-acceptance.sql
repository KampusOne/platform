-- Run on the rehearsal branch, then production after the single migration batch.
-- Every fixture is removed by an exception subtransaction. No provider calls.
DO $october_acceptance$
declare
 uni constant uuid := '6a79211e-6e85-4d95-be24-976edb26ba58';
 actor constant uuid := 'd34f89d0-aa39-4a92-b52f-a16af84a0b1f';
 fixture_user uuid := gen_random_uuid(); other_user uuid := gen_random_uuid();
 fixture_key text := 'october-fixture:'||gen_random_uuid()::text;
 upload uuid := gen_random_uuid(); discount uuid := gen_random_uuid(); purchase uuid := gen_random_uuid();
 campus uuid; other_campus uuid; place uuid; candidate uuid := gen_random_uuid(); import_id uuid;
 journal uuid; replay uuid; lines jsonb; blocked boolean; complete boolean := false; n integer;
 before_users bigint; before_media bigint; before_journals bigint;
begin
 select count(*) into before_users from public.users;
 select count(*) into before_media from public.media_objects;
 select count(*) into before_journals from public.ledger_transactions;
 select id into campus from public.institution_campuses where institution_id=uni and slug='ugbowo';
 select id into other_campus from public.institution_campuses where institution_id=uni and slug='ekehuan';
 select id into place from public.campus_places where campus_id=other_campus and status='PUBLISHED' order by id limit 1;
 if campus is null or other_campus is null or place is null then raise exception 'OCTOBER_CAMPUS_FIXTURE_NOT_READY';end if;
 begin
  insert into public.users(id,email,password_hash,email_verified_at,updated_at) values(fixture_user,fixture_user::text||'@fixture.invalid','non-login-fixture',now(),now()),(other_user,other_user::text||'@fixture.invalid','non-login-fixture',now(),now());
  insert into public.profiles(id,user_id,username,display_name,university_id,updated_at)values(gen_random_uuid(),fixture_user,'fixture_'||left(replace(fixture_user::text,'-',''),20),'Acceptance fixture',uni,now());
  -- The actual database, not just HTTP validation, permits 500 MiB DM objects.
  insert into public.media_objects(owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name)values(fixture_user,uni,'message',fixture_key,'application/pdf',524288000,'fixture.pdf');
  blocked=false;begin
   insert into public.media_objects(owner_user_id,kind,object_key,content_type,size_bytes,original_name)values(fixture_user,'message',fixture_key||':too-large','application/pdf',524288001,'fixture.pdf');
  exception when check_violation then blocked=true;end;
  if not blocked then raise exception 'OCTOBER_UPLOAD_LIMIT_NOT_ENFORCED';end if;
  blocked=false;begin
   insert into public.media_objects(owner_user_id,kind,object_key,content_type,size_bytes,original_name)values(fixture_user,'kyc',fixture_key||':identity-too-large','image/jpeg',10485761,'fixture.jpg');
  exception when check_violation then blocked=true;end;
  if not blocked then raise exception 'OCTOBER_PRIVATE_IDENTITY_LIMIT_CHANGED';end if;
  perform app_private.reserve_message_upload(upload,fixture_user,uni,fixture_key,'multipart','fixture.pdf','application/pdf',524288000);
  perform app_private.reserve_message_upload(upload,fixture_user,uni,fixture_key,'unused-retry','fixture.pdf','application/pdf',524288000);
  for n in 1..3 loop perform app_private.reserve_message_upload(gen_random_uuid(),fixture_user,uni,fixture_key||n,'multipart','fixture.pdf','application/pdf',524288000);end loop;
  blocked=false;begin
   perform app_private.reserve_message_upload(gen_random_uuid(),fixture_user,uni,fixture_key||':quota','multipart','fixture.pdf','application/pdf',524288000);
  exception when others then if sqlerrm='UPLOAD_ALLOWANCE_EXHAUSTED' then blocked=true;else raise;end if;end;
  if not blocked then raise exception 'OCTOBER_UPLOAD_ALLOWANCE_NOT_ENFORCED';end if;
  blocked=false;begin
   perform app_private.reserve_message_upload(upload,other_user,uni,fixture_key,'multipart','fixture.pdf','application/pdf',524288000);
  exception when others then if sqlerrm='UPLOAD_SESSION_CONFLICT' then blocked=true;else raise;end if;end;
  if not blocked then raise exception 'OCTOBER_UPLOAD_OWNER_NOT_ENFORCED';end if;
  -- Budget reservations are serialized, tenant-bound and scope-specific.
  insert into app_private.discount_codes(id,institution_id,code,scope,percent,ends_at,max_uses,per_user_limit,created_by,budget_kobo)values(discount,uni,'F_'||upper(left(replace(discount::text,'-',''),24)),'STORE',50,now()+interval '1 hour',20,20,actor,5000);
  perform app_private.reserve_commerce_discount(purchase,fixture_user,uni,'STORE','F_'||upper(left(replace(discount::text,'-',''),24)),10000,now()+interval '15 minutes');
  blocked=false;begin
   perform app_private.reserve_commerce_discount(gen_random_uuid(),fixture_user,uni,'STORE','F_'||upper(left(replace(discount::text,'-',''),24)),10000,now()+interval '15 minutes');
  exception when others then if sqlerrm='DISCOUNT_BUDGET_EXHAUSTED' then blocked=true;else raise;end if;end;
  if not blocked then raise exception 'OCTOBER_DISCOUNT_BUDGET_NOT_ENFORCED';end if;
  blocked=false;begin
   perform app_private.reserve_commerce_discount(gen_random_uuid(),fixture_user,uni,'TUTORIAL','F_'||upper(left(replace(discount::text,'-',''),24)),10000,now()+interval '15 minutes');
  exception when others then if sqlerrm='DISCOUNT_UNAVAILABLE' then blocked=true;else raise;end if;end;
  if not blocked then raise exception 'OCTOBER_DISCOUNT_SCOPE_NOT_ENFORCED';end if;
  -- A promotion shortfall is an explicit expense, while supplier earnings remain.
  lines=jsonb_build_array(jsonb_build_object('code','PAYSTACK_CLEARING','type','ASSET','direction','DEBIT','amount',5000),jsonb_build_object('code','PROMOTION_EXPENSE','type','EXPENSE','direction','DEBIT','amount',5000),jsonb_build_object('code','VENDOR_AVAILABLE','type','LIABILITY','owner',fixture_user,'direction','CREDIT','amount',10000));
  journal=app_private.post_finance_journal(uni,'ACCEPTANCE_FIXTURE',fixture_key,fixture_key,'Self-cleaning discounted sale',lines);
  replay=app_private.post_finance_journal(uni,'ACCEPTANCE_FIXTURE',fixture_key,fixture_key,'Self-cleaning discounted sale',lines);
  if journal<>replay or app_private.finance_balance(uni,fixture_user,'VENDOR_AVAILABLE')<>10000 then raise exception 'OCTOBER_PROMOTION_LEDGER_NOT_BALANCED';end if;
  -- GIS validation and campus scoping exercise real PostGIS with a private fixture.
  insert into app_private.map_imports(institution_id,campus_id,actor_user_id,request_key,status)values(uni,campus,actor,fixture_key,'REVIEW')returning id into import_id;
  insert into app_private.map_candidates(id,institution_id,campus_id,import_id,source_provider,source_feature_id,feature_kind,name,geometry)values(candidate,uni,campus,import_id,'OSM',fixture_key,'PLACE','GIS acceptance fixture','{"type":"Polygon","coordinates":[[[5.61,6.39],[5.611,6.39],[5.611,6.391],[5.61,6.391],[5.61,6.39]]]}');
  blocked=false;begin
   perform app_private.review_map_candidate(candidate,actor,'MERGE',place,null,'Reject the other-campus place');
  exception when others then if sqlerrm='MAP_PLACE_SCOPE' then blocked=true;else raise;end if;end;
  if not blocked then raise exception 'OCTOBER_MAP_PLACE_SCOPE_NOT_ENFORCED';end if;
  update app_private.map_candidates set geometry='{"type":"Polygon","coordinates":[[[5.61,6.39],[5.611,6.391],[5.611,6.39],[5.61,6.391],[5.61,6.39]]]}' where id=candidate;
  blocked=false;begin
   perform app_private.review_map_candidate(candidate,actor,'APPROVE',null,null,'Reject self-crossing footprint');
  exception when others then if sqlerrm='MAP_INVALID_GEOMETRY' then blocked=true;else raise;end if;end;
  if not blocked then raise exception 'OCTOBER_MAP_INVALID_GEOMETRY_NOT_ENFORCED';end if;
  set constraints all immediate;
  complete=true;
  raise exception using errcode='P0398',message='ROLLBACK_OCTOBER_ACCEPTANCE_FIXTURES';
 exception when sqlstate 'P0398' then if not complete then raise;end if;end;
 if (select count(*) from public.users)<>before_users or (select count(*) from public.media_objects)<>before_media or (select count(*) from public.ledger_transactions)<>before_journals
 or exists(select 1 from app_private.map_imports where request_key=fixture_key) or exists(select 1 from app_private.discount_codes where id=discount) or exists(select 1 from app_private.media_upload_sessions where owner_user_id=fixture_user)
 then raise exception 'OCTOBER_FIXTURES_NOT_ROLLED_BACK';end if;
end $october_acceptance$;
