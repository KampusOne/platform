import { describe,expect,it,vi,afterEach } from "vitest";
import { assertProfileContext,assertAccountReview,classifyPaystackContext,feeVariance,publishedProviderProfiles,pricingPreview,prepareCollectionInitialization,resolveProviderCollection } from "./payment-pricing";
import { collectionFeeKobo,checkoutPrice,listingPrice,publishedNigeriaLocalFees,roundDisplayKobo,type CommerceFees } from "./pricing";
import type { Bindings } from "../types";
const dbStub=vi.hoisted(()=>({execute:vi.fn()}));
vi.mock("./database",()=>({database:()=>({execute:dbStub.execute}),firstRow:(value:{rows:unknown[]})=>value.rows[0]}));
const policy:CommerceFees={id:"test",buyerBasisPoints:0,buyerFlatPerItemKobo:0,sellerCommissionBasisPoints:1000,collection:publishedNigeriaLocalFees,checkoutSavings:true,allowProcessorSubsidy:false};
afterEach(()=>{vi.restoreAllMocks();dbStub.execute.mockReset();});
describe("provider context and payment psychology",()=>{
  it("calculates all published local boundaries in integer minor units",()=>{
    for(const [amount,fee]of [[100,2],[100000,1500],[249900,3749],[250000,13750],[250100,13752],[500000,17500],[600000,19000],[1000000,25000],[5000000,85000],[10000000,160000],[12666666,200000],[12666667,200000],[15000000,200000]])expect(collectionFeeKobo(amount!,publishedNigeriaLocalFees)).toBe(fee);
  });
  it("keeps DVA, terminal and education reference profiles disabled and isolated",()=>{
    const now=Date.parse("2026-10-03T12:00:00Z"),p={transactionClass:"DEDICATED_VIRTUAL_ACCOUNT" as const,status:"APPROVED",effectiveFrom:"2026-10-03T00:00:00Z",effectiveTo:null};
    expect(()=>assertProfileContext(p,"ONLINE_COLLECTION","LOCAL_COLLECTION",now)).toThrow("different");
    expect(()=>assertProfileContext({...p,status:"DISABLED"},"DEDICATED_VIRTUAL_ACCOUNT","DEDICATED_VIRTUAL_ACCOUNT",now)).toThrow("disabled");
    expect(()=>assertProfileContext({...p,effectiveTo:"2026-10-03T10:00:00Z"},"DEDICATED_VIRTUAL_ACCOUNT","DEDICATED_VIRTUAL_ACCOUNT",now)).toThrow("expired");
    expect(publishedProviderProfiles.every(p=>p.status==="DISABLED")).toBe(true);
    expect(publishedProviderProfiles.find(p=>p.transactionClass==="VIRTUAL_TERMINAL_TRANSFER")!.collection).toMatchObject({basisPoints:50,capKobo:50000});
    expect(classifyPaystackContext("bank_transfer","US",null)).toBe("LOCAL_COLLECTION");
    expect(classifyPaystackContext("card","US","AMERICAN EXPRESS")).toBe("INTERNATIONAL_AMEX");
    expect(classifyPaystackContext("card","GB","VISA")).toBe("INTERNATIONAL_CARD");
  });
  it("requires reviewed merchant-mode-specific pass-fees-disabled evidence",()=>{
    expect(()=>assertAccountReview(null,"live")).toThrow("paused");
    expect(()=>assertAccountReview({pass_fees_disabled:false,provider_mode:"live",expires_at:null},"live")).toThrow("paused");
    expect(()=>assertAccountReview({pass_fees_disabled:true,provider_mode:"test",expires_at:null},"live")).toThrow("paused");
    expect(()=>assertAccountReview({pass_fees_disabled:true,provider_mode:"live",expires_at:null},"live")).not.toThrow();
  });
  it("tracks real rounding adjustments and refuses unfunded downward rounding or excessive markups",()=>{
    expect(roundDisplayKobo(600123,{...publishedNigeriaLocalFees,roundingMode:"NONE"})).toBe(600123);
    expect(roundDisplayKobo(600123,{...publishedNigeriaLocalFees,roundingMode:"CEIL_50"})).toBe(605000);
    expect(roundDisplayKobo(600123,{...publishedNigeriaLocalFees,roundingMode:"CEIL_100"})).toBe(610000);
    expect(()=>roundDisplayKobo(600123,{...publishedNigeriaLocalFees,roundingMode:"NEAREST_50"})).toThrow("subsidy");
    expect(roundDisplayKobo(600123,{...publishedNigeriaLocalFees,roundingMode:"NEAREST_50"},true)).toBe(600000);
    expect(()=>roundDisplayKobo(600123,{...publishedNigeriaLocalFees,roundingMode:"CEIL_100",maxPricingAdjustmentKobo:1000})).toThrow("maximum");
    const p=pricingPreview(550000,{...publishedNigeriaLocalFees,roundingMode:"CEIL_100"});expect(p.pricingAdjustmentKobo).toBe(p.finalAmountKobo-p.rawRequirementKobo);expect(p.netKobo).toBeGreaterThanOrEqual(550000);
  });
  it("conserves fee allocations for every bearer and retains the exact accepted total",()=>{
    for(const feeBearer of ["PLATFORM_ABSORBS","SELLER_ABSORBS","BUYER_VISIBLE","INCLUDED_IN_PRICE","SPLIT"] as const){
      const p={...policy,feeBearer,feeSplit:{platformBasisPoints:2000,buyerBasisPoints:4000,sellerBasisPoints:4000}},q=checkoutPrice([{baseKobo:600000,quantity:1}],p,null),fee=q.feeAllocation;
      expect(fee.buyerKobo+fee.sellerKobo+fee.platformKobo).toBe(q.estimatedProcessingKobo);
      expect(q.totalKobo).toBe(q.payableKobo);expect(q.totalKobo).toBe(listingPrice(600000,p).customerPriceKobo);expect(q.sellerNetKobo+q.estimatedProcessingKobo+q.projectedPlatformNetKobo).toBe(q.payableKobo);
      expect(q.visibleProcessingKobo).toBe(feeBearer==="BUYER_VISIBLE"?fee.buyerKobo:0);
    }
    expect(listingPrice(0,policy)).toMatchObject({rawRequirementKobo:0,pricingAdjustmentKobo:0});
    expect(checkoutPrice([{baseKobo:600000,quantity:1}],{...policy,minimumCommissionKobo:100000,maximumCommissionKobo:null},null).sellerCommissionKobo).toBe(100000);
    expect(()=>checkoutPrice([{baseKobo:600000,quantity:1}],{...policy,minimumCommissionKobo:100000,maximumCommissionKobo:50000},null)).toThrow("Minimum");
  });
  it("records signed fee variance without changing customer principal",()=>{
    expect(feeVariance(19000,19000,0)).toEqual({varianceKobo:0,alert:false});expect(feeVariance(19000,19200,100)).toEqual({varianceKobo:200,alert:true});expect(feeVariance(19000,18900,100)).toEqual({varianceKobo:-100,alert:false});
  });
  it("checks the selected cart total against the adjustment limit and economic minimum",()=>{
    const strict={...policy,sellerCommissionBasisPoints:1000,checkoutSavings:false,roundingMode:"NONE" as const,maxPricingAdjustmentKobo:0};
    expect(()=>checkoutPrice([{baseKobo:100000,quantity:10}],strict,null)).toThrow("approved price adjustment");
    expect(()=>checkoutPrice([{baseKobo:50000,quantity:5}],{...policy,roundingMode:"NONE"},null)).toThrow("economic minimum");
    expect(checkoutPrice([{baseKobo:50000,quantity:5}],{...policy,roundingMode:"NONE",allowProcessorSubsidy:true},null).pricingAdjustmentKobo).toBeLessThan(0);
  });
});

