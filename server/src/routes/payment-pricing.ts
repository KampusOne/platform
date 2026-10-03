import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { z } from "@kampusone/contracts";
import { currentUser, requireAuth } from "../middleware/auth";
import { resolveAdminScope, assertPermission } from "../lib/admin-access";
import { database, firstRow } from "../lib/database";
import { input } from "../lib/input";
import { AppError } from "../lib/errors";
import { providerTransactionClasses, profileProduct, publishedProviderProfiles, paymentPricingReady, providerMode, pricingPreview } from "../lib/payment-pricing";
import { collectionFeeKobo, type CollectionFees } from "../lib/pricing";
import type { Bindings, Variables } from "../types";
const minor=z.number().int().min(0).max(2_000_000_000);
export const providerCollectionSchema=z.object({basisPoints:z.number().int().min(0).max(9999),flatKobo:minor,flatWaivedBelowKobo:minor,capKobo:minor.nullable()}).strict();
const sourceUrl=z.url().refine(value=>{const u=new URL(value);return u.protocol==="https:"&&["paystack.com","support.paystack.com","dashboard.paystack.com"].includes(u.hostname);},"Use an official Paystack pricing or account source.");
export const providerProfileSchema=z.object({
  universityId:z.string().uuid(),version:z.string().trim().min(3).max(120).refine(v=>!v.startsWith("LEGACY_"),"LEGACY_ is reserved for historical rule imports."),transactionClass:z.enum(providerTransactionClasses),
  channel:z.enum(["ANY","card","bank_transfer","ussd"]).default("ANY"),cardNetwork:z.enum(["ANY","MASTERCARD","VISA","VERVE","AMEX"]).default("ANY"),
  collection:providerCollectionSchema,effectiveFrom:z.string().datetime({offset:true}),effectiveTo:z.string().datetime({offset:true}).nullable().default(null),
  status:z.enum(["APPROVED","DISABLED"]),varianceToleranceKobo:minor.max(100000000).default(100),sourceUrl,approvalNote:z.string().trim().min(10).max(2000),eligibilityEvidence:z.string().trim().max(4000).nullable().default(null),
}).strict().superRefine((v,ctx)=>{
  if(v.effectiveTo!==null&&Date.parse(v.effectiveTo)<=Date.parse(v.effectiveFrom))ctx.addIssue({code:"custom",path:["effectiveTo"],message:"The end must follow the effective date."});
  if(v.status==="APPROVED"&&profileProduct(v.transactionClass)!=="ONLINE_COLLECTION"&&(v.eligibilityEvidence?.length??0)<10)ctx.addIssue({code:"custom",path:["eligibilityEvidence"],message:"Confirm product eligibility and the account's commercial terms before enabling this profile."});
  if(v.transactionClass==="INTERNATIONAL_AMEX"&&v.cardNetwork!=="AMEX")ctx.addIssue({code:"custom",path:["cardNetwork"],message:"American Express has its own rule."});
  if(v.transactionClass==="INTERNATIONAL_CARD"&&v.cardNetwork==="AMEX")ctx.addIssue({code:"custom",path:["cardNetwork"],message:"Use the American Express profile for this network."});
  if(["LOCAL_COLLECTION","INTERNATIONAL_CARD"].includes(v.transactionClass)&&(v.channel!=="ANY"||v.cardNetwork!=="ANY"))ctx.addIssue({code:"custom",path:["channel"],message:"Ordinary checkout cannot promise a channel or card network before payment. Use a generic ANY profile; separately identified products have their own rules."});
});
export const accountReviewSchema=z.object({providerMode:z.enum(["live","test"]),passFeesDisabled:z.boolean(),reason:z.string().trim().min(10).max(2000),evidence:z.string().trim().min(10).max(4000),expiresAt:z.string().datetime({offset:true}).nullable().default(null)}).strict();
export const paymentPricingRoutes=new Hono<{Bindings:Bindings;Variables:Variables}>();
paymentPricingRoutes.use("*",requireAuth);
async function ready(env:Bindings){if(!await paymentPricingReady(env))throw new AppError(503,"FEATURE_DISABLED","Payment pricing controls are awaiting the reviewed database update.");}
paymentPricingRoutes.get("/profiles",async c=>{
  const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query("universityId"),"finance.view");
  if(!await paymentPricingReady(c.env))return c.json({ready:false,profiles:[],publishedProfiles:publishedProviderProfiles});
  const rows=await database(c.env).execute(sql`select id,university_id as "universityId",version,transaction_class as "transactionClass",channel,card_network as "cardNetwork",collection,effective_from as "effectiveFrom",effective_to as "effectiveTo",status,variance_tolerance_kobo as "varianceToleranceKobo",source_url as "sourceUrl",approval_note as "approvalNote",eligibility_evidence as "eligibilityEvidence",approved_at as "approvedAt",approved_by as "approvedBy" from app_private.payment_fee_profiles where (${scope}::uuid is null or university_id=${scope}::uuid) order by effective_from desc,approved_at desc limit 200`);
  return c.json({ready:true,profiles:rows.rows.map(p=>({...p,varianceToleranceKobo:Number(p.varianceToleranceKobo)})),publishedProfiles:publishedProviderProfiles});
});
paymentPricingRoutes.post("/profiles",async c=>{
  const data=await input(c,providerProfileSchema),user=currentUser(c);
  await resolveAdminScope(c.env,user,data.universityId,"finance.review");await ready(c.env);
  collectionFeeKobo(600000,data.collection);
  const id=crypto.randomUUID();
  try{
    await database(c.env).execute(sql`with locked as(select pg_advisory_xact_lock(hashtextextended('provider-profile:'||${data.universityId}||':'||${data.transactionClass},0))), previous as(select to_jsonb(p) as value from app_private.payment_fee_profiles p where university_id=${data.universityId}::uuid and transaction_class=${data.transactionClass} and effective_from<=now() order by effective_from desc,approved_at desc limit 1), added as(insert into app_private.payment_fee_profiles(id,university_id,version,transaction_class,channel,card_network,collection,effective_from,effective_to,status,variance_tolerance_kobo,source_url,approval_note,eligibility_evidence,approved_by) select ${id}::uuid,${data.universityId}::uuid,${data.version},${data.transactionClass},${data.channel},${data.cardNetwork},${JSON.stringify(data.collection)}::jsonb,${data.effectiveFrom}::timestamptz,${data.effectiveTo}::timestamptz,${data.status},${data.varianceToleranceKobo},${data.sourceUrl},${data.approvalNote},${data.eligibilityEvidence},${user.id}::uuid from locked returning *) insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata) select ${user.id}::uuid,${data.universityId}::uuid,'finance.provider_profile.approved','payment_fee_profile',id::text,${c.get("requestId")??null},'succeeded',jsonb_build_object('oldValue',(select value from previous),'newValue',to_jsonb(added),'reason',${data.approvalNote}) from added`);
  }catch(error){if(error instanceof Error&&/unique|duplicate/.test(error.message))throw new AppError(409,"CONFLICT","Use a new version for this campus and provider context.");throw error;}
  return c.json({id},201);
});
paymentPricingRoutes.get("/account-review",async c=>{
  await resolveAdminScope(c.env,currentUser(c),c.req.query("universityId"),"finance.view");const mode=providerMode(c.env);
  if(!await paymentPricingReady(c.env))return c.json({ready:false,reviewed:false,providerMode:mode,review:null});
  const review=firstRow(await database(c.env).execute<{passFeesDisabled:boolean;expiresAt:string|null}>(sql`select id,provider_mode as "providerMode",pass_fees_disabled as "passFeesDisabled",reviewed_at as "reviewedAt",reviewed_by as "reviewedBy",reason,evidence,expires_at as "expiresAt" from app_private.paystack_account_reviews where provider_mode=${mode} order by reviewed_at desc,id desc limit 1`));
  return c.json({ready:true,reviewed:!!review?.passFeesDisabled&&(review.expiresAt===null||Date.parse(review.expiresAt)>Date.now()),providerMode:mode,review:review??null});
});
paymentPricingRoutes.post("/account-review",async c=>{
  const data=await input(c,accountReviewSchema),user=currentUser(c),access=await assertPermission(c.env,user,"finance.review");
  if(!access.grants.some(g=>g.university_id===null&&g.permissions.includes("finance.review")))throw new AppError(403,"FORBIDDEN","Only a finance reviewer with platform scope can attest the global Paystack account setting.");
  if(data.expiresAt!==null&&Date.parse(data.expiresAt)<=Date.now())throw new AppError(400,"BAD_REQUEST","The review expiry must be in the future.");
  await ready(c.env);const id=crypto.randomUUID();
  await database(c.env).execute(sql`with locked as(select pg_advisory_xact_lock(hashtextextended('paystack-account-review:'||${data.providerMode},0))), previous as(select to_jsonb(r) as value from app_private.paystack_account_reviews r where provider_mode=${data.providerMode} order by reviewed_at desc,id desc limit 1), added as(insert into app_private.paystack_account_reviews(id,provider_mode,pass_fees_disabled,reason,evidence,reviewed_by,expires_at) select ${id}::uuid,${data.providerMode},${data.passFeesDisabled},${data.reason},${data.evidence},${user.id}::uuid,${data.expiresAt}::timestamptz from locked returning *) insert into app_private.audit_events(actor_user_id,university_id,action,target_type,target_id,request_id,outcome,metadata) select ${user.id}::uuid,null,'finance.paystack_account.reviewed','paystack_account_review',id::text,${c.get("requestId")??null},'succeeded',jsonb_build_object('oldValue',(select value from previous),'newValue',to_jsonb(added),'reason',${data.reason}) from added`);
  return c.json({id,passFeesDisabled:data.passFeesDisabled},201);
});
paymentPricingRoutes.get("/alerts",async c=>{
  const scope=await resolveAdminScope(c.env,currentUser(c),c.req.query("universityId"),"finance.view");
  if(!await paymentPricingReady(c.env))return c.json({ready:false,alerts:[]});
  const rows=await database(c.env).execute(sql`select id,university_id as "universityId",provider_reference as "providerReference",kind,metadata,created_at as "createdAt" from app_private.payment_pricing_alerts where (${scope}::uuid is null or university_id=${scope}::uuid) order by created_at desc limit 200`);
  return c.json({ready:true,alerts:rows.rows});
});
paymentPricingRoutes.post("/preview",async c=>{
  const data=await input(c,z.object({universityId:z.string().uuid(),amountKobo:minor,collection:providerCollectionSchema.extend({displayRoundKobo:z.number().int().min(100).max(100000).multipleOf(100).optional(),roundingMode:z.enum(["NONE","NEAREST_50","CEIL_50","NEAREST_100","CEIL_100","FRIENDLY_9"]).optional(),maxPricingAdjustmentKobo:minor.optional()}),allowProcessorSubsidy:z.boolean().default(false)}).strict());
  await resolveAdminScope(c.env,currentUser(c),data.universityId,"finance.review");
  try{return c.json(pricingPreview(data.amountKobo,data.collection as CollectionFees,data.allowProcessorSubsidy));}catch(error){if(error instanceof RangeError)throw new AppError(400,"BAD_REQUEST",error.message);throw error;}
});
