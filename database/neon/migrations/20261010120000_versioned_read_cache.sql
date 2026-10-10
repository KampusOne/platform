-- Shared reference revisions are committed with edits, not with a best-effort
-- per-location cache purge. No private user data or authorization is stored.
begin;
create table if not exists app_private.cache_resource_revisions (
  resource text primary key check (resource in ('academic.catalog','campus.maps','commerce.categories','notification.sounds','website.articles','website.settings')),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table app_private.cache_resource_revisions enable row level security;
revoke all on app_private.cache_resource_revisions from public;
insert into app_private.cache_resource_revisions(resource) values
 ('academic.catalog'),('campus.maps'),('commerce.categories'),
 ('notification.sounds'),('website.articles'),('website.settings')
on conflict(resource) do nothing;

create or replace function app_private.bump_read_cache_revision() returns trigger
language plpgsql set search_path='' as $$
begin
  update app_private.cache_resource_revisions set revision=revision+1,updated_at=now()
  where resource=any(TG_ARGV);
  return null;
end $$;
revoke all on function app_private.bump_read_cache_revision() from public;

-- Statement triggers avoid one revision write per row in large catalog/map
-- imports. All direct writes, including scripts and operator subrouters, count.
do $$
declare item record;
begin
  for item in select * from (values
    ('public.universities','academic.catalog'),
    ('public.faculties','academic.catalog'),
    ('public.departments','academic.catalog'),
    ('public.courses','academic.catalog'),
    ('public.institution_campuses','campus.maps'),
    ('public.campus_places','campus.maps'),
    ('public.campus_map_features','campus.maps'),
    ('public.campus_paths','campus.maps'),
    ('public.campus_entrances','campus.maps'),
    ('public.campus_place_media','campus.maps'),
    ('app_private.campus_map_controls','campus.maps'),
    ('public.product_categories','commerce.categories'),
    ('public.notification_sounds','notification.sounds'),
    ('public.website_articles','website.articles'),
    ('app_private.website_article_likes','website.articles'),
    ('app_private.website_settings','website.settings')
  ) as sources(table_name,resource)
  loop
    if to_regclass(item.table_name) is null then
      raise exception 'CACHE_PREREQUISITE_MISSING: %', item.table_name;
    end if;
    if item.table_name='public.universities' then
      execute 'create or replace trigger k1_read_cache_revision after insert or update or delete or truncate on public.universities for each statement execute function app_private.bump_read_cache_revision(''academic.catalog'',''campus.maps'')';
    else
      execute format('create or replace trigger k1_read_cache_revision after insert or update or delete or truncate on %s for each statement execute function app_private.bump_read_cache_revision(%L)',item.table_name,item.resource);
    end if;
  end loop;
  -- Sound eligibility depends on media deletion; map photo metadata also does.
  execute 'create or replace trigger k1_media_cache_revision after update or delete or truncate on public.media_objects for each statement execute function app_private.bump_read_cache_revision(''notification.sounds'',''campus.maps'')';
end $$;

create or replace function app_private.bump_changed_campus_revision() returns trigger
language plpgsql set search_path='' as $$
begin
  if TG_OP='INSERT' then
    update public.institution_campuses set map_revision=map_revision+1
    where id in (select distinct campus_id from new_rows where campus_id is not null);
  elsif TG_OP='DELETE' then
    update public.institution_campuses set map_revision=map_revision+1
    where id in (select distinct campus_id from old_rows where campus_id is not null);
  elsif TG_OP='UPDATE' then
    update public.institution_campuses set map_revision=map_revision+1
    where id in (select campus_id from new_rows where campus_id is not null
                 union select campus_id from old_rows where campus_id is not null);
  else
    update public.institution_campuses set map_revision=map_revision+1;
  end if;
  return null;
end $$;
revoke all on function app_private.bump_changed_campus_revision() from public;

do $$
declare source text;
begin
  foreach source in array array['public.campus_places','public.campus_map_features','public.campus_paths','public.campus_entrances','public.campus_place_media','app_private.campus_map_controls'] loop
    execute format('create or replace trigger k1_campus_revision_insert after insert on %s referencing new table as new_rows for each statement execute function app_private.bump_changed_campus_revision()',source);
    execute format('create or replace trigger k1_campus_revision_update after update on %s referencing old table as old_rows new table as new_rows for each statement execute function app_private.bump_changed_campus_revision()',source);
    execute format('create or replace trigger k1_campus_revision_delete after delete on %s referencing old table as old_rows for each statement execute function app_private.bump_changed_campus_revision()',source);
    execute format('create or replace trigger k1_campus_revision_truncate after truncate on %s for each statement execute function app_private.bump_changed_campus_revision()',source);
  end loop;
end $$;

create or replace function app_private.ensure_campus_metadata_revision() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.map_revision < old.map_revision or
     (new.map_revision=old.map_revision and
      (to_jsonb(new)-array['updated_at','map_revision']) is distinct from
      (to_jsonb(old)-array['updated_at','map_revision'])) then
    new.map_revision=old.map_revision+1;
  end if;
  return new;
end $$;
revoke all on function app_private.ensure_campus_metadata_revision() from public;
create or replace trigger k1_campus_metadata_revision before update on public.institution_campuses
for each row execute function app_private.ensure_campus_metadata_revision();
commit;
