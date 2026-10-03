"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";

type Tier = "standard" | "pro";
type Plan = {
  id: string;
  university_id: string;
  tier: Tier;
  version: string;
  amount_kobo: number;
  listed_amount_kobo: number;
  discount_percent: number;
  configured_discount_percent?: number;
  estimated_processing_kobo: number;
  expected_net_kobo?: number;
  active: boolean;
  available: boolean;
  offer_active: boolean;
  offer_starts_at: string | null;
  offer_ends_at: string | null;
  approved_at: string;
};
type Preview = {
  listedAmountKobo: number;
  amountKobo: number;
  discountPercent: number;
  discountAmountKobo: number;
  estimatedProcessingKobo: number;
  expectedNetKobo: number;
  offerActive: boolean;
  offerStartsAt: string | null;
  offerEndsAt: string | null;
};

export function KiraPricePlan() {
  const { scope } = useAdminContext();
  return <ScopedKiraPlan key={scope} />;
}

function ScopedKiraPlan() {
  const { scope, access, can, scopedPath } = useAdminContext();
  const [ready, setReady] = useState(false);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<{ input: string; price: Preview } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewRetry, setPreviewRetry] = useState(0);
  const previewTurn = useRef(0);
  const [form, setForm] = useState({
    universityId: scope,
    tier: "pro" as Tier,
    version: "",
    price: "6000",
    discount: "0",
    active: true,
    available: true,
    offerActive: false,
    offerStartsAt: "",
    offerEndsAt: "",
    sourceUrl: "https://paystack.com/pricing",
    note: "",
  });

  useEffect(() => {
    const controller = new AbortController();
    void portalApi<{ ready: boolean; plans: Plan[] }>(
      scopedPath("/v1/admin/finance/kira-plans"),
      { signal: controller.signal },
    ).then((result) => {
      if (!result || typeof result.ready !== "boolean" || !Array.isArray(result.plans))
        throw new Error("Kira plans could not be read. Try again.");
      if (!controller.signal.aborted) {
        setReady(result.ready);
        setPlans(result.plans);
        setError("");
      }
    }).catch((caught) => {
      if (!controller.signal.aborted)
        setError(caught instanceof Error ? caught.message : "Kira plans could not load.");
    });
    return () => controller.abort();
  }, [scopedPath, version]);

  const price = Number(form.price);
  const discountPercent = Number(form.discount);
  const startsAt = form.offerStartsAt ? Date.parse(form.offerStartsAt) : null;
  const endsAt = form.offerEndsAt ? Date.parse(form.offerEndsAt) : null;
  const moneyInputsValid = /^\d+(?:\.\d{1,2})?$/.test(form.price);
  const validSource = (() => {
    try { const source = new URL(form.sourceUrl); return source.protocol === "https:" && ["paystack.com", "support.paystack.com", "dashboard.paystack.com"].includes(source.hostname); }
    catch { return false; }
  })();
  const validation = !form.universityId
    ? "Choose the campus for this price."
    : !moneyInputsValid || ![price, discountPercent].every(Number.isFinite)
      ? "Enter valid amounts with no more than two decimal places."
      : (form.tier === "standard" && price !== 0 && price < 1000) || (form.tier === "pro" && price < 1000) || price > 1000000
        ? "Standard can be free or at least ₦1,000. Pro must be at least ₦1,000; the maximum is ₦1,000,000."
        : !/^\d+$/.test(form.discount) || !Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 90
          ? "Offer percentage must be a whole number from 0 to 90."
          : price === 0 && discountPercent !== 0
            ? "A free Standard plan cannot claim a percentage discount."
          : (startsAt !== null && !Number.isFinite(startsAt)) || (endsAt !== null && !Number.isFinite(endsAt)) || (startsAt !== null && endsAt !== null && endsAt <= startsAt)
              ? "Offer end must be after its start."
              : form.offerActive && (price === 0 || discountPercent === 0 || startsAt === null || endsAt === null)
                ? "An enabled offer needs a paid list price, a percentage, and start and end dates."
                : form.version.trim().length < 3 || form.version.trim().length > 80
                  ? "Add a new version name with 3 to 80 characters."
                  : !validSource
                    ? "Add an official Paystack HTTPS source for these processing rules."
                    : form.note.trim().length < 10 || form.note.trim().length > 2000
                      ? "Add approval evidence with 10 to 2,000 characters."
                      : "";
  const valid = validation === "";
  const input = valid ? JSON.stringify({
    universityId: form.universityId,
    tier: form.tier,
    version: form.version.trim(),
    amountKobo: Math.round(price * 100),
    discountPercent,
    active: form.active,
    available: form.available,
    offerActive: form.offerActive,
    offerStartsAt: startsAt === null ? null : new Date(startsAt).toISOString(),
    offerEndsAt: endsAt === null ? null : new Date(endsAt).toISOString(),
    sourceUrl: form.sourceUrl,
    approvalNote: form.note,
  }) : "";
  const currentPreview = preview?.input === input ? preview.price : null;

  useEffect(() => {
    const turn = ++previewTurn.current;
    if (!input || !ready || !can("finance.review")) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void portalApi<{ price: Preview }>("/v1/admin/finance/kira-plans/preview", {
        method: "POST",
        body: input,
        signal: controller.signal,
      }).then((result) => {
        if (!result?.price || !Number.isSafeInteger(result.price.amountKobo) || !Number.isSafeInteger(result.price.estimatedProcessingKobo) || !Number.isSafeInteger(result.price.expectedNetKobo))
          throw new Error("The server preview could not be read. Try again.");
        if (!controller.signal.aborted && turn === previewTurn.current) {
          setPreview({ input, price: result.price });
          setPreviewError("");
        }
      }).catch((caught) => {
        if (!controller.signal.aborted && turn === previewTurn.current)
          setPreviewError(caught instanceof Error ? caught.message : "The pricing preview could not load.");
      });
    }, 400);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [input, ready, can, previewRetry]);

  function change<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setNotice("");
    setPreviewError("");
  }

  async function approve(event: FormEvent) {
    event.preventDefault();
    if (busy || !valid || !ready || !can("finance.review") || !currentPreview) return;
    setBusy(true);
    setError("");
    try {
      await portalApi("/v1/admin/finance/kira-plans", { method: "POST", body: input });
      setNotice(`Kira ${tierName(form.tier)} version approved. Existing checkouts keep their agreed total.`);
      setVersion((current) => current + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The plan was not approved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Kira Standard and Pro pricing</h2>
      <p>Set a monthly list price, availability and a genuine scheduled percentage offer for each campus and tier. Standard defaults to free. Processing is included in the customer total; renewal is manual. Offers and discount codes do not combine.</p>
      {error ? <p className="notice notice--error" role="alert">{error} <button type="button" className="text-link" onClick={() => setVersion((current) => current + 1)}>Try again</button></p> : null}
      {!plans && !error ? <p aria-busy="true">Loading Kira plans…</p> : null}
      {plans && !ready ? <p>Subscription billing is awaiting the queued database update.</p> : null}
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      {plans?.length ? (
        <div className="table-scroll">
          <table className="operational-table">
            <thead><tr><th>Tier / campus</th><th>Version</th><th>List price</th><th>Customer total</th><th>Offer schedule</th><th>Expected processing</th><th>Status</th></tr></thead>
            <tbody>{plans.map((plan) => (
              <tr key={plan.id}>
                <td>{tierName(plan.tier ?? "pro")}<br />{access?.universities?.find((campus) => campus.id === plan.university_id)?.name ?? "Campus"}</td>
                <td>{plan.version}</td>
                <td>{formatMoney(plan.listed_amount_kobo)}</td>
                <td>{formatMoney(plan.amount_kobo)}</td>
                <td>{offerStatus(plan)}<br />{plan.offer_starts_at || plan.offer_ends_at ? `${formatDate(plan.offer_starts_at)} — ${formatDate(plan.offer_ends_at)}` : "No scheduled offer"}</td>
                <td>{formatMoney(plan.estimated_processing_kobo)}</td>
                <td>{plan.active ? plan.available ? "Active · available" : "Active · unavailable" : "Historical / inactive"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : ready ? <p>No Kira plan is approved for this scope. Standard remains free until a paid version is approved.</p> : null}
      {can("finance.review") ? (
        <form className="form-stack" onSubmit={approve}>
          <fieldset disabled={busy || !ready} style={{ border: 0, padding: 0 }}>
            <div className="form-grid">
              <label>Campus<select aria-label="Campus" required value={form.universityId} onChange={(event) => change("universityId", event.target.value)}><option value="">Choose campus</option>{access?.universities?.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}</select></label>
              <label>Tier<select value={form.tier} onChange={(event) => {
                const tier = event.target.value as Tier;
                setForm((current) => ({ ...current, tier, price: tier === "standard" ? "0" : "6000", discount: "0", offerActive: false }));
                setNotice("");
                setPreviewError("");
              }}><option value="standard">Kira Standard</option><option value="pro">Kira Pro</option></select></label>
              <label>Monthly list price · NGN<input type="number" required min={form.tier === "standard" ? 0 : 1000} max={1000000} step="0.01" value={form.price} onChange={(event) => change("price", event.target.value)} /></label>
              <label>Offer discount · %<input type="number" required min={0} max={90} step={1} value={form.discount} onChange={(event) => change("discount", event.target.value)} /></label>
              <label>Offer starts · local time<input type="datetime-local" required={form.offerActive} value={form.offerStartsAt} onChange={(event) => change("offerStartsAt", event.target.value)} /></label>
              <label>Offer ends · local time<input type="datetime-local" required={form.offerActive} value={form.offerEndsAt} onChange={(event) => change("offerEndsAt", event.target.value)} /></label>
              <label className="checkbox"><input type="checkbox" checked={form.active} onChange={(event) => change("active", event.target.checked)} />Active version · use for new catalog prices</label>
              <label className="checkbox"><input type="checkbox" checked={form.available} onChange={(event) => change("available", event.target.checked)} />Available to this campus</label>
              <label className="checkbox"><input type="checkbox" checked={form.offerActive} onChange={(event) => change("offerActive", event.target.checked)} />Offer enabled during its schedule</label>
              <label>New version<input required minLength={3} maxLength={80} value={form.version} onChange={(event) => change("version", event.target.value)} /></label>
              <label>Official source<input type="url" required value={form.sourceUrl} onChange={(event) => change("sourceUrl", event.target.value)} /></label>
              <label>Approval evidence<textarea required minLength={10} maxLength={2000} value={form.note} onChange={(event) => change("note", event.target.value)} /></label>
            </div>
            <p>Processing uses this campus’s active approved provider profile. Review provider rates in Payment &amp; Pricing.</p>
            <p>Each approval creates an immutable version. Use a new version to change price, availability, processing rules or offer dates.</p>
            {validation ? <p className="notice notice--error" role="status">{validation}</p> : null}
            {previewError ? <p className="notice notice--error" role="alert">{previewError} <button type="button" className="text-link" onClick={() => setPreviewRetry((current) => current + 1)}>Retry preview</button></p> : null}
            <p aria-live="polite" aria-busy={valid && ready && !currentPreview && !previewError}>
              {currentPreview ? `Server preview · list ${formatMoney(currentPreview.listedAmountKobo)} · ${currentPreview.offerActive ? `${currentPreview.discountPercent}% offer · discount ${formatMoney(currentPreview.discountAmountKobo)} · ` : ""}customer ${formatMoney(currentPreview.amountKobo)} · expected processing ${formatMoney(currentPreview.estimatedProcessingKobo)} · expected net ${formatMoney(currentPreview.expectedNetKobo)}` : valid && ready && !previewError ? "Fetching server pricing preview…" : "A valid server preview is required before approval."}
            </p>
            <button className="button button--primary" type="submit" disabled={!valid || !currentPreview || (currentPreview.amountKobo > 0 && currentPreview.expectedNetKobo <= 0)}>Approve new price version</button>
          </fieldset>
        </form>
      ) : null}
    </section>
  );
}

function tierName(tier: Tier) { return tier === "standard" ? "Standard" : "Pro"; }
function offerStatus(plan: Plan) {
  const percent = plan.configured_discount_percent ?? plan.discount_percent;
  if (!plan.offer_active || percent <= 0) return "Offer disabled";
  if (plan.offer_starts_at && Date.parse(plan.offer_starts_at) > Date.now()) return `${percent}% offer scheduled`;
  if (plan.offer_ends_at && Date.parse(plan.offer_ends_at) <= Date.now()) return "Offer expired";
  return `${percent}% offer active`;
}
function formatDate(value: string | null) { return value ? new Date(value).toLocaleString("en-NG") : "No limit"; }
function formatMoney(kobo: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(kobo / 100);
}
