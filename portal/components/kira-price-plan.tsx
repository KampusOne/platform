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
  selected?: boolean;
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
  const { scope, access } = useAdminContext();
  const campusId = scope || (access?.universities?.length === 1 ? access.universities[0]!.id : "");
  return <ScopedKiraPlan key={campusId} initialCampusId={campusId} />;
}

function ScopedKiraPlan({ initialCampusId }: { initialCampusId: string }) {
  const { access, can, scopedPath } = useAdminContext();
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
  const edited = useRef(false);
  const [form, setForm] = useState({
    universityId: initialCampusId,
    tier: "pro" as Tier,
    price: "6000",
    discount: "0",
    active: true,
    available: true,
    offerActive: false,
    offerStartsAt: "",
    offerEndsAt: "",
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
        if (!edited.current) setForm((current) => ({ ...current, ...selectedPlanValues(result.plans, current.universityId, current.tier) }));
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
              : form.offerActive && (price === 0 || discountPercent === 0)
                ? "An enabled offer needs a paid price and a discount percentage."
                : "";
  const valid = validation === "";
  const input = valid ? JSON.stringify({
    universityId: form.universityId,
    tier: form.tier,
    amountKobo: Math.round(price * 100),
    discountPercent,
    active: form.active,
    available: form.available,
    offerActive: form.offerActive,
    offerStartsAt: startsAt === null ? null : new Date(startsAt).toISOString(),
    offerEndsAt: endsAt === null ? null : new Date(endsAt).toISOString(),
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
    edited.current = key !== "universityId";
    setForm((current) => {
      const next = { ...current, [key]: value };
      return key === "universityId" ? { ...next, ...selectedPlanValues(plans ?? [], next.universityId, next.tier) } : next;
    });
    setNotice("");
    setPreviewError("");
  }

  async function approve(event: FormEvent) {
    event.preventDefault();
    if (busy || !valid || !ready || !can("finance.review")) return;
    setBusy(true);
    setError("");
    try {
      await portalApi("/v1/admin/finance/kira-plans", { method: "POST", body: input });
      setNotice(`Kira ${tierName(form.tier)} price saved. Students see the new price and active discount immediately.`);
      edited.current = false;
      setVersion((current) => current + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The plan was not approved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <section className="panel">
      <h2>Kira Standard and Pro pricing</h2>
      <p>Set the monthly price and discount students see. The displayed total estimates processing; Paystack confirms its actual charge at checkout. Standard can stay free, and paid plans renew only when students choose to pay again.</p>
      {error ? <p className="notice notice--error" role="alert">{error} <button type="button" className="text-link" onClick={() => setVersion((current) => current + 1)}>Try again</button></p> : null}
      {!plans && !error ? <p aria-busy="true">Loading Kira plans…</p> : null}
      {plans && !ready ? <p>Subscription billing is awaiting the queued database update.</p> : null}
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      {plans?.length ? (
        <details>
          <summary>Price history and processing estimates</summary>
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
        </details>
      ) : ready ? <p>No Kira plan is approved for this scope. Standard remains free until a paid version is approved.</p> : null}
      {can("finance.review") ? (
        <form className="form-stack" onSubmit={approve}>
          <fieldset disabled={busy || !ready} style={{ border: 0, padding: 0 }}>
            <div className="form-grid">
              <label>Campus<select aria-label="Campus" required value={form.universityId} onChange={(event) => change("universityId", event.target.value)}><option value="">Choose campus</option>{access?.universities?.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}</select></label>
              <label>Tier<select value={form.tier} onChange={(event) => {
                const tier = event.target.value as Tier;
                edited.current = false;
                setForm((current) => ({ ...current, tier, ...selectedPlanValues(plans ?? [], current.universityId, tier) }));
                setNotice("");
                setPreviewError("");
              }}><option value="standard">Kira Standard</option><option value="pro">Kira Pro</option></select></label>
              <label>Monthly list price · NGN<input type="number" required min={form.tier === "standard" ? 0 : 1000} max={1000000} step="0.01" value={form.price} onChange={(event) => change("price", event.target.value)} /></label>
              <label>Offer discount · %<input type="number" required min={0} max={90} step={1} value={form.discount} onChange={(event) => change("discount", event.target.value)} /></label>
              <label>Offer starts · optional<input type="datetime-local" value={form.offerStartsAt} onChange={(event) => change("offerStartsAt", event.target.value)} /></label>
              <label>Offer ends · optional<input type="datetime-local" value={form.offerEndsAt} onChange={(event) => change("offerEndsAt", event.target.value)} /></label>
              <label className="checkbox"><input type="checkbox" checked={form.active} onChange={(event) => change("active", event.target.checked)} />Use this price</label>
              <label className="checkbox"><input type="checkbox" checked={form.available} onChange={(event) => change("available", event.target.checked)} />Available to this campus</label>
              <label className="checkbox"><input type="checkbox" checked={form.offerActive} onChange={(event) => change("offerActive", event.target.checked)} />Show this discount to students</label>
            </div>
            <p className="field-help">Leave offer dates empty to apply the enabled discount immediately. Every save records your changes automatically.</p>
            {validation ? <p className="notice notice--error" role="status">{validation}</p> : null}
            {previewError ? <p className="notice notice--error" role="alert">{previewError} <button type="button" className="text-link" onClick={() => setPreviewRetry((current) => current + 1)}>Retry preview</button></p> : null}
            <p aria-live="polite" aria-busy={valid && ready && !currentPreview && !previewError}>
              {currentPreview ? `Server preview · list ${formatMoney(currentPreview.listedAmountKobo)} · ${currentPreview.offerActive ? `${currentPreview.discountPercent}% offer · discount ${formatMoney(currentPreview.discountAmountKobo)} · ` : ""}customer ${formatMoney(currentPreview.amountKobo)} · expected processing ${formatMoney(currentPreview.estimatedProcessingKobo)} · expected net ${formatMoney(currentPreview.expectedNetKobo)}` : valid && ready && !previewError ? "Fetching server pricing preview…" : "Enter a valid price to see the customer total."}
            </p>
            <button className="button button--primary" type="submit" disabled={!valid || busy || Boolean(currentPreview && currentPreview.amountKobo > 0 && currentPreview.expectedNetKobo <= 0)}>{busy ? "Saving…" : "Save price and discount"}</button>
          </fieldset>
        </form>
      ) : null}
    </section>
    </>
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

function selectedPlanValues(plans: Plan[], universityId: string, tier: Tier) {
  const current = plans.find((plan) => plan.university_id === universityId && plan.tier === tier && (plan.active || plan.selected));
  const localDate = (value: string | null) => value ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
  return { price: String(current ? current.listed_amount_kobo / 100 : tier === "standard" ? 0 : 6000), discount: String(current?.configured_discount_percent ?? current?.discount_percent ?? 0), available: current?.available ?? true, active: current?.active ?? true, offerActive: current?.offer_active ?? false, offerStartsAt: localDate(current?.offer_starts_at ?? null), offerEndsAt: localDate(current?.offer_ends_at ?? null) };
}
