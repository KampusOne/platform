import { Hono } from "hono";
import { afterEach,describe,expect,it,vi } from "vitest";
import { AppError } from "../lib/errors";
import type { Bindings,Variables } from "../types";
const stubs=vi.hoisted(()=>({execute:vi.fn(),scope:vi.fn(),permission:vi.fn(),ready:vi.fn(),bachsReady:vi.fn()}));
vi.mock("../middleware/auth",()=>({requireAuth:async(_c:unknown,next:()=>Promise<void>)=>next(),currentUser:()=>({id:"22222222-2222-4222-8222-222222222222"})}));
vi.mock("../lib/admin-access",()=>({resolveAdminScope:stubs.scope,assertPermission:stubs.permission}));
vi.mock("../lib/database",()=>({database:()=>({execute:stubs.execute}),firstRow:(r:{rows:unknown[]})=>r.rows[0]}));
vi.mock("../lib/payment-pricing",async original=>({...await original<typeof import("../lib/payment-pricing")>(),paymentPricingReady:stubs.ready}));
vi.mock("../lib/bachs-pricing-store",()=>({bachsPricingReady:stubs.bachsReady}));
import { paymentPricingRoutes,providerProfileSchema,accountReviewSchema,bachsProfileSchema } from "./payment-pricing";
const universityId="11111111-1111-4111-8111-111111111111";
const profile={universityId,version:"reviewed-v1",transactionClass:"LOCAL_COLLECTION",channel:"ANY",cardNetwork:"ANY",collection:{basisPoints:150,flatKobo:10000,flatWaivedBelowKobo:250000,capKobo:200000},effectiveFrom:"2026-10-03T00:00:00Z",effectiveTo:null,status:"APPROVED",varianceToleranceKobo:100,sourceUrl:"https://support.paystack.com/en/articles/2130306",approvalNote:"Reviewed the commercial account terms",eligibilityEvidence:null};
function app(){const a=new Hono<{Bindings:Bindings;Variables:Variables}>();a.route("/pricing",paymentPricingRoutes);a.onError((error,c)=>c.json({message:error.message},error instanceof AppError?error.status:500));return a;}
const env={ENVIRONMENT:"local",PAYSTACK_SECRET_KEY:"sk_test_fixture"}as Bindings;
afterEach(()=>vi.clearAllMocks());
describe("scoped payment pricing administration",()=>{
  it("requires explicit product eligibility and isolates international Amex",()=>{
    expect(providerProfileSchema.safeParse({...profile,transactionClass:"EDUCATION_LOCAL_CARD"}).success).toBe(false);
    expect(providerProfileSchema.safeParse({...profile,transactionClass:"EDUCATION_LOCAL_CARD",status:"DISABLED"}).success).toBe(true);
    expect(providerProfileSchema.safeParse({...profile,transactionClass:"DEDICATED_VIRTUAL_ACCOUNT",eligibilityEvidence:"Paystack confirmed eligibility on reviewed account"}).success).toBe(true);
    expect(providerProfileSchema.safeParse({...profile,transactionClass:"INTERNATIONAL_AMEX"}).success).toBe(false);
    expect(providerProfileSchema.safeParse({...profile,transactionClass:"INTERNATIONAL_AMEX",cardNetwork:"AMEX"}).success).toBe(true);
    expect(providerProfileSchema.safeParse({...profile,effectiveTo:"2026-10-02T00:00:00Z"}).success).toBe(false);
    expect(accountReviewSchema.safeParse({providerMode:"test",passFeesDisabled:true,reason:"Reviewed account preference",evidence:"Dashboard setting unchecked"}).success).toBe(true);
  });
  it("checks campus scope before reading profiles",async()=>{
    stubs.scope.mockRejectedValueOnce(new AppError(403,"FORBIDDEN","Outside your campus"));
    const response=await app().request("/pricing/profiles?universityId="+universityId,{},env);expect(response.status).toBe(403);expect(stubs.execute).not.toHaveBeenCalled();expect(stubs.ready).not.toHaveBeenCalled();
  });
  it("never marks an untouched provider account reviewed",async()=>{
    stubs.scope.mockResolvedValueOnce(universityId);stubs.ready.mockResolvedValueOnce(true);stubs.execute.mockResolvedValueOnce({rows:[]});
    const response=await app().request("/pricing/account-review",{},env);expect(await response.json()).toMatchObject({ready:true,reviewed:false,review:null,providerMode:"test"});
  });
  it("prevents campus reviewers from attesting a global merchant setting",async()=>{
    stubs.permission.mockResolvedValueOnce({grants:[{university_id:universityId,permissions:["finance.review"]}]});
    const response=await app().request("/pricing/account-review",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({providerMode:"test",passFeesDisabled:true,reason:"Reviewed account preference",evidence:"Dashboard setting unchecked"})},env);expect(response.status).toBe(403);expect(stubs.execute).not.toHaveBeenCalled();
  });
  it("persists a new profile and its old/new/reason audit together",async()=>{
    stubs.scope.mockResolvedValueOnce(universityId);stubs.ready.mockResolvedValueOnce(true);stubs.execute.mockResolvedValueOnce({rows:[]});
    const response=await app().request("/pricing/profiles",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(profile)},env);expect(response.status).toBe(201);expect(stubs.execute).toHaveBeenCalledTimes(1);
  });
  it("lets a platform finance reviewer confirm checkout setup without typing evidence",async()=>{
    stubs.permission.mockResolvedValueOnce({grants:[{university_id:null,permissions:["finance.review"]}]});stubs.ready.mockResolvedValueOnce(true);stubs.execute.mockResolvedValueOnce({rows:[]});
    const response=await app().request("/pricing/account-review",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({providerMode:"test",passFeesDisabled:true})},env);
    expect(response.status).toBe(201);expect(await response.json()).toMatchObject({passFeesDisabled:true});expect(stubs.execute).toHaveBeenCalledOnce();
    expect(accountReviewSchema.parse({providerMode:"test",passFeesDisabled:true}).evidence).toContain('explicitly confirmed');
  });
});

