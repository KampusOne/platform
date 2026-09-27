import { sql, type SQL } from 'drizzle-orm';
import { database, firstRow } from './database';
import { AppError } from './errors';
import type { Bindings } from '../types';
const cache = new WeakMap<object,{ready:boolean;expires:number}>();
export async function profileSafetyReady(env:Bindings) {
  const saved=cache.get(env); if(saved && saved.expires>Date.now()) return saved.ready;
  const row=firstRow(await database(env).execute<{ready:boolean}>(sql`select to_regclass('public.user_blocks') is not null and to_regclass('public.profile_social_policies') is not null as ready`));
  const ready=row?.ready===true;cache.set(env,{ready,expires:Date.now()+(ready?60000:5000)});return ready;
}
export async function requireProfileSafety(env:Bindings) {
  if(!await profileSafetyReady(env)) throw new AppError(503,'PROVIDER_UNAVAILABLE','Profile controls are being updated. Please try again shortly.');
}
export function unblockedAuthor(viewer:string,author:SQL) {
  return sql`not exists(select 1 from public.user_blocks ub where (ub.blocker_id=${viewer}::uuid and ub.blocked_id=${author}) or (ub.blocked_id=${viewer}::uuid and ub.blocker_id=${author}))`;
}
export async function requireUnblocked(env:Bindings,viewer:string,target:string) {
  if(viewer===target || !await profileSafetyReady(env)) return;
  const row=firstRow(await database(env).execute(sql`select 1 from public.user_blocks where (blocker_id=${viewer}::uuid and blocked_id=${target}::uuid) or (blocked_id=${viewer}::uuid and blocker_id=${target}::uuid) limit 1`));
  if(row) throw new AppError(404,'NOT_FOUND','This profile or conversation is unavailable.');
}
