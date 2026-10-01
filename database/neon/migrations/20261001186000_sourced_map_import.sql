begin;
create table if not exists app_private.map_place_history(id uuid primary key default gen_random_uuid(),place_id uuid not null references public.campus_places(id),institution_id uuid not null references public.universities(id),actor_user_id uuid references public.users(id),before_value jsonb not null,recorded_at timestamptz not null default now());
alter table app_private.map_place_history enable row level security;
revoke all on app_private.map_place_history from public;
create or replace function app_private.track_map_place_change() returns trigger language plpgsql set search_path='' as $$
begin
 if (OLD.latitude,OLD.longitude) is distinct from (NEW.latitude,NEW.longitude) and OLD.geom is not distinct from NEW.geom then NEW.geom=case when NEW.latitude is null or NEW.longitude is null then null else public.ST_SetSRID(public.ST_MakePoint(NEW.longitude,NEW.latitude),4326) end;end if;
 if (OLD.geom,OLD.name,OLD.source_provider) is distinct from(NEW.geom,NEW.name,NEW.source_provider) then
  insert into app_private.map_place_history(place_id,institution_id,actor_user_id,before_value) values(OLD.id,OLD.university_id,nullif(current_setting('app.map_actor',true),'')::uuid,to_jsonb(OLD)||jsonb_build_object('geometry',public.ST_AsGeoJSON(OLD.geom)::jsonb));
 end if;return NEW;
