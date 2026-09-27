import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from '@kampusone/contracts';
import { database, firstRow } from '../lib/database';
import { input } from '../lib/input';
import { AppError } from '../lib/errors';
import { generateOtp, hashOtp } from '../lib/security';
import { requireEmailProvider, sendMail } from '../lib/email';
import { clearSessionCookies, currentUser, requireAuth } from '../middleware/auth';
import type { Bindings, Variables } from '../types';

export const accountDeletionRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();
accountDeletionRoutes.use('/*', requireAuth);
accountDeletionRoutes.use('/*', async (c,next) => { c.header('Cache-Control','private, no-store'); await next(); });
accountDeletionRoutes.post('/code', async c => {
  const user=currentUser(c),db=database(c.env);
  if(!user.sessionFamilyId) throw new AppError(401,'UNAUTHENTICATED','Sign in again before deleting your account.');
  requireEmailProvider(c.env);
  const allowed=firstRow(await db.execute<{allowed:boolean}>(sql`select app_private.consume_request_rate_limit('ACCOUNT_DELETE_CODE',${user.id},3,3600,3600) as allowed`));
  if(!allowed?.allowed) throw new AppError(429,'RATE_LIMITED','Please wait before requesting another deletion code.');
  const code=generateOtp(),challenge=crypto.randomUUID();
  await db.execute(sql`insert into app_private.account_deletion_codes(id,user_id,session_family_id,token_hash) values(${challenge}::uuid,${user.id}::uuid,${user.sessionFamilyId}::uuid,${await hashOtp(c.env,code)})`);
  await sendMail(c.env,{to:user.email,code,kind:'account-deletion',idempotencyKey:'delete-'+challenge});
  return c.json({challengeId:challenge,expiresIn:600},201);
});
accountDeletionRoutes.post('/confirm', async c => {
  const data=await input(c,z.object({challengeId:z.string().uuid(),code:z.string().regex(/^\d{6}$/),confirmation:z.literal('DELETE')}).strict());
  const user=currentUser(c);
  if(!user.sessionFamilyId) throw new AppError(401,'UNAUTHENTICATED','Sign in again before deleting your account.');
  const result=firstRow(await database(c.env).execute<{outcome:string}>(sql`select app_private.delete_own_account(${user.id}::uuid,${user.sessionFamilyId}::uuid,${data.challengeId}::uuid,${await hashOtp(c.env,data.code)},${c.get('requestId')??crypto.randomUUID()}) as outcome`));
  if(result?.outcome!=='DELETED') throw new AppError(400,'BAD_REQUEST','This code is incorrect or expired. Request a new code if needed.');
  clearSessionCookies(c,c.env);
  return c.json({status:'deleted'});
});
