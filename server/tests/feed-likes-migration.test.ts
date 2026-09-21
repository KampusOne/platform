import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

const campus = "10000000-0000-4000-8000-000000000001";
const otherCampus = "10000000-0000-4000-8000-000000000002";
const alice = "20000000-0000-4000-8000-000000000001";
const bob = "20000000-0000-4000-8000-000000000002";
const post = "30000000-0000-4000-8000-000000000001";
const draft = "30000000-0000-4000-8000-000000000002";
const archived = "30000000-0000-4000-8000-000000000003";
const publicPost = "30000000-0000-4000-8000-000000000005";
const scheduled = "30000000-0000-4000-8000-000000000004";
let db: PGlite;
const setLike = (actor: string, desired: boolean, id = post, scope = campus) =>
  db.query<{ id: string; liked: boolean; like_count: number }>(
    "select * from app_private.set_feed_post_like($1::uuid,$2::uuid,$3::uuid,$4::boolean)", [id, actor, scope, desired]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema app_private;
    create table public.users(id uuid primary key);
    create table public.universities(id uuid primary key);
    create table public.feed_posts(id uuid primary key, university_id uuid not null references public.universities(id), status text not null, published_at timestamptz, audience jsonb not null default '{}'::jsonb);
    insert into public.users values('${alice}'),('${bob}');
    insert into public.universities values('${campus}'),('${otherCampus}');
    insert into public.feed_posts(id,university_id,status,published_at) values
      ('${post}','${campus}','PUBLISHED',now()-interval '1 day'),
      ('${draft}','${campus}','DRAFT',now()),
      ('${archived}','${campus}','ARCHIVED',now()),
      ('${scheduled}','${campus}','PUBLISHED',now()+interval '1 day');
    insert into public.feed_posts values('${publicPost}','${otherCampus}','PUBLISHED',now(),'{"visibility":"PUBLIC"}');
  `);
  const migration = await readFile(new URL("../../database/neon/migrations/20260921183000_feed_post_likes.sql", import.meta.url), "utf8");
  await db.exec(migration);
  // Safe to reapply on an environment that already ran the additive migration.
  await db.exec(migration);
}, 30_000);
beforeEach(async () => { await db.exec("delete from public.feed_likes"); });
afterAll(async () => { await db?.close(); });

describe("persistent post-like database invariants", () => {
  it("makes repeated likes and unlikes idempotent", async () => {
    expect((await setLike(alice, true)).rows).toEqual([{ id: post, liked: true, like_count: 1 }]);
    expect((await setLike(alice, true)).rows[0]?.like_count).toBe(1);
    expect((await setLike(alice, false)).rows).toEqual([{ id: post, liked: false, like_count: 0 }]);
    expect((await setLike(alice, false)).rows[0]?.like_count).toBe(0);
  });
  it("keeps other users' likes when one user unlikes", async () => {
    await setLike(alice, true); await setLike(bob, true);
    expect((await setLike(alice, false)).rows).toEqual([{ id: post, liked: false, like_count: 1 }]);
    expect((await setLike(bob, true)).rows[0]?.like_count).toBe(1);
  });
  it("rejects a raw duplicate even outside the API", async () => {
    await setLike(alice, true);
    await expect(db.query("insert into public.feed_likes(post_id,user_id,institution_id) values($1,$2,$3)", [post, alice, campus])).rejects.toThrow();
    expect((await setLike(alice, true)).rows[0]?.like_count).toBe(1);
  });
  it("does not expose or mutate a different campus's post", async () => {
    expect((await setLike(alice, true, post, otherCampus)).rows).toEqual([]);
    expect((await db.query("select * from public.feed_likes")).rows).toEqual([]);
  });
  it("allows a shared public post without misassigning its institution", async () => {
    expect((await setLike(alice, true, publicPost)).rows).toEqual([{ id: publicPost, liked: true, like_count: 1 }]);
    expect((await db.query("select institution_id from public.feed_likes where post_id=$1", [publicPost])).rows).toEqual([{ institution_id: otherCampus }]);
    expect((await setLike(alice, false, publicPost)).rows[0]?.like_count).toBe(0);
  });
  it("enforces the post's institution through a composite foreign key", async () => {
    await expect(db.query("insert into public.feed_likes(post_id,user_id,institution_id) values($1,$2,$3)", [post, alice, otherCampus])).rejects.toThrow();
  });
  it.each([draft, archived, scheduled, "30000000-0000-4000-8000-999999999999"])("rejects unavailable post %s", async (id) => {
    expect((await setLike(alice, true, id)).rows).toEqual([]);
  });
  it("rolls back a mutation that fails its user foreign key", async () => {
    await expect(setLike("20000000-0000-4000-8000-999999999999", true)).rejects.toThrow();
    expect((await db.query("select * from public.feed_likes")).rows).toEqual([]);
  });
});
