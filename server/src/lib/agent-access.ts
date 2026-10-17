import {sql} from 'drizzle-orm';
import {database,firstRow} from './database';
import {AppError} from './errors';
import type {Bindings} from '../types';
export async function restoreExpiredAgentRoles(env:Bindings,userId:string) {
  await database(env).execute(sql`update public.agent_profiles set status='ACTIVE',suspension_ends_at=null,suspension_reason=null where user_id=${userId}::uuid and status='PAUSED' and suspension_ends_at<=now()`);
}
export async function requireAgentRoleAccess(env:Bindings,userId:string,universityId:string|null,role:string,write:boolean) {
  await restoreExpiredAgentRoles(env,userId);
  const profile=firstRow(await database(env).execute<{id:string;status:string;suspension_ends_at:string|null;suspension_reason:string|null}>(sql`select id,status,suspension_ends_at,suspension_reason from public.agent_profiles where user_id=${userId}::uuid and university_id=${universityId}::uuid and agent_type=${role} limit 1`));
  if(!profile || !['ACTIVE','PAUSED'].includes(profile.status) || profile.status==='PAUSED'&&!profile.suspension_ends_at)throw new AppError(403,'FORBIDDEN','This agent role is not active. Your student account is still available.');
  if(write&&profile.status!=='ACTIVE')throw new AppError(403,'FORBIDDEN',`Your ${role.toLowerCase()} account is temporarily suspended until ${new Date(profile.suspension_ends_at!).toLocaleDateString('en-NG')}. You can view this dashboard; uploads, changes and withdrawals are paused.`,{reason:'AGENT_TEMPORARILY_SUSPENDED',endsAt:profile.suspension_ends_at});
  return profile;
}
