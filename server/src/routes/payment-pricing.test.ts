import { Hono } from "hono";
import { afterEach,describe,expect,it,vi } from "vitest";
import { AppError } from "../lib/errors";
import type { Bindings,Variables } from "../types";
const stubs=vi.hoisted(()=>({execute:vi.fn(),scope:vi.fn(),permission:vi.fn(),ready:vi.fn()}));
vi.mock("../middleware/auth",()=>({requireAuth:async(_c:unknown,next:()=>Promise<void>)=>next(),currentUser:()=>({id:"22222222-2222-4222-8222-222222222222"})}));
vi.mock("../lib/admin-access",()=>({resolveAdminScope:stubs.scope,assertPermission:stubs.permission}));
vi.mock("../lib/database",()=>({database:()=>({execute:stubs.execute}),firstRow:(r:{rows:unknown[]})=>r.rows[0]}));
vi.mock("../lib/payment-pricing",async original=>({...await original<typeof import("../lib/payment-pricing")>(),paymentPricingReady:stubs.ready}));
import { paymentPricingRoutes,providerProfileSchema,accountReviewSchema } from "./payment-pricing";
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
