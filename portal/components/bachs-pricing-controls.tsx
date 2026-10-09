"use client";

import { useEffect, useState, type FormEvent } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
import { formatPricingMoney, pricingMinor } from "./payment-pricing-controls";

type Context = "CHECKOUT_BANK_TRANSFER" | "LOCAL_CARD" | "VIRTUAL_ACCOUNT_DEPOSIT" | "BANK_WITHDRAWAL";
type Profile = {
  id: string; universityId: string; version: string; context: Context; status: "APPROVED" | "DISABLED";
  collection: { basisPoints: number; flatKobo: number; flatWaivedBelowKobo: number; capKobo: number | null };
  effectiveFrom: string; effectiveTo: string | null; sourceUrl: string;
};
type Catalog = { ready: boolean; profiles: Profile[]; publishedProfiles: Profile[] };
type Preview = {
  referenceOnly: boolean;
  quote?: { finalCustomerAmountKobo: number; estimatedProviderFeeKobo: number; estimatedNetKobo: number; discountKobo: number; pricingAdjustmentKobo: number };
  withdrawal?: { recipientAmountKobo: number; providerFeeKobo: number; totalDebitKobo: number };
  deposit?: { amountKobo: number; estimatedProviderFeeKobo: number };
};
type FeeAlert = { quoteId: string; reference: string; context: Context; amountKobo: number; actualFeeKobo: number; varianceKobo: number; recordedAt: string };
const base = "/v1/admin/finance/payment-pricing/bachs";
const contexts: { id: Context; label: string }[] = [
  { id: "CHECKOUT_BANK_TRANSFER", label: "Checkout bank transfer" },
  { id: "LOCAL_CARD", label: "Nigerian card (beta)" },
  { id: "VIRTUAL_ACCOUNT_DEPOSIT", label: "Fixed virtual-account deposit" },
  { id: "BANK_WITHDRAWAL", label: "Merchant bank withdrawal" },
];
const label = (value: Context) => contexts.find(item => item.id === value)?.label ?? value;
const message = (error: unknown) => error instanceof Error ? error.message : "BACHS pricing could not be loaded.";
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const money = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2_000_000_000;
function isProfile(value: unknown): value is Profile {
  if (!object(value) || !object(value.collection)) return false;
  const fee = value.collection;
  return typeof value.id === "string" && typeof value.universityId === "string" && typeof value.version === "string" &&
    contexts.some(item => item.id === value.context) && typeof value.status === "string" && ["APPROVED", "DISABLED"].includes(value.status) &&
    money(fee.basisPoints) && fee.basisPoints < 10_000 && money(fee.flatKobo) && money(fee.flatWaivedBelowKobo) && (fee.capKobo === null || money(fee.capKobo));
}
function isCatalog(value: unknown): value is Catalog {
  return object(value) && typeof value.ready === "boolean" && Array.isArray(value.profiles) && value.profiles.every(isProfile) && Array.isArray(value.publishedProfiles) && value.publishedProfiles.every(isProfile);
}
function isPreview(value: unknown, context: Context): value is Preview {
  if (!object(value) || typeof value.referenceOnly !== "boolean") return false;
  const fields = context === "BANK_WITHDRAWAL" ? ["recipientAmountKobo", "providerFeeKobo", "totalDebitKobo"] : context === "VIRTUAL_ACCOUNT_DEPOSIT" ? ["amountKobo", "estimatedProviderFeeKobo"] : ["finalCustomerAmountKobo", "estimatedProviderFeeKobo", "estimatedNetKobo", "discountKobo", "pricingAdjustmentKobo"];
  const detail = context === "BANK_WITHDRAWAL" ? value.withdrawal : context === "VIRTUAL_ACCOUNT_DEPOSIT" ? value.deposit : value.quote;
  return object(detail) && fields.every(field => money(detail[field]));
}
function isFeeAlert(value: unknown): value is FeeAlert {
  return object(value) && typeof value.quoteId === "string" && typeof value.reference === "string" &&
    contexts.some(item => item.id === value.context) && money(value.amountKobo) && money(value.actualFeeKobo) &&
    typeof value.varianceKobo === "number" && Number.isSafeInteger(value.varianceKobo) && Math.abs(value.varianceKobo) <= 2_000_000_000 &&
    typeof value.recordedAt === "string" && Number.isFinite(Date.parse(value.recordedAt));
}

