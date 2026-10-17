import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { AppError } from '../lib/errors';
const stub = vi.hoisted(() => ({ execute: vi.fn(), scope: '22222222-2222-4222-8222-222222222222', user: { id: '11111111-1111-4111-8111-111111111111', universityId: '22222222-2222-4222-8222-222222222222' } }));
vi.mock('../middleware/auth', () => ({ requireAuth: async (_c, next) => next(), currentUser: () => stub.user }));
vi.mock('../lib/database', () => ({ database: () => ({ execute: stub.execute }), firstRow: (r) => r.rows[0], sqlClient: vi.fn() }));
vi.mock('../lib/admin-access', () => ({ resolveAdminScope: async () => stub.scope }));
import { publicBadgeAdminRoutes } from './public-badges';
import { studentGroupRoutes } from './student-groups';
const db = new PGlite(), dialect = new PgDialect();
const person = '33333333-3333-4333-8333-333333333333', group = '44444444-4444-4444-8444-444444444444', post = '55555555-5555-4555-8555-555555555555', key = '66666666-6666-4666-8666-666666666666';
const migration = readFileSync(new URL('../../../database/neon/migrations/20261017183000_alumni_public_badges.sql', import.meta.url), 'utf8');
const app = new Hono();
app.use('*', async (c, next) => { c.set('requestId', 'fixture'); await next(); });
app.route('/badges', publicBadgeAdminRoutes);
app.route('/groups', studentGroupRoutes);
app.onError((e, c) => c.json({ error: e.message }, e instanceof AppError ? e.status : 500));
const env = {};
beforeAll(async () => {
    await db.exec(`create schema app_private;
    create table users(id uuid primary key,deleted_at timestamptz);
    create table profiles(user_id uuid primary key,university_id uuid,display_name text,username text,profile_image_url text,verification_status text,public_badge_verified boolean,updated_at timestamptz,deleted_at timestamptz);
    create table app_private.audit_events(actor_user_id uuid,university_id uuid,action text,target_type text,target_id text,request_id text,outcome text,metadata jsonb);
    create table student_groups(id uuid primary key,institution_id uuid,owner_user_id uuid,kind text,members_can_post boolean);
    create table student_group_members(group_id uuid,user_id uuid,role text,joined_at timestamptz,notifications_enabled boolean);
    create table student_group_posts(id uuid primary key,group_id uuid,institution_id uuid);
    create table student_group_comments(id uuid primary key default gen_random_uuid(),post_id uuid,group_id uuid,institution_id uuid,author_user_id uuid,body text,media_id uuid,created_at timestamptz default now());
    insert into users values('${person}',null);
    insert into profiles(user_id,university_id,display_name,verification_status,public_badge_verified) values('${person}','${stub.scope}','Graduate','PENDING',false);
    insert into student_groups values('${group}','${stub.scope}','${stub.user.id}','COMMUNITY',true);
    insert into student_group_members values('${group}','${stub.user.id}','MEMBER',now(),true);
    insert into student_group_posts values('${post}','${group}','${stub.scope}');`);
    await db.exec(migration);
    await db.exec(migration);
}, 30000);
beforeEach(async () => {
    stub.scope = stub.user.universityId;
    stub.execute.mockReset().mockImplementation((statement) => { const q = dialect.sqlToQuery(statement); return db.query(q.sql, q.params); });
    await db.exec(`update profiles set public_badge_verified=false,public_badge_kind='STANDARD';delete from app_private.audit_events;delete from student_group_comments;`);
});
afterAll(async () => { await db.close(); });
const change = (patch = {}) => app.request('/badges/' + person, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verified: true, kind: 'ALUMNI', expected: false, expectedKind: 'STANDARD', reason: 'Confirmed graduation record', ...patch }) }, env);
it('assigns a purple Alumni identity with an atomic audit while preserving identity verification', async () => {
    const response = await change();
    expect(response.status).toBe(200);
    expect((await response.json()).badge).toMatchObject({ verified: true, kind: 'ALUMNI' });
    expect((await db.query('select verification_status from profiles')).rows).toEqual([{ verification_status: 'PENDING' }]);
    expect((await db.query('select metadata from app_private.audit_events')).rows[0]).toMatchObject({ metadata: { kind: 'ALUMNI', previousKind: 'STANDARD' } });
});
it('rejects stale kind decisions and cross-campus assignments', async () => {
    await change();
    expect((await change({ expected: true, expectedKind: 'STANDARD', kind: 'STANDARD' })).status).toBe(409);
    stub.scope = '77777777-7777-4777-8777-777777777777';
    expect((await change()).status).toBe(403);
});
it('rejects invented badge types and retains existing legacy controls', async () => {
    expect((await change({ kind: 'ADMIN' })).status).toBe(400);
    expect((await change({ kind: 'STANDARD' })).status).toBe(200);
});
it('deduplicates a shared-composer comment retry and keeps the campus binding', async () => {
    const send = () => app.request(`/groups/${group}/posts/${post}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'Thanks for the update', requestId: key }) }, env);
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    expect((await db.query('select body,institution_id from student_group_comments')).rows).toEqual([{ body: 'Thanks for the update', institution_id: stub.scope }]);
});
