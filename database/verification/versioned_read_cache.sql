-- Run after the migration on an isolated rehearsal branch. All mutations roll
-- back. Do not use production for rehearsal or export student rows.
begin;
do $$
declare before_revision bigint; campus uuid; before_map integer; path uuid;
begin
  if (select count(*) from app_private.cache_resource_revisions) <> 6 then
    raise exception 'CACHE_NAMESPACE_COUNT';
  end if;
  select revision into before_revision from app_private.cache_resource_revisions where resource='academic.catalog';
  update public.courses set name=name where id=(select id from public.courses limit 1);
  if (select revision from app_private.cache_resource_revisions where resource='academic.catalog') <= before_revision then
    raise exception 'CACHE_CATALOG_NOT_INVALIDATED';
  end if;
  select id,campus_id into path,campus from public.campus_paths where campus_id is not null limit 1;
  if path is not null then
    select map_revision into before_map from public.institution_campuses where id=campus;
    select revision into before_revision from app_private.cache_resource_revisions where resource='campus.maps';
    update public.campus_paths set closed=not closed where id=path;
    if (select map_revision from public.institution_campuses where id=campus) <= before_map
       or (select revision from app_private.cache_resource_revisions where resource='campus.maps') <= before_revision then
      raise exception 'CACHE_PATH_NOT_INVALIDATED';
    end if;
  end if;
  if not (select relrowsecurity from pg_class where oid='app_private.cache_resource_revisions'::regclass)
     or exists(select 1 from information_schema.role_table_grants where table_schema='app_private' and table_name='cache_resource_revisions' and grantee='PUBLIC') then
    raise exception 'CACHE_PRIVATE_TABLE_ACCESS';
  end if;
end $$;
select 'cache-rehearsal-passed' as result;
rollback;
