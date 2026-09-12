-- Run on a disposable Neon branch after phase_3_commerce_foundation.sql.
-- The nested exception block rolls back every fixture before this statement exits.

do $phase3_acceptance$
declare
  university uuid;
  buyer uuid;
  vendor_user uuid;
  reviewer uuid;
  second_university uuid := gen_random_uuid();
  application uuid := gen_random_uuid();
  vendor uuid := gen_random_uuid();
  category uuid := gen_random_uuid();
  zone uuid := gen_random_uuid();
  product uuid := gen_random_uuid();
  test_order_id uuid := gen_random_uuid();
  invalid_order_id uuid := gen_random_uuid();
  test_refund_id uuid := gen_random_uuid();
  test_review_id uuid := gen_random_uuid();
  fixture_suffix text := substring(replace(gen_random_uuid()::text, '-', '') from 1 for 12);
  original_revision integer;
  created record;
  acceptance_completed boolean := false;
begin
  select id into university
  from public.universities
  where deleted_at is null
  order by created_at
  limit 1;

  select users.id into buyer
  from public.users users
  join public.profiles profiles on profiles.user_id = users.id
  where users.deleted_at is null
    and profiles.deleted_at is null
    and profiles.university_id = university
  order by users.created_at
  limit 1;

  select id into vendor_user
  from public.users
  where deleted_at is null and id <> buyer
  order by created_at
  limit 1;

  select id into reviewer
  from public.users
  where deleted_at is null and id not in (buyer, vendor_user)
  order by created_at
  limit 1;

  if university is null or buyer is null or vendor_user is null or reviewer is null then
    raise exception 'PHASE_3_ACCEPTANCE_REQUIRES_ONE_UNIVERSITY_AND_THREE_USERS';
  end if;

  begin
    insert into public.universities (
      id, name, slug, country, state, updated_at
    ) values (
      second_university,
      'Phase 3 acceptance ' || fixture_suffix,
      'phase-3-acceptance-' || fixture_suffix,
      'Nigeria',
      'Edo',
      now()
    );

    insert into public.agent_applications (
      id, university_id, user_id, agent_type, display_name, phone_e164,
      statement, status, reviewer_user_id, review_note, reviewed_at
    ) values (
      application, university, vendor_user, 'VENDOR',
      'Phase 3 acceptance vendor', '+2348031234567',
      'Self-cleaning Phase 3 commerce acceptance fixture.',
      'APPROVED', reviewer, 'Approved only inside the rehearsal transaction.', now()
    );

    insert into public.agent_profiles (
      id, university_id, user_id, application_id, agent_type,
      display_name, verified_at, status
    ) values (
      vendor, university, vendor_user, application, 'VENDOR',
      'Phase 3 acceptance vendor', now(), 'ACTIVE'
    );

    insert into public.product_categories (
      id, university_id, name, status, listing_rules,
      created_by_user_id, reviewed_by_user_id, reviewed_at
    ) values (
      category, university, 'Acceptance essentials ' || fixture_suffix,
      'APPROVED', 'Self-cleaning rehearsal fixture.',
      reviewer, reviewer, now()
    );

    insert into public.vendor_storefronts (
      vendor_profile_id, university_id, display_name, description,
      contact_phone_e164, pickup_location, status,
      submitted_at, reviewed_by_user_id, reviewed_at, review_note
    ) values (
      vendor, university, 'Phase 3 acceptance vendor',
      'Self-cleaning storefront used only for migration acceptance.',
      '+2348031234567', 'Main Gate acceptance pickup point',
      'APPROVED', now(), reviewer, now(), 'Approved only for the rehearsal.'
    );

    insert into public.delivery_zones (
      id, university_id, name, base_fee_kobo, active
    ) values (
      zone, university, 'Acceptance zone ' || fixture_suffix, 50000, true
    );

    insert into public.vendor_products (
      id, university_id, vendor_profile_id, name, description,
      category, category_id, price_kobo, stock_quantity, status,
      submitted_at, package_weight_grams, package_length_cm,
      package_width_cm, package_height_cm, bicycle_delivery_eligible
    ) values (
      product, university, vendor, 'Acceptance notebook',
      'Self-cleaning product used only for Phase 3 acceptance.',
      'Acceptance essentials ' || fixture_suffix, category,
      150000, 4, 'SUBMITTED', now(), 350, 24, 18, 3, true
    );

    begin
      update public.vendor_products set status = 'PUBLISHED' where id = product;
      raise exception 'UNMODERATED_PUBLICATION_WAS_ACCEPTED';
    exception
      when check_violation then null;
    end;

    update public.vendor_products
    set status = 'PUBLISHED',
        reviewed_by_user_id = reviewer,
        reviewed_at = now(),
        moderated_revision = listing_revision,
        moderation_note = 'Approved only for the rehearsal.'
    where id = product;

    select * into created
    from app_private.create_store_order_v2(
      test_order_id,
      university,
      buyer,
      vendor,
      zone,
      'Ada Student',
      '+2348031234567',
      'Hall 2 main entrance',
      'Beside the porter lodge',
      null,
      null,
      'Call on arrival',
      jsonb_build_array(jsonb_build_object('product_id', product, 'quantity', 2)),
      'acceptance-pickup-hash',
      'acceptance-delivery-hash'
    );

    if created.total_kobo <> 350000 then
      raise exception 'SERVER_TOTAL_MISMATCH';
    end if;
    if not exists (
      select 1 from public.order_delivery_snapshots snapshots
      where snapshots.order_id = test_order_id
        and snapshots.recipient_phone_e164 = '+2348031234567'
        and snapshots.delivery_location = 'Hall 2 main entrance'
    ) then
      raise exception 'DELIVERY_SNAPSHOT_MISSING';
    end if;
    if (select stock_quantity from public.vendor_products where id = product) <> 2 then
      raise exception 'INVENTORY_NOT_RESERVED';
    end if;
    if (
      select pricing_formula_version from public.orders where id = test_order_id
    ) <> 'UNCONFIGURED' then
      raise exception 'PRICING_POLICY_NOT_SAFELY_BLOCKED';
    end if;

    begin
      update public.order_delivery_snapshots
      set delivery_location = 'Mutated address'
      where order_delivery_snapshots.order_id = test_order_id;
      raise exception 'DELIVERY_SNAPSHOT_MUTATION_WAS_ACCEPTED';
    exception
      when sqlstate '55000' then null;
    end;

    begin
      perform *
      from app_private.create_store_order_v2(
        invalid_order_id,
        university,
        buyer,
        vendor,
        zone,
        'Ada Student',
        '08031234567',
        'Hall 2 main entrance',
        null,
        null,
        null,
        null,
        jsonb_build_array(jsonb_build_object('product_id', product, 'quantity', 1)),
        'acceptance-pickup-hash-2',
        'acceptance-delivery-hash-2'
      );
      raise exception 'INVALID_PHONE_WAS_ACCEPTED';
    exception
      when check_violation then null;
    end;

    if exists (select 1 from public.orders orders where orders.id = invalid_order_id) then
      raise exception 'FAILED_CHECKOUT_DID_NOT_ROLL_BACK';
    end if;
    if (select stock_quantity from public.vendor_products where id = product) <> 2 then
      raise exception 'FAILED_CHECKOUT_CHANGED_STOCK';
    end if;

    begin
      perform *
      from app_private.create_store_order_v2(
        gen_random_uuid(),
        second_university,
        buyer,
        vendor,
        zone,
        'Ada Student',
        '+2348031234567',
        'Hall 2 main entrance',
        null,
        null,
        null,
        null,
        jsonb_build_array(jsonb_build_object('product_id', product, 'quantity', 1)),
        'acceptance-pickup-hash-3',
        'acceptance-delivery-hash-3'
      );
      raise exception 'CROSS_TENANT_BUYER_WAS_ACCEPTED';
    exception
      when sqlstate 'P0001' then
        if sqlerrm <> 'BUYER_TENANT_MISMATCH' then
          raise;
        end if;
    end;

    begin
      insert into public.product_media (
        university_id, product_id, storage_key, position
      ) values (
        second_university, product, 'phase-3-acceptance/' || fixture_suffix, 0
      );
      raise exception 'CROSS_TENANT_PRODUCT_MEDIA_WAS_ACCEPTED';
    exception
      when foreign_key_violation then null;
    end;

    update public.orders set status = 'PAID', updated_at = now() where id = test_order_id;
    if (
      select count(*) from public.order_status_events events
      where events.order_id = test_order_id
    ) <> 2 then
      raise exception 'ORDER_TIMELINE_NOT_APPEND_ONLY';
    end if;

    begin
      perform *
      from app_private.create_product_review(
        test_review_id, test_order_id, product, buyer, 5::smallint, 'Too early.'::text
      );
      raise exception 'UNDELIVERED_REVIEW_WAS_ACCEPTED';
    exception
      when sqlstate 'P0002' then null;
    end;

    update public.orders
    set status = 'DELIVERED', completed_at = now(), updated_at = now()
    where id = test_order_id;

    perform *
    from app_private.create_product_review(
      test_review_id,
      test_order_id,
      product,
      buyer,
      5::smallint,
      'Verified self-cleaning purchase review.'::text
    );

    begin
      perform *
      from app_private.create_product_review(
        gen_random_uuid(),
        test_order_id,
        product,
        buyer,
        4::smallint,
        'Duplicate self-cleaning purchase review.'::text
      );
      raise exception 'DUPLICATE_REVIEW_WAS_ACCEPTED';
    exception
      when sqlstate 'P0001' then null;
    end;

    insert into public.commerce_refunds (
      id, university_id, order_id, idempotency_key, amount_kobo,
      reason, requested_by_user_id
    ) values (
      test_refund_id,
      university,
      test_order_id,
      'phase3-acceptance-' || fixture_suffix,
      50000,
      'Self-cleaning refund acceptance record.',
      buyer
    );

    if (
      select count(*) from public.commerce_refund_events events
      where events.refund_id = test_refund_id
    ) <> 1 then
      raise exception 'REFUND_EVENT_MISSING';
    end if;

    begin
      delete from public.commerce_refunds refunds where refunds.id = test_refund_id;
      raise exception 'REFUND_DELETE_WAS_ACCEPTED';
    exception
      when sqlstate '55000' then null;
    end;

    select listing_revision into original_revision
    from public.vendor_products
    where id = product;

    update public.vendor_products
    set stock_quantity = stock_quantity + 1
    where id = product;

    if exists (
      select 1 from public.vendor_products
      where id = product
        and (status <> 'PUBLISHED' or listing_revision <> original_revision)
    ) then
      raise exception 'STOCK_ONLY_UPDATE_TRIGGERED_REVIEW';
    end if;

    update public.vendor_products
    set price_kobo = price_kobo + 100
    where id = product;

    if not exists (
      select 1 from public.vendor_products
      where id = product
        and status = 'NEEDS_CORRECTION'
        and listing_revision = original_revision + 1
        and moderated_revision is null
        and reviewed_at is null
    ) then
      raise exception 'MATERIAL_UPDATE_DID_NOT_REQUIRE_REVIEW';
    end if;

    acceptance_completed := true;
    raise exception using
      errcode = 'P0399',
      message = 'ROLLBACK_PHASE_3_ACCEPTANCE_FIXTURES';
  exception
    when sqlstate 'P0399' then
      if not acceptance_completed then
        raise;
      end if;
  end;

  if exists (
    select 1 from public.agent_applications
    where id = application
  ) or exists (
    select 1 from public.universities
    where id = second_university
  ) then
    raise exception 'PHASE_3_ACCEPTANCE_FIXTURE_CLEANUP_FAILED';
  end if;
end;
$phase3_acceptance$;
