"use client";

import { useEffect, useState, type FormEvent } from "react";
import { portalApi } from "@/lib/api";
import { PortalShell } from "./portal-shell";
import { useAdminContext } from "./admin-context";
import { DiscountCodes } from "./discount-codes";
import { KiraPricePlan } from "./kira-price-plan";
import { TransferCostPolicies } from "./transfer-cost-policies";
import { FinanceRefunds } from "./finance-refunds";
import { BachsPricingControls } from "./bachs-pricing-controls";
import {
  PaymentPricingControls,
  validProviderProfiles,
  type ProviderFeeProfile,
} from "./payment-pricing-controls";

type Policy = {
  id: string;
  university_id: string;
  kind: string;
  version: string;
  active: boolean;
  buyer_basis_points: number;
  seller_commission_basis_points: number;
  approved_at: string;
  policy_config?: {
    providerProfileId?: string;
    roundingMode?: string;
    maxPricingAdjustmentKobo?: number;
    feeBearer?: string;
    customerFeeDisplay?: string;
    minimumCommissionKobo?: number;
    maximumCommissionKobo?: number | null;
  };
};
type Fees = {
  basisPoints: number;
  flatKobo: number;
  flatWaivedBelowKobo: number;
  capKobo: number | null;
};
type Result = {
  ready: boolean;
  policies: Policy[];
  publishedLocalBaseline: Fees;
};
type Zone = {
  id: string;
  university_id: string;
  name: string;
  route_distance_metres: number | null;
  base_fee_kobo: number;
  rider_earning_kobo: number | null;
};
type Receipt = {
  provider_reference: string;
  purpose: string;
  amount_kobo: number;
  provider_fee_kobo: number;
  estimated_processing_kobo: number | null;
  allocated: boolean;
  paid_at: string;
};
type Preview = {
  listings: {
    customerPriceKobo: number;
    rawRequirementKobo: number;
    pricingAdjustmentKobo: number;
  }[];
  checkout: {
    payableKobo: number;
    sellerNetKobo: number;
    estimatedProcessingKobo: number;
    projectedPlatformNetKobo: number;
    rawRequirementKobo: number;
    pricingAdjustmentKobo: number;
    visibleProcessingKobo: number;
    feeAllocation: {
      buyerKobo: number;
      sellerKobo: number;
      platformKobo: number;
      feeKobo: number;
    };
  };
  approved: false;
};
const money = (value: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    Number(value) / 100,
  );
