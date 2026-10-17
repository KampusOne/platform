import {sql} from 'drizzle-orm';
import {database,firstRow} from './database';
import {AppError} from './errors';
import {walkingRoute,type Coordinate,type WalkPath} from './campus-routing';
import type {Bindings} from '../types';
export async function mappedDeliveryPoint(env:Bindings,universityId:string,placeId:string){
 const row=firstRow(await database(env).execute<{campus_id:string;name:string;latitude:number;longitude:number;entrance_verified:boolean}>(sql`
 select p.campus_id,p.name,coalesce(ST_Y(e.geom),p.latitude)::float8 latitude,coalesce(ST_X(e.geom),p.longitude)::float8 longitude,(e.geom is not null) as entrance_verified
 from public.campus_places p join public.institution_campuses c on c.id=p.campus_id and c.institution_id=p.university_id and c.status='PUBLISHED'
 left join lateral(select geom from public.campus_entrances where place_id=p.id and institution_id=p.university_id and preferred and verified_at is not null order by verified_at desc limit 1)e on true
 where p.id=${placeId}::uuid and p.university_id=${universityId}::uuid and p.status='PUBLISHED'`));
 if(!row||row.latitude===null||row.longitude===null)throw new AppError(422,'BAD_REQUEST','This place has no map point yet. Choose a nearby mapped campus location and add your exact address in the delivery note.');return row;
}
/** Publish availability only. Vendor GPS coordinates remain private. */
export async function riderPickupAvailability(env:Bindings,universityId:string,vendorIds:string[]) {
 const ready=new Map<string,boolean>();
 if(!vendorIds.length||env.LOGISTICS_ENABLED!=='true')return ready;
 const db=database(env);
 const schema=firstRow(await db.execute<{maps:boolean;positions:boolean}>(sql`select
  to_regclass('public.institution_campuses') is not null and to_regclass('public.campus_entrances') is not null as maps,
  to_regclass('app_private.agent_route_positions') is not null as positions`));
 const position=schema?.positions?sql`exists(select 1 from app_private.agent_route_positions pos where pos.agent_profile_id=a.id and pos.institution_id=a.university_id
  and pos.captured_at>=now()-interval '2 minutes' and pos.captured_at<=now()+interval '10 seconds' and pos.accuracy_metres<=50)`:sql`false`;
 const mapped=schema?.maps?sql`exists(select 1 from public.campus_places p join public.institution_campuses c on c.id=p.campus_id and c.institution_id=p.university_id and c.status='PUBLISHED'
  where p.id::text=to_jsonb(s)->>'pickup_place_id' and p.university_id=a.university_id and p.status='PUBLISHED'
  and ((p.latitude is not null and p.longitude is not null) or exists(select 1 from public.campus_entrances e where e.place_id=p.id and e.institution_id=p.university_id and e.preferred and e.verified_at is not null and e.geom is not null)))`:sql`false`;
 const rows=await db.execute<{id:string;ready:boolean}>(sql`select a.id,(${position} or ${mapped}) as ready from public.agent_profiles a
  join public.vendor_storefronts s on s.vendor_profile_id=a.id and s.university_id=a.university_id and s.status='APPROVED'
  where a.university_id=${universityId}::uuid and a.agent_type='VENDOR' and a.status='ACTIVE'
   and a.id in(select value::uuid from jsonb_array_elements_text(${JSON.stringify(vendorIds)}::jsonb))`);
 for(const row of rows.rows)ready.set(row.id,row.ready);
 return ready;
}
export async function currentAgentPosition(env:Bindings,profileId:string,universityId:string){
 return firstRow(await database(env).execute<{latitude:number;longitude:number;captured_at:string;accuracy_metres:number}>(sql`select latitude::float8 latitude,longitude::float8 longitude,captured_at,accuracy_metres::float8 accuracy_metres from app_private.agent_route_positions where agent_profile_id=${profileId}::uuid and institution_id=${universityId}::uuid and captured_at>=now()-interval '2 minutes' and captured_at<=now()+interval '10 seconds' and accuracy_metres<=50`));
}
export async function campusDeliveryRoute(env:Bindings,universityId:string,campusId:string,origin:Coordinate,destination:Coordinate){
 // Bicycle delivery follows mapped permitted roads and cycleways with access restrictions.
 const paths=(await database(env).execute<WalkPath>(sql`
 select p.node_ids,ST_AsGeoJSON(p.geom)::jsonb geometry,p.name,p.closed,
 coalesce(f.tags->>'bicycle',f.tags->>'vehicle',f.tags->>'access','yes') access,
 case when f.tags->>'oneway:bicycle'in('no','0','false')then 0 when coalesce(f.tags->>'oneway:bicycle',f.tags->>'oneway')='-1'then -1 when coalesce(f.tags->>'oneway:bicycle',f.tags->>'oneway')in('yes','1','true')or f.tags->>'junction'='roundabout'then 1 else 0 end oneway
 from public.campus_paths p join public.campus_map_features f on f.campus_id=p.campus_id and f.source_feature_id=p.source_feature_id and f.source_provider='OSM'
 where p.campus_id=${campusId}::uuid and p.institution_id=${universityId}::uuid and (f.tags->>'highway'in('cycleway','residential','service','unclassified','living_street','tertiary','tertiary_link','secondary','secondary_link','primary','primary_link')or(f.tags->>'highway'in('footway','path','track','pedestrian')and f.tags->>'bicycle'in('yes','designated','permissive')))  limit 5000`)).rows;
 const route=walkingRoute(paths,origin,destination,false,true);
 if(!route)throw new AppError(422,'BAD_REQUEST','A mapped rider route is unavailable between these points. Choose pickup or another mapped delivery point.');
 return {distanceMetres:route.networkDistanceMetres,geometry:route.geometry,originSnapMetres:route.originSnapMetres,destinationSnapMetres:route.destinationSnapMetres,notice:route.originSnapMetres>10||route.destinationSnapMetres>10?'Road-to-door access still needs verification. The reviewed distance covers the mapped road route.':null,source:'OSM_BICYCLE_NETWORK' as const};
}
