import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { Hono, type Context, type Next } from 'hono';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, testDatabaseAdapter } from './helpers/database';
import { agentRoutes } from '../src/routes/agents';
import { AppError } from '../src/lib/errors';
import type { Bindings } from '../src/types';

let pg: PGlite;
vi.mock('../src/lib/database', () => ({ database: () => testDatabaseAdapter(pg), firstRow: (r: { rows: unknown[] }) => r.rows[0] }));
vi.mock('../src/middleware/auth', () => ({ currentUser: (c: Context) => ({ id: c.req.header('x-user'), universityId: c.req.header('x-campus'), roles: ['STUDENT'] }), requireAuth: async (_c: Context, next: Next) => next() }));
const campus = crypto.randomUUID(), secondCampus = crypto.randomUUID(), owner = crypto.randomUUID(), other = crypto.randomUUID();
const tutor = crypto.randomUUID(), secondTutor = crypto.randomUUID(), image = crypto.randomUUID(), foreignImage = crypto.randomUUID(), document = crypto.randomUUID();
const cover = `https://example.invalid/v1/media/${image}?v=3`;
const env = { TUTORIALS_ENABLED: 'true', PHASE_2_SCHEMA_READY: 'true', PAYMENTS_ENABLED: 'true' } as Bindings;
const app = new Hono().route('/agents', agentRoutes);
app.onError((error, c) => c.json({ error: error.message }, error instanceof AppError ? error.status : 500));
async function request(path: string, method = 'GET', body?: unknown, user = owner, institution = campus) {
  const response = await app.request('/agents' + path, { method, headers: { 'x-user': user, 'x-campus': institution, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  return { status: response.status, body: await response.json() as any };
}
async function resource(status = 'PUBLISHED') {
  const id = crypto.randomUUID();
  await pg.query(`insert into tutorial_resources(id,university_id,tutor_profile_id,course_code,title,description,resource_type,access_model,price_kobo,publisher_name,publisher_verified,media_object_id,status,cover_url,subject,parts)
    values($1,$2,$3,'MTH101','Calculus notes','An introductory calculus workbook.','PDF','PAID',25000,'Synthetic tutor',true,$4,$5,$6,'Mathematics',$7::jsonb)`,
  [id, campus, tutor, document, status, cover, JSON.stringify([{ mediaId: document, title: 'Chapter one' }])]);
  return id;
}
async function row(id: string, material = true) {
  return (await pg.query<any>(`select *,updated_at::text as revision from ${material ? 'tutorial_resources' : 'tutorial_listings'} where id=$1`, [id])).rows[0];
}
async function edit(id: string, extra = {}) {
  const current = await row(id);
  return { title: current.title, description: current.description, courseCode: current.course_code, subject: current.subject,
    accessModel: current.access_model, priceKobo: current.price_kobo, coverUrl: current.cover_url, expectedRevision: current.revision, ...extra };
}
beforeAll(async () => {
  pg = await createTestDatabase();
  for (const id of [campus, secondCampus]) await pg.query("insert into universities(id,name,slug,updated_at)values($1,'Synthetic campus '||$1::uuid::text,$1::uuid::text,now())", [id]);
  for (const [user, profile] of [[owner, tutor], [other, secondTutor]]) {
    await pg.query("insert into users(id,email,password_hash,updated_at)values($1,$1::uuid::text||'@example.invalid','synthetic',now())", [user]);
    await pg.query("insert into profiles(id,user_id,university_id,username,display_name,updated_at)values($1,$1,$2,'fixture_'||substring(replace($1::uuid::text,'-',''),1,20),'Synthetic tutor',now())", [user, campus]);
    const application = crypto.randomUUID();
    await pg.query("insert into agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement)values($1,$2,$3,'TUTOR','Synthetic tutor','+2348000000000','Synthetic test fixture only')", [application, user, campus]);
    await pg.query("insert into agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,verified_at)values($1,$2,$3,$4,'TUTOR','Synthetic tutor',now())", [profile, user, campus, application]);
  }
  for (const [id, user, kind, type] of [[image, owner, 'product', 'image/jpeg'], [foreignImage, other, 'product', 'image/jpeg'], [document, owner, 'resource', 'application/pdf']])
    await pg.query('insert into media_objects(id,owner_user_id,institution_id,kind,object_key,content_type,size_bytes,original_name)values($1,$2,$3,$4,$1::uuid::text,$5,1024,\'Synthetic fixture\')', [id, user, campus, kind, type]);
});
afterAll(async () => { await pg?.close(); });
describe('tutor-owned listing management', () => {
  it('returns the saved cover and exact edit revision on the dashboard', async () => {
    const id = await resource(), response = await request('/tutorials');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.resources.find((r: any) => r.id === id)).toMatchObject({ cover_url: cover, subject: 'Mathematics', revision: (await row(id)).revision });
  });
  it('saves material details without changing its uploaded file, parts or publication status', async () => {
    const id = await resource(), before = await row(id);
    const result = await request('/tutorial-resources/' + id, 'PATCH', await edit(id, { title: 'Revised calculus notes', priceKobo: 35000, coverUrl: null }));
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(await row(id)).toMatchObject({ title: 'Revised calculus notes', price_kobo: 35000, cover_url: null, media_object_id: document, parts: before.parts, status: 'PUBLISHED' });
    expect((await row(id)).revision).not.toBe(before.revision);
    expect((await request('/tutorial-resources/' + id, 'PATCH', await edit(id, { coverUrl: cover }))).status).toBe(200);
  });
  it('rejects stale writes, foreign images, invalid prices and moderation bypasses', async () => {
    const id = await resource(), stale = await edit(id);
    expect((await request('/tutorial-resources/' + id, 'PATCH', { ...stale, title: 'First saved edit' })).status).toBe(200);
    expect((await request('/tutorial-resources/' + id, 'PATCH', { ...stale, title: 'An outdated edit' })).status).toBe(409);
    expect((await request('/tutorial-resources/' + id, 'PATCH', await edit(id, { coverUrl: `https://example.invalid/v1/media/${foreignImage}` }))).status).toBe(409);
    expect((await request('/tutorial-resources/' + id, 'PATCH', await edit(id, { accessModel: 'FREE', priceKobo: 100 }))).status).toBe(400);
    const submitted = await resource('SUBMITTED');
    expect((await request('/tutorial-resources/' + submitted, 'PATCH', await edit(submitted))).status).toBe(409);
  });
  it('checks ownership, current campus, role suspension and malformed identifiers', async () => {
    const id = await resource(), data = await edit(id);
    expect((await request('/tutorial-resources/' + id, 'PATCH', data, other)).status).toBe(409);
    expect((await request('/tutorial-resources/' + id, 'DELETE', undefined, other)).status).toBe(404);
    expect((await request('/tutorial-resources/' + id, 'PATCH', data, owner, secondCampus)).status).toBe(403);
    expect((await request('/tutorial-resources/not-an-id', 'DELETE')).status).toBe(400);
    await pg.query("update agent_profiles set status='PAUSED',suspension_ends_at=now()+interval '1 day' where id=$1", [tutor]);
    try {
      expect((await request('/tutorial-resources/' + id, 'PATCH', data)).status).toBe(403);
      expect((await request('/tutorial-resources/' + id, 'DELETE')).status).toBe(403);
    } finally { await pg.query("update agent_profiles set status='ACTIVE',suspension_ends_at=null where id=$1", [tutor]); }
  });
  it('removes a material idempotently from listings and retains referenced files and saves', async () => {
    const id = await resource();
    await pg.query('insert into learning_saves(user_id,resource_id)values($1,$2)', [other, id]);
    expect((await request('/tutorial-resources/' + id, 'DELETE')).status).toBe(200);
    expect((await request('/tutorial-resources/' + id, 'DELETE')).status).toBe(200);
    expect((await request('/tutorials')).body.resources.some((r: any) => r.id === id)).toBe(false);
    expect(await row(id)).toMatchObject({ status: 'ARCHIVED', media_object_id: document });
    expect((await pg.query('select resource_id from learning_saves where resource_id=$1', [id])).rows).toHaveLength(1);
    expect((await pg.query('select id from media_objects where id=$1 and deleted_at is null', [document])).rows).toHaveLength(1);
  });
  it('edits a tutorial and removes its listing while retaining confirmed bookings', async () => {
    const details = { title: 'Calculus revision', description: 'An introductory calculus revision class.', courseCode: 'MTH101', format: 'IN_PERSON', priceKobo: 25000, capacity: 20, locationText: 'Library', cancellationCutoffHours: 2 };
    const created = await request('/tutorials', 'POST', details), id = created.body.id;
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const before = await row(id, false);
    expect((await request('/tutorials/' + id, 'PATCH', { ...details, title: 'Revised calculus class', expectedRevision: before.revision })).status).toBe(200);
    expect((await request('/tutorials/' + id, 'PATCH', { ...details, expectedRevision: before.revision })).status).toBe(409);
    const booking = crypto.randomUUID();
    await pg.query("insert into tutorial_bookings(id,university_id,listing_id,student_user_id,status,amount_kobo)values($1,$2,$3,$4,'CONFIRMED',25000)", [booking, campus, id, other]);
    expect((await request('/tutorials/' + id, 'DELETE', undefined, other)).status).toBe(404);
    expect((await request('/tutorials/' + id, 'DELETE')).status).toBe(200);
    expect((await request('/tutorials/' + id, 'DELETE')).status).toBe(200);
    expect((await request('/tutorials')).body.listings.some((r: any) => r.id === id)).toBe(false);
    expect((await pg.query('select status,amount_kobo from tutorial_bookings where id=$1', [booking])).rows[0]).toEqual({ status: 'CONFIRMED', amount_kobo: 25000 });
  });
});
