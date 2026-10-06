begin;
-- Preserve reviewed directory locations and OSM path topology. Overture adds
-- real footprints and reviewable names; it never invents rooms or entrances.
create or replace function app_private.import_overture_campus(p_campus uuid,p_actor uuid,p_release text,p_hash text,p_features jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare campus public.institution_campuses;feature jsonb;shape public.geometry;import_id uuid;new_buildings integer:=0;new_places integer:=0;matched uuid;
begin
 if p_release is null or p_hash is null or p_features is null or p_release!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}\.[0-9]+$'or p_hash!~'^[a-f0-9]{64}$' or jsonb_typeof(p_features)<>'array'or jsonb_array_length(p_features)>20000 then raise exception 'MAP_SOURCE_INVALID';end if;
 select * into campus from public.institution_campuses where id=p_campus for update;if not found then raise exception 'MAP_CAMPUS_NOT_FOUND';end if;
 insert into app_private.map_imports(institution_id,campus_id,actor_user_id,source_provider,request_key,status,source_url,diagnostics,completed_at)
 values(campus.institution_id,campus.id,p_actor,'OVERTURE','overture:'||p_hash,'COMPLETE','https://docs.overturemaps.org/',jsonb_build_object('source','OVERTURE','release',p_release,'hash',p_hash,'entrancesSurveyed',false),now())
 on conflict(campus_id,request_key)do update set completed_at=now() returning id into import_id;
 for feature in select value from jsonb_array_elements(p_features)loop
  if jsonb_typeof(feature->'geometry')is distinct from 'object'or nullif(feature->'properties'->>'sourceId','')is null then continue;end if;
  shape=public.ST_SetSRID(public.ST_GeomFromGeoJSON((feature->'geometry')::text),4326);
  if not public.ST_IsValid(shape)or public.ST_IsEmpty(shape)then continue;end if;
  if campus.boundary is not null then
   if not public.ST_Covers(campus.boundary,public.ST_PointOnSurface(shape))then continue;end if;
  elsif not public.ST_DWithin(shape::public.geography,public.ST_SetSRID(public.ST_MakePoint(campus.longitude,campus.latitude),4326)::public.geography,1200)then continue;
  end if;
  if feature->'properties'->>'kind'='building' and public.GeometryType(shape)in('POLYGON','MULTIPOLYGON')then
   if exists(select 1 from public.campus_map_features f where f.campus_id=p_campus and f.source_provider='OSM'and(f.kind='BUILDING'or f.tags?'building')and f.geom OPERATOR(public.&&) shape and public.GeometryType(f.geom)in('POLYGON','MULTIPOLYGON')and public.ST_Area(public.ST_Intersection(f.geom,shape))>public.ST_Area(shape)*.65)then continue;end if;
   insert into public.campus_map_features(institution_id,campus_id,source_provider,source_feature_id,kind,geom,tags)
   values(campus.institution_id,p_campus,'OVERTURE',feature->'properties'->>'sourceId','BUILDING',shape,(feature->'properties')||jsonb_build_object('building','yes','source_release',p_release))on conflict(campus_id,source_provider,source_feature_id)do nothing;
   if found then new_buildings=new_buildings+1;end if;
  elsif feature->'properties'->>'kind'='place'and length(trim(coalesce(feature->'properties'->>'name','')))>0 then
   select id into matched from public.campus_places where campus_id=p_campus and lower(name)=lower(feature->'properties'->>'name')limit 1;
   insert into app_private.map_candidates(institution_id,campus_id,import_id,source_provider,source_feature_id,feature_kind,name,geometry,tags,matched_place_id)
   values(campus.institution_id,p_campus,import_id,'OVERTURE',feature->'properties'->>'sourceId','PLACE',feature->'properties'->>'name',feature->'geometry',feature->'properties',matched)on conflict(campus_id,source_provider,source_feature_id,feature_kind)do nothing;
   if found then new_places=new_places+1;end if;
  end if;
 end loop;
 if new_buildings>0 or new_places>0 then update public.institution_campuses set map_revision=map_revision+1 where id=p_campus;end if;
 return jsonb_build_object('newBuildings',new_buildings,'newPlaceCandidates',new_places,'reviewedDirectoryPreserved',true);
end $$;
revoke all on function app_private.import_overture_campus(uuid,uuid,text,text,jsonb)from public;
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
    values(place,candidate.institution_id,candidate.campus_id,label,case when candidate.tags->>'building'='university' then 'ACADEMIC' when candidate.tags->>'amenity' in('hospital','clinic') then 'HEALTH' when candidate.tags->>'amenity' in('restaurant','cafe') then 'FOOD' else 'SERVICE' end,'Mapped source place. Entrance verification is separate.','PUBLISHED');
   end if;
   update public.campus_places set geom=shape,longitude=public.ST_X(public.ST_Centroid(shape)),latitude=public.ST_Y(public.ST_Centroid(shape)),source_provider=candidate.source_provider,source_feature_id=candidate.source_feature_id,source_url=case when candidate.source_provider='OVERTURE'then 'https://docs.overturemaps.org/'else 'https://www.openstreetmap.org/'||candidate.source_feature_id end,verified_at=now(),confidence=.8 where id=place and campus_id=candidate.campus_id;
  end if;
  insert into public.campus_map_features(institution_id,campus_id,source_provider,source_feature_id,kind,geom,tags)
  values(candidate.institution_id,candidate.campus_id,candidate.source_provider,candidate.source_feature_id,candidate.feature_kind,shape,candidate.tags)
  on conflict(campus_id,source_provider,source_feature_id) do update set geom=excluded.geom,tags=excluded.tags,verified_at=now();
 end if;
 update app_private.map_candidates set status=case p_decision when 'APPROVE' then 'APPROVED' when 'MERGE' then 'MERGED' else 'REJECTED' end,reviewer_user_id=p_reviewer,decision_note=p_note,reviewed_at=now() where id=p_id;
 update public.institution_campuses set map_revision=map_revision+1 where id=candidate.campus_id;
 return candidate.campus_id;
end $$;
commit;
