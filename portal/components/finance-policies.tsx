"use client";

import { useEffect, useState, type FormEvent } from "react";
import { portalApi } from "@/lib/api";
import { PortalShell } from "./portal-shell";
import { useAdminContext } from "./admin-context";
import { KiraPricePlan } from "./kira-price-plan";

type Policy = {
  id: string;
  university_id: string;
  kind: string;
  version: string;
  active: boolean;
  buyer_basis_points: number;
  seller_commission_basis_points: number;
  approved_at: string;
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
  listings: { customerPriceKobo: number }[];
  checkout: {
    payableKobo: number;
    sellerNetKobo: number;
    estimatedProcessingKobo: number;
    projectedPlatformNetKobo: number;
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
  if (!Number.isSafeInteger(n))
    throw new Error("This value is outside the supported range.");
  return n;
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
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [version, setVersion] = useState(0),
    [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    universityId: scope,
    kind: "STORE",
    version: "",
    buyerPercent: "",
    buyerFlat: "0",
    sellerPercent: "",
    collectionPercent: "1.5",
    collectionFlat: "100",
    waivedBelow: "2500",
    cap: "2000",
    sourceUrl: "https://paystack.com/pricing",
    note: "",
    samplePrice: "3500",
    sampleQuantity: "1",
    checkoutSavings: true,
    allowProcessorSubsidy: false,
  });
  const [preview, setPreview] = useState<Preview | null>(null),
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
    ])
      .then(([r, z, p]) => {
        if (!controller.signal.aborted) {
          setResult(r);
          setZones(z.zones);
          setReceipts(p.receipts);
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
    setNotice("");
  }
  function payload() {
    if (!form.universityId)
      throw new Error("Choose the campus this policy applies to.");
    return {
      universityId: form.universityId,
      kind: form.kind,
      version: form.version,
      buyerBasisPoints: minor(form.buyerPercent),
      buyerFlatPerItemKobo: minor(form.buyerFlat),
      sellerCommissionBasisPoints: minor(form.sellerPercent),
      collection: {
        basisPoints: minor(form.collectionPercent),
        flatKobo: minor(form.collectionFlat),
        flatWaivedBelowKobo: minor(form.waivedBelow),
        capKobo: form.cap ? minor(form.cap) : null,
      },
      sourceUrl: form.sourceUrl,
      approvalNote: form.note,
      checkoutSavings: form.checkoutSavings,
      allowProcessorSubsidy: form.allowProcessorSubsidy,
    };
  }
  async function review(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const data = payload(),
        p = await portalApi<Preview>("/v1/admin/finance/fee-policy-preview", {
          method: "POST",
          body: JSON.stringify({
            ...data,
            samples: [
              {
                baseKobo: minor(form.samplePrice),
                quantity: Number(form.sampleQuantity),
              },
            ],
          }),
        });
      setPreview(p);
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "The policy could not be previewed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (!preview) return;
    setBusy(true);
    setNotice("");
    try {
      await portalApi("/v1/admin/finance/fee-policies", {
        method: "POST",
        body: JSON.stringify(payload()),
      });
      setPreview(null);
      setVersion((v) => v + 1);
      setNotice(
        "Policy approved and audited. New listings use this version; existing quotes keep their totals.",
      );
    } catch (e) {
      setNotice(
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
    ["collectionPercent", "Collection rate (%)"],
    ["collectionFlat", "Collection flat amount (₦)"],
    ["waivedBelow", "Flat amount waived below (₦)"],
    ["cap", "Collection cap (₦, blank for no cap)"],
    ["samplePrice", "Sample seller price (₦)"],
    ["sampleQuantity", "Sample quantity"],
  ] as const;
  return (
    <PortalShell
      active="admin"
      eyebrow="Finance controls"
      title="Prices & ride commissions"
      description="Approve inclusive prices, review campus fares, and keep a versioned record of every change."
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
                      <td>{p.seller_commission_basis_points / 100}%</td>
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
              <form className="panel" onSubmit={review}>
                <h2>Review a new price policy</h2>
                <p className="field-help">
                  Enter the platform commission explicitly. The published local
                  processing baseline is prefilled for review. Confirm the rates
                  and taxes on your merchant account before approval.
                </p>
                <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
                  <div className="form-grid">
                    <label>
                      Campus
                      <select
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
                      Product area
                      <select
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
                          required={key !== "cap"}
                          inputMode={key === "version" ? "text" : "decimal"}
                          value={form[key]}
                          onChange={(e) => change(key, e.target.value)}
                        />
                      </label>
                    ))}
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
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={form.checkoutSavings}
                      onChange={(e) =>
                        change("checkoutSavings", e.target.checked)
                      }
                    />
                    Offer checkout savings when transaction-level fees allow
                  </label>
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={form.allowProcessorSubsidy}
                      onChange={(e) =>
                        change("allowProcessorSubsidy", e.target.checked)
                      }
                    />
                    Authorize Campus One to fund carts whose processing exceeds
                    their margin
                  </label>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => void checkRates()}
                    >
                      Check published Paystack rates
                    </button>
                    <button className="button button--primary" type="submit">
                      Preview calculation
                    </button>
                  </div>
                </fieldset>
                {preview ? (
                  <section aria-live="polite">
                    <h3>Sample checkout</h3>
                    <dl className="detail-list">
                      <div>
                        <dt>Displayed unit price</dt>
                        <dd>
                          {money(preview.listings[0]?.customerPriceKobo ?? 0)}
                        </dd>
                      </div>
                      <div>
                        <dt>Customer pays</dt>
                        <dd>{money(preview.checkout.payableKobo)}</dd>
                      </div>
                      <div>
                        <dt>Seller receives</dt>
                        <dd>{money(preview.checkout.sellerNetKobo)}</dd>
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
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={busy || !result?.ready}
                      onClick={() => void approve()}
                    >
                      Approve this version
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
