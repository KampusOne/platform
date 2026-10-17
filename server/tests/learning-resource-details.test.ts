import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { Hono, type Context, type Next } from 'hono';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, testDatabaseAdapter, testSqlClient } from './helpers/database';
import { studentRoutes } from '../src/routes/student';
import { AppError } from '../src/lib/errors';
import type { Bindings } from '../src/types';

let pg: PGlite;
vi.mock('../src/lib/database', () => ({ database: () => testDatabaseAdapter(pg), sqlClient: () => testSqlClient(pg), firstRow: (r: { rows: unknown[] }) => r.rows[0] }));
vi.mock('../src/middleware/auth', () => ({ currentUser: (c: Context) => ({ id: c.req.header('x-user'), universityId: c.req.header('x-campus'), roles: ['STUDENT'] }), requireAuth: async (_c: Context, next: Next) => next() }));
const campus = crypto.randomUUID(), otherCampus = crypto.randomUUID(), owner = crypto.randomUUID(), student = crypto.randomUUID(), tutor = crypto.randomUUID();
const env = { TUTORIALS_ENABLED: 'true', PHASE_2_SCHEMA_READY: 'true', UNIFIED_SCHEMA_READY: 'true' } as Bindings;
const app = new Hono().route('/student', studentRoutes);
app.onError((e, c) => c.json({ error: e.message }, e instanceof AppError ? e.status : 500));
async function request(resource: string, { user = student, institution = campus, saved }: { user?: string; institution?: string; saved?: boolean } = {}) {
  return app.request(`/student/tutorial-resources/${resource}${saved === undefined ? '' : '/save'}`, {
    method: saved === undefined ? 'GET' : 'PUT', headers: { 'x-user': user, 'x-campus': institution, 'content-type': 'application/json' },
    ...(saved === undefined ? {} : { body: JSON.stringify({ saved }) }),
  }, env);
}
async function resource() {
  const id = crypto.randomUUID();
  await pg.query(`insert into tutorial_resources(id,university_id,tutor_profile_id,course_code,title,description,resource_type,access_model,publisher_name,publisher_verified,status,cover_url,subject)
    values($1,$2,$3,'GET201','Fluid mechanics','A fluid mechanics workbook.','PDF','FREE','An old publisher name',true,'PUBLISHED','https://example.invalid/cover.jpg','Engineering')`, [id, campus, tutor]);
  return id;
}
async function detail(id: string, options = {}) {
  const response = await request(id, options), body = await response.json() as any;
  expect(response.status, JSON.stringify(body)).toBe(200); return body.resource;
}
beforeAll(async () => {
  pg = await createTestDatabase();
  await pg.exec("alter table public.agent_profiles add column if not exists public_details jsonb not null default '{}'::jsonb");
  for (const id of [campus, otherCampus]) await pg.query("insert into universities(id,name,slug,updated_at)values($1,'Synthetic campus '||$1::uuid::text,$1::uuid::text,now())", [id]);
  for (const id of [owner, student]) {
    await pg.query("insert into users(id,email,password_hash,updated_at)values($1,$1::uuid::text||'@example.invalid','synthetic',now())", [id]);
    await pg.query("insert into profiles(id,user_id,university_id,username,display_name,profile_image_url,updated_at)values($1,$1,$2,left($1::uuid::text,28),'Synthetic student','https://example.invalid/student.jpg',now())", [id, campus]);
  }
  const application = crypto.randomUUID();
  await pg.query("insert into agent_applications(id,user_id,university_id,agent_type,display_name,phone_e164,statement)values($1,$2,$3,'TUTOR','Current Tutor','+2348000000000','Synthetic test fixture only')", [application, owner, campus]);
  await pg.query(`insert into agent_profiles(id,user_id,university_id,application_id,agent_type,display_name,verified_at,public_details)values($1,$2,$3,$4,'TUTOR','Current Tutor',now(),'{"profileImageUrl":"https://example.invalid/tutor.jpg","privateExample":"must not be returned"}')`, [tutor, owner, campus, application]);
});
afterAll(async () => { await pg?.close(); });
describe('learning resource tutor identity', () => {
  it('returns the current tutor identity and verified state in one private response', async () => {
    const id = await resource(), response = await request(id), body = await response.json() as any;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(body.resource).toMatchObject({ tutor_profile_id: tutor, tutor_name: 'Current Tutor', tutor_image_url: 'https://example.invalid/tutor.jpg', tutor_verified: true, is_saved: false, can_access: true });
    for (const field of ['public_details', 'privateExample', 'phone_e164', 'settings']) expect(body.resource).not.toHaveProperty(field);
  });
  it('uses the current tutor verification rather than a stale publisher flag and falls back to the owner photo', async () => {
    const id = await resource();
    await pg.query("update tutorial_resources set publisher_verified=false where id=$1", [id]);
    await pg.query("update agent_profiles set public_details='{}'::jsonb where id=$1", [tutor]);
    try { expect(await detail(id)).toMatchObject({ publisher_verified: false, tutor_verified: true, tutor_image_url: 'https://example.invalid/student.jpg' }); }
    finally { await pg.query(`update agent_profiles set public_details='{"profileImageUrl":"https://example.invalid/tutor.jpg"}' where id=$1`, [tutor]); }
  });
  it('persists bookmarks per viewer and reflects both save and removal on reload', async () => {
    const id = await resource();
    expect((await request(id, { saved: true })).status).toBe(200);
    expect((await detail(id)).is_saved).toBe(true);
    expect((await detail(id, { user: owner })).is_saved).toBe(false);
    expect((await request(id, { saved: false })).status).toBe(200);
    expect((await detail(id)).is_saved).toBe(false);
  });
  it('keeps resources hidden outside their campus and across blocks in either direction', async () => {
    const id = await resource();
    expect((await request(id, { institution: otherCampus })).status).toBe(404);
    for (const [blocker, blocked] of [[owner, student], [student, owner]]) {
      await pg.query('insert into user_blocks(blocker_id,blocked_id)values($1,$2)', [blocker, blocked]);
      try { expect((await request(id)).status).toBe(404); }
      finally { await pg.query('delete from user_blocks where blocker_id=$1 and blocked_id=$2', [blocker, blocked]); }
    }
  });
  it('hides inactive tutors and rejects malformed resource links', async () => {
    const id = await resource();
    await pg.query("update agent_profiles set status='PAUSED' where id=$1", [tutor]);
    try { expect((await request(id)).status).toBe(404); }
    finally { await pg.query("update agent_profiles set status='ACTIVE' where id=$1", [tutor]); }
    expect((await request('not-an-id')).status).toBe(400);
  });
});