export function BachsPricingControls() {
  const { scope } = useAdminContext();
  return <ScopedBachsPricing key={scope} />;
}
function ScopedBachsPricing() {
  const { scope, can, scopedPath } = useAdminContext();
  const allowed = can("finance.view"), mayApprove = can("finance.review");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [alerts, setAlerts] = useState<FeeAlert[]>([]);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const [context, setContext] = useState<Context>("CHECKOUT_BANK_TRANSFER");
  const [profileId, setProfileId] = useState("");
  const [priceMode, setPriceMode] = useState<"FIXED_TOTAL" | "RECOVER_FEES">("FIXED_TOTAL");
  const [amount, setAmount] = useState("6000");
  const [delivery, setDelivery] = useState("0");
  const [platform, setPlatform] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [rounding, setRounding] = useState("CEIL_100");
  const [maxAdjustment, setMaxAdjustment] = useState("100");
  const [withdrawalMode, setWithdrawalMode] = useState("RECIPIENT_AMOUNT");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [version, setVersion] = useState("");
  const [rate, setRate] = useState("1.5");
  const [flat, setFlat] = useState("0");
  const [cap, setCap] = useState("2000");
  const [status, setStatus] = useState("DISABLED");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [sourceUrl, setSourceUrl] = useState("https://docs.bachs.io/for-you/fees");

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    void Promise.all([
      portalApi<unknown>(scopedPath(base + "/profiles"), { signal: controller.signal }),
      portalApi<unknown>(scopedPath(base + "/alerts"), { signal: controller.signal }),
    ]).then(([result, feeAlerts]) => {
        if (controller.signal.aborted) return;
        if (!isCatalog(result) || !object(feeAlerts) || !Array.isArray(feeAlerts.alerts) || !feeAlerts.alerts.every(isFeeAlert))
          throw new Error("BACHS pricing data is incomplete. Try again.");
        setCatalog(result); setAlerts(feeAlerts.alerts); setLoadError("");
      }).catch(error => { if (!controller.signal.aborted) setLoadError(message(error)); });
    return () => controller.abort();
  }, [allowed, scopedPath, revision]);

  function chooseContext(value: Context) {
    setContext(value); setProfileId(""); setPreview(null); setActionError("");
    const reference = catalog?.publishedProfiles.find(item => item.context === value);
    if (reference) {
      setRate(String(reference.collection.basisPoints / 100));
      setFlat(String(reference.collection.flatKobo / 100));
      setCap(reference.collection.capKobo === null ? "" : String(reference.collection.capKobo / 100));
    }
  }
  function edited() { setPreview(null); setActionError(""); setNotice(""); }
  async function simulate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!scope || busy) return;
    setBusy("preview"); setActionError(""); setPreview(null);
    try {
      const result = await portalApi<unknown>(base + "/preview", { method: "POST", body: JSON.stringify({
        universityId: scope, ...(profileId ? { profileId } : {}), context,
        amountKobo: pricingMinor(amount), priceMode,
        deliveryKobo: pricingMinor(delivery, "Delivery"), platformRevenueKobo: priceMode === "FIXED_TOTAL" ? 0 : pricingMinor(platform, "Platform revenue"),
        discountPercent: Number(discount), roundingMode: priceMode === "FIXED_TOTAL" ? "NONE" : rounding,
        maxPricingAdjustmentKobo: pricingMinor(maxAdjustment, "Maximum rounding adjustment"),
        withdrawalMode,
      }) });
      if (!isPreview(result, context)) throw new Error("The BACHS quote is incomplete. Try previewing again.");
      setPreview(result);
    } catch (error) { setActionError(message(error)); }
    finally { setBusy(null); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!scope || busy || !catalog?.ready) return;
    setBusy("save"); setActionError(""); setNotice("");
    try {
      const basisPoints = pricingMinor(rate, "Percentage");
      if (basisPoints >= 10_000) throw new Error("The rate must be below 100%.");
      await portalApi(base + "/profiles", { method: "POST", body: JSON.stringify({
        universityId: scope, version, context, collection: { basisPoints, flatKobo: pricingMinor(flat), flatWaivedBelowKobo: 0, capKobo: cap === "" ? null : pricingMinor(cap) },
        effectiveFrom: new Date().toISOString(), effectiveTo: null, status, varianceToleranceKobo: 100,
        sourceUrl, approvalNote: reason, eligibilityEvidence: evidence,
      }) });
      setNotice("BACHS fee version recorded. Checkout activation is managed separately.");
      setRevision(value => value + 1); setPreview(null); setVersion("");
    } catch (error) { setActionError(message(error)); }
    finally { setBusy(null); }
  }
  if (!allowed) return null;
  const checkout = context === "CHECKOUT_BANK_TRANSFER" || context === "LOCAL_CARD";
  return <section className="panel" aria-labelledby="bachs-pricing-heading">
    <h2 id="bachs-pricing-heading">BACHS pricing</h2>
    <p>Set processing costs before quoting a purchase. Kira keeps its exact discounted list price; fee recovery quotes include processing before payment.</p>
    <p>NGN bank withdrawals have their own fee. Marketplace seller transfers through BACHS Connect require their own approved terms.</p>
    {loadError ? <p className="notice notice--error" role="alert">{loadError} <button className="text-link" type="button" onClick={() => setRevision(value => value + 1)}>Try again</button></p> : !catalog ? <p aria-live="polite">Loading BACHS pricing…</p> : null}
    {catalog && !catalog.ready ? <p className="notice">The pricing database update is pending. Published rates are available for preview.</p> : null}
    {!scope ? <p className="notice">Select a university to preview or record pricing.</p> : null}
    {catalog ? <>
      <form onSubmit={simulate}>
        <fieldset disabled={!scope || busy !== null}>
          <legend>Check the final total</legend>
          <div className="form-grid">
            <label>Payment product<select value={context} onChange={event => chooseContext(event.target.value as Context)}>{contexts.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label>Fee version<select value={profileId} onChange={event => { setProfileId(event.target.value); edited(); }}>
              <option value="">Published reference · preview only</option>
              {catalog.profiles.filter(item => item.context === context && item.universityId === scope).map(item => <option key={item.id} value={item.id}>{item.version} · {item.status.toLowerCase()}</option>)}
            </select></label>
            <label>{context === "BANK_WITHDRAWAL" ? "Withdrawal amount (₦)" : "Item or plan amount (₦)"}<input required inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); edited(); }} /></label>
            {checkout ? <>
              <label>Price policy<select value={priceMode} onChange={event => { setPriceMode(event.target.value as typeof priceMode); edited(); }}><option value="FIXED_TOTAL">Fixed final price · Kira</option><option value="RECOVER_FEES">Include fee recovery · marketplace</option></select></label>
              <label>Discount on items (%)<input required type="number" min="0" max="90" step="1" value={discount} onChange={event => { setDiscount(event.target.value); edited(); }} /></label>
              <label>Delivery (₦)<input required inputMode="decimal" value={delivery} onChange={event => { setDelivery(event.target.value); edited(); }} /></label>
              {priceMode === "RECOVER_FEES" ? <>
                <label>Platform revenue before fee recovery (₦)<input required inputMode="decimal" value={platform} onChange={event => { setPlatform(event.target.value); edited(); }} /></label>
                <label>Price rounding<select value={rounding} onChange={event => { setRounding(event.target.value); edited(); }}><option value="NONE">Exact amount</option><option value="CEIL_50">Up to next ₦50</option><option value="CEIL_100">Up to next ₦100</option><option value="FRIENDLY_9">Retail ending in 999</option></select></label>
                <label>Maximum rounding adjustment (₦)<input required inputMode="decimal" value={maxAdjustment} onChange={event => { setMaxAdjustment(event.target.value); edited(); }} /></label>
              </> : null}
            </> : context === "BANK_WITHDRAWAL" ? <label>Amount means<select value={withdrawalMode} onChange={event => { setWithdrawalMode(event.target.value); edited(); }}><option value="RECIPIENT_AMOUNT">Amount the bank receives</option><option value="TOTAL_DEBIT">Maximum debit including fee</option></select></label> : null}
          </div>
          <button className="button button--secondary" type="submit">{busy === "preview" ? "Calculating…" : "Preview total"}</button>
        </fieldset>
      </form>
      {preview ? <div className="sub-form" aria-live="polite">
        <p>{preview.referenceOnly ? "Published rate simulation" : "Saved fee version simulation"}. This preview creates no payment.</p>
        {preview.quote ? <dl><dt>Customer total and BACHS amount</dt><dd>{formatPricingMoney(preview.quote.finalCustomerAmountKobo)}</dd><dt>Actual discount on items</dt><dd>{formatPricingMoney(preview.quote.discountKobo)}</dd><dt>Estimated processing inside total</dt><dd>{formatPricingMoney(preview.quote.estimatedProviderFeeKobo)}</dd><dt>Estimated proceeds</dt><dd>{formatPricingMoney(preview.quote.estimatedNetKobo)}</dd><dt>Recorded rounding adjustment</dt><dd>{formatPricingMoney(preview.quote.pricingAdjustmentKobo)}</dd></dl> : null}
        {preview.withdrawal ? <dl><dt>Bank receives</dt><dd>{formatPricingMoney(preview.withdrawal.recipientAmountKobo)}</dd><dt>Provider fee</dt><dd>{formatPricingMoney(preview.withdrawal.providerFeeKobo)}</dd><dt>Total balance debit</dt><dd>{formatPricingMoney(preview.withdrawal.totalDebitKobo)}</dd></dl> : null}
        {preview.deposit ? <dl><dt>Deposit</dt><dd>{formatPricingMoney(preview.deposit.amountKobo)}</dd><dt>Estimated virtual-account fee</dt><dd>{formatPricingMoney(preview.deposit.estimatedProviderFeeKobo)}</dd></dl> : null}
      </div> : null}
      {mayApprove ? <form onSubmit={save}>
        <fieldset disabled={!scope || !catalog.ready || busy !== null}>
          <legend>Record a new {label(context).toLowerCase()} fee version</legend>
          <div className="form-grid">
            <label>Version name<input required minLength={3} maxLength={120} value={version} onChange={event => setVersion(event.target.value)} /></label>
            <label>Processing rate (%)<input required inputMode="decimal" value={rate} onChange={event => setRate(event.target.value)} /></label>
            <label>Flat fee (₦)<input required inputMode="decimal" value={flat} onChange={event => setFlat(event.target.value)} /></label>
            <label>Fee cap (₦, blank for none)<input inputMode="decimal" value={cap} onChange={event => setCap(event.target.value)} /></label>
            <label>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="DISABLED">Disabled</option><option value="APPROVED">Approved</option></select></label>
            <label>Official pricing or account source<input required type="url" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} /></label>
            <label>Reason for this version<textarea required minLength={10} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></label>
            <label>Confirmed account capability and fee terms<textarea required minLength={10} maxLength={4000} value={evidence} onChange={event => setEvidence(event.target.value)} /></label>
          </div>
          <button className="button button--primary" type="submit">{busy === "save" ? "Recording…" : "Record fee version"}</button>
        </fieldset>
      </form> : null}
      {catalog.profiles.length ? <div className="table-scroll" role="region" aria-label="BACHS fee history" tabIndex={0}><table className="operational-table"><thead><tr><th>Product</th><th>Version</th><th>Status</th><th>Rate</th><th>Flat fee</th><th>Cap</th></tr></thead><tbody>{catalog.profiles.map(item => <tr key={item.id}><td>{label(item.context)}</td><td>{item.version}</td><td>{item.status.toLowerCase()}</td><td>{item.collection.basisPoints / 100}%</td><td>{formatPricingMoney(item.collection.flatKobo)}</td><td>{item.collection.capKobo === null ? "None" : formatPricingMoney(item.collection.capKobo)}</td></tr>)}</tbody></table></div> : <p>No BACHS fee versions have been recorded in this scope.</p>}
      <h3>Processing fee differences</h3>
      {alerts.length ? <div className="table-scroll" role="region" aria-label="BACHS fee differences" tabIndex={0}><table className="operational-table"><thead><tr><th>Reference</th><th>Product</th><th>Accepted total</th><th>Actual fee</th><th>Difference</th></tr></thead><tbody>{alerts.map(item => <tr key={item.quoteId}><td>{item.reference}</td><td>{label(item.context)}</td><td>{formatPricingMoney(item.amountKobo)}</td><td>{formatPricingMoney(item.actualFeeKobo)}</td><td>{item.varianceKobo < 0 ? "−" : "+"}{formatPricingMoney(Math.abs(item.varianceKobo))}</td></tr>)}</tbody></table></div> : <p>No BACHS processing fee differences require review in this scope.</p>}
    </> : null}
    {actionError ? <p className="field-error" role="alert">{actionError}</p> : null}
    {notice ? <p className="notice" role="status">{notice}</p> : null}
  </section>;
}