function minor(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new Error("Enter a valid amount with up to two decimal places.");
  const [whole, decimal = ""] = value.split(".");
  const n = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n > 2_000_000_000)
    throw new Error("This value is outside the supported range.");
  return n;
}
function validMinor(value: unknown) {
  return (
    (typeof value === "number" ||
      (typeof value === "string" && /^\d+$/.test(value))) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) >= 0 &&
    Number(value) <= 2_000_000_000
  );
}
function validPolicy(policy: Policy) {
  if (
    !policy ||
    typeof policy !== "object" ||
    ![
      policy.id,
      policy.university_id,
      policy.version,
      policy.approved_at,
    ].every((value) => typeof value === "string") ||
    !["STORE", "TUTORIAL"].includes(policy.kind) ||
    typeof policy.active !== "boolean" ||
    ![policy.buyer_basis_points, policy.seller_commission_basis_points].every(
      validMinor,
    )
  )
    return false;
  const config = policy.policy_config;
  return (
    config === undefined ||
    config === null ||
    (typeof config === "object" &&
      !Array.isArray(config) &&
      (config.feeBearer === undefined ||
        typeof config.feeBearer === "string") &&
      (config.customerFeeDisplay === undefined ||
        typeof config.customerFeeDisplay === "string") &&
      (config.roundingMode === undefined ||
        typeof config.roundingMode === "string") &&
      (config.minimumCommissionKobo === undefined ||
        validMinor(config.minimumCommissionKobo)) &&
      (config.maximumCommissionKobo == null ||
        validMinor(config.maximumCommissionKobo)) &&
      (config.maxPricingAdjustmentKobo === undefined ||
        validMinor(config.maxPricingAdjustmentKobo)))
  );
}
function validPreview(value: Preview) {
  return (
    value &&
    value.approved === false &&
    Array.isArray(value.listings) &&
    value.listings.length > 0 &&
    value.listings.every(
      (listing) =>
        listing &&
        typeof listing === "object" &&
        [
          listing.customerPriceKobo,
          listing.rawRequirementKobo,
          listing.pricingAdjustmentKobo,
        ].every(Number.isSafeInteger) &&
        listing.customerPriceKobo >= 0 &&
        listing.rawRequirementKobo >= 0 &&
        listing.rawRequirementKobo + listing.pricingAdjustmentKobo ===
          listing.customerPriceKobo,
    ) &&
    value.checkout &&
    [
      value.checkout.payableKobo,
      value.checkout.sellerNetKobo,
      value.checkout.estimatedProcessingKobo,
      value.checkout.projectedPlatformNetKobo,
      value.checkout.rawRequirementKobo,
      value.checkout.pricingAdjustmentKobo,
      value.checkout.visibleProcessingKobo,
    ].every(Number.isSafeInteger) &&
    value.checkout.feeAllocation &&
    [
      value.checkout.feeAllocation.buyerKobo,
      value.checkout.feeAllocation.sellerKobo,
      value.checkout.feeAllocation.platformKobo,
      value.checkout.feeAllocation.feeKobo,
    ].every((amount) => Number.isSafeInteger(amount) && amount >= 0) &&
    value.checkout.payableKobo >= 0 &&
    value.checkout.sellerNetKobo >= 0 &&
    value.checkout.rawRequirementKobo >= 0 &&
    value.checkout.visibleProcessingKobo >= 0 &&
    value.checkout.visibleProcessingKobo <= value.checkout.payableKobo &&
    value.checkout.payableKobo - value.checkout.rawRequirementKobo ===
      value.checkout.pricingAdjustmentKobo &&
    value.checkout.feeAllocation.feeKobo ===
      value.checkout.estimatedProcessingKobo &&
    value.checkout.feeAllocation.buyerKobo +
      value.checkout.feeAllocation.sellerKobo +
      value.checkout.feeAllocation.platformKobo ===
      value.checkout.feeAllocation.feeKobo
  );
}

