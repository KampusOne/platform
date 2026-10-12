import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { decodeJwt, SignJWT } from 'jose';
import { createTestDatabase, testDatabaseAdapter, testSqlClient } from './helpers/database';
import { app } from '../src/app';
import { createSession } from '../src/services/sessions';
import type { Bindings } from '../src/types';
let db:PGlite,accessToken:string,ticket:string;
vi.mock('../src/lib/database',()=>({database:()=>testDatabaseAdapter(db),sqlClient:()=>testSqlClient(db),firstRow:(r:{rows:unknown[]})=>r.rows[0]}));
const user=crypto.randomUUID(),campus=crypto.randomUUID(),otherCampus=crypto.randomUUID(),scopes:string[]=[];
const namespace={idFromName:(scope:string)=>{scopes.push(scope);return scope;},get:()=>({fetch:async()=>new Response(null,{status:204})})};
const env={ENVIRONMENT:'local',ALLOWED_ORIGINS:'https://app.example.invalid',PUBLIC_API_ORIGIN:'https://api.example.invalid',JWT_SECRET:'synthetic-live-auth-secret-12345678901234567890',UNIFIED_SCHEMA_READY:'true',LIVE_UPDATES_ENABLED:'true',LIVE_USERS:namespace} as unknown as Bindings;
async function requestTicket(environment=env,token=accessToken){return app.request('https://api.example.invalid/v1/live/ticket',{method:'POST',headers:{Authorization:'Bearer '+token}},environment);}
async function upgrade(value=ticket,origin='https://app.example.invalid'){return app.request('https://api.example.invalid/v1/live',{headers:{Upgrade:'websocket',Origin:origin,'Sec-WebSocket-Protocol':'kampusone-live,ticket.'+value}},env);}
beforeAll(async()=>{
  db=await createTestDatabase();
  for(const id of [campus,otherCampus])await db.query("insert into public.universities(id,name,slug,updated_at)values($1,'Test campus '||$1::uuid::text,$1::uuid::text,now())",[id]);
  await db.query("insert into public.users(id,email,password_hash,email_verified_at,updated_at)values($1,'live-test@example.invalid','synthetic',now(),now())",[user]);
  await db.query("insert into public.profiles(id,user_id,username,display_name,university_id,updated_at)values($1,$1,'livetest','Test member',$2,now())",[user,campus]);
  accessToken=(await createSession(env,{id:user,email:'live-test@example.invalid',roles:['STUDENT'],operatorRoles:[],universityId:campus})).accessToken;
},60000);
afterAll(async()=>{await db?.close();});
describe('live gateway authorization against current PostgreSQL state',()=>{
  it('requires a valid session and a reviewed enabled binding',async()=>{
    expect((await requestTicket(env,'invalid')).status).toBe(401);
    expect((await requestTicket({...env,LIVE_UPDATES_ENABLED:'false'})).status).toBe(503);
    expect(scopes).toHaveLength(0);
  });
  it('issues a short non-cacheable ticket bound to user, institution and session',async()=>{
    const response=await requestTicket();expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
    const data=await response.json() as {ticket:string;url:string;expiresAt:number};ticket=data.ticket;
    const claims=decodeJwt(ticket);expect(claims).toMatchObject({sub:user,institutionId:campus,iss:'kampusone-live',aud:'live-upgrade'});expect(typeof claims.family).toBe('string');
    expect(Number(claims.exp)-Number(claims.iat)).toBeLessThanOrEqual(60);
    expect(data.url).toBe('wss://api.example.invalid/v1/live');expect(new URL(data.url).search).toBe('');
  });
  it('rejects untrusted origins and tampered, expired or wrong-audience tickets before reaching a hub',async()=>{
    expect((await upgrade(ticket,'https://untrusted.example.invalid')).status).toBe(403);
    expect((await upgrade(ticket.slice(0,-3)+'xyz')).status).toBe(401);
    const claims=decodeJwt(ticket);
    for(const audience of ['live-upgrade','wrong-audience']){
      const forged=await new SignJWT({institutionId:campus,family:claims.family}).setSubject(user).setProtectedHeader({alg:'HS256'}).setIssuer('kampusone-live').setAudience(audience).setExpirationTime(audience==='live-upgrade'?1:Math.floor(Date.now()/1000)+60).sign(new TextEncoder().encode(env.JWT_SECRET));
      expect((await upgrade(forged)).status).toBe(401);
    }
    expect(scopes).toHaveLength(0);
  });
  it('routes only the current user/tenant and rejects a stale tenant or revoked session',async()=>{
    expect((await upgrade()).status).toBe(204);expect(scopes).toEqual([JSON.stringify([user,campus])]);
    await db.query('update public.profiles set university_id=$2 where user_id=$1',[user,otherCampus]);expect((await upgrade()).status).toBe(401);
    await db.query('update public.profiles set university_id=$2 where user_id=$1',[user,campus]);
    await db.query('update public.refresh_tokens set revoked_at=now() where user_id=$1',[user]);expect((await upgrade()).status).toBe(401);
    expect(scopes).toHaveLength(1);
  });
});
