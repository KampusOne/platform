begin;
alter table public.campus_entrances add column if not exists source_feature_id text;
create unique index if not exists campus_entrance_source on public.campus_entrances(campus_id,source_feature_id) where source_feature_id is not null;
create or replace function app_private.review_map_candidate(p_id uuid,p_reviewer uuid,p_decision text,p_place uuid,p_name text,p_note text)
returns uuid language plpgsql set search_path='' as $$
declare candidate app_private.map_candidates%rowtype; shape public.geometry; place uuid; nodes text[]; label text;
begin
 select * into candidate from app_private.map_candidates where id=p_id for update;
 if not found then raise exception 'MAP_NOT_FOUND';end if;
 if candidate.status<>'PENDING' then raise exception 'MAP_ALREADY_REVIEWED';end if;
 if p_decision not in('APPROVE','MERGE','REJECT') or length(trim(p_note))<3 then raise exception 'MAP_INVALID_DECISION';end if;
 place=coalesce(p_place,candidate.matched_place_id);
 if place is not null and not exists(select 1 from public.campus_places where id=place and campus_id=candidate.campus_id and university_id=candidate.institution_id) then raise exception 'MAP_PLACE_SCOPE';end if;
 if p_decision<>'REJECT' then
  shape=public.ST_SetSRID(public.ST_GeomFromGeoJSON(candidate.geometry::text),4326);
  if not public.ST_IsValid(shape) or public.ST_IsEmpty(shape) then raise exception 'MAP_INVALID_GEOMETRY';end if;
  if candidate.feature_kind='PATH' then
   select array_agg(value) into nodes from jsonb_array_elements_text(candidate.tags->'node_ids');
   if public.GeometryType(shape)<>'LINESTRING' or array_length(nodes,1) is distinct from public.ST_NPoints(shape) then raise exception 'MAP_INVALID_PATH';end if;
   insert into public.campus_paths(institution_id,campus_id,source_feature_id,node_ids,geom,name,access,surface,steps,wheelchair)
   values(candidate.institution_id,candidate.campus_id,candidate.source_feature_id,nodes,shape,candidate.name,case when candidate.tags->>'highway' in('motorway','motorway_link','trunk','trunk_link') and coalesce(candidate.tags->>'foot','') not in('yes','designated','permissive') then 'no' else coalesce(candidate.tags->>'foot',candidate.tags->>'access','yes') end,candidate.tags->>'surface',coalesce(candidate.tags->>'highway'='steps',false),candidate.tags->>'wheelchair')
   on conflict(campus_id,source_feature_id) do update set node_ids=excluded.node_ids,geom=excluded.geom,access=excluded.access,surface=excluded.surface,steps=excluded.steps,wheelchair=excluded.wheelchair,verified_at=now();
  elsif candidate.feature_kind='BOUNDARY' then
   if public.GeometryType(shape) not in('POLYGON','MULTIPOLYGON') then raise exception 'MAP_INVALID_BOUNDARY';end if;
   update public.institution_campuses set boundary=public.ST_Multi(shape),boundary_verified_at=now() where id=candidate.campus_id;
  elsif candidate.feature_kind='ENTRANCE' then
   if public.GeometryType(shape)<>'POINT' or place is null then raise exception 'MAP_ENTRANCE_PLACE_REQUIRED';end if;
   insert into public.campus_entrances(institution_id,campus_id,place_id,geom,label,preferred,verified_at,source_feature_id)
   values(candidate.institution_id,candidate.campus_id,place,shape,coalesce(p_name,'Entrance'),true,now(),candidate.source_feature_id)
   on conflict(campus_id,source_feature_id) where source_feature_id is not null do update set place_id=excluded.place_id,geom=excluded.geom,label=excluded.label,verified_at=now();
  else
   if place is null then
    label=coalesce(nullif(trim(p_name),''),candidate.name);if label is null then raise exception 'MAP_NAME_REQUIRED';end if;
    place=gen_random_uuid();
    insert into public.campus_places(id,university_id,campus_id,name,category,description,status)
    values(place,candidate.institution_id,candidate.campus_id,label,case when candidate.tags->>'building'='university' then 'ACADEMIC' when candidate.tags->>'amenity' in('hospital','clinic') then 'HEALTH' when candidate.tags->>'amenity' in('restaurant','cafe') then 'FOOD' else 'SERVICE' end,'Mapped OpenStreetMap place. Entrance verification is separate.','PUBLISHED');
   end if;
   update public.campus_places set geom=shape,longitude=public.ST_X(public.ST_Centroid(shape)),latitude=public.ST_Y(public.ST_Centroid(shape)),source_provider='OSM',source_feature_id=candidate.source_feature_id,source_url='https://www.openstreetmap.org/'||candidate.source_feature_id,verified_at=now(),confidence=.8 where id=place and campus_id=candidate.campus_id;
  end if;
  insert into public.campus_map_features(institution_id,campus_id,source_provider,source_feature_id,kind,geom,tags)
  values(candidate.institution_id,candidate.campus_id,'OSM',candidate.source_feature_id,candidate.feature_kind,shape,candidate.tags)
  on conflict(campus_id,source_provider,source_feature_id) do update set geom=excluded.geom,tags=excluded.tags,verified_at=now();
 end if;
 update app_private.map_candidates set status=case p_decision when 'APPROVE' then 'APPROVED' when 'MERGE' then 'MERGED' else 'REJECTED' end,reviewer_user_id=p_reviewer,decision_note=p_note,reviewed_at=now() where id=p_id;
 update public.institution_campuses set map_revision=map_revision+1 where id=candidate.campus_id;
 return candidate.campus_id;
end $$;
revoke all on function app_private.review_map_candidate(uuid,uuid,text,uuid,text,text) from public;
commit;
