import { Hono } from 'hono';
import { SignJWT,jwtVerify } from 'jose';
import { sql } from 'drizzle-orm';
import { requireAuth,currentUser } from '../middleware/auth';
import { allowedOrigins } from '../lib/config';
import { database,firstRow } from '../lib/database';
import { AppError } from '../lib/errors';
import { liveScope } from '../lib/live-updates';
import type { Bindings,Variables } from '../types';
export const liveRoutes=new Hono<{Bindings:Bindings;Variables:Variables}>();
const secret=(env:Bindings)=>{if(!env.JWT_SECRET||env.JWT_SECRET.length<32)throw new AppError(503,'FEATURE_DISABLED','Live updates are unavailable.');return new TextEncoder().encode(env.JWT_SECRET);};
function enabled(env:Bindings){if(env.LIVE_UPDATES_ENABLED!=='true'||!env.LIVE_USERS)throw new AppError(503,'FEATURE_DISABLED','Live updates are unavailable. Screens use bounded reconciliation.');}
liveRoutes.post('/ticket',requireAuth,async c=>{
  enabled(c.env);const user=currentUser(c);
  if(!user.sessionFamilyId)throw new AppError(401,'UNAUTHENTICATED','Refresh your session.');
  const rate=firstRow(await database(c.env).execute<{allowed:boolean}>(sql`select app_private.consume_request_rate_limit('LIVE_TICKET',${user.id},12,60,60) as allowed`));
  if(!rate?.allowed)throw new AppError(429,'RATE_LIMITED','Please wait before reconnecting live updates.');
  const expiresAt=Date.now()+60_000;
  const ticket=await new SignJWT({institutionId:user.universityId,family:user.sessionFamilyId}).setProtectedHeader({alg:'HS256'}).setSubject(user.id).setIssuer('kampusone-live').setAudience('live-upgrade').setJti(crypto.randomUUID()).setIssuedAt().setExpirationTime(Math.floor(expiresAt/1000)).sign(secret(c.env));
  const origin=new URL(c.env.PUBLIC_API_ORIGIN??c.req.url);
  if(origin.protocol!=='https:'&&c.env.ENVIRONMENT!=='local')throw new AppError(503,'FEATURE_DISABLED','Live origin must use HTTPS.');
  origin.protocol=origin.protocol==='https:'?'wss:':'ws:';origin.pathname='/v1/live';origin.search='';origin.hash='';
  c.header('Cache-Control','no-store');
  return c.json({ticket,url:origin.toString(),expiresAt});
});
liveRoutes.get('/',async c=>{
  enabled(c.env);
  const origin=c.req.header('Origin');if(origin&&!allowedOrigins(c.env).has(origin))throw new AppError(403,'FORBIDDEN','This origin is not allowed.');
  if(c.req.header('Upgrade')?.toLowerCase()!=='websocket')throw new AppError(400,'BAD_REQUEST','Use a WebSocket upgrade.');
  const protocols=(c.req.header('Sec-WebSocket-Protocol')??'').split(',').map(v=>v.trim());
  const value=protocols.find(v=>v.startsWith('ticket.'))?.slice(7);
  if(!value||value.length>2000||!protocols.includes('kampusone-live'))throw new AppError(401,'UNAUTHENTICATED','Request a live ticket.');
  let claims;
  try{claims=(await jwtVerify(value,secret(c.env),{issuer:'kampusone-live',audience:'live-upgrade',algorithms:['HS256']})).payload;}catch{throw new AppError(401,'UNAUTHENTICATED','Your live ticket expired.');}
  const uuid=/^[0-9a-f-]{36}$/i;
  if(typeof claims.sub!=='string'||!uuid.test(claims.sub)||typeof claims.family!=='string'||!uuid.test(claims.family)||!(claims.institutionId===null||typeof claims.institutionId==='string'&&uuid.test(claims.institutionId)))throw new AppError(401,'UNAUTHENTICATED','Request a new live ticket.');
  const valid=firstRow(await database(c.env).execute(sql`select 1 as valid from public.users u join public.profiles p on p.user_id=u.id and p.deleted_at is null where u.id=${claims.sub}::uuid and u.status::text='ACTIVE' and u.deleted_at is null and p.university_id is not distinct from ${claims.institutionId as string|null}::uuid and exists(select 1 from public.refresh_tokens t where t.user_id=u.id and t.family_id=${claims.family}::uuid and t.revoked_at is null and t.expires_at>now()) and not exists(select 1 from public.account_restrictions r where r.user_id=u.id and r.revoked_at is null and r.starts_at<=now() and(r.ends_at is null or r.ends_at>now()))`));
  if(!valid)throw new AppError(401,'UNAUTHENTICATED','Your session is no longer available.');
  const stub=c.env.LIVE_USERS!.get(c.env.LIVE_USERS!.idFromName(liveScope(claims.sub,claims.institutionId as string|null)));
  return stub.fetch('https://live.internal/connect',{headers:{Upgrade:'websocket','X-Live-Expires':String(Math.min(Date.now()+60_000,Number(claims.exp)*1000))}});
});
