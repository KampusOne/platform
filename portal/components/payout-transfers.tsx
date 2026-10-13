"use client";
import {DecisionConsent} from "./decision-consent";
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
  payout_commission_kobo:number;
  requested_by_user_id:string;provider:string;provider_failure_reason?:string;
  account_name:string|null;
  fee_allowance_kobo: number | null;
  cost_recorded_kobo: number;
  expected_transfer_fee_kobo: number | null;
  actual_transfer_fee_kobo: number | null;
  expected_statutory_duty_kobo: number | null;
  actual_statutory_duty_kobo: number | null;
  statutory_duty_reserved_kobo: number;
  statutory_duty_source: string | null;
  statutory_duty_reconciliation: string;
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
      withdrawalUnavailableReason?:string|null;
      payouts: Payout[];
    } | null>(null),
    [version, setVersion] = useState(0),
    [filter, setFilter] = useState("REQUESTED"),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
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
      setNotice(
        action === "check"
          ? "Provider status checked."
          : action === "duty-reconciliation"
            ? "Reviewed statement duty recorded. Its accounting and source are sealed."
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
    const data = new FormData(event.currentTarget,(event.nativeEvent as SubmitEvent).submitter);
    if(data.get("confirm")!=="on")return;
    const decision=data.get("status")??"APPROVED",note=String(data.get("note")??"").trim();
    void act(p,decision==="APPROVED"?"approve":"review",decision==="APPROVED"?{confirm:true,...(note?{note}:{})}:{status:decision,note:note||"Reviewer confirmed rejection of this request and release of reserved earnings."});
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
                {result.withdrawalUnavailableReason??'New transfers are paused. Existing transfer results can still be checked.'}
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
                    {p.provider_failure_reason?<p className="notice notice--error" role="alert">{p.provider_failure_reason}</p>:null}
                    {p.returned_to_wallet ? <p className="notice">{money(p.amount_kobo)} has been returned to the available wallet. A new withdrawal requires a new quote.</p> : null}
                    <dl className="details-list">
                      <dt>Quoted bank amount</dt>
                      <dd>{money(p.bank_net_kobo)}</dd>
                      <dt>Withdrawal commission</dt><dd>{money(p.payout_commission_kobo)}</dd>
                      <dt>Reserved fee allowance</dt>
                      <dd>{money(p.fee_allowance_kobo)}</dd>
                      <dt>Expected transfer fee</dt>
                      <dd>{p.expected_transfer_fee_kobo == null ? "Historical combined estimate" : money(p.expected_transfer_fee_kobo)}</dd>
                      <dt>Verified provider fee · {p.provider==='BACHS'?'Bachs payout GET':'Paystack transfer GET'}</dt>
                      <dd>{p.actual_transfer_fee_kobo == null ? "Awaiting verification" : money(p.actual_transfer_fee_kobo)}</dd>
                      <dt>Booked transfer expense</dt>
                      <dd>{money(p.cost_recorded_kobo)}</dd>
                      {p.provider!=="BACHS"?<><dt>Expected statutory duty · platform accounting</dt>
                      <dd>{p.expected_statutory_duty_kobo == null ? "Historical combined estimate" : money(p.expected_statutory_duty_kobo)}</dd>
                      <dt>Actual statutory duty · Balance statement</dt>
                      <dd>{p.actual_statutory_duty_kobo == null ? "Awaiting separate statement reconciliation" : money(p.actual_statutory_duty_kobo)}</dd>
                      {Number(p.statutory_duty_reserved_kobo) > 0 ? <><dt>Historical duty allowance awaiting statement</dt><dd>{money(p.statutory_duty_reserved_kobo)}</dd></> : null}
                      </>:null}
                      <dt>Destination</dt>
                      <dd>
                        {p.account_name} · {p.bank_name} ·••{p.account_last4}
                      </dd>
                      <dt>Saved reference</dt>
                      <dd>
                        <code>{p.provider_reference}</code>
                      </dd>
                    </dl>
                    <PayoutEvidence payoutId={p.id} />
                    {p.provider!=="BACHS"?<p>Bank receiving-account deductions are unverified. Transfer proof does not establish the separate statutory duty amount.</p>:null}
                    {p.provider!=="BACHS" && can("finance.review") && p.actual_statutory_duty_kobo == null && ["PAID", "REVERSED", "FAILED"].includes(p.status) ? (
                      <form onSubmit={(event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        void act(p, "duty-reconciliation", { actualDutyKobo: Math.round(Number(form.get("actualDuty")) * 100), statementReference: form.get("statement"), note: form.get("note") });
                      }}>
                        <fieldset disabled={Boolean(busy)} style={{ border: 0, padding: 0 }}>
                          <legend>Review statutory duty from the Paystack Balance statement</legend>
                          <label>Actual statutory duty · NGN<input name="actualDuty" type="number" min="0" max="10000" step="0.01" required /></label>
                          <label>Statement entry / evidence reference<input name="statement" required minLength={3} maxLength={200} /></label>
                          <label>Confirm review<DecisionConsent name="note" /></label>
                          <p>Use the separate statement duty entry. Enter zero only when reviewed statement evidence establishes no duty. KampusOne absorbs any additional cost.</p>
                          <button type="submit" className="button button--secondary">Record reviewed statement duty</button>
                        </fieldset>
                      </form>
                    ) : null}
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
                            Note (optional)
                            <textarea name="note" maxLength={1000} />
                          </label>
                          <label className="checkbox"><input type="checkbox" name="confirm" required />I reviewed the earnings and saved bank account. Approval sends exactly {money(p.bank_net_kobo)}.</label>
                          <button name="status" value="APPROVED" className="button button--primary" disabled={Boolean(busy)||!result.withdrawalsEnabled}>
                            {busy===p.id?"Processing…":"Approve payout"}
                          </button>
                          <button name="status" value="REJECTED" className="button button--secondary" disabled={Boolean(busy)}>Reject & return funds</button>
                        </fieldset>
                      </form>
                    ) : null}
                    {can("payouts.approve")&&!p.returned_to_wallet&&p.initiated_at&&p.status==="PROCESSING"?<form onSubmit={e=>{e.preventDefault();if(new FormData(e.currentTarget).get('confirm')==='on')void act(p,"approve",{confirm:true});}}><label className="checkbox"><input name="confirm" type="checkbox" required/>Use this saved reference to recover its transfer status.</label><button className="button button--secondary" disabled={Boolean(busy)||!result.withdrawalsEnabled}>Resume saved transfer</button></form>:null}
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

