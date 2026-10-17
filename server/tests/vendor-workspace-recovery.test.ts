import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Hono, type Context, type Next } from 'hono';
import type { PGlite } from '@electric-sql/pglite';
import { testDatabaseAdapter, testSqlClient } from './helpers/database';
import { october6Database } from './helpers/oct6-database';
import { agentRoutes } from '../src/routes/agents';
import { accountRoutes } from '../src/routes/account';
import { studentRoutes } from '../src/routes/student';
import { AppError } from '../src/lib/errors';
import type { Bindings } from '../src/types';
let pg: PGlite, queries = 0;
vi.mock('../src/lib/database', () => ({
  database: () => ({ execute: (statement: Parameters<ReturnType<typeof testDatabaseAdapter>['execute']>[0]) => { queries++; return testDatabaseAdapter(pg).execute(statement); } }),
  sqlClient: () => testSqlClient(pg), firstRow: (r: { rows: unknown[] }) => r.rows[0],
}));
vi.mock('../src/middleware/auth', () => ({
  currentUser: (c: Context) => ({ id: c.req.header('x-user'), universityId: c.req.header('x-campus'), roles: ['STUDENT'] }),
  requireAuth: (c: Context, next: Next) => c.req.header('x-user') ? next() : c.json({ error: 'Unauthorized' }, 401),
}));
const campus = crypto.randomUUID(), foreignCampus = crypto.randomUUID(), owner = crypto.randomUUID(), other = crypto.randomUUID(), buyer = crypto.randomUUID();
const vendor = crypto.randomUUID(), otherVendor = crypto.randomUUID(), foreignVendor = crypto.randomUUID(), tutor = crypto.randomUUID();
const env = { PHASE_3_SCHEMA_READY: 'true', PHASE_2_SCHEMA_READY: 'true', STORE_ENABLED: 'true', TUTORIALS_ENABLED: 'true', UNIFIED_SCHEMA_READY: 'true' } as Bindings;
const app = new Hono().route('/agents', agentRoutes).route('/account', accountRoutes).route('/student', studentRoutes);
app.onError((e, c) => c.json({ error: e.message, details: e instanceof AppError ? e.details : null }, e instanceof AppError ? e.status : 500));
async function req(path: string, expected = 200, method = 'GET', body?: unknown, user = owner, school = campus) {
  const response = await app.request(path, { method, headers: { 'x-user': user, 'x-campus': school, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const result = await response.json(); expect(response.status, JSON.stringify(result)).toBe(expected); return result;
}
async function order(status: string, profile = vendor, school = campus, amount = 100000, date = "now()") {
  const id = crypto.randomUUID();
  await pg.query(`insert into orders(id,university_id,buyer_user_id,vendor_profile_id,status,subtotal_kobo,created_at) values($1,$2,$3,$4,$5,$6,${date})`, [id, school, buyer, profile, status, amount]);
  return id;
}
const draft = { displayName: 'Synthetic shop', description: 'Books and stationery for students.', contactPhoneE164: '+2348012345678', pickupLocation: 'Library entrance', pickupLocations: ['Library entrance', 'Faculty gate'], pickupPlaceId: null, openingHours: {}, defaultPreparationMinutes: 60 };
beforeAll(async () => {
  pg = await october6Database();
  for (const file of ['20261015110000_exclusive_agent_roles.sql', '20261017120000_campus_release.sql'])
    await pg.exec(readFileSync(new URL('../../database/neon/migrations/' + file, import.meta.url), 'utf8'));
  for (const id of [campus, foreignCampus]) await pg.query("insert into universities(id,name,slug,updated_at)values($1,'Synthetic campus '||$1::uuid::text,$1::uuid::text,now())", [id]);
  for (const id of [owner, other, buyer]) await pg.query("insert into users(id,email,password_hash,updated_at)values($1,$1::uuid::text||'@example.invalid','synthetic',now())", [id]);
  for (const [id, user, school, role] of [[vendor, owner, campus, 'VENDOR'], [otherVendor, other, campus, 'VENDOR'], [foreignVendor, other, foreignCampus, 'VENDOR'], [tutor, owner, campus, 'TUTOR']]) {
    const application = crypto.randomUUID();
    await pg.query("insert into agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement)values($1,$2,$3,$4,'Synthetic business','+2348012345678','Synthetic test fixture')", [application, user, school, role]);
    await pg.query("insert into agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,verified_at)values($1,$2,$3,$4,$5,'Synthetic business',now())", [id, user, school, application, role]);
  }
}, 60000);
afterAll(async () => { await pg?.close(); });
it('returns fourteen genuine empty days without the SQL alias error, using two route queries', async () => {
  queries = 0;
  const data = await req('/agents/analytics');
  expect(queries).toBe(2); // authorization and data; the separate session check is mocked here.
  expect(data.trend).toHaveLength(14);
  expect(data.trend.map((d: {day:string}) => d.day)).toEqual([...data.trend.map((d: {day:string}) => d.day)].sort());
  expect(data.trend.every((d: {orders:number;delivered:number;net_kobo:string}) => d.orders === 0 && d.delivered === 0 && Number(d.net_kobo) === 0)).toBe(true);
});
it('counts only this seller’s paid sales, including their share of combined orders and Lagos day boundaries', async () => {
  await order('PAID');
  await order('DELIVERED', vendor, campus, 250000);
  const combined = await order('READY', otherVendor, campus, 900000);
  await pg.query('insert into app_private.order_vendor_allocations(order_id,vendor_profile_id,vendor_user_id,seller_net_kobo,listed_items_kobo)values($1,$2,$3,40000,50000)', [combined, vendor, owner]);
  await order('PENDING_PAYMENT'); await order('CANCELLED'); await order('REFUNDED'); await order('DISPUTED');
  await order('PAID', otherVendor); await order('PAID', foreignVendor, foreignCampus);
  const firstDay = "(((now() at time zone 'Africa/Lagos')::date-13)::timestamp at time zone 'Africa/Lagos')";
  await order('PAID', vendor, campus, 17000, firstDay);
  await order('PAID', vendor, campus, 800000, firstDay + "-interval '1 microsecond'");
  const data = await req('/agents/analytics');
  expect(data.trend.reduce((n: number, d: {orders:number}) => n+d.orders, 0)).toBe(4);
  expect(data.trend.reduce((n: number, d: {delivered:number}) => n+d.delivered, 0)).toBe(1);
  expect(data.trend.reduce((n: number, d: {net_kobo:string}) => n+Number(d.net_kobo), 0)).toBe(407000);
  expect(Number(data.trend[0].net_kobo)).toBe(17000);
  await req('/agents/analytics', 403, 'GET', undefined, owner, foreignCampus);
  await req('/agents/analytics', 403, 'GET', undefined, buyer);
});
it('saves a draft without optional opening hours and preserves all pickup locations on reload', async () => {
  // Legacy active stores may still need the original review flow.
  await pg.query("update vendor_storefronts set status='DRAFT' where vendor_profile_id=$1", [vendor]);
  await req('/agents/storefront', 200, 'PUT', draft);
  const result = await req('/agents/storefront');
  expect(result.vendorProfileId).toBe(vendor);
  expect(result.storefront.opening_hours).toEqual({});
  expect(result.storefront.pickup_locations).toEqual(draft.pickupLocations);
  await req('/agents/storefront/status', 409, 'PATCH', { status: 'SUBMITTED' });
  const invalid = await req('/agents/storefront', 400, 'PUT', { ...draft, openingHours: { schedule: '' } });
  expect(invalid.error).toContain('Opening hours'); expect(invalid.details.fields.openingHours).toBeTruthy();
  await req('/agents/storefront', 200, 'PUT', { ...draft, openingHours: { schedule: 'Mon–Fri 8am–6pm' } });
  await req('/agents/storefront/status', 200, 'PATCH', { status: 'SUBMITTED' });
  await pg.query("update agent_profiles set verified_at=now() where id=$1", [vendor]);
  const approved = await req('/agents/storefront', 200, 'PUT', draft);
  expect(approved.status).toBe('APPROVED');
});
it('checks live role status on every request and restores expired suspensions in the same snapshot', async () => {
  queries = 0;
  expect((await req('/account/capabilities')).profiles).toHaveLength(2); expect(queries).toBe(1);
  await pg.query("update agent_profiles set status='PAUSED',suspension_ends_at=now()+interval '2 days',suspension_reason='Synthetic hold' where id=$1", [vendor]);
  expect((await req('/account/capabilities')).profiles.find((p: {id:string}) => p.id === vendor).status).toBe('PAUSED');
  await req('/agents/analytics');
  await req('/agents/storefront', 403, 'PUT', draft);
  await pg.query("update agent_profiles set status='SUSPENDED',suspension_ends_at=null where id=$1", [vendor]);
  await req('/agents/analytics', 403);
  expect((await req('/account/capabilities')).profiles.map((p: {id:string}) => p.id)).toEqual([tutor]);
  await pg.query("update agent_profiles set status='PAUSED',suspension_ends_at=now()-interval '1 minute' where id=$1", [vendor]);
  const restored = (await req('/account/capabilities')).profiles.find((p: {id:string}) => p.id === vendor);
  expect(restored.status).toBe('ACTIVE'); expect(restored.suspension_ends_at).toBeNull();
  await req('/agents/storefront', 200, 'PUT', draft);
  await pg.query("update agent_profiles set status='PAUSED',suspension_ends_at=now()-interval '1 minute' where id=$1", [vendor]);
  await req('/agents/storefront', 200, 'PUT', draft);
  expect((await pg.query<{status:string}>('select status from agent_profiles where id=$1',[vendor])).rows[0].status).toBe('ACTIVE');
});

it('searches tutors and every material type before applying result limits, without exposing other campuses or blocked tutors', async () => {
  await pg.query("update agent_profiles set display_name='Ada Calculus',biography='Physics and engineering',public_details='{\"categories\":[\"Physics\",\"MTH101\"]}' where id=$1", [tutor]);
  const resources: Record<string, string> = {};
  for (const type of ['VIDEO', 'PDF', 'AUDIOBOOK', 'NOTE', 'PAST_QUESTION']) {
    const id = crypto.randomUUID(); resources[type] = id;
    await pg.query("insert into tutorial_resources(id,university_id,tutor_profile_id,course_code,title,description,resource_type,access_model,price_kobo,publisher_name,status,subject,parts)values($1,$2,$3,'MTH101','Calculus introduction','Learn derivatives and limits',$4,'FREE',0,'Ada Calculus','PUBLISHED','Physics',$5::jsonb)", [id, campus, tutor, type, type === 'AUDIOBOOK' ? JSON.stringify([{title:'Limits',mediaId:crypto.randomUUID()},{title:'Derivatives',mediaId:crypto.randomUUID()}]) : '[]']);
  }
  expect((await req('/student/tutors?q=ada%20physics')).tutors.map((p: {id:string}) => p.id)).toEqual([tutor]);
  expect((await req('/student/tutors?q=physics', 200, 'GET', undefined, owner, foreignCampus)).tutors).toEqual([]);
  for (const [query, type] of [['videos physics','VIDEO'], ['pdf calculus','PDF'], ['audiobooks limits','AUDIOBOOK'], ['playbook derivatives','AUDIOBOOK'], ['notes calculus','NOTE'], ['past questions','PAST_QUESTION']]) {
    const found = (await req('/student/tutorials?q=' + encodeURIComponent(query))).resources;
    expect(found.map((r: {id:string}) => r.id), query).toContain(resources[type]);
    if (type !== 'PDF') expect(found).toHaveLength(1);
  }
  expect((await req('/student/tutorials?q=materials')).resources).toHaveLength(5);
  queries = 0;
  expect((await req('/student/tutorials?q=no-such-material')).resources).toEqual([]);
  expect(queries).toBe(2); // Empty searches do not wait for payment-provider readiness.
  await pg.query("update tutorial_resources set title='Calculus 100% introduction' where id=$1", [resources.PDF]);
  expect((await req('/student/tutorials?q=%25')).resources.map((r: {id:string}) => r.id)).toEqual([resources.PDF]);
  await pg.query('insert into user_blocks(blocker_id,blocked_id)values($1,$2)', [buyer, owner]);
  expect((await req('/student/tutors?q=ada', 200, 'GET', undefined, buyer)).tutors).toEqual([]);
  expect((await req('/student/tutorials?q=calculus', 200, 'GET', undefined, buyer)).resources).toEqual([]);
});
