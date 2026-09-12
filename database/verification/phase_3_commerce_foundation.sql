-- Run against an isolated Neon branch after applying the complete migration chain.
-- This file is intentionally read-only: any failed invariant aborts verification.

do $$
declare
  create_order_v2 regprocedure;
  create_product_review regprocedure;
begin
  if to_regclass('public.vendor_storefronts') is null
    or to_regclass('public.product_media') is null
    or to_regclass('public.order_delivery_snapshots') is null
    or to_regclass('public.order_status_events') is null
    or to_regclass('public.product_reviews') is null
    or to_regclass('public.commerce_refunds') is null then
    raise exception 'PHASE_3_TABLE_MISSING';
  end if;

  create_order_v2 := to_regprocedure(
    'app_private.create_store_order_v2(uuid,uuid,uuid,uuid,uuid,text,text,text,text,numeric,numeric,text,jsonb,text,text)'
  );
  if create_order_v2 is null then
    raise exception 'PHASE_3_ORDER_FUNCTION_MISSING';
  end if;
  if has_function_privilege('public', create_order_v2, 'EXECUTE') then
    raise exception 'PHASE_3_ORDER_FUNCTION_PUBLICLY_EXECUTABLE';
  end if;

  create_product_review := to_regprocedure(
    'app_private.create_product_review(uuid,uuid,uuid,uuid,smallint,text)'
  );
  if create_product_review is null then
    raise exception 'PHASE_3_PRODUCT_REVIEW_FUNCTION_MISSING';
  end if;
  if has_function_privilege('public', create_product_review, 'EXECUTE') then
    raise exception 'PHASE_3_PRODUCT_REVIEW_FUNCTION_PUBLICLY_EXECUTABLE';
  end if;

  if has_table_privilege('public', 'public.order_delivery_snapshots', 'SELECT')
    or has_table_privilege('public', 'public.order_delivery_snapshots', 'INSERT')
    or has_table_privilege('public', 'public.commerce_refunds', 'SELECT') then
    raise exception 'PHASE_3_SENSITIVE_TABLE_PUBLICLY_ACCESSIBLE';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.orders'::regclass
      and tgname = 'orders_capture_status_event'
      and not tgisinternal
  ) then
    raise exception 'PHASE_3_ORDER_HISTORY_TRIGGER_MISSING';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.vendor_products'::regclass
      and tgname = 'vendor_products_guard_material_change'
      and not tgisinternal
  ) then
    raise exception 'PHASE_3_PRODUCT_REVISION_TRIGGER_MISSING';
  end if;

  if (
    select count(*) from pg_constraint
    where conname in (
      'vendor_products_vendor_tenant_fkey',
      'vendor_products_category_tenant_fkey',
      'orders_vendor_tenant_fkey',
      'orders_delivery_zone_tenant_fkey',
      'delivery_jobs_order_tenant_fkey',
      'delivery_jobs_zone_tenant_fkey'
    )
  ) <> 6 then
    raise exception 'PHASE_3_COMMERCE_TENANT_CONSTRAINT_MISSING';
  end if;

  if exists (
    select 1 from public.vendor_products
    where status = 'PUBLISHED'
      and (
        reviewed_by_user_id is null
        or reviewed_at is null
        or moderated_revision is distinct from listing_revision
      )
  ) then
    raise exception 'PHASE_3_UNMODERATED_PUBLISHED_PRODUCT';
  end if;

  if exists (
    select 1
    from public.order_delivery_snapshots snapshots
    join public.orders orders on orders.id = snapshots.order_id
    where snapshots.university_id <> orders.university_id
  ) then
    raise exception 'PHASE_3_DELIVERY_SNAPSHOT_TENANT_MISMATCH';
  end if;

  if exists (
    select 1
    from public.product_reviews reviews
    join public.orders orders on orders.id = reviews.order_id
    left join public.order_items items
      on items.order_id = reviews.order_id and items.product_id = reviews.product_id
    where reviews.university_id <> orders.university_id
      or reviews.buyer_user_id <> orders.buyer_user_id
      or items.id is null
  ) then
    raise exception 'PHASE_3_REVIEW_NOT_VERIFIED_PURCHASE';
  end if;

  if exists (
    select 1
    from public.commerce_refund_events events
    join public.commerce_refunds refunds on refunds.id = events.refund_id
    where events.university_id <> refunds.university_id
  ) then
    raise exception 'PHASE_3_REFUND_EVENT_TENANT_MISMATCH';
  end if;

  if exists (
    select 1 from public.orders orders
    where not exists (
      select 1 from public.order_status_events events where events.order_id = orders.id
    )
  ) then
    raise exception 'PHASE_3_ORDER_HISTORY_INCOMPLETE';
  end if;
end;
$$;
