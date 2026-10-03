"use client";
import { useEffect, useState, type FormEvent } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
type Plan = {
  id: string;
  version: string;
  amount_kobo: number;
  listed_amount_kobo: number;
  discount_percent: number;
  estimated_processing_kobo: number;
  active: boolean;
  approved_at: string;
};
export function KiraPricePlan() {
  const { scope } = useAdminContext();
  return <ScopedKiraPlan key={scope} />;
}
function ScopedKiraPlan() {
  const { scope, access, can, scopedPath } = useAdminContext(),
    [ready, setReady] = useState(false),
    [plans, setPlans] = useState<Plan[] | null>(null),
    [version, setVersion] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [form, setForm] = useState({
    universityId: scope,
    version: "",
    price: "6000",
    discount: "0",
    percent: "1.5",
    flat: "100",
    threshold: "2500",
    cap: "2000",
    sourceUrl: "https://paystack.com/pricing",
    note: "",
  });
  useEffect(() => {
    const controller = new AbortController();
    void portalApi<{ ready: boolean; plans: Plan[] }>(
      scopedPath("/v1/admin/finance/kira-plans"),
      { signal: controller.signal },
    )
      .then((r) => {
        if (!r || typeof r.ready !== 'boolean' || !Array.isArray(r.plans)) throw new Error('Kira plans could not be read. Try again.');
        if (!controller.signal.aborted) {
          setReady(r.ready);
          setPlans(r.plans);
          setError("");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Kira plans could not load.",
          );
      });
    return () => controller.abort();
  }, [scopedPath, version]);
  const price = Number(form.price),
    discountPercent = Number(form.discount),
    listedAmountKobo = Math.round(price * 100),
    payableKobo = listedAmountKobo - Math.floor(listedAmountKobo * discountPercent / 100),
    percent = Number(form.percent),
    flat = Number(form.flat),
    threshold = Number(form.threshold),
    cap = Number(form.cap);
  const valid =
    [price, discountPercent, percent, flat, threshold, cap].every(Number.isFinite) &&
    price >= 1000 && price <= 1000000 &&
    Number.isInteger(discountPercent) && discountPercent >= 0 && discountPercent <= 90 &&
    percent >= 0 &&
    percent < 100 &&
    flat >= 0 &&
    threshold >= 0 &&
    cap >= 0;
  const estimate = valid
    ? Math.min(
        Math.ceil((payableKobo * Math.round(percent * 100)) / 10000) +
          (payableKobo < threshold * 100 ? 0 : Math.round(flat * 100)),
        Math.round(cap * 100),
      )
    : null;
  const change = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setNotice("");
  };
  async function approve(event: FormEvent) {
    event.preventDefault();
    if (busy || !valid || !ready || !can("finance.review")) return;
    setBusy(true);
    setError("");
    try {
      const collection = {
        basisPoints: Math.round(percent * 100),
        flatKobo: Math.round(flat * 100),
        flatWaivedBelowKobo: Math.round(threshold * 100),
        capKobo: Math.round(cap * 100),
      };
      await portalApi("/v1/admin/finance/kira-plans", {
        method: "POST",
        body: JSON.stringify({
          universityId: form.universityId,
          version: form.version,
          amountKobo: listedAmountKobo,
          discountPercent,
          collection,
          sourceUrl: form.sourceUrl,
          approvalNote: form.note,
        }),
      });
      setNotice(
        "Kira price and offer approved. New checkouts use this price; existing checkouts keep their agreed total.",
      );
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The plan was not approved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Kira Pro pricing</h2>
      <p>
        Set the monthly price and a percentage offer for each campus. Users see
        the original price, offer and final total. Processing comes from that
        total. Renewal is manual. Offers and discount codes do not combine.
      </p>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
          <button
            type="button"
            className="text-link"
            onClick={() => setVersion((v) => v + 1)}
          >
            Try again
          </button>
        </p>
      ) : null}
      {!plans && !error ? <p aria-busy="true">Loading Kira plans…</p> : null}
      {plans && !ready ? (
        <p>Subscription billing is awaiting the queued database update.</p>
      ) : null}
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
      {plans?.length ? (
        <div className="table-scroll">
          <table className="operational-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Customer total</th>
                <th>Offer</th>
                <th>Expected processing</th>
                <th>Expected net</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td>{p.version}</td>
                  <td>{formatMoney(p.amount_kobo)}</td>
                  <td>{p.discount_percent ? `${p.discount_percent}% off ${formatMoney(p.listed_amount_kobo)}` : "No offer"}</td>
                  <td>
                    ₦
                    {(p.estimated_processing_kobo / 100).toLocaleString(
                      "en-NG",
                    )}
                  </td>
                  <td>
                    ₦
                    {(
                      (p.amount_kobo - p.estimated_processing_kobo) /
                      100
                    ).toLocaleString("en-NG")}
                  </td>
                  <td>{p.active ? "Active" : "Historical"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : ready ? (
        <p>No Kira plan is approved for this scope.</p>
      ) : null}
      {can("finance.review") ? (
        <form onSubmit={approve}>
          <fieldset disabled={busy || !ready} style={{ border: 0, padding: 0 }}>
            <div className="form-grid">
              <label>
                Campus
                <select
                  aria-label="Campus"
                  required
                  value={form.universityId}
                  onChange={(e) => change("universityId", e.target.value)}
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
                Monthly price · NGN
                <input type="number" required min={1000} max={1000000} step="0.01" value={form.price} onChange={(e) => change("price", e.target.value)} />
              </label>
              <label>
                Offer discount · %
                <input type="number" required min={0} max={90} step={1} value={form.discount} onChange={(e) => change("discount", e.target.value)} />
              </label>
              <label>
                New version
                <input
                  required
                  minLength={3}
                  maxLength={80}
                  value={form.version}
                  onChange={(e) => change("version", e.target.value)}
                />
              </label>
              {(
                [
                  ["percent", "Collection percent"],
                  ["flat", "Collection flat · NGN"],
                  ["threshold", "Flat waived below · NGN"],
                  ["cap", "Collection cap · NGN"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    required
                    min={0}
                    step="0.01"
                    value={form[key]}
                    onChange={(e) => change(key, e.target.value)}
                  />
                </label>
              ))}
              <label>
                Official source
                <input
                  type="url"
                  required
                  value={form.sourceUrl}
                  onChange={(e) => change("sourceUrl", e.target.value)}
                />
              </label>
              <label>
                Approval evidence
                <textarea
                  required
                  minLength={10}
                  maxLength={2000}
                  value={form.note}
                  onChange={(e) => change("note", e.target.value)}
                />
              </label>
            </div>
            <p aria-live="polite">
              {estimate === null
                ? "Enter a valid collection rule."
                : `Original ${formatMoney(listedAmountKobo)} · ${discountPercent}% off · customer ${formatMoney(payableKobo)} · estimated processing ${formatMoney(estimate)} · expected net ${formatMoney(payableKobo - estimate)}`}
            </p>
            <button
              className="button button--primary"
              type="submit"
              disabled={!valid || estimate === null || estimate >= payableKobo}
            >
              Approve price and offer
            </button>
          </fieldset>
        </form>
      ) : null}
    </section>
  );
}
function formatMoney(kobo: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(kobo / 100);
}