export function FinancePolicies() {
  const { scope } = useAdminContext();
  return <FinancePolicyEditor key={scope} />;
}
function FinancePolicyEditor() {
  const { access, scope, can, scopedPath } = useAdminContext(),
    allowed = can("finance.view"),
    mayApprove = can("finance.review");
  const [result, setResult] = useState<Result | null>(null),
    [receipts, setReceipts] = useState<Receipt[]>([]),
    [zones, setZones] = useState<Zone[]>([]),
    [providerProfiles, setProviderProfiles] = useState<ProviderFeeProfile[]>(
      [],
    ),
    [providerReady, setProviderReady] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [policyError, setPolicyError] = useState(""),
    [version, setVersion] = useState(0),
    [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    universityId: scope,
    kind: "STORE",
    version: "",
    buyerPercent: "",
    buyerFlat: "0",
    sellerPercent: "",
    sourceUrl: "https://paystack.com/pricing",
    note: "",
    samplePrice: "3500",
    sampleQuantity: "1",
    checkoutSavings: true,
    allowProcessorSubsidy: false,
    providerProfileId: "",
    feeBearer: "INCLUDED_IN_PRICE",
    customerFeeDisplay: "INCLUDED",
    platformShare: "100",
    sellerShare: "0",
    buyerShare: "0",
    roundingMode: "NONE",
    maxAdjustment: "0",
    minimumCommission: "0",
    maximumCommission: "",
  });
  const [preview, setPreview] = useState<Preview | null>(null),
    [acceptedPreview, setAcceptedPreview] = useState(false),
    [zoneId, setZoneId] = useState(""),
    [distance, setDistance] = useState(""),
    [zoneReason, setZoneReason] = useState("");
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    void Promise.all([
      portalApi<Result>(scopedPath("/v1/admin/finance/fee-policies"), {
        signal: controller.signal,
      }),
      portalApi<{ zones: Zone[] }>(
        scopedPath("/v1/admin/finance/delivery-zones"),
        { signal: controller.signal },
      ),
      portalApi<{ receipts: Receipt[] }>(
        scopedPath("/v1/admin/finance/receipts"),
        { signal: controller.signal },
      ),
      portalApi<{
        ready: boolean;
        profiles: ProviderFeeProfile[];
        publishedProfiles: Partial<ProviderFeeProfile>[];
      }>(scopedPath("/v1/admin/finance/payment-pricing/profiles"), {
        signal: controller.signal,
      }),
    ])
      .then(([r, z, p, profiles]) => {
        if (
          !r ||
          typeof r.ready !== "boolean" ||
          !Array.isArray(r.policies) ||
          !r.policies.every(validPolicy) ||
          !Array.isArray(z?.zones) ||
          !z.zones.every(
            (zone) =>
              zone &&
              typeof zone === "object" &&
              [zone.id, zone.university_id, zone.name].every(
                (value) => typeof value === "string",
              ) &&
              (zone.route_distance_metres === null ||
                validMinor(zone.route_distance_metres)),
          ) ||
          !Array.isArray(p?.receipts) ||
          !p.receipts.every(
            (receipt) =>
              receipt &&
              typeof receipt === "object" &&
              [
                receipt.provider_reference,
                receipt.purpose,
                receipt.paid_at,
              ].every((value) => typeof value === "string") &&
              typeof receipt.allocated === "boolean" &&
              [receipt.amount_kobo, receipt.provider_fee_kobo].every(
                validMinor,
              ) &&
              (receipt.estimated_processing_kobo === null ||
                validMinor(receipt.estimated_processing_kobo)),
          ) ||
          !validProviderProfiles(profiles)
        )
          throw new Error("Finance settings could not be read. Try again.");
        if (!controller.signal.aborted) {
          setResult(r);
          setZones(z.zones);
          setReceipts(p.receipts);
          setProviderProfiles(profiles.profiles);
          setProviderReady(profiles.ready);
          setError("");
        }
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Finance settings could not load.",
          );
      });
    return () => controller.abort();
  }, [allowed, scopedPath, version]);
  function change(field: string, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
    setPreview(null);
    setAcceptedPreview(false);
    setNotice("");
    setPolicyError("");
  }
  const selectedProfile = providerProfiles.find(
    (profile) =>
      profile.id === form.providerProfileId &&
      profile.universityId === form.universityId,
  );
  function payload() {
    if (!form.universityId)
      throw new Error("Choose the campus this policy applies to.");
    if (
      !selectedProfile ||
      selectedProfile.status !== "APPROVED" ||
      selectedProfile.transactionClass !== "LOCAL_COLLECTION"
    )
      throw new Error(
        "Choose a currently effective, approved local online collection profile for this campus.",
      );
    if (form.version.trim().length < 3)
      throw new Error(
        "Enter a new policy version of at least three characters.",
      );
    const buyerBasisPoints = minor(form.buyerPercent),
      sellerCommissionBasisPoints = minor(form.sellerPercent);
    if (buyerBasisPoints >= 10000 || sellerCommissionBasisPoints >= 10000)
      throw new Error(
        "Buyer markup and seller commission must each be below 100%.",
      );
    const minimumCommissionKobo = minor(form.minimumCommission),
      maximumCommissionKobo = form.maximumCommission
        ? minor(form.maximumCommission)
        : null;
    if (
      maximumCommissionKobo !== null &&
      maximumCommissionKobo < minimumCommissionKobo
    )
      throw new Error(
        "Maximum commission must be at least the minimum commission.",
      );
    const feeSplit =
      form.feeBearer === "SPLIT"
        ? {
            platformBasisPoints: minor(form.platformShare),
            sellerBasisPoints: minor(form.sellerShare),
            buyerBasisPoints: minor(form.buyerShare),
          }
        : undefined;
    if (
      feeSplit &&
      feeSplit.platformBasisPoints +
        feeSplit.sellerBasisPoints +
        feeSplit.buyerBasisPoints !==
        10000
    )
      throw new Error(
        "Platform, seller and buyer fee shares must total exactly 100%.",
      );
    if (
      form.feeBearer === "BUYER_VISIBLE" &&
      form.customerFeeDisplay !== "SEPARATE"
    )
      throw new Error(
        "Buyer-visible processing must appear as a separate line before payment.",
      );
    if (form.note.trim().length < 10)
      throw new Error(
        "Add the reason and evidence for this policy (at least ten characters).",
      );
    return {
      universityId: form.universityId,
      kind: form.kind,
      version: form.version.trim(),
      buyerBasisPoints,
      buyerFlatPerItemKobo: minor(form.buyerFlat),
      sellerCommissionBasisPoints,
      collection: selectedProfile.collection,
      providerProfileId: selectedProfile.id,
      feeBearer: form.feeBearer,
      customerFeeDisplay: form.customerFeeDisplay,
      feeSplit,
      roundingMode: form.roundingMode,
      maxPricingAdjustmentKobo: minor(form.maxAdjustment),
      minimumCommissionKobo,
      maximumCommissionKobo,
      sourceUrl: form.sourceUrl,
      approvalNote: form.note,
      checkoutSavings: form.checkoutSavings,
      allowProcessorSubsidy: form.allowProcessorSubsidy,
    };
  }
  async function review(event: FormEvent) {
    event.preventDefault();
    if (busy || !mayApprove) return;
    setBusy(true);
    setNotice("");
    setPolicyError("");
    setPreview(null);
    setAcceptedPreview(false);
    try {
      const quantity = Number(form.sampleQuantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100)
        throw new Error(
          "Sample quantity must be a whole number from 1 to 100.",
        );
      const data = payload(),
        p = await portalApi<Preview>("/v1/admin/finance/fee-policy-preview", {
          method: "POST",
          body: JSON.stringify({
            ...data,
            samples: [
              {
                baseKobo: minor(form.samplePrice),
                quantity,
              },
            ],
          }),
        });
      if (!validPreview(p))
        throw new Error(
          "The server preview was incomplete. Try again before approving this policy.",
        );
      setPreview(p);
    } catch (e) {
      setPolicyError(
        e instanceof Error ? e.message : "The policy could not be previewed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (
      !preview ||
      !acceptedPreview ||
      busy ||
      !mayApprove ||
      !result?.ready ||
      !providerReady
    )
      return;
    setBusy(true);
    setNotice("");
    setPolicyError("");
    try {
      const response = await portalApi<{ id: string }>(
        "/v1/admin/finance/fee-policies",
        {
          method: "POST",
          body: JSON.stringify(payload()),
        },
      );
      if (!response || typeof response.id !== "string")
        throw new Error(
          "Policy approval was not confirmed. Refresh approved versions before retrying.",
        );
      setPreview(null);
      setAcceptedPreview(false);
      setVersion((v) => v + 1);
      setNotice(
        "Policy approved and audited. New listings use this version; existing quotes keep their totals.",
      );
    } catch (e) {
      setPolicyError(
        e instanceof Error ? e.message : "This policy could not be approved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function checkRates() {
    setBusy(true);
    setNotice("");
    try {
      if (!form.universityId)
        throw new Error("Choose a campus for the fee-check audit.");
      const r = await portalApi<{
        status: string;
        checkedAt: string;
        message: string;
      }>("/v1/admin/finance/check-published-fees", {
        method: "POST",
        body: JSON.stringify({ universityId: form.universityId }),
      });
      setNotice(
        `${r.status === "BASELINE_FOUND" ? "Published baseline found" : "Published rates need manual review"} · ${new Date(r.checkedAt).toLocaleString()}. ${r.message}`,
      );
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : "The published rates could not be checked.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveZone(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const selected = zones.find((z) => z.id === zoneId);
      if (!selected) throw new Error("Choose a delivery zone.");
      await portalApi(`/v1/admin/finance/delivery-zones/${zoneId}/distance`, {
        method: "PUT",
        body: JSON.stringify({
          universityId: selected.university_id,
          distanceMetres: Number(distance),
          reason: zoneReason,
        }),
      });
      setVersion((v) => v + 1);
      setNotice(
        "Campus zone distance and future fare quotes updated. Existing ride quotes keep their agreed fare.",
      );
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "This distance could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  const fields = [
    ["version", "Policy version"],
    ["buyerPercent", "Buyer markup (%)"],
    ["buyerFlat", "Buyer amount per item (₦)"],
    ["sellerPercent", "Seller commission (%)"],
    ["minimumCommission", "Minimum commission (₦)"],
    ["maximumCommission", "Maximum commission (₦, optional)"],
    ["maxAdjustment", "Maximum price adjustment (₦)"],
    ["samplePrice", "Sample seller price (₦)"],
    ["sampleQuantity", "Sample quantity"],
  ] as const;
  return (
    <PortalShell
      active="admin"
      eyebrow="Finance controls"
      title="Payment & pricing"
      description="Set Kira prices and discounts, confirm checkout setup, and review your payment records."
    >
      {!allowed ? (
        <section className="state-panel">
          <h2>Finance access required</h2>
          <p>Your staff permissions do not include this workspace.</p>
        </section>
      ) : (
        <>
          {error ? (
            <section className="state-panel state-panel--error" role="alert">
              <p>{error}</p>
              <button
                className="button button--secondary"
                onClick={() => setVersion((v) => v + 1)}
              >
                Try again
              </button>
            </section>
          ) : null}
          {!result && !error ? (
            <section className="panel" aria-busy="true">
              <p>Loading approved policies…</p>
            </section>
          ) : null}
          {notice ? (
            <p className="notice" role="status">
              {notice}
            </p>
          ) : null}
          {result && !result.ready ? (
            <section className="state-panel">
              <h2>Financial update queued</h2>
              <p>
                Policy approval and rider fares become available after the
                queued database migrations. You can preview calculations now.
              </p>
            </section>
          ) : null}
          <KiraPricePlan />
          <details className="panel">
            <summary>Advanced provider and payment policies</summary>
            <p className="field-help">
              Review detailed provider rates, account attestations and pricing alerts when you need them.
            </p>
            <PaymentPricingControls
              onProfilesChanged={() => {
                setVersion((value) => value + 1);
                setPreview(null);
                setAcceptedPreview(false);
              }}
            />
            <BachsPricingControls />
            <TransferCostPolicies />
          </details>
          <FinanceRefunds />
          <DiscountCodes />
          <section className="panel">
            <h2>Approved policy versions</h2>
            <div className="table-scroll">
              <table className="operational-table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Scope</th>
                    <th>Buyer markup</th>
                    <th>Seller commission</th>
                    <th>Processing & display</th>
                    <th>Rounding</th>
                    <th>State</th>
                    <th>Approved</th>
                  </tr>
                </thead>
                <tbody>
                  {result?.policies.map((p) => (
                    <tr key={p.id}>
                      <td>{p.version}</td>
                      <td>
                        {access?.universities?.find(
                          (u) => u.id === p.university_id,
                        )?.name ?? p.university_id}{" "}
                        · {p.kind.toLowerCase()}
                      </td>
                      <td>{p.buyer_basis_points / 100}%</td>
                      <td>
                        {p.seller_commission_basis_points / 100}%
                        {p.policy_config?.minimumCommissionKobo !==
                        undefined ? (
                          <span className="record-meta">
                            Minimum{" "}
                            {money(p.policy_config.minimumCommissionKobo)}
                            {p.policy_config.maximumCommissionKobo != null
                              ? ` · maximum ${money(p.policy_config.maximumCommissionKobo)}`
                              : ""}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {p.policy_config?.feeBearer
                          ?.replaceAll("_", " ")
                          .toLowerCase() ?? "Original policy"}
                        <span className="record-meta">
                          {p.policy_config?.customerFeeDisplay === "SEPARATE"
                            ? "Processing shown before payment"
                            : "Processing included in total"}
                        </span>
                      </td>
                      <td>
                        {p.policy_config?.roundingMode
                          ?.replaceAll("_", " ")
                          .toLowerCase() ?? "Original rule"}
                        {p.policy_config?.maxPricingAdjustmentKobo !==
                        undefined ? (
                          <span className="record-meta">
                            Adjustment limit{" "}
                            {money(p.policy_config.maxPricingAdjustmentKobo)}
                          </span>
                        ) : null}
                      </td>
                      <td>{p.active ? "Active" : "Previous version"}</td>
                      <td>{new Date(p.approved_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result && !result.policies.length ? (
              <p className="table-empty">
                No approved policy yet. Store and tutorial commissions remain
                unconfigured.
              </p>
            ) : null}
          </section>
          <section className="panel">
            <h2>Verified receipts & processing</h2>
            <p className="field-help">
              Actual processing comes from verified Paystack receipts. Held
              payments remain in the ledger for review before fulfilment or
              repayment is credited.
            </p>
            <div className="table-scroll">
              <table className="operational-table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Purpose</th>
                    <th>Received</th>
                    <th>Actual processing</th>
                    <th>Quote estimate</th>
                    <th>Allocation</th>
                    <th>Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r) => (
                    <tr key={r.provider_reference}>
                      <td>{r.provider_reference}</td>
                      <td>{r.purpose.replaceAll("_", " ").toLowerCase()}</td>
                      <td>{money(r.amount_kobo)}</td>
                      <td>{money(r.provider_fee_kobo)}</td>
                      <td>
                        {r.estimated_processing_kobo != null
                          ? money(r.estimated_processing_kobo)
                          : "—"}
                      </td>
                      <td>{r.allocated ? "Allocated" : "Held for review"}</td>
                      <td>{new Date(r.paid_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result && !receipts.length ? (
              <p className="table-empty">
                No verified receipts in this scope yet.
              </p>
            ) : null}
          </section>
          {mayApprove ? (
            <>
              <form className="panel form-stack" onSubmit={review}>
                <h2>Review a new price policy</h2>
                <p className="field-help">
                  Select an approved online collection profile, then review the
                  server&apos;s customer total and settlement. The economic
                  minimum must be covered unless you explicitly approve a
                  subsidy.
                </p>
                <fieldset
                  disabled={busy || !providerReady || Boolean(error)}
                  style={{ border: 0, padding: 0 }}
                >
                  <div className="form-grid">
                    <label>
                      Campus
                      <select
                        required
                        aria-label="Campus"
                        value={form.universityId}
                        onChange={(e) => {
                          change("universityId", e.target.value);
                          change("providerProfileId", "");
                        }}
                      >
                        <option value="">Choose campus</option>
                        {access?.universities?.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Approved online collection profile
                      <select
                        required
                        aria-label="Approved online collection profile"
                        value={form.providerProfileId}
                        onChange={(event) =>
                          change("providerProfileId", event.target.value)
                        }
                      >
                        <option value="">Choose approved profile</option>
                        {providerProfiles
                          .filter(
                            (profile) =>
                              profile.universityId === form.universityId &&
                              profile.transactionClass === "LOCAL_COLLECTION" &&
                              profile.status === "APPROVED",
                          )
                          .map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.version} · {profile.channel}
                            </option>
                          ))}
                      </select>
                      <span className="field-help">
                        DVA, terminal and education profiles cannot price
                        ordinary marketplace checkout. International checkout
                        needs its own verified context.
                      </span>
                    </label>
                    <label>
                      Product area
                      <select
                        aria-label="Product area"
                        value={form.kind}
                        onChange={(e) => change("kind", e.target.value)}
                      >
                        <option value="STORE">Store products</option>
                        <option value="TUTORIAL">Tutorials</option>
                      </select>
                    </label>
                    {fields.map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <input
                          required={key !== "maximumCommission"}
                          type={key === "version" ? "text" : "number"}
                          min={key === "version" ? undefined : 0}
                          max={
                            key === "sampleQuantity"
                              ? 100
                              : key === "buyerPercent" ||
                                  key === "sellerPercent"
                                ? 99.99
                                : undefined
                          }
                          step={
                            key === "sampleQuantity"
                              ? 1
                              : key === "version"
                                ? undefined
                                : "0.01"
                          }
                          minLength={key === "version" ? 3 : undefined}
                          maxLength={key === "version" ? 80 : undefined}
                          inputMode={key === "version" ? "text" : "decimal"}
                          value={form[key]}
                          onChange={(e) => change(key, e.target.value)}
                        />
                      </label>
                    ))}
                    <label>
                      Who bears collection processing?
                      <select
                        aria-label="Who bears collection processing?"
                        value={form.feeBearer}
                        onChange={(event) => {
                          change("feeBearer", event.target.value);
                          change(
                            "customerFeeDisplay",
                            event.target.value === "BUYER_VISIBLE"
                              ? "SEPARATE"
                              : "INCLUDED",
                          );
                        }}
                      >
                        <option value="INCLUDED_IN_PRICE">
                          Included in the customer price
                        </option>
                        <option value="PLATFORM_ABSORBS">
                          KampusOne absorbs
                        </option>
                        <option value="SELLER_ABSORBS">
                          Seller absorbs from settlement
                        </option>
                        <option value="BUYER_VISIBLE">
                          Buyer · shown before payment
                        </option>
                        <option value="SPLIT">
                          Reviewed platform / seller / buyer split
                        </option>
                      </select>
                    </label>
                    <label>
                      Customer fee display
                      <select
                        aria-label="Customer fee display"
                        value={form.customerFeeDisplay}
                        onChange={(event) =>
                          change("customerFeeDisplay", event.target.value)
                        }
                      >
                        <option
                          value="INCLUDED"
                          disabled={form.feeBearer === "BUYER_VISIBLE"}
                        >
                          Included in the accepted total
                        </option>
                        <option value="SEPARATE">
                          Separate line before the accepted total
                        </option>
                      </select>
                      <span className="field-help">
                        A separately displayed charge is already part of the
                        quoted total. It is never added after acceptance.
                      </span>
                    </label>
                    <label>
                      Price rounding
                      <select
                        aria-label="Price rounding"
                        value={form.roundingMode}
                        onChange={(event) =>
                          change("roundingMode", event.target.value)
                        }
                      >
                        <option value="NONE">
                          None · exact server calculation
                        </option>
                        <option value="NEAREST_50">Nearest ₦50</option>
                        <option value="CEIL_50">Round up to ₦50</option>
                        <option value="NEAREST_100">Nearest ₦100</option>
                        <option value="CEIL_100">Round up to ₦100</option>
                        <option value="FRIENDLY_9">Retail ending · ₦999</option>
                      </select>
                      <span className="field-help">
                        Nearest rounding can fall below the economic minimum and
                        needs an explicit subsidy. Every adjustment is stored.
                      </span>
                    </label>
                    <label>
                      Official source URL
                      <input
                        type="url"
                        required
                        value={form.sourceUrl}
                        onChange={(e) => change("sourceUrl", e.target.value)}
                      />
                    </label>
                    <label>
                      Approval note
                      <textarea
                        required
                        minLength={10}
                        maxLength={2000}
                        value={form.note}
                        onChange={(e) => change("note", e.target.value)}
                      />
                    </label>
                  </div>
                  {selectedProfile ? (
                    <p className="notice">
                      Selected rule: {selectedProfile.version} ·{" "}
                      {selectedProfile.collection.basisPoints / 100}% +{" "}
                      {money(selectedProfile.collection.flatKobo)} · flat waived
                      below{" "}
                      {money(selectedProfile.collection.flatWaivedBelowKobo)}
                      {selectedProfile.collection.capKobo === null
                        ? " · no cap"
                        : ` · capped at ${money(selectedProfile.collection.capKobo)}`}
                      . Server validation checks the effective window again.
                    </p>
                  ) : (
                    <p className="field-help">
                      Approve the campus provider profile above before creating
                      a marketplace policy.
                    </p>
                  )}
                  {form.feeBearer === "SPLIT" ? (
                    <fieldset className="sub-form">
                      <legend>Collection fee split</legend>
                      <div className="form-grid">
                        {(
                          [
                            ["platformShare", "KampusOne share (%)"],
                            ["sellerShare", "Seller share (%)"],
                            ["buyerShare", "Buyer share (%)"],
                          ] as const
                        ).map(([field, label]) => (
                          <label key={field}>
                            {label}
                            <input
                              required
                              type="number"
                              min={0}
                              max={100}
                              step="0.01"
                              value={form[field]}
                              onChange={(event) =>
                                change(field, event.target.value)
                              }
                            />
                          </label>
                        ))}
                      </div>
                      <p className="field-help" aria-live="polite">
                        All three shares must total exactly 100%. The backend
                        allocates actual monetary shares.
                      </p>
                    </fieldset>
                  ) : null}
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={form.checkoutSavings}
                      onChange={(e) =>
                        change("checkoutSavings", e.target.checked)
                      }
                    />
                    Offer checkout savings when transaction-level fees allow
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={form.allowProcessorSubsidy}
                      onChange={(e) =>
                        change("allowProcessorSubsidy", e.target.checked)
                      }
                    />
                    Explicitly authorize KampusOne to cover the economic minimum
                    when rounding or processing would otherwise leave a
                    shortfall
                  </label>
                  {policyError ? (
                    <p className="field-error" role="alert">
                      {policyError}
                    </p>
                  ) : null}
                  <div className="form-actions">
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => void checkRates()}
                    >
                      Check published Paystack rates
                    </button>
                    <button className="button button--primary" type="submit">
                      {busy ? "Checking policy…" : "Preview server calculation"}
                    </button>
                  </div>
                </fieldset>
                {preview ? (
                  <section aria-live="polite">
                    <h3>Server-calculated sample checkout</h3>
                    <dl className="detail-list">
                      <div>
                        <dt>Displayed unit price</dt>
                        <dd>
                          {money(preview.listings[0]?.customerPriceKobo ?? 0)}
                        </dd>
                      </div>
                      <div>
                        <dt>Raw checkout economic requirement</dt>
                        <dd>{money(preview.checkout.rawRequirementKobo)}</dd>
                      </div>
                      <div>
                        <dt>Recorded price adjustment</dt>
                        <dd>{money(preview.checkout.pricingAdjustmentKobo)}</dd>
                      </div>
                      <div>
                        <dt>Customer pays</dt>
                        <dd>{money(preview.checkout.payableKobo)}</dd>
                      </div>
                      <div>
                        <dt>Intended Paystack amount</dt>
                        <dd>{money(preview.checkout.payableKobo)}</dd>
                      </div>
                      <div>
                        <dt>Processing shown before payment</dt>
                        <dd>
                          {preview.checkout.visibleProcessingKobo
                            ? `${money(preview.checkout.visibleProcessingKobo)} · already in total`
                            : "Included; no separate buyer charge"}
                        </dd>
                      </div>
                      <div>
                        <dt>Seller receives</dt>
                        <dd>{money(preview.checkout.sellerNetKobo)}</dd>
                      </div>
                      <div>
                        <dt>Processing allocation · KampusOne</dt>
                        <dd>
                          {money(preview.checkout.feeAllocation.platformKobo)}
                        </dd>
                      </div>
                      <div>
                        <dt>Processing allocation · seller</dt>
                        <dd>
                          {money(preview.checkout.feeAllocation.sellerKobo)}
                        </dd>
                      </div>
                      <div>
                        <dt>Processing allocation · buyer</dt>
                        <dd>
                          {money(preview.checkout.feeAllocation.buyerKobo)}
                        </dd>
                      </div>
                      <div>
                        <dt>Estimated processing</dt>
                        <dd>
                          {money(preview.checkout.estimatedProcessingKobo)}
                        </dd>
                      </div>
                      <div>
                        <dt>Projected platform margin</dt>
                        <dd>
                          {money(preview.checkout.projectedPlatformNetKobo)}
                        </dd>
                      </div>
                    </dl>
                    <p className="field-help">
                      {preview.checkout.pricingAdjustmentKobo < 0 ||
                      preview.checkout.projectedPlatformNetKobo < 0
                        ? "The sample uses an explicit platform subsidy. Review the shortfall before approving."
                        : "The server has validated this sample against the pricing limits. All future quotes are checked again."}
                    </p>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={acceptedPreview}
                        onChange={(event) =>
                          setAcceptedPreview(event.target.checked)
                        }
                      />
                      I reviewed the customer total, economic requirement and
                      fee allocation for this version.
                    </label>
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={
                        busy ||
                        !result?.ready ||
                        !providerReady ||
                        !acceptedPreview
                      }
                      onClick={() => void approve()}
                    >
                      {busy
                        ? "Approving version…"
                        : "Approve this reviewed version"}
                    </button>
                  </section>
                ) : null}
              </form>
              <form className="panel" onSubmit={saveZone}>
                <h2>Review campus zone distance</h2>
                <p>
                  ₦300 through 1 km, then ₦50 for each next started kilometre,
                  capped at ₦450. Campus One commission is 10%; the rider keeps
                  90%.
                </p>
                <p className="field-help">
                  Zone distances are campus estimates. Quotes label them as
                  estimates. A cash fare stays with the rider; only its
                  commission becomes account debt. Four unpaid commissions pause
                  new rides.
                </p>
                <fieldset
                  disabled={busy || !result?.ready}
                  style={{ border: 0, padding: 0 }}
                >
                  <div className="form-grid">
                    <label>
                      Delivery zone
                      <select
                        required
                        value={zoneId}
                        onChange={(e) => {
                          setZoneId(e.target.value);
                          setDistance(
                            String(
                              zones.find((z) => z.id === e.target.value)
                                ?.route_distance_metres ?? "",
                            ),
                          );
                        }}
                      >
                        <option value="">Choose zone</option>
                        {zones.map((z) => (
                          <option key={z.id} value={z.id}>
                            {z.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Reviewed distance in metres
                      <input
                        required
                        type="number"
                        min={0}
                        max={100000}
                        step={1}
                        value={distance}
                        onChange={(e) => setDistance(e.target.value)}
                      />
                    </label>
                    <label>
                      Review reason
                      <textarea
                        required
                        minLength={10}
                        maxLength={1000}
                        value={zoneReason}
                        onChange={(e) => setZoneReason(e.target.value)}
                      />
                    </label>
                  </div>
                  <button className="button button--primary" type="submit">
                    Save reviewed distance
                  </button>
                </fieldset>
              </form>
            </>
          ) : null}
        </>
      )}
    </PortalShell>
  );
}
