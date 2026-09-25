import {Hono} from 'hono';
import {sql} from 'drizzle-orm';
import {z} from '@kampusone/contracts';
import {database,firstRow} from '../lib/database';
import {id,input} from '../lib/input';
import {currentUser,requireAuth} from '../middleware/auth';
import {resolveAdminScope} from '../lib/admin-access';
import {recordAudit} from '../lib/audit';
import {AppError} from '../lib/errors';
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
 const d=await input(c,z.object({id:z.string().uuid().optional(),name:z.string().trim().min(2).max(180),description:z.string().trim().max(2000).default(''),parentId:z.string().uuid().nullable().default(null),floor:z.string().trim().max(40).default(''),room:z.string().trim().max(40).default(''),aliases:z.array(z.string().trim().min(1).max(80)).max(20).default([]),status:z.enum(['DRAFT','PUBLISHED','ARCHIVED']).default('DRAFT')}).strict());
 if(d.parentId&&(!firstRow(await db.execute(sql`select id from public.campus_places where id=${d.parentId}::uuid and campus_id=${campusId}::uuid and parent_place_id is null and id<>${d.id??'00000000-0000-0000-0000-000000000000'}::uuid`))))throw new AppError(400,'BAD_REQUEST','Choose a building on this campus.');
 if(d.id&&d.parentId&&firstRow(await db.execute(sql`select id from public.campus_places where parent_place_id=${d.id}::uuid limit 1`)))throw new AppError(400,'BAD_REQUEST','A building containing offices cannot become an office.');
 const target=d.id??crypto.randomUUID();
 const result=firstRow(await db.execute(sql`insert into public.campus_places(id,university_id,campus_id,name,category,description,parent_place_id,floor_label,room_label,search_aliases,status) values(${target}::uuid,${campus.institution_id}::uuid,${campusId}::uuid,${d.name},${d.parentId?'SERVICE':'ACADEMIC'},${d.description},${d.parentId}::uuid,${d.floor},${d.room},${sql.param(d.aliases)}::text[],${d.status}) on conflict(id) do update set name=excluded.name,description=excluded.description,parent_place_id=excluded.parent_place_id,floor_label=excluded.floor_label,room_label=excluded.room_label,search_aliases=excluded.search_aliases,status=excluded.status,updated_at=now() where campus_places.campus_id=excluded.campus_id returning id`));
 if(!result)throw new AppError(403,'FORBIDDEN','This place is outside the selected campus.');
 await recordAudit(c.env,{actorUserId:u.id,universityId:campus.institution_id,action:'campus.place.saved',targetType:'campus_place',targetId:target,requestId:c.get('requestId')});return c.json(result,201);
});
