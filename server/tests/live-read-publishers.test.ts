import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, testDatabaseAdapter } from './helpers/database';
import { liveScope } from '../src/lib/live-updates';
import { publishNotificationRead, publishRiderQueueReads } from '../src/services/live-read-publishers';
import type { Bindings } from '../src/types';

let db: PGlite, reads = 0;
vi.mock('../src/lib/database', () => ({
  database: () => ({ execute: (...args: Parameters<ReturnType<typeof testDatabaseAdapter>['execute']>) => {
    reads++;
    return testDatabaseAdapter(db).execute(...args);
  } }),
}));

const campus = crypto.randomUUID(), otherCampus = crypto.randomUUID();
const actor = crypto.randomUUID(), rider = crypto.randomUUID(), offline = crypto.randomUUID();
const paused = crypto.randomUUID(), restricted = crypto.randomUUID(), outsider = crypto.randomUUID(), student = crypto.randomUUID();
const targets: string[] = [], events: { id: string; prefixes: string[] }[] = [];
const namespace = {
  idFromName: (scope: string) => { targets.push(scope); return scope; },
  get: () => ({ fetch: async (_url: string, init: RequestInit) => {
    events.push(JSON.parse(String(init.body)));
    return new Response(null, { status: 204 });
  } }),
};
const env = { LIVE_UPDATES_ENABLED: 'true', LIVE_USERS: namespace } as unknown as Bindings;

async function addUser(user: string, institution = campus) {
  await db.query("insert into public.users(id,email,password_hash,updated_at)values($1,$1::uuid::text||'@example.invalid','synthetic',now())", [user]);
  await db.query('insert into public.profiles(id,user_id,username,display_name,university_id,updated_at)values($1,$1,left(replace($1::uuid::text,\'-\',\'\'),30),$1::uuid::text,$2,now())', [user, institution]);
}
async function addRider(user: string, institution = campus, online = true, status = 'ACTIVE') {
  const application = crypto.randomUUID(), profile = crypto.randomUUID();
  await db.query("insert into public.agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement,status)values($1,$2,$3,'RIDER','Synthetic rider','+2348000000000','Synthetic approved fixture only','APPROVED')", [application, user, institution]);
  await db.query("insert into public.agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,verified_at,status)values($1,$2,$3,$4,'RIDER','Synthetic rider',now(),$5)", [profile, user, institution, application, status]);
  await db.query('insert into public.rider_presence(rider_profile_id,online)values($1,$2)', [profile, online]);
}

beforeAll(async () => {
  db = await createTestDatabase();
  for (const id of [campus, otherCampus]) await db.query("insert into public.universities(id,name,slug,updated_at)values($1,'Live fixture '||$1::uuid::text,$1::uuid::text,now())", [id]);
  for (const id of [actor, rider, offline, paused, restricted, student]) await addUser(id);
  await addUser(outsider, otherCampus);
  await addRider(rider); await addRider(offline, campus, false); await addRider(paused, campus, true, 'PAUSED');
  await addRider(restricted); await addRider(outsider, otherCampus);
  await db.query("insert into public.account_restrictions(user_id,institution_id,kind,reason,created_by)values($1,$2,'SUSPENDED','Synthetic restricted fixture',$3)", [restricted, campus, actor]);
}, 60000);
beforeEach(() => { reads = 0; targets.length = 0; events.length = 0; });
afterAll(async () => { await db?.close(); });

describe('live read audiences against current PostgreSQL state', () => {
  it('performs no database or hub work when the reviewed gate or binding is absent', async () => {
    for (const disabled of [{ ...env, LIVE_UPDATES_ENABLED: 'false' }, { ...env, LIVE_USERS: undefined }]) {
      await publishNotificationRead(disabled, actor, 'notice:one', campus);
      await publishRiderQueueReads(disabled, campus, 'dispatch:one', actor);
    }
    await publishNotificationRead(env, 'invalid', 'notice:one', campus);
    await publishRiderQueueReads(env, null, 'dispatch:one', actor);
    expect(reads).toBe(0); expect(targets).toEqual([]);
  });
  it('notifies only the current recipient institution and rejects old-campus notices after a transfer', async () => {
    await publishNotificationRead(env, actor, 'notice:one', campus);
    expect(targets).toEqual([liveScope(actor, campus)]);
    await db.query('update public.profiles set university_id=$2 where user_id=$1', [actor, otherCampus]);
    try {
      await publishNotificationRead(env, actor, 'notice:old', campus);
      expect(targets).toHaveLength(1);
      await publishNotificationRead(env, actor, 'notice:global', null);
      expect(targets[1]).toBe(liveScope(actor, otherCampus));
    } finally { await db.query('update public.profiles set university_id=$2 where user_id=$1', [actor, campus]); }
    expect(events.every(event => JSON.stringify(event).includes('notice:old') === false)).toBe(true);
  });
  it('excludes restricted and deleted recipients without exposing their identities in events', async () => {
    await publishNotificationRead(env, restricted, 'notice:restricted', campus);
    await db.query('update public.users set deleted_at=now() where id=$1', [student]);
    try { await publishNotificationRead(env, student, 'notice:deleted', campus); }
    finally { await db.query('update public.users set deleted_at=null where id=$1', [student]); }
    expect(targets).toEqual([]); expect(events).toEqual([]);
  });
  it('dispatches only to the actor and current approved online riders within the institution', async () => {
    await publishRiderQueueReads(env, campus, 'dispatch:one', actor);
    expect(new Set(targets)).toEqual(new Set([liveScope(actor, campus), liveScope(rider, campus)]));
    expect(events).toHaveLength(2);
    for (const event of events) expect(Object.keys(event).sort()).toEqual(['id', 'prefixes']);
    expect(events.every(event => event.prefixes.length === 1 && event.prefixes[0] === '/v1/agents')).toBe(true);
  });
  it('caps dispatch work at sixteen recipients and always includes the active actor', async () => {
    for (let i = 0; i < 18; i++) { const user = crypto.randomUUID(); await addUser(user); await addRider(user); }
    await publishRiderQueueReads(env, campus, 'dispatch:many', actor);
    expect(targets).toHaveLength(16); expect(new Set(targets).size).toBe(16);
    expect(targets).toContain(liveScope(actor, campus));
    expect(targets).not.toContain(liveScope(outsider, otherCampus));
  });
});