type Evidence={profile:{user_id:string;display_name:string;agent_type:string;biography:string};balances:{available_kobo:number;pending_kobo:number;reserved_kobo:number};earningsHistory:{id:string;description:string;available_change_kobo:number;created_at:string;reference_type:string}[];sales:{id:string;status:string;earnings_state:string;subtotal_kobo:number;goods:{name:string;quantity:number}[]}[]};
function PayoutEvidence({payoutId}:{payoutId:string}){
  const {can}=useAdminContext(),[data,setData]=useState<Evidence|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  return <section className="panel"><button className="button button--secondary" disabled={busy} onClick={()=>{setBusy(true);void portalApi<Evidence>(`/v1/admin/operations/payouts/${payoutId}/details`).then(setData).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>{busy?'Loading…':'View profile, sales & earnings'}</button>{error?<p role="alert">{error}</p>:null}{data?<>
    <h3>{data.profile.display_name}</h3><p>{data.profile.biography}</p>{can('users.view')?<Link href={'/admin/users/'+data.profile.user_id}>Open full profile</Link>:null}
    <dl className="details-list"><dt>Available earnings</dt><dd>{money(data.balances.available_kobo)}</dd><dt>Pending earnings</dt><dd>{money(data.balances.pending_kobo)}</dd><dt>Reserved withdrawals</dt><dd>{money(data.balances.reserved_kobo)}</dd></dl>
    {data.sales.length?<><h3>Recent sales</h3><div className="table-scroll"><table className="operational-table"><thead><tr><th>Goods</th><th>Sale</th><th>Status</th></tr></thead><tbody>{data.sales.map(s=><tr key={s.id}><td>{s.goods.map(g=>`${g.name} × ${g.quantity}`).join(', ')}</td><td>{money(s.subtotal_kobo)}</td><td>{state(s.status)} · {state(s.earnings_state)}</td></tr>)}</tbody></table></div></>:null}
    <h3>Earnings history</h3><p>Recent wallet movements, including earlier withdrawals and returned funds.</p><div className="table-scroll"><table className="operational-table"><thead><tr><th>Source</th><th>Available balance change</th><th>Date</th></tr></thead><tbody>{data.earningsHistory.map(h=><tr key={h.id}><td>{h.description}</td><td>{money(h.available_change_kobo)}</td><td>{new Date(h.created_at).toLocaleString()}</td></tr>)}</tbody></table></div>
  </>:null}</section>;
}
