import { sql } from 'drizzle-orm';
import { database, firstRow } from './database';
import { AppError } from './errors';
import type { Bindings } from '../types';

export type AgentRoleProfile = {
  id: string;
  university_id: string;
  status: string;
  suspension_ends_at: string | null;
  suspension_reason: string | null;
};

/** PostgreSQL's main SELECT sees the pre-update snapshot. Take restored rows
 * from RETURNING and exclude their old versions from the unchanged branch.
 * This is one round trip, with no authorization cached between requests.
 */
export function currentAgentProfiles(userId: string, universityId: string | null) {
  return sql`with restored as (
    update public.agent_profiles
    set status='ACTIVE', suspension_ends_at=null, suspension_reason=null
    where user_id=${userId}::uuid and university_id=${universityId}::uuid
      and status='PAUSED' and suspension_ends_at<=now()
    returning id, university_id, agent_type, display_name, status, suspension_ends_at, suspension_reason
  ), current_profiles as (
    select * from restored
    union all
    select id, university_id, agent_type, display_name, status, suspension_ends_at, suspension_reason
    from public.agent_profiles p
    where user_id=${userId}::uuid and university_id=${universityId}::uuid
      and not exists(select 1 from restored r where r.id=p.id)
  )`;
}

export async function requireAgentRoleAccess(env: Bindings, userId: string, universityId: string | null, role: string, write: boolean) {
  const profile = firstRow(await database(env).execute<AgentRoleProfile>(sql`
    ${currentAgentProfiles(userId, universityId)}
    select id, university_id, status, suspension_ends_at, suspension_reason
    from current_profiles where agent_type=${role} limit 1
  `));
  if (!profile || !['ACTIVE', 'PAUSED'].includes(profile.status) || profile.status === 'PAUSED' && !profile.suspension_ends_at)
    throw new AppError(403, 'FORBIDDEN', 'This agent role is not active. Your student account is still available.');
  if (write && profile.status !== 'ACTIVE')
    throw new AppError(403, 'FORBIDDEN', `Your ${role.toLowerCase()} account is temporarily suspended until ${new Date(profile.suspension_ends_at!).toLocaleDateString('en-NG')}. You can view this dashboard; uploads, changes and withdrawals are paused.`, { reason: 'AGENT_TEMPORARILY_SUSPENDED', endsAt: profile.suspension_ends_at });
  return profile;
}
