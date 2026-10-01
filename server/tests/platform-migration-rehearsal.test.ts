import {readFileSync}from"node:fs";
import {createHash}from"node:crypto";
import{afterAll,beforeAll,describe,it,expect}from"vitest";
import type{PGlite}from"@electric-sql/pglite";
import{createTestDatabase}from"./helpers/database";
let db:PGlite;
const root=new URL("../../",import.meta.url);
const manifest=JSON.parse(readFileSync(new URL("database/verification/2026-09-30-migration-manifest.json",root),"utf8"))as{migrations:{version:string;path:string;sha256:string;gitBlobSha:string;status:string}[]};
const queued=manifest.migrations.filter(m=>m.status==="queued_in_this_update");
beforeAll(async()=>{
 db=await createTestDatabase();
 await db.exec(readFileSync(new URL("database/neon/migrations/20260912200000_phase_3_commerce_foundation.sql",root),"utf8"));
 for(const migration of queued){
  if(!/^database\/neon\/migrations\/\d{14}_[a-z0-9_]+\.sql$/.test(migration.path))throw new Error("Invalid migration path");
  const bytes=readFileSync(new URL(migration.path,root));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(migration.sha256);
  expect(createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest("hex")).toBe(migration.gitBlobSha);
  await db.exec(bytes.toString("utf8"));
 }
});
afterAll(async()=>{await db?.close();});
describe("ordered platform migration rehearsal",()=>{
 it("applies the exact twelve new versions together on the schema-only baseline",async()=>{
  expect(queued).toHaveLength(12);expect(queued.map(m=>m.version)).toEqual(queued.map(m=>m.version).sort());
  const tables=(await db.query<{name:string}>("select tablename name from pg_tables where schemaname='app_private'")).rows.map(r=>r.name);
  expect(tables).toEqual(expect.arrayContaining(["staff_account_provisions","operations_documents","managed_publishers","agent_identity_submissions","order_price_snapshots","tutorial_material_purchases","agent_payout_settlements"]));
  const columns=(await db.query<{column_name:string}>("select column_name from information_schema.columns where table_schema='public'and table_name='product_events'")).rows.map(r=>r.column_name);expect(columns).toEqual(expect.arrayContaining(["platform","action","component","percent_scrolled"]));
  expect((await db.query("select conname from pg_constraint where conname in('media_objects_kind_check','product_events_event_name_check')and not convalidated")).rows).toHaveLength(0);
 });
 it("does not seed staff grants, broadcast authority or financial pricing and keeps new private tables inaccessible to PUBLIC",async()=>{
  for(const table of ["staff_account_provisions","operations_documents","managed_publishers","agent_identity_submissions"]){
   expect((await db.query<{count:number}>(`select count(*)::int count from app_private.${table}`)).rows[0]!.count).toBe(0);
   expect((await db.query<{public_access:number}>("select count(*)::int public_access from pg_class t cross join lateral aclexplode(coalesce(t.relacl,acldefault('r',t.relowner)))a where t.oid=$1::regclass and a.grantee=0",["app_private."+table])).rows[0]!.public_access).toBe(0);
  }
  expect((await db.query<{public_execute:number}>("select count(*)::int public_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where n.nspname='app_private'and p.proname in('provision_staff_account','reserve_managed_publisher_post','post_finance_journal','create_material_purchase','record_kira_receipt')and a.grantee=0 and a.privilege_type='EXECUTE'")).rows[0]!.public_execute).toBe(0);
 });
});
