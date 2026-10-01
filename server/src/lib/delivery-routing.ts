import {sql} from 'drizzle-orm';
import {database,firstRow} from './database';
import {AppError} from './errors';
import {walkingRoute,type Coordinate,type WalkPath} from './campus-routing';
import type {Bindings} from '../types';
export async function mappedDeliveryPoint(env:Bindings,universityId:string,placeId:string){
 const row=firstRow(await database(env).execute<{campus_id:string;name:string;latitude:number;longitude:number}>(sql`
 select p.campus_id,p.name,coalesce(ST_Y(e.geom),p.latitude)::float8 latitude,coalesce(ST_X(e.geom),p.longitude)::float8 longitude
 from public.campus_places p join public.institution_campuses c on c.id=p.campus_id and c.status='PUBLISHED'
 left join lateral(select geom from public.campus_entrances where place_id=p.id and institution_id=p.university_id and preferred and verified_at is not null order by verified_at desc limit 1)e on true
 where p.id=${placeId}::uuid and p.university_id=${universityId}::uuid and p.status='PUBLISHED' and (e.geom is not null or (p.source_provider='OSM'and p.confidence>=.8))`));
 if(!row||row.latitude===null||row.longitude===null)throw new AppError(422,'BAD_REQUEST','Choose a sourced campus pickup or delivery point before reviewing a rider fare.');return row;
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
 return {distanceMetres:route.distanceMetres,geometry:route.geometry,originSnapMetres:route.originSnapMetres,destinationSnapMetres:route.destinationSnapMetres,source:'OSM_BICYCLE_NETWORK' as const};
}
