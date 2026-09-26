import {Hono} from 'hono';
import {sql} from 'drizzle-orm';
import {z} from '@kampusone/contracts';
import {database,firstRow} from '../lib/database';
import {id,input} from '../lib/input';
import {currentUser,requireAuth} from '../middleware/auth';
import {resolveAdminScope} from '../lib/admin-access';
import {recordAudit} from '../lib/audit';
import {AppError} from '../lib/errors';
import {importCampusPlacesFromOpenStreetMap} from '../lib/osm-campus-import';
import type{Bindings,Variables} from '../types';
export const campusAdminRoutes=new Hono<{Bindings:Bindings;Variables:Variables}>();
campusAdminRoutes.use('/*',requireAuth);
campusAdminRoutes.get('/',async c=>{
 const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query('universityId'),'universities.view');
 const rows=await database(c.env).execute(sql`select id,institution_id,name,slug,latitude,longitude,map_style,source_url,status from public.institution_campuses where (${scope}::uuid is null or institution_id=${scope}::uuid) order by name limit 300`);
 return c.json({campuses:rows.rows});
});
campusAdminRoutes.post('/',async c=>{
 const d=await input(c,z.object({id:z.string().uuid().optional(),universityId:z.string().uuid(),name:z.string().trim().min(2).max(120),slug:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),status:z.enum(['DRAFT','PUBLISHED','ARCHIVED']).default('DRAFT'),latitude:z.number().min(-90).max(90).nullable().default(null),longitude:z.number().min(-180).max(180).nullable().default(null)}).strict().refine(v=>(v.latitude===null)===(v.longitude===null),'Provide both coordinates or leave both blank.'));
 const u=currentUser(c);await resolveAdminScope(c.env,u,d.universityId,'universities.manage');
 const target=d.id??crypto.randomUUID();
 const result=firstRow(await database(c.env).execute(sql`insert into public.institution_campuses(id,institution_id,name,slug,status,latitude,longitude) values(${target}::uuid,${d.universityId}::uuid,${d.name},${d.slug},${d.status},${d.latitude},${d.longitude}) on conflict(id) do update set name=excluded.name,slug=excluded.slug,status=excluded.status,latitude=excluded.latitude,longitude=excluded.longitude,updated_at=now() where institution_campuses.institution_id=excluded.institution_id returning id`));
 if(!result)throw new AppError(403,'FORBIDDEN','This campus is outside the selected university.');
 await recordAudit(c.env,{actorUserId:u.id,universityId:d.universityId,action:'campus.saved',targetType:'campus',targetId:target,requestId:c.get('requestId')});return c.json(result,201);
});
campusAdminRoutes.get('/:id/places',async c=>{
 const campus=firstRow(await database(c.env).execute<{institution_id:string}>(sql`select institution_id from public.institution_campuses where id=${id(c.req.param('id'))}::uuid`));
 if(!campus)throw new AppError(404,'NOT_FOUND','Campus not found.');
 await resolveAdminScope(c.env,currentUser(c),campus.institution_id,'universities.view');
 return c.json({places:(await database(c.env).execute(sql`select id,name,category,description,latitude,longitude,parent_place_id,floor_label,room_label,search_aliases,status from public.campus_places where campus_id=${id(c.req.param('id'))}::uuid order by name limit 500`)).rows});
});
campusAdminRoutes.post('/:id/places',async c=>{
 const campusId=id(c.req.param('id')),u=currentUser(c),db=database(c.env);
 const campus=firstRow(await db.execute<{institution_id:string}>(sql`select institution_id from public.institution_campuses where id=${campusId}::uuid`));if(!campus)throw new AppError(404,'NOT_FOUND','Campus not found.');
 await resolveAdminScope(c.env,u,campus.institution_id,'universities.manage');
 const d=await input(c,z.object({id:z.string().uuid().optional(),name:z.string().trim().min(2).max(180),description:z.string().trim().max(2000).default(''),parentId:z.string().uuid().nullable().default(null),floor:z.string().trim().max(40).default(''),room:z.string().trim().max(40).default(''),aliases:z.array(z.string().trim().min(1).max(80)).max(20).default([]),latitude:z.number().min(-90).max(90).nullable().default(null),longitude:z.number().min(-180).max(180).nullable().default(null),status:z.enum(['DRAFT','PUBLISHED','ARCHIVED']).default('DRAFT')}).strict().refine(v=>(v.latitude===null)===(v.longitude===null),'Provide both coordinates or leave both blank.'));
 if(d.parentId&&(!firstRow(await db.execute(sql`select id from public.campus_places where id=${d.parentId}::uuid and campus_id=${campusId}::uuid and parent_place_id is null and id<>${d.id??'00000000-0000-0000-0000-000000000000'}::uuid`))))throw new AppError(400,'BAD_REQUEST','Choose a building on this campus.');
 if(d.id&&d.parentId&&firstRow(await db.execute(sql`select id from public.campus_places where parent_place_id=${d.id}::uuid limit 1`)))throw new AppError(400,'BAD_REQUEST','A building containing offices cannot become an office.');
 const target=d.id??crypto.randomUUID();
 const result=firstRow(await db.execute(sql`insert into public.campus_places(id,university_id,campus_id,name,category,description,parent_place_id,floor_label,room_label,search_aliases,latitude,longitude,status) values(${target}::uuid,${campus.institution_id}::uuid,${campusId}::uuid,${d.name},${d.parentId?'SERVICE':'ACADEMIC'},${d.description},${d.parentId}::uuid,${d.floor},${d.room},${sql.param(d.aliases)}::text[],${d.latitude},${d.longitude},${d.status}) on conflict(id) do update set name=excluded.name,description=excluded.description,parent_place_id=excluded.parent_place_id,floor_label=excluded.floor_label,room_label=excluded.room_label,search_aliases=excluded.search_aliases,latitude=excluded.latitude,longitude=excluded.longitude,status=excluded.status,updated_at=now() where campus_places.campus_id=excluded.campus_id returning id`));
 if(!result)throw new AppError(403,'FORBIDDEN','This place is outside the selected campus.');
 await recordAudit(c.env,{actorUserId:u.id,universityId:campus.institution_id,action:'campus.place.saved',targetType:'campus_place',targetId:target,requestId:c.get('requestId')});return c.json(result,201);
});