describe("campus-scoped BACHS pricing controls",()=>{
  const bachsProfile={...profile,context:"CHECKOUT_BANK_TRANSFER",collection:{basisPoints:150,flatKobo:0,flatWaivedBelowKobo:0,capKobo:200000},sourceUrl:"https://docs.bachs.io/for-you/fees",eligibilityEvidence:"Merchant confirmed NGN checkout and fee treatment"};
  const validProfile=()=>{const {transactionClass:_transaction,channel:_channel,cardNetwork:_network,...data}=bachsProfile;return data;};
  const post=(path:string,body:unknown)=>app().request(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)},env);

  it("requires official terms and an explicit account capability review",()=>{
    expect(bachsProfileSchema.safeParse(validProfile()).success).toBe(true);
    expect(bachsProfileSchema.safeParse({...validProfile(),eligibilityEvidence:""}).success).toBe(false);
    expect(bachsProfileSchema.safeParse({...validProfile(),sourceUrl:"https://fake-bachs.io/fees"}).success).toBe(false);
    expect(bachsProfileSchema.safeParse({...validProfile(),sourceUrl:"https://docs.bachs.io:444/fees"}).success).toBe(false);
    expect(bachsProfileSchema.parse({...validProfile(),sourceUrl:"https://bachs.io"}).sourceUrl).toBe("https://bachs.io/");
    expect(bachsProfileSchema.safeParse({...validProfile(),effectiveTo:"2026-10-01T00:00:00Z"}).success).toBe(false);
  });

  it("requires finance access before returning campus fee differences",async()=>{
    stubs.scope.mockRejectedValueOnce(new AppError(403,"FORBIDDEN","Outside your campus"));
    expect((await app().request("/pricing/bachs/alerts?universityId="+universityId,{},env)).status).toBe(403);
    expect(stubs.execute).not.toHaveBeenCalled();
    stubs.scope.mockResolvedValueOnce(universityId);stubs.bachsReady.mockResolvedValueOnce(true);stubs.execute.mockResolvedValueOnce({rows:[{reference:"K1-B-fixture",amountKobo:600000,actualFeeKobo:9200,varianceKobo:200}]});
    const response=await app().request("/pricing/bachs/alerts?universityId="+universityId,{},env);
    expect(await response.json()).toMatchObject({ready:true,alerts:[{amountKobo:600000,varianceKobo:200}]});
  });

  it("checks finance scope before inspecting the BACHS database",async()=>{
    stubs.scope.mockRejectedValueOnce(new AppError(403,"FORBIDDEN","Outside your campus"));
    const response=await app().request("/pricing/bachs/profiles?universityId="+universityId,{},env);
    expect(response.status).toBe(403);expect(stubs.bachsReady).not.toHaveBeenCalled();expect(stubs.execute).not.toHaveBeenCalled();
  });

  it("offers disabled reference rates while the additive migration is pending",async()=>{
    stubs.scope.mockResolvedValueOnce(universityId);stubs.bachsReady.mockResolvedValueOnce(false);
    const response=await app().request("/pricing/bachs/profiles?universityId="+universityId,{},env);
    const data=await response.json()as{ready:boolean;profiles:unknown[];publishedProfiles:{status:string}[]};
    expect(data.ready).toBe(false);expect(data.profiles).toHaveLength(0);expect(data.publishedProfiles).toHaveLength(4);expect(data.publishedProfiles.every(p=>p.status==="DISABLED")).toBe(true);
    expect(stubs.execute).not.toHaveBeenCalled();
  });

  it("previews a fixed discounted Kira price without creating checkout evidence",async()=>{
    stubs.scope.mockResolvedValueOnce(universityId);
    const response=await post("/pricing/bachs/preview",{universityId,context:"CHECKOUT_BANK_TRANSFER",amountKobo:600000,discountPercent:20});
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({referenceOnly:true,quote:{discountKobo:120000,finalCustomerAmountKobo:480000,providerAmountKobo:480000,estimatedProviderFeeKobo:7200}});
    expect(stubs.scope).toHaveBeenCalledWith(env,expect.anything(),universityId,"finance.view");expect(stubs.execute).not.toHaveBeenCalled();
  });

  it("isolates virtual deposits from merchant withdrawals and hosted card collection",async()=>{
    for(const [context,expected]of[
      ["VIRTUAL_ACCOUNT_DEPOSIT",{deposit:{estimatedProviderFeeKobo:30000}}],
      ["BANK_WITHDRAWAL",{withdrawal:{recipientAmountKobo:20000000,providerFeeKobo:5000,totalDebitKobo:20005000}}],
      ["LOCAL_CARD",{quote:{estimatedProviderFeeKobo:400000}}],
    ]as const){
      stubs.scope.mockResolvedValueOnce(universityId);
      const response=await post("/pricing/bachs/preview",{universityId,context,amountKobo:20000000});expect(response.status).toBe(200);expect(await response.json()).toMatchObject(expected);
    }
    expect(stubs.execute).not.toHaveBeenCalled();
  });

  it("records an approved profile and its reason in one audited database call",async()=>{
    stubs.scope.mockResolvedValueOnce(universityId);stubs.bachsReady.mockResolvedValueOnce(true);stubs.execute.mockResolvedValueOnce({rows:[]});
    const response=await post("/pricing/bachs/profiles",validProfile());expect(response.status).toBe(201);
    expect(stubs.scope).toHaveBeenCalledWith(env,expect.anything(),universityId,"finance.review");expect(stubs.execute).toHaveBeenCalledOnce();
  });

  it("rejects saved previews outside the campus and mismatched payment contexts",async()=>{
    const body={universityId,profileId:"33333333-3333-4333-8333-333333333333",context:"LOCAL_CARD",amountKobo:600000};
    stubs.scope.mockResolvedValueOnce(universityId);stubs.bachsReady.mockResolvedValueOnce(true);stubs.execute.mockResolvedValueOnce({rows:[]});
    expect((await post("/pricing/bachs/preview",body)).status).toBe(404);
    stubs.scope.mockResolvedValueOnce(universityId);stubs.bachsReady.mockResolvedValueOnce(true);stubs.execute.mockResolvedValueOnce({rows:[{...validProfile(),id:body.profileId}]});
    expect((await post("/pricing/bachs/preview",body)).status).toBe(400);
  });
});