end $$;
create or replace trigger campus_place_history before update on public.campus_places for each row execute function app_private.track_map_place_change();
create or replace function app_private.import_sourced_campus_map(p_uni uuid,p_actor uuid,p_hash text,p_data jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare campus record;shape public.geometry;place uuid;added integer;summary jsonb:='{}';campus_name text;boundary_feature text;
begin
 if p_data is null or jsonb_typeof(p_data->'features') is distinct from 'array' or length(p_hash)<8 then raise exception 'MAP_SOURCE_REQUIRED';end if;
 perform set_config('app.map_actor',p_actor::text,true);
 for campus in select distinct c.* from public.institution_campuses c join jsonb_to_recordset(p_data->'features') v(slug text) on v.slug=c.slug where c.institution_id=p_uni loop
  perform pg_advisory_xact_lock(hashtextextended('release-map:'||campus.id::text,0));
  insert into app_private.map_imports(institution_id,campus_id,actor_user_id,request_key,status,source_url,diagnostics,completed_at)
  values(p_uni,campus.id,p_actor,'release:'||p_hash,'COMPLETE','https://www.openstreetmap.org/',jsonb_build_object('sourceHash',p_hash,'source','OSM','release','2026-10-01','verification','Source geometry reviewed; entrance surveys remain separate.'),now()) on conflict(campus_id,request_key) do nothing;
  insert into public.campus_map_features(institution_id,campus_id,source_provider,source_feature_id,kind,geom,tags)
  select p_uni,campus.id,'OSM',v.source_feature_id,v.kind,public.ST_SetSRID(public.ST_GeomFromGeoJSON(v.geometry::text),4326),v.tags from jsonb_to_recordset(p_data->'features') v(slug text,source_feature_id text,kind text,geometry jsonb,tags jsonb)
  where v.slug=campus.slug and public.ST_IsValid(public.ST_GeomFromGeoJSON(v.geometry::text)) on conflict(campus_id,source_provider,source_feature_id) do nothing;
  get diagnostics added=ROW_COUNT;
  insert into public.campus_paths(institution_id,campus_id,source_feature_id,node_ids,geom,name,access,surface,steps,wheelchair)
  select p_uni,campus.id,v.source_feature_id,array(select jsonb_array_elements_text(v.tags->'node_ids')),public.ST_SetSRID(public.ST_GeomFromGeoJSON(v.geometry::text),4326),v.name,
    case when v.tags->>'highway' in('motorway','motorway_link','trunk','trunk_link') and coalesce(v.tags->>'foot','') not in('yes','designated','permissive') then 'no' else coalesce(v.tags->>'foot',v.tags->>'access','yes') end,
    v.tags->>'surface',coalesce(v.tags->>'highway'='steps',false),v.tags->>'wheelchair'
  from jsonb_to_recordset(p_data->'features') v(slug text,source_feature_id text,kind text,name text,geometry jsonb,tags jsonb)
  where v.slug=campus.slug and v.kind='PATH' and jsonb_array_length(v.tags->'node_ids')=public.ST_NPoints(public.ST_GeomFromGeoJSON(v.geometry::text)) on conflict(campus_id,source_feature_id) do nothing;
  -- Keep every existing directory ID, name, alias and hierarchy. New OSM names enter review.
  insert into app_private.map_candidates(institution_id,campus_id,import_id,source_provider,source_feature_id,feature_kind,name,geometry,tags,matched_place_id)
  select p_uni,campus.id,i.id,'OSM',v.source_feature_id,v.kind,v.name,v.geometry,v.tags,p.id
  from jsonb_to_recordset(p_data->'features') v(slug text,source_feature_id text,kind text,name text,geometry jsonb,tags jsonb)
  join app_private.map_imports i on i.campus_id=campus.id and i.request_key='release:'||p_hash
  left join lateral(select cp.id from public.campus_places cp where cp.campus_id=campus.id and cp.university_id=p_uni and exists(select 1 from unnest(cp.search_aliases||array[cp.name]) label where regexp_replace(lower(label),'[^a-z0-9]','','g')=regexp_replace(lower(v.name),'[^a-z0-9]','','g')) order by cp.id limit 1)p on true
  where v.slug=campus.slug and v.kind='PLACE' and v.name is not null on conflict(campus_id,source_provider,source_feature_id,feature_kind) do nothing;
  select f.geom,f.source_feature_id into shape,boundary_feature from public.campus_map_features f where f.campus_id=campus.id and f.kind='BOUNDARY' limit 1;
  if shape is not null and campus.boundary is null then
   update public.institution_campuses set boundary=public.ST_Multi(shape),boundary_verified_at=now(),source_url='https://www.openstreetmap.org/'||boundary_feature where id=campus.id;
   campus_name=campus.name;
   select id into place from public.campus_places where campus_id=campus.id and lower(name)=lower(campus_name) limit 1;
   if place is null then
    place=gen_random_uuid();insert into public.campus_places(id,university_id,campus_id,name,category,description,status,geom,latitude,longitude,source_provider,source_feature_id,source_url,confidence)
    values(place,p_uni,campus.id,campus_name,'SERVICE','Campus area and mapped gates from OpenStreetMap. Department positions require separate verification.','PUBLISHED',shape,public.ST_Y(public.ST_Centroid(shape)),public.ST_X(public.ST_Centroid(shape)),'OSM',boundary_feature,'https://www.openstreetmap.org/'||boundary_feature,.8);
   end if;
   insert into public.campus_entrances(institution_id,campus_id,place_id,geom,label,preferred,verified_at,source_feature_id)
   select p_uni,campus.id,place,f.geom,'Mapped campus gate (OpenStreetMap)',true,now(),f.source_feature_id from public.campus_map_features f where f.campus_id=campus.id and f.kind='ENTRANCE' on conflict(campus_id,source_feature_id) where source_feature_id is not null do nothing;
  end if;
  if added>0 then update public.institution_campuses set map_revision=map_revision+1 where id=campus.id;end if;
  summary=summary||jsonb_build_object(campus.slug,jsonb_build_object('newFeatures',added,'directoryPreserved',true));
 end loop;
 insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,outcome,metadata) select p_actor,p_uni,'maps.release-data.imported','map_import',p_hash,'succeeded',summary where not exists(select 1 from app_private.audit_events where action='maps.release-data.imported' and target_id=p_hash);
 return summary;
end $$;
revoke all on function app_private.import_sourced_campus_map(uuid,uuid,text,jsonb) from public;
commit;
