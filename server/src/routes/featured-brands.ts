import {Hono} from 'hono';
import {sql} from 'drizzle-orm';
import {z} from '@kampusone/contracts';
import {database,firstRow} from '../lib/database';
import {currentUser,requireAuth} from '../middleware/auth';
import {resolveAdminScope} from '../lib/admin-access';
import {input} from '../lib/input';
import {AppError} from '../lib/errors';
import {recordAudit} from '../lib/audit';
import type {Bindings,Variables} from '../types';
export const featuredBrandRoutes=new Hono<{Bindings:Bindings;Variables:Variables}>();
featuredBrandRoutes.use('*',requireAuth);
featuredBrandRoutes.get('/public',async c=>{
 const user=currentUser(c);if(!user.universityId)return c.json({brands:[]});
 const rows=await database(c.env).execute(sql`select a.id,a.agent_type,a.display_name,a.profile_image_url,f.position from app_private.featured_brands f join public.agent_profiles a on a.id=f.agent_profile_id
  where f.institution_id=${user.universityId}::uuid and f.enabled and a.university_id=f.institution_id and a.status='ACTIVE' and a.verified_at is not null
  and not exists(select 1 from public.user_blocks b where(b.blocker_id=${user.id}::uuid and b.blocked_id=a.user_id)or(b.blocker_id=a.user_id and b.blocked_id=${user.id}::uuid)) order by f.position,a.id limit 30`);
 return c.json({brands:rows.rows});
});
featuredBrandRoutes.get('/admin',async c=>{
 const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query('universityId'),'marketplace.view'),search=c.req.query('search')?.trim().slice(0,120)??'';
 const db=database(c.env),result=await db.execute(sql`select a.id,a.university_id,a.agent_type,a.display_name,a.profile_image_url,coalesce(f.enabled,false) as featured,coalesce(f.position,0) as position from public.agent_profiles a
  left join app_private.featured_brands f on f.agent_profile_id=a.id and f.institution_id=a.university_id
  where a.status='ACTIVE' and a.verified_at is not null and(${scope}::uuid is null or a.university_id=${scope}::uuid)and(${search}='' or a.display_name ilike ${'%'+search+'%'})
  order by coalesce(f.enabled,false) desc,coalesce(f.position,0),a.display_name limit 100`);
 return c.json({brands:result.rows});
});
featuredBrandRoutes.put('/admin',async c=>{
 const user=currentUser(c),d=await input(c,z.object({agentId:z.string().uuid(),enabled:z.boolean(),position:z.number().int().min(0).max(1000)}).strict());
 const agent=firstRow(await database(c.env).execute<{university_id:string}>(sql`select university_id from public.agent_profiles where id=${d.agentId}::uuid and status='ACTIVE' and verified_at is not null`));
 if(!agent)throw new AppError(404,'NOT_FOUND','Choose an approved active agent.');await resolveAdminScope(c.env,user,agent.university_id,'marketplace.manage');
 await database(c.env).execute(sql`insert into app_private.featured_brands(institution_id,agent_profile_id,enabled,position,created_by)values(${agent.university_id}::uuid,${d.agentId}::uuid,${d.enabled},${d.position},${user.id}::uuid)on conflict(institution_id,agent_profile_id)do update set enabled=excluded.enabled,position=excluded.position`);
 await recordAudit(c.env,{actorUserId:user.id,action:'marketplace.featured-brand.updated',targetType:'agent_profile',targetId:d.agentId,requestId:c.get('requestId'),universityId:agent.university_id,metadata:{enabled:d.enabled,position:d.position}});
 return c.json({saved:true});
});
featuredBrandRoutes.get('/acquisition',async c=>{
 const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query('universityId'),'analytics.view'),db=database(c.env);
 const [totals,others]=await Promise.all([
 db.execute(sql`select context,source,count(*)::int as users from app_private.user_acquisition where(${scope}::uuid is null or institution_id=${scope}::uuid) group by context,source order by context,users desc`),
 db.execute(sql`select context,other_text,created_at from app_private.user_acquisition where source='OTHER' and(${scope}::uuid is null or institution_id=${scope}::uuid)order by created_at desc limit 100`),
 ]);return c.json({totals:totals.rows,others:others.rows});
});
