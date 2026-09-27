import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { feeRuleSchema } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { input } from "../lib/input";
import { AppError } from "../lib/errors";
import { currentUser } from "../middleware/auth";
import { resolveAdminScope } from "../lib/admin-access";
import { recordAudit } from "../lib/audit";
import type { Bindings,Variables } from "../types";
export const feeRuleRoutes=new Hono<{Bindings:Bindings;Variables:Variables}>();
feeRuleRoutes.get("/",async c=>{
  const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query("universityId"),"finance.view");
  const [rules,disputes,zones]=await Promise.all([
    database(c.env).execute(sql`select * from public.fee_rules where (${scope}::uuid is null or institution_id=${scope}::uuid) order by effective_at desc limit 200`),
    database(c.env).execute(sql`select p.id,p.title,p.amount_kobo,p.dispute_reason,p.created_at,p.institution_id from public.tutorial_purchases p where p.status='DISPUTED' and (${scope}::uuid is null or p.institution_id=${scope}::uuid) order by p.updated_at limit 100`),
    database(c.env).execute(sql`select id,name from public.delivery_zones where (${scope}::uuid is null or university_id=${scope}::uuid) and active order by name limit 200`),
  ]);
  return c.json({rules:rules.rows,disputes:disputes.rows,zones:zones.rows});
});
feeRuleRoutes.post("/",async c=>{
  const u=currentUser(c),d=await input(c,feeRuleSchema);
  await resolveAdminScope(c.env,u,d.institutionId,"finance.review");
  if(d.zoneId&&!firstRow(await database(c.env).execute(sql`select id from public.delivery_zones where id=${d.zoneId}::uuid and university_id=${d.institutionId}::uuid`)))throw new AppError(400,"BAD_REQUEST","Choose a delivery zone in this university.");
  const effective=new Date(d.effectiveAt);
  if(effective.getTime()<Date.now()-300000)throw new AppError(400,"BAD_REQUEST","Fee versions cannot be backdated. Choose now or a future effective date.");
  const rule=firstRow(await database(c.env).execute(sql`insert into public.fee_rules(institution_id,fee_type,version,effective_at,flat_kobo,basis_points,minimum_kobo,maximum_kobo,zone_id,bands,created_by,reason)
    values(${d.institutionId}::uuid,${d.feeType},${d.version},${d.effectiveAt}::timestamptz,${d.flatKobo},${d.basisPoints},${d.minimumKobo},${d.maximumKobo},${d.zoneId}::uuid,${JSON.stringify(d.bands)}::jsonb,${u.id}::uuid,${d.reason})
    on conflict do nothing returning id`));
  if(!rule)throw new AppError(409,"CONFLICT","This version or effective time already exists. Use a new version.");
  await recordAudit(c.env,{actorUserId:u.id,universityId:d.institutionId,action:"finance.fee_rule_created",targetType:"fee_rule",targetId:String(rule.id),requestId:c.get("requestId"),metadata:{...d}});
  return c.json({rule},201);
});
