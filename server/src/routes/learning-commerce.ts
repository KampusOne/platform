import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z, tutorPurchaseTargetSchema } from "@kampusone/contracts";
import { database, firstRow } from "../lib/database";
import { input, id } from "../lib/input";
import { AppError } from "../lib/errors";
import { currentUser, requireAuth } from "../middleware/auth";
import { requireFeature } from "../lib/features";
import { requireUnblocked } from "../lib/profile-safety";
import type { Bindings, Variables } from "../types";

export const learningCommerceRoutes = new Hono<{Bindings:Bindings;Variables:Variables}>();
learningCommerceRoutes.use("/*",requireAuth);
learningCommerceRoutes.use("/*",async(c,next)=>{
  c.header("Cache-Control","private, no-store");
  requireFeature(c.env,"TUTORIALS_ENABLED","Learning purchases are unavailable in this environment.");
  if(!currentUser(c).universityId)throw new AppError(409,"CONFLICT","Choose your university first.");
  await next();
});
export function commerceError(error:unknown):never {
  const message=error instanceof Error?error.message:String(error);
  if(message.includes("FEE_POLICY_UNCONFIGURED"))throw new AppError(409,"CONFLICT","Pricing is awaiting an approved fee policy. No payment has been taken.");
  if(message.includes("SAVED_PURCHASE_PRICE"))throw new AppError(409,"CONFLICT","You already have a saved checkout at an earlier price. Review it in My learning purchases.");
  if(message.includes("TUTORIAL_FULL"))throw new AppError(409,"CONFLICT","This tutor package is currently full.");
  if(message.includes("PRICE_CHANGED"))throw new AppError(409,"CONFLICT","The price has changed. Refresh the breakdown before continuing.");
  if(message.includes("TUTOR_PRODUCT_UNAVAILABLE"))throw new AppError(404,"NOT_FOUND","This learning product is unavailable.");
  if(message.includes("PURCHASE_ID_CONFLICT"))throw new AppError(409,"CONFLICT","This checkout identifier has already been used.");
  throw error;
}
learningCommerceRoutes.post("/quote",async c=>{
  const u=currentUser(c),d=await input(c,tutorPurchaseTargetSchema);
  try {
    const row=firstRow(await database(c.env).execute<{quote:Record<string,unknown>}>(sql`select app_private.tutor_quote(${u.universityId}::uuid,${u.id}::uuid,${d.resourceId??null}::uuid,${d.listingId??null}::uuid) quote`));
    if(Number(row?.quote.amountKobo)>0)requireFeature(c.env,"PAYMENTS_ENABLED","Payments are not connected yet.");
    return c.json({quote:row!.quote});
  }catch(e){commerceError(e);}
});
learningCommerceRoutes.post("/purchases",async c=>{
  const u=currentUser(c),d=await input(c,z.object({id:z.string().uuid(),target:tutorPurchaseTargetSchema,quote:z.record(z.string(),z.unknown())}).strict());
  const db=database(c.env);
  const allowed=firstRow(await db.execute<{allowed:boolean}>(sql`select app_private.consume_request_rate_limit('TUTOR_PURCHASE',${u.id},20,3600,3600) allowed`));
  if(!allowed?.allowed)throw new AppError(429,"RATE_LIMITED","Too many checkout requests. Please try again later.");
  try {
    // Recompute before accepting; neither the submitted total nor fee version is trusted.
    const actual=firstRow(await db.execute<{quote:Record<string,unknown>}>(sql`select app_private.tutor_quote(${u.universityId}::uuid,${u.id}::uuid,${d.target.resourceId??null}::uuid,${d.target.listingId??null}::uuid) quote`));
    if(Number(actual?.quote.amountKobo)>0)requireFeature(c.env,"PAYMENTS_ENABLED","Payments are not connected yet.");
    const purchase=firstRow(await db.execute(sql`select * from app_private.create_tutor_purchase(${d.id}::uuid,${u.universityId}::uuid,${u.id}::uuid,${d.target.resourceId??null}::uuid,${d.target.listingId??null}::uuid,${JSON.stringify(d.quote)}::jsonb)`));
    return c.json({purchase},201);
  }catch(e){commerceError(e);}
});
learningCommerceRoutes.get("/purchases",async c=>{
  const u=currentUser(c),before=c.req.query("before")?id(c.req.query("before")!):null;
  const r=await database(c.env).execute(sql`select p.*,a.user_id tutor_user_id,a.display_name tutor_name,
    r.media_object_id,app_private.can_read_tutor_resource(${u.id}::uuid,p.resource_id) can_access_resource,
    case when p.status<>'PAID' then p.status when p.access_starts_at>now() then 'UPCOMING'
      when p.access_ends_at<=now() then 'EXPIRED' else 'ACTIVE' end access_status
    from public.tutorial_purchases p join public.agent_profiles a on a.id=p.tutor_profile_id
    left join public.tutorial_resources r on r.id=p.resource_id
    where p.student_user_id=${u.id}::uuid and (${before}::uuid is null or (p.created_at,p.id)<(select created_at,id from public.tutorial_purchases where id=${before}::uuid and student_user_id=${u.id}::uuid))
    order by p.created_at desc,p.id desc limit 51`);
  return c.json({purchases:r.rows.slice(0,50),nextCursor:r.rows.length>50?r.rows[49]!.id:null});
});
learningCommerceRoutes.post("/purchases/:id/dispute",async c=>{
  const u=currentUser(c),d=await input(c,z.object({reason:z.string().trim().min(10).max(1000)}).strict());
  const row=firstRow(await database(c.env).execute(sql`update public.tutorial_purchases set status='DISPUTED',earnings_state='RESERVED',dispute_reason=${d.reason},updated_at=now()
    where id=${id(c.req.param("id"))}::uuid and student_user_id=${u.id}::uuid and status='PAID' and release_at>now() returning id`));
  if(!row)throw new AppError(409,"CONFLICT","This purchase cannot be disputed here. Contact support with the purchase ID.");
  return c.json({status:"DISPUTED"});
});
learningCommerceRoutes.post("/threads",async c=>{
  const u=currentUser(c),d=await input(c,z.object({studentId:z.string().uuid(),tutorId:z.string().uuid()}).strict());
  if(![d.studentId,d.tutorId].includes(u.id)||d.studentId===d.tutorId)throw new AppError(404,"NOT_FOUND","Tutor relationship not found.");
  await requireUnblocked(c.env,d.studentId,d.tutorId);
  const row=firstRow(await database(c.env).execute(sql`insert into public.direct_threads(institution_id,initiator_id,recipient_id,status,kind)
    select ${u.universityId}::uuid,${d.studentId}::uuid,${d.tutorId}::uuid,'ACCEPTED','TUTOR'
    where app_private.tutor_access_end(${d.studentId}::uuid,${d.tutorId}::uuid)>now()
    on conflict(initiator_id,recipient_id) where kind='TUTOR' do update set updated_at=direct_threads.updated_at returning id`));
  if(!row)throw new AppError(403,"FORBIDDEN","Tutor messaging is available during an active session or package.");
  return c.json({thread:row});
});

learningCommerceRoutes.get("/learners",async c=>{
  const u=currentUser(c);
  const rows=await database(c.env).execute(sql`select p.id,p.title,p.status,p.student_user_id,p.access_starts_at,p.access_ends_at,
    p.price_kobo,p.commission_kobo,p.tutor_net_kobo,p.earnings_state,s.display_name student_name,
    (app_private.tutor_access_end(p.student_user_id,${u.id}::uuid)>now()) chat_active
    from public.tutorial_purchases p join public.agent_profiles a on a.id=p.tutor_profile_id and a.status='ACTIVE'
    join public.profiles s on s.user_id=p.student_user_id and s.deleted_at is null
    where a.user_id=${u.id}::uuid and p.status in ('PAID','DISPUTED') order by p.created_at desc limit 100`);
  return c.json({learners:rows.rows});
});
