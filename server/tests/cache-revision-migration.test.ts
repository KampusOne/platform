import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../database/neon/migrations/20261010120000_versioned_read_cache.sql",import.meta.url),"utf8");
let db: PGlite;
const a="11111111-1111-4111-8111-111111111111", b="22222222-2222-4222-8222-222222222222";
async function revision(resource: string) { return Number((await db.query<{revision:bigint}>("select revision from app_private.cache_resource_revisions where resource=$1",[resource])).rows[0]!.revision); }
async function mapRevision(campus: string) { return (await db.query<{map_revision:number}>("select map_revision from public.institution_campuses where id=$1",[campus])).rows[0]!.map_revision; }
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create schema app_private; create table public.institution_campuses(id uuid primary key,map_revision int not null default 1,name text,updated_at timestamptz default now());");
  for (const table of ["universities","faculties","departments","courses","product_categories","notification_sounds","media_objects","website_articles"])
    await db.exec(`create table public.${table}(id uuid primary key,name text);`);
  for (const table of ["campus_places","campus_map_features","campus_paths","campus_entrances","campus_place_media"])
    await db.exec(`create table public.${table}(id uuid primary key,campus_id uuid,name text);`);
  await db.exec("create table app_private.campus_map_controls(campus_id uuid primary key,enabled boolean); create table app_private.website_article_likes(id uuid primary key); create table app_private.website_settings(id uuid primary key);");
  await db.exec(migration);
  await db.exec(`insert into public.institution_campuses(id,name)values('${a}','A'),('${b}','B');`);
},30_000);
afterAll(async () => { await db.close(); });
describe("transactional cache invalidation", () => {
  it("bumps academic revisions with direct catalog edits and rolls back together",async()=>{
    const start=await revision("academic.catalog");
    await db.exec(`begin;insert into public.courses(id,name)values('${crypto.randomUUID()}','Synthetic');`);
    expect(await revision("academic.catalog")).toBe(start+1);
    await db.exec("rollback;");
    expect(await revision("academic.catalog")).toBe(start);
    expect((await db.query("select * from public.courses")).rows).toHaveLength(0);
  });
  it("invalidates a bulk import once per campus statement and covers movement/deletion",async()=>{
    const beforeA=await mapRevision(a),beforeB=await mapRevision(b);
    await db.query("insert into public.campus_places(id,campus_id,name)select gen_random_uuid(),$1,'Synthetic '||n from generate_series(1,1000)n",[a]);
    expect(await mapRevision(a)).toBe(beforeA+1);expect(await mapRevision(b)).toBe(beforeB);
    const row=(await db.query<{id:string}>("select id from public.campus_places limit 1")).rows[0]!;
    await db.query("update public.campus_places set campus_id=$1 where id=$2",[b,row.id]);
    expect(await mapRevision(a)).toBe(beforeA+2);expect(await mapRevision(b)).toBe(beforeB+1);
    await db.query("delete from public.campus_places where id=$1",[row.id]);
    expect(await mapRevision(b)).toBe(beforeB+2);
  });
  it("covers paths, geometry, entrances, media and controls without route-specific hooks",async()=>{
    for(const table of ["public.campus_paths","public.campus_map_features","public.campus_entrances","public.campus_place_media"]){
      const before=await mapRevision(a),key=crypto.randomUUID();
      await db.query(`insert into ${table}(id,campus_id,name)values($1,$2,'Synthetic')`,[key,a]);
      await db.query(`update ${table} set name='Updated' where id=$1`,[key]);
      await db.query(`delete from ${table} where id=$1`,[key]);
      expect(await mapRevision(a)).toBe(before+3);
    }
    const before=await mapRevision(a);
    await db.query("insert into app_private.campus_map_controls(campus_id,enabled)values($1,true)",[a]);
    expect(await mapRevision(a)).toBe(before+1);
  });
  it("keeps campus metadata revisions monotonic, including older explicit revisions",async()=>{
    const before=await mapRevision(a);
    await db.query("update public.institution_campuses set name='New name' where id=$1",[a]);
    expect(await mapRevision(a)).toBe(before+1);
    await db.query("update public.institution_campuses set map_revision=1 where id=$1",[a]);
    expect(await mapRevision(a)).toBe(before+2);
  });
  it("invalidates publication/likes/categories/sounds/media deletions and is rerunnable",async()=>{
    for(const [table,resource] of [["public.website_articles","website.articles"],["app_private.website_article_likes","website.articles"],["app_private.website_settings","website.settings"],["public.product_categories","commerce.categories"],["public.notification_sounds","notification.sounds"]]){
      const before=await revision(resource!);
      await db.query(`insert into ${table}(id)values($1)`,[crypto.randomUUID()]);
      expect(await revision(resource!)).toBe(before+1);
    }
    const key=crypto.randomUUID();await db.query("insert into public.media_objects(id)values($1)",[key]);
    const before=await revision("notification.sounds");await db.query("delete from public.media_objects where id=$1",[key]);
    expect(await revision("notification.sounds")).toBe(before+1);
    const catalog=await revision("academic.catalog");await db.exec(migration);expect(await revision("academic.catalog")).toBe(catalog);
    const privacy=(await db.query<{relrowsecurity:boolean;public_granted:boolean}>("select relrowsecurity,exists(select 1 from information_schema.role_table_grants where table_schema='app_private'and table_name='cache_resource_revisions'and grantee='PUBLIC')public_granted from pg_class where oid='app_private.cache_resource_revisions'::regclass")).rows[0];
    expect(privacy).toEqual({relrowsecurity:true,public_granted:false});
  });
});
