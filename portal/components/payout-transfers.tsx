"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { portalApi } from "@/lib/api";
import { PortalShell } from "./portal-shell";
import { useAdminContext } from "./admin-context";
type Payout = {
  id: string;
  display_name: string;
  agent_type: string;
  status: string;
  financial_version: string | null;
  amount_kobo: number;
  bank_net_kobo: number | null;
  fee_allowance_kobo: number | null;
  cost_recorded_kobo: number;
  bank_name: string | null;
  account_last4: string | null;
  provider_reference: string | null;
  requested_at: string;
  initiated_at: string | null;
  returned_to_wallet?: boolean;
};
const money = (v: unknown) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    Number(v ?? 0) / 100,
  );
const state = (v: string) => v.toLowerCase().replaceAll("_", " ");
export function PayoutTransfers() {
  const { scope } = useAdminContext();
  return <ScopedTransfers key={scope} />;
}
function ScopedTransfers() {
  const { can, scopedPath } = useAdminContext(),
    [result, setResult] = useState<{
      ready: boolean;
      withdrawalsEnabled: boolean;
      payouts: Payout[];
    } | null>(null),
    [version, setVersion] = useState(0),
    [filter, setFilter] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirm, setConfirm] = useState("");
  const allowed = can("finance.view");
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    void portalApi<{
      ready: boolean;
      withdrawalsEnabled: boolean;
      payouts: Payout[];
    }>(
      scopedPath(
        "/v1/admin/operations/payouts" + (filter ? "?status=" + filter : ""),
      ),
      { signal: controller.signal },
    )
      .then((r) => {
        if (!controller.signal.aborted) {
          setResult(r);
          setError("");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [allowed, scopedPath, filter, version]);
  async function act(p: Payout, action: string, data: Record<string, unknown>) {
    if (busy) return;
    setBusy(p.id);
    setError("");
    setNotice("");
    try {
      await portalApi(`/v1/admin/operations/payouts/${p.id}/${action}`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      setConfirm("");
      setNotice(
        action === "check"
          ? "Provider status checked."
          : "Action saved. Only provider verification can confirm payment.",
      );
      setVersion((v) => v + 1);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "This withdrawal could not be updated.",
      );
      setVersion((v) => v + 1);
    } finally {
      setBusy("");
    }
  }
  function review(event: FormEvent<HTMLFormElement>, p: Payout) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void act(p, "review", {
      status: data.get("status"),
      note: data.get("note"),
    });
  }
  function finalize(event: FormEvent<HTMLFormElement>, p: Payout) {
    event.preventDefault();
    const form = event.currentTarget,
      otp = String(new FormData(form).get("otp") ?? "");
    form.reset();
    void act(p, "finalize", { otp });
  }
  return (
    <PortalShell
      active="admin"
      eyebrow="Finance operations"
      title="Verified withdrawals"
      description="Review the quoted bank amount, reserve real earnings, and track the bank's confirmed result."
      actions={
        <Link className="button button--secondary" href="/admin/payouts">
          Bank verification
        </Link>
      }
    >
      {!allowed ? (
        <section className="state-panel">
          <h2>Finance access required</h2>
          <p>Your staff permissions do not include this workspace.</p>
        </section>
      ) : (
        <>
          {error ? (
            <p className="notice notice--error" role="alert">
              {error}
              <button
                className="text-link"
                onClick={() => setVersion((v) => v + 1)}
              >
                Refresh status
              </button>
            </p>
          ) : null}
          {notice ? (
            <p className="notice" role="status">
              {notice}
            </p>
          ) : null}
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Withdrawal queue</h2>
                <p>
                  Latest 100 requests in this scope. Unconfirmed transfers keep
                  their reservation. A verified final failure returns the amount
                  to the available wallet.
                </p>
              </div>
              <label>
                Status
                <select
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setResult(null);
                    setConfirm("");
                  }}
                >
                  <option value="">All</option>
                  {[
                    "REQUESTED",
                    "IN_REVIEW",
                    "APPROVED",
                    "PROCESSING",
                    "OTP_REQUIRED",
                    "PAID",
                    "FAILED",
                    "REVERSED",
                    "REQUIRES_REVIEW",
                    "REJECTED",
                  ].map((v) => (
                    <option key={v} value={v}>
                      {state(v)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button button--secondary"
                disabled={Boolean(busy)}
                onClick={() => setVersion((v) => v + 1)}
              >
                Refresh
              </button>
            </div>
            {!result && !error ? (
              <p aria-busy="true">Loading withdrawals…</p>
            ) : null}
            {result && !result.ready ? (
              <p>The verified transfer migration is queued.</p>
            ) : null}
            {result?.ready && !result.withdrawalsEnabled ? (
              <p className="notice">
                New transfers are paused. Existing transfer results can still be
                checked.
              </p>
            ) : null}
            {result?.ready && !result.payouts.length ? (
              <div className="empty-row">
                <strong>No withdrawals</strong>
                <span>
                  Requests matching this scope and status appear here.
                </span>
              </div>
            ) : null}
            {result?.payouts.map((p) => (
              <details className="review-item" key={p.id}>
                <summary>
                  <span>
                    <strong>
                      {p.display_name} · {state(p.agent_type)}
                    </strong>
                    <small>{new Date(p.requested_at).toLocaleString()}</small>
                  </span>
                  <span>
                    <strong>{money(p.amount_kobo)}</strong>
                    <small>{p.returned_to_wallet ? "Returned to wallet" : state(p.status)}</small>
                  </span>
                </summary>
                {p.financial_version !== "LEDGER_PAYOUT_V1" ? (
                  <p>
                    Legacy request. Reconcile its provider history and ledger
                    before any further transfer.
                  </p>
                ) : (
                  <>
                    {p.returned_to_wallet ? <p className="notice">{money(p.amount_kobo)} has been returned to the available wallet. A new withdrawal requires a new quote.</p> : null}
                    <dl className="details-list">
                      <dt>Quoted bank amount</dt>
                      <dd>{money(p.bank_net_kobo)}</dd>
                      <dt>Reserved fee allowance</dt>
                      <dd>{money(p.fee_allowance_kobo)}</dd>
                      <dt>Verified processing cost</dt>
                      <dd>{money(p.cost_recorded_kobo)}</dd>
                      <dt>Destination</dt>
                      <dd>
                        {p.bank_name} ·••{p.account_last4}
                      </dd>
                      <dt>Saved reference</dt>
                      <dd>
                        <code>{p.provider_reference}</code>
                      </dd>
                    </dl>
                    <div className="action-row">
                      <button
                        className="button button--secondary"
                        disabled={Boolean(busy)}
                        onClick={() => void act(p, "check", {})}
                      >
                        Check provider status
                      </button>
                    </div>
                    {can("payouts.approve") &&
                    !p.initiated_at &&
                    ["REQUESTED", "IN_REVIEW", "APPROVED"].includes(
                      p.status,
                    ) ? (
                      <form
                        className="form-stack"
                        onSubmit={(e) => review(e, p)}
                      >
                        <fieldset
                          disabled={Boolean(busy)}
                          style={{ border: 0, padding: 0 }}
                        >
                          <label>
                            Decision
                            <select name="status">
                              <option value="IN_REVIEW">In review</option>
                              <option value="APPROVED">
                                Approve quoted amount
                              </option>
                              <option value="REJECTED">
                                Reject and release reservation
                              </option>
                            </select>
                          </label>
                          <label>
                            Finance note
                            <textarea
                              name="note"
                              required
                              minLength={3}
                              maxLength={1000}
                            />
                          </label>
                          <button className="button button--secondary">
                            Save decision
                          </button>
                        </fieldset>
                      </form>
                    ) : null}
                    {can("payouts.approve") &&
                    !p.returned_to_wallet &&
                    ["APPROVED", "PROCESSING", "FAILED"].includes(p.status) ? (
                      <div className="action-row">
                        {confirm === p.id ? (
                          <>
                            <p>
                              Send exactly {money(p.bank_net_kobo)} to{" "}
                              {p.bank_name} ·••{p.account_last4} using this
                              saved reference?
                            </p>
                            <button
                              className="button button--primary"
                              disabled={
                                Boolean(busy) || !result.withdrawalsEnabled
                              }
                              onClick={() =>
                                void act(p, "transfer", { confirm: true })
                              }
                            >
                              {busy === p.id
                                ? "Requesting…"
                                : "Confirm transfer"}
                            </button>
                            <button
                              className="button button--secondary"
                              disabled={Boolean(busy)}
                              onClick={() => setConfirm("")}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            className="button button--primary"
                            disabled={
                              Boolean(busy) || !result.withdrawalsEnabled
                            }
                            onClick={() => setConfirm(p.id)}
                          >
                            {p.initiated_at
                              ? "Retry saved transfer"
                              : "Send approved transfer"}
                          </button>
                        )}
                      </div>
                    ) : null}
                    {can("payouts.approve") && p.status === "OTP_REQUIRED" ? (
                      <form
                        className="form-stack"
                        onSubmit={(e) => finalize(e, p)}
                      >
                        <label>
                          Merchant confirmation code
                          <input
                            name="otp"
                            type="password"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            pattern="[0-9]{6,10}"
                            required
                            minLength={6}
                            maxLength={10}
                          />
                        </label>
                        <button
                          className="button button--primary"
                          disabled={Boolean(busy) || !result.withdrawalsEnabled}
                        >
                          Confirm with OTP
                        </button>
                      </form>
                    ) : null}
                  </>
                )}
              </details>
            ))}
          </section>
        </>
      )}
    </PortalShell>
  );
}
