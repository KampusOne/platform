import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono, type Context, type Next } from 'hono';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, testDatabaseAdapter } from './helpers/database';
import { featuredBrandRoutes } from '../src/routes/featured-brands';
import { peopleRoutes } from '../src/routes/people';
import { AppError } from '../src/lib/errors';
import type { Bindings } from '../src/types';

let pg: PGlite;
vi.mock('../src/lib/database', () => ({ database: () => testDatabaseAdapter(pg), firstRow: (r: { rows: unknown[] }) => r.rows[0] }));
vi.mock('../src/middleware/auth', () => ({ currentUser: (c: Context) => ({ id: c.req.header('x-user'), universityId: c.req.header('x-campus'), roles: ['STUDENT'] }), requireAuth: async (c: Context, next: Next) => c.req.header('x-user') ? next() : c.json({ error: 'Unauthorized' }, 401) }));
const campus = crypto.randomUUID(), foreignCampus = crypto.randomUUID(), student = crypto.randomUUID(), owner = crypto.randomUUID(), brand = crypto.randomUUID();
const env = { UNIFIED_SCHEMA_READY: 'true' } as Bindings;
const app = new Hono().route('/brands', featuredBrandRoutes).route('/people', peopleRoutes);
app.onError((e, c) => c.json({ error: e.message }, e instanceof AppError ? e.status : 500));
function request(path = '/brands/public', institution = campus) {
  return app.request(path, { headers: { 'x-user': student, 'x-campus': institution } }, env);
}
async function brands(institution = campus) {
  const response = await request('/brands/public', institution);
  expect(response.status).toBe(200);
  return (await response.json() as { brands: Record<string, unknown>[] }).brands;
}
beforeAll(async () => {
  pg = await createTestDatabase();
  await pg.exec("alter table public.agent_profiles add column if not exists public_details jsonb not null default '{}'::jsonb");
  for (const id of [campus, foreignCampus]) await pg.query("insert into universities(id,name,slug,updated_at)values($1,'Synthetic campus '||$1::uuid::text,$1::uuid::text,now())", [id]);
  for (const id of [student, owner]) {
    await pg.query("insert into users(id,email,password_hash,updated_at)values($1,$1::uuid::text||'@example.invalid','synthetic',now())", [id]);
    await pg.query("insert into profiles(id,user_id,university_id,username,display_name,updated_at)values($1,$1,$2,left($1::uuid::text,28),'Synthetic owner',now())", [id, campus]);
  }
  const application = crypto.randomUUID();
  await pg.query("insert into agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement)values($1,$2,$3,'VENDOR','Campus brand','+2348000000000','Synthetic fixture only')", [application, owner, campus]);
  await pg.query(`insert into agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,verified_at,public_details)values($1,$2,$3,$4,'VENDOR','Campus brand',now(),'{"verified":false,"profileImageUrl":"https://example.invalid/brand.jpg"}')`, [brand, owner, campus, application]);
  await pg.query('insert into app_private.featured_brands(institution_id,agent_profile_id,created_by)values($1,$2,$3)', [campus, brand, student]);
}, 60000);
afterAll(async () => { await pg?.close(); });
describe('campus brand identity and verification', () => {
  it('exposes a public service ID and trusted verification in the rail and its destination profile', async () => {
    const rail = await brands();
    expect(rail).toHaveLength(1);
    expect(rail[0]).toMatchObject({ id: brand, agent_type: 'VENDOR', display_name: 'Campus brand', verified: true, profile_image_url: 'https://example.invalid/brand.jpg' });
    const response = await request('/people/services/' + brand), data = await response.json() as any;
    expect(response.status, JSON.stringify(data)).toBe(200);
    expect(data.service).toMatchObject({ id: brand, verified: true });
    for (const field of ['public_details', 'application_id', 'phone_e164', 'statement']) expect(rail[0]).not.toHaveProperty(field);
  });
  it('keeps featured brands scoped to the viewer campus', async () => {
    expect(await brands(foreignCampus)).toEqual([]);
    expect((await request('/people/services/' + brand, foreignCampus)).status).toBe(404);
  });
  it('does not advertise disabled, inactive or deleted brands', async () => {
    await pg.query('update app_private.featured_brands set enabled=false where agent_profile_id=$1', [brand]);
    try { expect(await brands()).toEqual([]); } finally { await pg.query('update app_private.featured_brands set enabled=true where agent_profile_id=$1', [brand]); }
    await pg.query("update agent_profiles set status='PAUSED' where id=$1", [brand]);
    try { expect(await brands()).toEqual([]); } finally { await pg.query("update agent_profiles set status='ACTIVE' where id=$1", [brand]); }
    await pg.query('update profiles set deleted_at=now() where user_id=$1', [owner]);
    try { expect(await brands()).toEqual([]); } finally { await pg.query('update profiles set deleted_at=null where user_id=$1', [owner]); }
  });
  it('hides blocked brands and rejects access to their profiles in both directions', async () => {
    for (const [blocker, blocked] of [[student, owner], [owner, student]]) {
      await pg.query('insert into user_blocks(blocker_id,blocked_id)values($1,$2)', [blocker, blocked]);
      try { expect(await brands()).toEqual([]); expect((await request('/people/services/' + brand)).status).toBe(404); }
      finally { await pg.query('delete from user_blocks where blocker_id=$1 and blocked_id=$2', [blocker, blocked]); }
    }
  });
});