campusAdminRoutes.post('/:id/import-osm',async c=>{
 if(c.env.OSM_IMPORT_ENABLED==='false')throw new AppError(503,'SERVICE_UNAVAILABLE','OpenStreetMap import is temporarily disabled.');
 const campusId=id(c.req.param('id')),u=currentUser(c),db=database(c.env);
 const campus=firstRow(await db.execute<{institution_id:string;latitude:string|null;longitude:string|null}>(sql`select institution_id,latitude,longitude from public.institution_campuses where id=${campusId}::uuid`));
 if(!campus)throw new AppError(404,'NOT_FOUND','Campus not found.');
 await resolveAdminScope(c.env,u,campus.institution_id,'universities.manage');
 const latitude=Number(campus.latitude),longitude=Number(campus.longitude);
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude))throw new AppError(409,'CONFLICT','Save the campus centre before importing mapped places.');
 const body=await c.req.json().catch(()=>({}));
 const parsed=z.object({radiusMeters:z.number().int().min(500).max(3500).default(2200)}).safeParse(body);
 if(!parsed.success)throw new AppError(400,'BAD_REQUEST','Choose an import radius between 500 and 3500 metres.');
 let places;
 try{
  places=await importCampusPlacesFromOpenStreetMap({latitude,longitude,radiusMeters:parsed.data.radiusMeters});
 }catch(error){
  throw new AppError(502,'BAD_GATEWAY',error instanceof Error?error.message:'OpenStreetMap import could not be completed.');
 }
 const payload=JSON.stringify(places.map(place=>({
  name:place.name,
  category:place.category,
  description:place.description,
  latitude:place.latitude,
  longitude:place.longitude,
  aliasesCsv:place.aliases.join('|'),
  sourceRef:place.sourceRef,
  sourceUrl:place.sourceUrl,
 })));
 const inserted=await db.execute(sql`
  with incoming as (
   select * from jsonb_to_recordset(${payload}::jsonb)
   as x(name text,category text,description text,latitude numeric,longitude numeric,aliases_csv text,source_ref text,source_url text)
  )
  insert into public.campus_places(
   university_id,campus_id,name,category,description,latitude,longitude,search_aliases,status,
   source_provider,source_ref,source_url,source_synced_at
  )
  select
   ${campus.institution_id}::uuid,${campusId}::uuid,name,category,description,latitude,longitude,
   case when aliases_csv='' then '{}'::text[] else string_to_array(aliases_csv,'|') end,
   'DRAFT','OPENSTREETMAP',source_ref,source_url,now()
  from incoming
  on conflict(campus_id,source_provider,source_ref) do update set
   name=excluded.name,
   category=excluded.category,
   latitude=excluded.latitude,
   longitude=excluded.longitude,
   search_aliases=excluded.search_aliases,
   source_url=excluded.source_url,
   source_synced_at=now()
  returning id
 `);
 await recordAudit(c.env,{actorUserId:u.id,universityId:campus.institution_id,action:'campus.osm_imported',targetType:'campus',targetId:campusId,requestId:c.get('requestId')});
 return c.json({found:places.length,synced:inserted.rows.length,status:'DRAFT'});
});
