import { sql } from 'drizzle-orm';
import { database, firstRow } from './database';
import { AppError } from './errors';
import type { AuthenticatedUser, Bindings } from '../types';
export const ADMIN_PERMISSIONS = [
 'overview.view','universities.view','universities.manage','users.view','users.verify','users.manage',
 'staff.manage','agents.view','agents.review','agents.verify','marketplace.view','marketplace.manage',
 'content.capabilities','content.view','content.create','content.manage','content.delete','academic.view','academic.manage',
 'ai.view','finance.view','finance.review','payouts.approve','analytics.view','audit.view','support.view',
 'support.manage','system.view','product.manage','broadcasts.view','broadcasts.manage','broadcasts.send','notifications.test','notifications.manage',
] as const;
const legacy: Record<string,readonly string[]> = {
 PLATFORM_ADMIN:ADMIN_PERMISSIONS,
 INSTITUTION_ADMIN:['overview.view','universities.view','users.view','academic.view','academic.manage','agents.view','marketplace.view','marketplace.manage','content.view','content.create','content.manage','content.delete','analytics.view'],
 CONTENT_EDITOR:['content.view','content.create','content.manage','content.delete','universities.view'],
 VERIFICATION_REVIEWER:['agents.view','agents.review','agents.verify'],
 SUPPORT:['users.view','support.view','support.manage'],
 FINANCE_REVIEWER:['finance.view','finance.review','payouts.approve','analytics.view'],
};
export type AdminUser = AuthenticatedUser & { adminPermission?: string };
type Grant = {permissions:string[];university_id:string|null};
export type AdminAccess={permissions:string[];universityIds:string[];allUniversities:boolean;grants:Grant[]};
export async function adminAccess(env:Bindings,user:AuthenticatedUser):Promise<AdminAccess>{
 const db=database(env);
 const custom=firstRow(await db.execute<{permissions:string[];university_ids:string[];all_universities:boolean;status:string}>(sql`select permissions,university_ids,all_universities,status from app_private.staff_access where user_id=${user.id}::uuid`));
 let grants:Grant[]=[];
 if(custom){
  if(custom.status==='ACTIVE') grants=custom.all_universities?[{permissions:custom.permissions,university_id:null}]:custom.university_ids.map(university_id=>({permissions:custom.permissions,university_id}));
 } else {
  const rows=await db.execute<{role:string;university_id:string|null}>(sql`select role,university_id from public.operator_roles where user_id=${user.id}::uuid and (expires_at is null or expires_at>now())`);
  grants=rows.rows.filter(r=>r.university_id!==null||r.role==='PLATFORM_ADMIN').map(r=>({permissions:[...(legacy[r.role]??[])],university_id:r.university_id}));
 }
 return {permissions:[...new Set(grants.flatMap(g=>g.permissions))],universityIds:[...new Set(grants.flatMap(g=>g.university_id?[g.university_id]:[]))],allUniversities:grants.some(g=>g.university_id===null),grants};
}
export async function assertPermission(env:Bindings,user:AuthenticatedUser,permission:string){
 const access=await adminAccess(env,user);
 if(!access.permissions.includes(permission))throw new AppError(403,'FORBIDDEN','Your staff permissions do not allow this action.');
 return access;
}
export async function resolveAdminScope(env:Bindings,user:AdminUser,requested?:string,permission=user.adminPermission??'overview.view'){
 if(requested&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requested))throw new AppError(400,'BAD_REQUEST','Select a valid university.');
 const access=await assertPermission(env,user,permission);
 const grants=access.grants.filter(g=>g.permissions.includes(permission));
 if(grants.some(g=>g.university_id===null))return requested??null;
 if(requested&&grants.some(g=>g.university_id===requested))return requested;
 if(requested)throw new AppError(403,'FORBIDDEN',"You cannot access another university's records.");
 // Legacy routes accept one scope; never interpret a missing filter as unrestricted access.
 const first=grants.find(g=>g.university_id)?.university_id;
 if(!first)throw new AppError(403,'FORBIDDEN','No university scope is assigned to this account.');
 return first;
}
export function permissionForAdminRoute(path:string,method:string):string|null{
 const read=method==='GET'||method==='HEAD';
 if(path==='/access')return 'access';
 if(path.startsWith('/broadcasts'))return read?'broadcasts.view':/(send|test|schedule)$/.test(path)?'broadcasts.send':'broadcasts.manage';
 if(path.startsWith('/staff'))return 'staff.manage';
 if(path.startsWith('/workspaces/'))return ({universities:'universities.view',users:'users.view',agents:'agents.view','academic-submissions':'academic.view',content:'content.view',analytics:'analytics.view',finance:'finance.view',audit:'audit.view',ai:'ai.view',support:'support.view'} as Record<string,string>)[path.split('/')[2]??'']??null;
 if(path==='/reports/engagement')return 'analytics.view';
 if(path==='/reports/ai')return 'ai.view';
 if(path==='/dashboard')return 'overview.view';
 if(path.endsWith('/publishing-capabilities'))return 'content.capabilities';
 if(path.startsWith('/users'))return path.endsWith('/verification')?'users.verify':read?'users.view':'users.manage';
 if(/^\/applications\/[^/]+\/checks$/.test(path))return 'agents.verify';
 if(path.startsWith('/applications'))return read?'agents.view':path.endsWith('/verification')?'agents.verify':'agents.review';
 if(path.startsWith('/academic/'))return read?'academic.view':'academic.manage';
 if(path.startsWith('/academic-submissions'))return read?'academic.view':'academic.manage';
 if(path.startsWith('/operations/payouts')||path==='/operations/release-eligible-earnings')return read?'finance.view':'payouts.approve';
 if(/^\/operations\/(payment-events|disputes)/.test(path))return read?'finance.view':'finance.review';
 if(path.startsWith('/operations'))return read?'marketplace.view':'marketplace.manage';
 if(/^\/(content|tutorials|campus-places)/.test(path))return read?'content.view':method==='DELETE'?'content.delete':path.endsWith('/review')||path.endsWith('/verify')?'content.manage':'content.create';
 if(path==='/audit')return 'audit.view';
 if(path==='/release-phases')return 'system.view';
 return null;
}
