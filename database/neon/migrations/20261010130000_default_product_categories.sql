-- The seller form requires an approved category. Seed the normal catalogue
-- for existing and future institutions without overriding a campus restriction.
begin;
create or replace function app_private.seed_product_categories(p_university uuid)
returns void language sql set search_path='' as $$
  insert into public.product_categories(university_id,name,status,listing_rules,reviewed_at)
  select p_university,name,'APPROVED',rules,now() from (values
    ('Books & textbooks','Sell original or legally licensed books.'),
    ('Course materials','Only list material you own or have permission to distribute.'),
    ('Student handbooks','Only list authorised handbooks and student guides.'),
    ('Stationery & school supplies','Describe the condition and quantity accurately.'),
    ('Art & craft materials','Describe the materials and quantity accurately.'),
    ('Building & workshop materials','Do not list hazardous or restricted materials.'),
    ('Lab & engineering supplies','Do not list controlled chemicals or restricted equipment.'),
    ('Phones & accessories','Disclose condition, compatibility and warranty.'),
    ('Computers & accessories','Disclose condition, specifications and warranty.'),
    ('Electronics','Disclose condition, specifications and warranty.'),
    ('Clothing & fashion','Provide sizes and accurate product photos.'),
    ('Shoes & bags','Provide sizes, condition and accurate product photos.'),
    ('Beauty & personal care','Only list genuine products with valid expiry dates.'),
    ('Food & drinks','Provide preparation, ingredient and freshness information.'),
    ('Groceries','Only list safe products with valid expiry dates.'),
    ('Home & hostel essentials','Describe condition, dimensions and collection details.'),
    ('Furniture','Describe condition, dimensions and collection details.'),
    ('Appliances','Disclose condition and electrical specifications.'),
    ('Sports & fitness','Describe condition, sizes and specifications.'),
    ('Health & wellness','Do not list prescription medicines or controlled products.'),
    ('Games & entertainment','Only list genuine products you may legally sell.'),
    ('Gifts & handmade items','Describe materials and preparation time.'),
    ('Other products','Do not list illegal, counterfeit, hazardous or restricted goods.')
  ) as catalogue(name,rules)
  on conflict(university_id,name) do nothing;
$$;
select app_private.seed_product_categories(id) from public.universities;
create or replace function app_private.seed_institution_product_categories()
returns trigger language plpgsql set search_path='' as $$
begin
  perform app_private.seed_product_categories(new.id);
  return new;
end $$;
create trigger institution_product_categories after insert on public.universities
for each row execute function app_private.seed_institution_product_categories();
revoke all on function app_private.seed_product_categories(uuid),app_private.seed_institution_product_categories() from public;
commit;
