begin;
-- Product approval follows the vendor's completed approval. Delivery package
-- details determine rider eligibility, not whether a product can be listed.
alter table public.vendor_products drop constraint vendor_products_publication_review_check;
alter table public.vendor_products add constraint vendor_products_publication_review_check check(status<>'PUBLISHED' or(category_id is not null and image_url is not null));
alter table public.vendor_products add column image_urls jsonb not null default '[]' check(jsonb_typeof(image_urls)='array' and jsonb_array_length(image_urls)<=6);
alter table public.vendor_products add column client_request_id uuid;
create unique index vendor_product_create_request_idx on public.vendor_products(vendor_profile_id,client_request_id) where client_request_id is not null;
create or replace function app_private.guard_product_material_change() returns trigger language plpgsql set search_path='' as $$
begin
 if row(new.name,new.description,new.category_id,new.price_kobo,new.image_url,new.image_urls,new.preparation_minutes,new.package_weight_grams,new.package_length_cm,new.package_width_cm,new.package_height_cm,new.bicycle_delivery_eligible)
 is distinct from row(old.name,old.description,old.category_id,old.price_kobo,old.image_url,old.image_urls,old.preparation_minutes,old.package_weight_grams,old.package_length_cm,old.package_width_cm,old.package_height_cm,old.bicycle_delivery_eligible) then
  new.listing_revision:=old.listing_revision+1;
  new.reviewed_by_user_id:=null;new.reviewed_at:=null;new.moderated_revision:=null;
 end if;
 return new;
end $$;
create function app_private.guard_verified_vendor_publication() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='PUBLISHED' and not exists(
  select 1 from public.agent_profiles a join public.product_categories c on c.id=new.category_id and c.university_id=a.university_id and c.status='APPROVED'
  where a.id=new.vendor_profile_id and a.university_id=new.university_id and a.agent_type='VENDOR' and a.status='ACTIVE' and a.verified_at is not null
  and not exists(select 1 from public.vendor_storefronts s where s.vendor_profile_id=a.id and s.status='SUSPENDED')
 )then raise exception 'VERIFIED_VENDOR_PUBLICATION_REQUIRED';end if;
 return new;
end $$;
create trigger vendor_products_verify_publisher before insert or update on public.vendor_products for each row execute function app_private.guard_verified_vendor_publication();
-- A store's public trust comes from vendor approval. Keep the existing
-- suspension state and recorded reviewer history for moderation.
alter table public.vendor_storefronts drop constraint vendor_storefronts_approval_revision_check;
-- PostgreSQL's anonymous publication check has a generated name. Remove only
-- the check that requires product-independent review fields.
do $$declare r record;begin
 for r in select conname from pg_constraint where conrelid='public.vendor_storefronts'::regclass and contype='c' and pg_get_constraintdef(oid) like '%reviewed_by_user_id%' loop
  execute format('alter table public.vendor_storefronts drop constraint %I',r.conname);
 end loop;
end $$;
create function app_private.guard_verified_storefront() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='APPROVED' and not exists(select 1 from public.agent_profiles a where a.id=new.vendor_profile_id and a.university_id=new.university_id and a.agent_type='VENDOR' and a.status='ACTIVE' and a.verified_at is not null)then raise exception 'VERIFIED_VENDOR_REQUIRED';end if;
 return new;
end $$;
create trigger vendor_storefronts_verified before insert or update on public.vendor_storefronts for each row execute function app_private.guard_verified_storefront();
create or replace function app_private.guard_storefront_material_change() returns trigger language plpgsql set search_path='' as $$
begin
 if row(new.display_name,new.description,new.contact_phone_e164,new.pickup_location,new.pickup_instructions,new.opening_hours,new.default_preparation_minutes)
 is distinct from row(old.display_name,old.description,old.contact_phone_e164,old.pickup_location,old.pickup_instructions,old.opening_hours,old.default_preparation_minutes)then
  new.listing_revision:=old.listing_revision+1;
 end if;
 return new;
end $$;
create function app_private.activate_verified_vendor_storefront() returns trigger language plpgsql set search_path='' as $$
begin
 if new.agent_type='VENDOR' and new.status='ACTIVE' and new.verified_at is not null then
  insert into public.vendor_storefronts(vendor_profile_id,university_id,display_name,status) values(new.id,new.university_id,left(new.display_name,120),'APPROVED')
  on conflict(vendor_profile_id) do update set status='APPROVED' where vendor_storefronts.status<>'SUSPENDED';
 end if;
 return new;
end $$;
create trigger agent_verified_storefront after insert or update of status,verified_at on public.agent_profiles for each row execute function app_private.activate_verified_vendor_storefront();
insert into public.vendor_storefronts(vendor_profile_id,university_id,display_name,status)
select a.id,a.university_id,left(a.display_name,120),'APPROVED' from public.agent_profiles a where a.agent_type='VENDOR' and a.status='ACTIVE' and a.verified_at is not null
on conflict(vendor_profile_id) do update set status='APPROVED' where vendor_storefronts.status<>'SUSPENDED';
revoke all on function app_private.guard_verified_vendor_publication(),app_private.guard_verified_storefront(),app_private.activate_verified_vendor_storefront() from public;
commit;