const oldProfile={id:"33333333-3333-4333-8333-333333333333",version:"v1",transactionClass:"LOCAL_COLLECTION" as const,channel:"ANY",cardNetwork:"ANY",status:"APPROVED",effectiveFrom:"2026-10-01T00:00:00Z",effectiveTo:null,collection:publishedNigeriaLocalFees};
const latestProfile={...oldProfile,id:"44444444-4444-4444-8444-444444444444",version:"v2"};
const env={ENVIRONMENT:"staging",DATABASE_URL:"postgres://synthetic.invalid/db",PAYSTACK_SECRET_KEY:"sk_test_synthetic"}as Bindings;
describe("current provider eligibility",()=>{
  it("accepts a durably imported approved native rule for ordinary checkout",async()=>{
    const imported={...oldProfile,version:'LEGACY_approved-native-policy'};
    dbStub.execute.mockResolvedValueOnce({rows:[{ready:true}]}).mockResolvedValueOnce({rows:[imported]}).mockResolvedValueOnce({rows:[imported]});
    expect(await resolveProviderCollection(env,"11111111-1111-4111-8111-111111111111")).toMatchObject({providerProfileId:imported.id,providerProfileVersion:imported.version,basisPoints:150});
  });
  it("refuses new quotes pinned to a superseded profile or a disabled current successor",async()=>{
    dbStub.execute.mockResolvedValueOnce({rows:[{ready:true}]}).mockResolvedValueOnce({rows:[oldProfile]}).mockResolvedValueOnce({rows:[latestProfile]});
    await expect(resolveProviderCollection(env,"11111111-1111-4111-8111-111111111111",oldProfile.id)).rejects.toThrow("previous provider version");
    dbStub.execute.mockResolvedValueOnce({rows:[{ready:true}]}).mockResolvedValueOnce({rows:[oldProfile]}).mockResolvedValueOnce({rows:[{...latestProfile,status:"DISABLED"}]});
    await expect(resolveProviderCollection(env,"11111111-1111-4111-8111-111111111111",oldProfile.id)).rejects.toThrow("disabled");
  });
  it("allows an accepted historical price only while the current context remains approved",async()=>{
    const native={university_id:"11111111-1111-4111-8111-111111111111",profile_id:oldProfile.id},review={pass_fees_disabled:true,provider_mode:"test",expires_at:null};
    dbStub.execute.mockResolvedValueOnce({rows:[{ready:true}]}).mockResolvedValueOnce({rows:[review]}).mockResolvedValueOnce({rows:[native]}).mockResolvedValueOnce({rows:[{ready:true}]}).mockResolvedValueOnce({rows:[{...oldProfile,effectiveTo:"2026-10-02T00:00:00Z"}]}).mockResolvedValueOnce({rows:[latestProfile]}).mockResolvedValueOnce({rows:[{provider_reference:"K1-O-history",fee_profile_id:oldProfile.id,fee_profile_version:"v1"}]});
    expect(await prepareCollectionInitialization(env,"K1-O-history",600000,{})).toMatchObject({fee_profile_version:"v1"});
    dbStub.execute.mockResolvedValueOnce({rows:[{ready:true}]}).mockResolvedValueOnce({rows:[review]}).mockResolvedValueOnce({rows:[native]}).mockResolvedValueOnce({rows:[{ready:true}]}).mockResolvedValueOnce({rows:[oldProfile]}).mockResolvedValueOnce({rows:[{...latestProfile,status:"DISABLED"}]});
    await expect(prepareCollectionInitialization(env,"K1-O-history",600000,{})).rejects.toThrow("disabled");
  });
});
