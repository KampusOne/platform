import { sql } from "drizzle-orm";
import { database, firstRow } from "./database";
import { AppError } from "./errors";
import { collectionFeeKobo, inclusiveGrossKobo, roundDisplayKobo, type CollectionFees } from "./pricing";
import type { Bindings } from "../types";

export const providerTransactionClasses = [
  "LOCAL_COLLECTION", "INTERNATIONAL_CARD", "INTERNATIONAL_AMEX", "DEDICATED_VIRTUAL_ACCOUNT",
  "VIRTUAL_TERMINAL_TRANSFER", "VIRTUAL_TERMINAL_USSD", "VIRTUAL_TERMINAL_LOCAL_CARD", "VIRTUAL_TERMINAL_INTERNATIONAL_CARD",
  "PHYSICAL_TERMINAL_CARD", "PHYSICAL_TERMINAL_TRANSFER", "PHYSICAL_TERMINAL_USSD", "EDUCATION_LOCAL_CARD", "EDUCATION_OTHER",
] as const;
export type ProviderTransactionClass = typeof providerTransactionClasses[number];
export type PaymentProduct = "ONLINE_COLLECTION" | "DEDICATED_VIRTUAL_ACCOUNT" | "VIRTUAL_TERMINAL" | "PHYSICAL_TERMINAL" | "EDUCATION";
const local: CollectionFees = { basisPoints: 150, flatKobo: 10000, flatWaivedBelowKobo: 250000, capKobo: 200000 };
const international: CollectionFees = { basisPoints: 390, flatKobo: 10000, flatWaivedBelowKobo: 0, capKobo: null };
const rule = (basisPoints:number,capKobo:number|null):CollectionFees => ({basisPoints,flatKobo:0,flatWaivedBelowKobo:0,capKobo});
/** Reference catalog only. A catalog entry never constitutes merchant approval. */
export const publishedProviderProfiles = providerTransactionClasses.map(transactionClass => ({
  transactionClass, status: "DISABLED" as const, country: "NG", currency: "NGN", version: "PAYSTACK_NG_20261003_REFERENCE",
  channel: transactionClass==="INTERNATIONAL_CARD"?"ANY":transactionClass.includes("CARD")||transactionClass==="INTERNATIONAL_AMEX"?"card":transactionClass.includes("TRANSFER")||transactionClass==="DEDICATED_VIRTUAL_ACCOUNT"?"bank_transfer":transactionClass.includes("USSD")?"ussd":"ANY",
  cardNetwork:transactionClass==="INTERNATIONAL_AMEX"?"AMEX":"ANY",
  collection: transactionClass === "INTERNATIONAL_CARD" || transactionClass === "VIRTUAL_TERMINAL_INTERNATIONAL_CARD" ? international :
    transactionClass === "INTERNATIONAL_AMEX" ? rule(450,null) : transactionClass === "DEDICATED_VIRTUAL_ACCOUNT" ? rule(100,30000) :
    transactionClass === "VIRTUAL_TERMINAL_TRANSFER" ? rule(50,50000) : transactionClass === "PHYSICAL_TERMINAL_CARD" ? rule(50,100000) :
    transactionClass === "EDUCATION_LOCAL_CARD" ? rule(70,150000) : transactionClass === "EDUCATION_OTHER" ? {...rule(0,null),flatKobo:30000} : local,
  sourceUrl: transactionClass.includes("TERMINAL") ? "https://support.paystack.com/en/articles/2131842" : "https://support.paystack.com/en/articles/2130306",
}));
export function profileProduct(transactionClass:ProviderTransactionClass):PaymentProduct {
  if(transactionClass==="DEDICATED_VIRTUAL_ACCOUNT")return transactionClass;
  if(transactionClass.startsWith("VIRTUAL_TERMINAL"))return "VIRTUAL_TERMINAL";
  if(transactionClass.startsWith("PHYSICAL_TERMINAL"))return "PHYSICAL_TERMINAL";
  if(transactionClass.startsWith("EDUCATION"))return "EDUCATION";
  return "ONLINE_COLLECTION";
}
export function assertProfileContext(profile:{transactionClass:ProviderTransactionClass;status:string;effectiveFrom:string;effectiveTo:string|null},product:PaymentProduct,transactionClass:ProviderTransactionClass,at=Date.now()){
  if(profileProduct(profile.transactionClass)!==product || profile.transactionClass!==transactionClass)
    throw new AppError(409,"CONFLICT","This provider profile belongs to a different payment product or channel context.");
  if(profile.status!=="APPROVED" || Date.parse(profile.effectiveFrom)>at || (profile.effectiveTo!==null&&Date.parse(profile.effectiveTo)<=at))
    throw new AppError(503,"FEATURE_DISABLED","The provider fee profile is disabled, not yet effective, or expired.");
}
export function classifyPaystackContext(channel:string|null,country:string|null,cardNetwork:string|null):ProviderTransactionClass{
  if(channel==="card" && country && country.toUpperCase()!=="NG")return /AMEX|AMERICAN EXPRESS/i.test(cardNetwork??"")?"INTERNATIONAL_AMEX":"INTERNATIONAL_CARD";
  return "LOCAL_COLLECTION";
}
export function pricingPreview(amountKobo:number,collection:CollectionFees,allowProcessorSubsidy=false){
  const rawRequirementKobo=inclusiveGrossKobo(amountKobo,collection),finalAmountKobo=roundDisplayKobo(rawRequirementKobo,collection,allowProcessorSubsidy);
  const estimatedFeeKobo=collectionFeeKobo(finalAmountKobo,collection);
  return {estimatedFeeKobo,rawRequirementKobo,finalAmountKobo,pricingAdjustmentKobo:finalAmountKobo-rawRequirementKobo,netKobo:finalAmountKobo-estimatedFeeKobo};
}
export function feeVariance(expectedFeeKobo:number,actualFeeKobo:number,toleranceKobo:number){
  if(![expectedFeeKobo,actualFeeKobo,toleranceKobo].every(v=>Number.isSafeInteger(v)&&v>=0))throw new RangeError("Fee reconciliation requires whole nonnegative kobo values.");
  const varianceKobo=actualFeeKobo-expectedFeeKobo;
  return {varianceKobo,alert:Math.abs(varianceKobo)>toleranceKobo};
}
export async function paymentPricingReady(env:Bindings){
  return firstRow(await database(env).execute<{ready:boolean}>(sql`select to_regprocedure('app_private.snapshot_collection_payment(text,bigint,jsonb)') is not null as ready`))?.ready===true;
}
async function requireReady(env:Bindings){
  if(!await paymentPricingReady(env))throw new AppError(503,"FEATURE_DISABLED","Payment pricing controls are awaiting their reviewed database update.");
}
async function eligibleProviderProfile(env:Bindings,universityId:string|null,profileId:string|undefined,product:PaymentProduct,transactionClass:ProviderTransactionClass,allowHistorical=false){
  await requireReady(env);
  type Profile={id:string;version:string;transactionClass:ProviderTransactionClass;channel:string;cardNetwork:string;status:string;effectiveFrom:string;effectiveTo:string|null;collection:CollectionFees};
  const p=firstRow(await database(env).execute<Profile>(sql`
    select id,version,transaction_class as "transactionClass",channel,card_network as "cardNetwork",status,effective_from as "effectiveFrom",effective_to as "effectiveTo",collection
    from app_private.payment_fee_profiles where university_id=${universityId}::uuid
      and (${profileId??null}::uuid is null or id=${profileId??null}::uuid)
      and (${profileId??null}::uuid is not null or (transaction_class=${transactionClass} and effective_from<=now() and (transaction_class not in('LOCAL_COLLECTION','INTERNATIONAL_CARD') or (channel='ANY' and card_network='ANY'))))
    order by effective_from desc,approved_at desc limit 1`));
  if(!p)throw new AppError(503,"FEATURE_DISABLED","Checkout is temporarily unavailable for this campus. Please try again shortly.");
  if(["LOCAL_COLLECTION","INTERNATIONAL_CARD"].includes(p.transactionClass)&&(p.channel!=="ANY"||p.cardNetwork!=="ANY"))throw new AppError(409,"CONFLICT","Ordinary checkout needs a generic provider profile because the customer's channel and card network are not known yet.");
  const latest=firstRow(await database(env).execute<Profile>(sql`select id,version,transaction_class as "transactionClass",channel,card_network as "cardNetwork",status,effective_from as "effectiveFrom",effective_to as "effectiveTo",collection from app_private.payment_fee_profiles where university_id=${universityId}::uuid and transaction_class=${p.transactionClass} and channel=${p.channel} and card_network=${p.cardNetwork} and effective_from<=now() order by effective_from desc,approved_at desc limit 1`));
  if(!latest)throw new AppError(503,"FEATURE_DISABLED","This provider context has no effective approved pricing profile.");
  if(latest.effectiveTo!==null&&Date.parse(latest.effectiveTo)<=Date.now())await database(env).execute(sql`insert into app_private.payment_pricing_alerts(university_id,provider_reference,kind,metadata) values(${universityId}::uuid,${"profile:"+latest.id},'PROVIDER_PROFILE_EXPIRED',${JSON.stringify({profileId:latest.id,version:latest.version,effectiveTo:latest.effectiveTo})}::jsonb) on conflict do nothing`);
  assertProfileContext(latest,product,transactionClass);
  if(!allowHistorical){assertProfileContext(p,product,transactionClass);if(p.id!==latest.id)throw new AppError(409,"CONFLICT","The approved product policy references a previous provider version. Review a policy using the current effective rule before creating a new quote.");}
  else if(p.status!=="APPROVED"||Date.parse(p.effectiveFrom)>Date.now()||profileProduct(p.transactionClass)!==product||p.transactionClass!==transactionClass)throw new AppError(503,"FEATURE_DISABLED","This saved quote's provider context is no longer eligible for initialization.");
  collectionFeeKobo(600000,p.collection);
  return p;
}
export async function resolveProviderCollection(env:Bindings,universityId:string|null,profileId?:string,product:PaymentProduct="ONLINE_COLLECTION",transactionClass:ProviderTransactionClass="LOCAL_COLLECTION"):Promise<CollectionFees>{
  const p=await eligibleProviderProfile(env,universityId,profileId,product,transactionClass);
  return {...p.collection,providerProfileId:p.id,providerProfileVersion:p.version,transactionClass:p.transactionClass};
}
export function assertAccountReview(review:{pass_fees_disabled:boolean;provider_mode:string;expires_at:string|null}|null,mode:"live"|"test",at=Date.now()){
  if(!review || !review.pass_fees_disabled || review.provider_mode!==mode || (review.expires_at!==null&&Date.parse(review.expires_at)<=at))
    throw new AppError(503,"FEATURE_DISABLED","Payments are paused until finance confirms that Paystack's Pass fees to customers setting is disabled for this account.");
}
export function providerMode(env:Bindings):"live"|"test"{return env.ENVIRONMENT==="production"||env.PAYSTACK_SECRET_KEY?.startsWith("sk_live_")?"live":"test";}
function isolatedLocalTest(env:Bindings){return env.ENVIRONMENT==="local"&&!env.DATABASE_URL;}
export async function prepareCollectionInitialization(env:Bindings,reference:string,amountKobo:number,metadata:Record<string,unknown>){
  if(isolatedLocalTest(env))return;
  await requireReady(env);
  const mode=providerMode(env);
  const review=firstRow(await database(env).execute<{pass_fees_disabled:boolean;provider_mode:string;expires_at:string|null}>(sql`select pass_fees_disabled,provider_mode,expires_at from app_private.paystack_account_reviews where provider_mode=${mode} order by reviewed_at desc,id desc limit 1`));
  assertAccountReview(review??null,mode);
  const native=firstRow(await database(env).execute<{university_id:string;profile_id:string|null}>(sql`
    select university_id,fee_profile_id as profile_id from app_private.collection_payment_pricing where provider_reference=${reference}
    union all select a.university_id,(cp.collection->>'providerProfileId')::uuid as profile_id from public.payment_attempts a
      left join app_private.order_price_snapshots os on a.resource_type='STORE_ORDER' and os.order_id=a.resource_id
      left join app_private.store_checkout_quotes sq on sq.id=os.quote_id
      left join app_private.tutorial_booking_prices tp on a.resource_type='TUTORIAL_BOOKING' and tp.booking_id=a.resource_id
      left join app_private.material_checkout_quotes mq on a.resource_type='TUTORIAL_PURCHASE' and mq.id=a.resource_id
      left join app_private.commerce_fee_policies cp on cp.id=coalesce(sq.policy_id,tp.policy_id,mq.policy_id)
      where a.provider_reference=${reference}
    union all select k.university_id,(p.collection->>'providerProfileId')::uuid from app_private.kira_checkouts k join app_private.kira_price_plans p on p.id=k.plan_id where k.provider_reference=${reference}
    union all select university_id,null::uuid from app_private.rider_commission_checkouts where provider_reference=${reference} limit 1`));
  if(!native)throw new AppError(409,"CONFLICT","The saved payment pricing intent could not be found. Review a new quote before paying.");
  await eligibleProviderProfile(env,native.university_id,native.profile_id??undefined,"ONLINE_COLLECTION","LOCAL_COLLECTION",true);
  return firstRow(await database(env).execute<{fee_profile_id:string;fee_profile_version:string;provider_reference:string}>(sql`select fee_profile_id,fee_profile_version,provider_reference from app_private.snapshot_collection_payment(${reference},${amountKobo}::bigint,${JSON.stringify(metadata)}::jsonb)`));
}
export type CollectionReceiptContext={reference:string;amountKobo:number;feeKobo:number;providerTransactionId:string|null;channel:string|null;paymentCountry:string|null;cardNetwork:string|null;currency:string;providerMode:string;paidAt:string|null};
export async function recordCollectionReceiptContext(env:Bindings,receipt:CollectionReceiptContext){
  if(isolatedLocalTest(env))return;
  // Old verified receipts remain reconcilable without a new account attestation.
  if(!await paymentPricingReady(env))return;
  const observed=firstRow(await database(env).execute<{state:string}>(sql`select app_private.record_collection_pricing_observation(${receipt.reference},${receipt.amountKobo}::bigint,${receipt.feeKobo}::bigint,${receipt.providerTransactionId},${receipt.channel},${receipt.paymentCountry},${receipt.cardNetwork},${receipt.currency},${receipt.providerMode}) as state`));
  if(observed?.state==="REQUIRES_REVIEW")throw new AppError(503,"PROVIDER_UNAVAILABLE","The provider receipt conflicts with an existing transaction. Finance review is required before fulfillment.");
}
export async function recordPaymentPricingAlert(env:Bindings,reference:string,kind:string,metadata:Record<string,unknown>){
  if(isolatedLocalTest(env)||!await paymentPricingReady(env))return;
  await database(env).execute(sql`select app_private.record_payment_pricing_alert(${reference},${kind},${JSON.stringify(metadata)}::jsonb)`);
}
