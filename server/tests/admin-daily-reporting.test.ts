import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, testDatabaseAdapter, testSqlClient } from "./helpers/database";
import { app } from "../src/app";
import { createSession } from "../src/services/sessions";
import { lagosDay, reportWindow } from "../src/lib/admin-reporting";
import { captureDailyAppReports } from "../src/services/admin-report-snapshots";
import type { Bindings } from "../src/types";
let db: PGlite;
vi.mock("../src/lib/database", () => ({ database: () => testDatabaseAdapter(db), sqlClient: () => testSqlClient(db), firstRow: (r:{rows:unknown[]}) => r.rows[0] }));
const campus=crypto.randomUUID(),foreignCampus=crypto.randomUUID(),admin=crypto.randomUUID(),analyst=crypto.randomUUID(),ordinary=crypto.randomUUID(),vendor=crypto.randomUUID(),application=crypto.randomUUID(),vendorProfile=crypto.randomUUID();
const tokens=new Map<string,string>();
const env:Bindings={ENVIRONMENT:"local",ALLOWED_ORIGINS:"https://portal.example.invalid",MINIMUM_APP_VERSION:"1",MAINTENANCE_MODE:"false",ACADEMIC_CORE_ENABLED:"true",SOCIAL_FEED_ENABLED:"true",MARKETPLACE_ENABLED:"false",PAYMENTS_ENABLED:"false",AI_ASSISTANT_ENABLED:"false",UNIFIED_SCHEMA_READY:"true",PHASE_2_SCHEMA_READY:"true",JWT_SECRET:"test-only-daily-report-jwt-secret-123456789012345678"};
async function request(path:string,actor=admin,method="GET",body?:unknown){return app.request("https://api.example.invalid/v1"+path,{method,headers:{Authorization:"Bearer "+tokens.get(actor),"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})},env);}
async function result(r:Response,status=200){const data=await r.json();expect({status:r.status,...(r.status===status?{}:{data})}).toEqual({status});return data;}
beforeAll(async()=>{
 db=await createTestDatabase();
 await db.exec(readFileSync(new URL("../../database/neon/migrations/20261001020000_admin_workspace_extensions.sql",import.meta.url),"utf8"));
 for(const[id,name]of[[campus,"Report campus"],[foreignCampus,"Other report campus"]])await db.query("insert into public.universities(id,name,slug,updated_at)values($1,$2,$3,now())",[id,name,"report-"+id]);
 for(const[i,id]of[admin,analyst,ordinary,vendor].entries()){
  await db.query("insert into public.users(id,email,password_hash,email_verified_at,created_at,updated_at)values($1,$2,'test-only',now(),'2025-01-01',now())",[id,`report${i}@example.invalid`]);
  await db.query("insert into public.profiles(id,user_id,display_name,username,university_id,updated_at)values(gen_random_uuid(),$1,$2,$3,$4,now())",[id,"Report "+i,"report"+i,campus]);
  tokens.set(id,(await createSession(env,{id,email:`report${i}@example.invalid`,roles:["STUDENT"],operatorRoles:[],universityId:campus})).accessToken);
 }
 await db.query("insert into public.operator_roles(user_id,role)values($1,'PLATFORM_ADMIN')",[admin]);
 await db.query("insert into app_private.staff_access(user_id,permissions,university_ids,all_universities,updated_by)values($1,$2,$3,false,$4)",[analyst,["overview.view","analytics.view"],[campus],admin]);
 await db.query("insert into public.agent_applications(id,university_id,user_id,agent_type,display_name,phone_e164,statement,status)values($1,$2,$3,'VENDOR','Report vendor','+2348000000001','Report test business','SUBMITTED')",[application,campus,vendor]);
 await db.query("insert into public.agent_profiles(id,university_id,user_id,application_id,agent_type,display_name,verified_at)values($1,$2,$3,$4,'VENDOR','Report vendor',now())",[vendorProfile,campus,vendor,application]);
});
afterAll(async()=>{await db?.close();});
describe("daily app records, finance and contextual reporting",()=>{
 it("uses Nigerian midnight, rejects impossible/future dates and preserves historical report dates",()=>{
  expect(lagosDay(new Date("2026-10-02T23:30:00Z"))).toBe("2026-10-03");
  expect(reportWindow("2026-10-02",new Date("2026-10-03T09:00:00Z"))).toEqual({day:"2026-10-02",start:"2026-10-01T23:00:00.000Z",end:"2026-10-02T23:00:00.000Z"});
  expect(()=>reportWindow("2026-02-30")).toThrow();expect(()=>reportWindow("2099-01-01")).toThrow();
 });
 it("counts successful signins and measured activity at WAT boundaries without leaking another campus",async()=>{
  for(const[uni,at]of[[campus,"2026-10-01T23:01:00Z"],[campus,"2026-10-02T23:01:00Z"],[foreignCampus,"2026-10-02T12:00:00Z"]]){
   await db.query("insert into app_private.audit_events(actor_user_id,university_id,action,target_type,outcome,occurred_at)values($1,$2,'auth.signin','session','succeeded',$3)",[ordinary,uni,at]);
   await db.query("insert into public.product_events(user_id,institution_id,event_name,screen,client_request_id,created_at)values($1,$2,'screen_view','feed',gen_random_uuid(),$3)",[ordinary,uni,at]);
  }
  const data=await result(await request("/admin/reports/daily?date=2026-10-02",analyst));
  expect(data.report.counts.signed_in_users).toBe(1);expect(data.report.counts.recorded_activities).toBe(1);expect(data.report.finance).toBeNull();expect(data.report.timeZone).toBe("Africa/Lagos");
  expect((await db.query("select day from app_private.daily_app_reports where scope_key=$1",[campus])).rows).toHaveLength(1);
  await result(await request("/admin/reports/daily?universityId="+foreignCampus,analyst),403);
  await result(await request("/admin/reports/daily",ordinary),403);
  await result(await request("/admin/reports/daily?date=2026-02-30"),400);
 });
 it("captures real product edits and first approvals without counting no-op updates",async()=>{
  const product=crypto.randomUUID();
  await db.query("insert into public.vendor_products(id,university_id,vendor_profile_id,name,description,category,price_kobo)values($1,$2,$3,'Test product','Detailed test product description','Books',550000)",[product,campus,vendorProfile]);
  await db.query("update public.vendor_products set name=name where id=$1",[product]);
  await db.query("update public.vendor_products set price_kobo=560000 where id=$1",[product]);
  await db.query("update public.agent_applications set status='APPROVED'where id=$1",[application]);
  await db.query("update public.agent_applications set status='APPROVED'where id=$1",[application]);
  const rows=(await db.query<{event_name:string;count:number}>("select event_name,count(*)::int count from app_private.admin_record_events where institution_id=$1 group by event_name",[campus])).rows;
  expect(rows.find(r=>r.event_name==="product_created")?.count).toBe(1);expect(rows.find(r=>r.event_name==="product_updated")?.count).toBe(1);expect(rows.find(r=>r.event_name==="agent_approved")?.count).toBe(1);
  await expect(db.query("delete from app_private.admin_record_events where subject_id=$1",[product])).rejects.toThrow(/append-only/);
 });
 it("writes each expense once in a balanced append-only journal, rejects changed retries and enforces finance permissions",async()=>{
  const body={requestId:crypto.randomUUID(),universityId:campus,category:"Hosting",description:"October hosting cost",amountKobo:10000,incurredOn:"2026-10-02"};
  const one=await result(await request("/admin/finance/reporting/expenses",admin,"POST",body),201),two=await result(await request("/admin/finance/reporting/expenses",admin,"POST",body),201);expect(one.id).toBe(two.id);
  expect((await db.query<{balanced:boolean}>("select app_private.validate_balanced_ledger_transaction($1) balanced",[one.journal_id])).rows[0]?.balanced).toBe(true);
  expect((await db.query("select * from public.ledger_lines where transaction_id=$1",[one.journal_id])).rows).toHaveLength(2);
  await result(await request("/admin/finance/reporting/expenses",admin,"POST",{...body,amountKobo:20000}),409);
  await result(await request("/admin/finance/reporting/expenses",analyst,"POST",body),403);
  await expect(db.query("update app_private.operations_expenses set amount_kobo=1 where id=$1",[one.id])).rejects.toThrow(/append-only/);
  const report=await result(await request("/admin/finance/reporting?universityId="+campus));expect(report.summary.expenses_kobo).toBe(10000);expect(report.summary.profit_kobo).toBe(-10000);expect(report.summary.arr_kobo).toBeNull();
 });
 it("separates gross sales, vendor allocations and platform revenue without counting wallet releases as new earnings",async()=>{
  const order=crypto.randomUUID(),payment=crypto.randomUUID(),release=crypto.randomUUID();
  await db.query("insert into public.orders(id,university_id,buyer_user_id,vendor_profile_id,status,subtotal_kobo,delivery_fee_kobo)values($1,$2,$3,$4,'PAID',550000,30000)",[order,campus,ordinary,vendorProfile]);
  const accounts=new Map<string,string>();for(const[code,type,owner]of[["PAYSTACK_CLEARING","ASSET",null],["PLATFORM_COMMISSION","REVENUE",null],["VENDOR_PENDING","LIABILITY",vendor],["VENDOR_AVAILABLE","LIABILITY",vendor]]as const){const id=crypto.randomUUID();await db.query("insert into public.ledger_accounts(id,university_id,owner_user_id,account_code,account_type)values($1,$2,$3,$4,$5)",[id,campus,owner,code,type]);accounts.set(code,id);}
  await db.exec("begin");await db.query("insert into public.ledger_transactions(id,university_id,reference_type,reference_id,idempotency_key,description)values($1,$2,'STORE_ORDER',$3,$4,'Fixture verified store journal')",[payment,campus,order,"report-sale-"+order]);
  for(const[code,direction,amount]of[["PAYSTACK_CLEARING","DEBIT",580000],["VENDOR_PENDING","CREDIT",550000],["PLATFORM_COMMISSION","CREDIT",30000]])await db.query("insert into public.ledger_lines(transaction_id,account_id,direction,amount_kobo)values($1,$2,$3,$4)",[payment,accounts.get(String(code)),direction,amount]);await db.exec("commit");
  await db.exec("begin");await db.query("insert into public.ledger_transactions(id,university_id,reference_type,reference_id,idempotency_key,description)values($1,$2,'STORE_ORDER',$3,$4,'Fixture wallet release')",[release,campus,order,"store-release:"+order]);for(const[code,direction]of[["VENDOR_PENDING","DEBIT"],["VENDOR_AVAILABLE","CREDIT"]])await db.query("insert into public.ledger_lines(transaction_id,account_id,direction,amount_kobo)values($1,$2,$3,550000)",[release,accounts.get(String(code)),direction]);await db.exec("commit");
  const data=await result(await request("/admin/finance/reporting?universityId="+campus));expect(data.summary).toMatchObject({gmv_kobo:580000,vendor_proceeds_kobo:550000,platform_revenue_kobo:30000,commission_kobo:30000,expenses_kobo:10000,profit_kobo:20000,transactions_processed:1,arr_kobo:null});
 });
 it("reports historical screen time and contextual graphs from the full scoped dataset",async()=>{
  await db.query("insert into app_private.foreground_usage_samples(id,user_id,institution_id,platform,screen,started_at,ended_at,seconds)values(gen_random_uuid(),$1,$2,'android','feed','2026-10-02T00:00:00Z','2026-10-02T00:00:30Z',30)",[ordinary,campus]);
  const usage=await result(await request("/usage/admin/today?date=2026-10-02",analyst));expect(usage.totals).toMatchObject({day:"2026-10-02",foreground_seconds:30,users:1,samples:1});
  const products=await result(await request("/admin/reports/workspace?module=marketplace",analyst));expect(products.categories.reduce((sum:number,r:{value:number})=>sum+r.value,0)).toBe(1);expect(products.daily).toHaveLength(30);
 });
 it("saves reports through cron and marks achieved milestones once per staff account and scope",async()=>{
  await captureDailyAppReports(env);const saved=await db.query("select day from app_private.daily_app_reports where scope_key='all'");expect(saved.rows.length).toBeGreaterThanOrEqual(3);
  for(let i=0;i<50;i++){const id=crypto.randomUUID();await db.query("insert into public.users(id,email,password_hash,created_at,updated_at)values($1,$2,'test-only','2025-01-01',now())",[id,`milestone-${id}@example.invalid`]);await db.query("insert into public.profiles(id,user_id,display_name,username,university_id,updated_at)values(gen_random_uuid(),$1,'Milestone fixture',$2,$3,now())",[id,"m"+id.replaceAll("-","").slice(0,24),campus]);}
  const milestones=await result(await request("/admin/reports/milestones?universityId="+campus,analyst));expect(milestones.milestones.some((m:{key:string})=>m.key==="signups_50")).toBe(true);
  await result(await request("/admin/reports/milestones/acknowledge?universityId="+campus,analyst,"POST",{key:"signups_50"}));const next=await result(await request("/admin/reports/milestones?universityId="+campus,analyst));expect(next.milestones.some((m:{key:string})=>m.key==="signups_50")).toBe(false);
  await result(await request("/admin/reports/milestones/acknowledge?universityId="+campus,analyst,"POST",{key:"signups_1000"}),409);
 });
});
