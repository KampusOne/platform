"use client";
import { useEffect, useState, type FormEvent } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
type Policy = {
  id: string;
  version: string;
  agent_type: string;
  fee_bearer: string;
  low_fee_kobo: number;
  middle_fee_kobo: number;
  high_fee_kobo: number;
  duty_kobo: number;
  duty_threshold_kobo: number;
  active: boolean;
};
export function TransferCostPolicies() {
  const { scope } = useAdminContext();
  return <ScopedTransferCosts key={scope} />;
}
function ScopedTransferCosts() {
  const { scope, access, can, scopedPath } = useAdminContext(),
    [result, setResult] = useState<{
      ready: boolean;
      policies: Policy[];
    } | null>(null),
    [version, setVersion] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void portalApi<{ ready: boolean; policies: Policy[] }>(
      scopedPath("/v1/admin/finance/transfer-policies"),
      { signal: controller.signal },
    )
      .then((r) => {
        if (!r || typeof r.ready !== 'boolean' || !Array.isArray(r.policies)) throw new Error('Transfer policies could not be read. Try again.');
        if (!controller.signal.aborted) {
          setResult(r);
          setError("");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [scopedPath, version]);
  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget,
      data = new FormData(form);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await portalApi("/v1/admin/finance/transfer-policies", {
        method: "POST",
        body: JSON.stringify({
          universityId: data.get("universityId"),
          agentType: data.get("agentType"),
          version: data.get("version"),
          feeBearer: data.get("feeBearer"),
          lowFeeKobo: Math.round(Number(data.get("low")) * 100),
          middleFeeKobo: Math.round(Number(data.get("middle")) * 100),
          highFeeKobo: Math.round(Number(data.get("high")) * 100),
          dutyKobo: Math.round(Number(data.get("duty")) * 100),
          dutyThresholdKobo: Math.round(Number(data.get("threshold")) * 100),
          sourceUrl: data.get("source"),
          approvalNote: data.get("note"),
        }),
      });
      setNotice(
        "Transfer policy approved. Existing quotes keep their sealed amounts.",
      );
      form.reset();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The policy could not be approved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Bank transfer costs</h2>
      <p>
        Commercial commission is already reflected in earnings. Withdrawals add
        no second platform commission. The initial rider model absorbs transfer
        costs; a different allocation requires an explicit reviewed policy.
      </p>
      <p>
        <a
          className="text-link"
          href="https://support.paystack.com/en/articles/2130370"
          target="_blank"
          rel="noreferrer"
        >
          Official transfer bands
        </a>{" "}
        ·{" "}
        <a
          className="text-link"
          href="https://support.paystack.com/en/articles/7573314"
          target="_blank"
          rel="noreferrer"
        >
          Duty and exemptions
        </a>
        . Review merchant terms and duty before approval. Verified transfer fees
        and separate statement duty require reconciliation.
      </p>
      {error ? (
        <p role="alert" className="notice notice--error">
          {error}
          <button
            className="text-link"
            onClick={() => setVersion((v) => v + 1)}
          >
            Try again
          </button>
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
      {!result && !error ? (
        <p aria-busy="true">Loading transfer policies…</p>
      ) : null}
      {result && !result.ready ? (
        <p>The verified transfer migration is queued.</p>
      ) : null}
      {result?.policies.length ? (
        <div className="table-scroll">
          <table className="operational-table">
            <thead>
              <tr>
                <th>Version · role</th>
                <th>Cost bearer</th>
                <th>Up to ₦5,000</th>
                <th>Up to ₦50,000</th>
                <th>Above ₦50,000</th>
                <th>Duty</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {result.policies.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.version} · {p.agent_type.toLowerCase()}
                  </td>
                  <td>{p.fee_bearer.toLowerCase()}</td>
                  <td>₦{Number(p.low_fee_kobo) / 100}</td>
                  <td>₦{Number(p.middle_fee_kobo) / 100}</td>
                  <td>₦{Number(p.high_fee_kobo) / 100}</td>
                  <td>
                    ₦{Number(p.duty_kobo) / 100} from ₦
                    {Number(p.duty_threshold_kobo) / 100}
                  </td>
                  <td>{p.active ? "Active" : "Historical"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : result?.ready ? (
        <p>No transfer policy is approved for this scope.</p>
      ) : null}
      {can("finance.review") ? (
        <form onSubmit={approve}>
          <fieldset
            disabled={busy || !result?.ready}
            style={{ border: 0, padding: 0 }}
          >
            <div className="form-grid">
              <label>
                Campus
                <select name="universityId" required defaultValue={scope}>
                  <option value="">Choose campus</option>
                  {access?.universities?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Agent role
                <select name="agentType">
                  <option value="RIDER">Rider</option>
                  <option value="VENDOR">Vendor</option>
                  <option value="TUTOR">Tutor</option>
                </select>
              </label>
              <label>
                New version
                <input name="version" required minLength={3} maxLength={80} />
              </label>
              <label>
                Transfer costs
                <select name="feeBearer">
                  <option value="PLATFORM">Absorbed by KampusOne</option>
                  <option value="PAYEE">Deduct the reviewed allowance</option>
                </select>
              </label>
              {(
                [
                  ["low", "Fee up to ₦5,000", "10"],
                  ["middle", "Fee up to ₦50,000", "25"],
                  ["high", "Fee above ₦50,000", "50"],
                  ["duty", "Additional duty", "50"],
                  ["threshold", "Duty starts at", "10000"],
                ] as const
              ).map(([name, label, value]) => (
                <label key={name}>
                  {label} · NGN
                  <input
                    name={name}
                    type="number"
                    min={0}
                    max={name === "threshold" ? 20000000 : 10000}
                    step="0.01"
                    required
                    defaultValue={value}
                  />
                </label>
              ))}
              <label>
                Official source
                <input
                  name="source"
                  type="url"
                  required
                  defaultValue="https://support.paystack.com/en/articles/2130370"
                />
              </label>
              <label>
                Approval evidence
                <textarea
                  name="note"
                  required
                  minLength={10}
                  maxLength={2000}
                />
              </label>
            </div>
            <p>
              These form values are published examples for review. Approval is
              never automatic.
            </p>
            <button type="submit" className="button button--primary">
              Approve transfer policy
            </button>
          </fieldset>
        </form>
      ) : null}
    </section>
  );
}
