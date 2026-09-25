"use client";
import { useEffect, useState, type FormEvent } from "react";
import { PortalApiError, portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
import { PortalShell } from "./portal-shell";
type Account = { id: string; agent_profile_id: string; status: string; bank_code: string; bank_name: string; account_name: string; account_last4: string; name_match: string; review_note: string | null; created_at: string; display_name?: string; legal_name?: string; university_id?: string; agent_type?: string; provider_mode?: string; payout_eligible?: boolean };
type Profile = { id: string; agent_type: string; display_name: string; university_id: string; bank_status: string; account: Account | null };
type Bank = { code: string; name: string };
export function PayoutSetupWorkspace({ mode }: { mode: "agent" | "admin" }) {
  const { scope, scopeLabel, scopedPath, can } = useAdminContext();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [reviewStatus, setReviewStatus] = useState("PENDING_REVIEW");
  const [page, setPage] = useState(0);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [providerAvailable, setProviderAvailable] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [bankQuery, setBankQuery] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [authorizedAccount, setAuthorizedAccount] = useState(false);
  const [selection, setSelection] = useState<Account | null>(null);
  const [decision, setDecision] = useState("REJECTED");
  const [reason, setReason] = useState("");
  const [ownershipConfirmed, setOwnershipConfirmed] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const [loadedKey, setLoadedKey] = useState("");
  const key = JSON.stringify([mode, scope, version, reviewStatus, page]);
  useEffect(() => {
    if (mode === "admin" && !can("finance.review")) return;
    let active = true;
    if (mode === "admin") {
      void portalApi<{ accounts: Account[] }>(scopedPath(`/v1/payout-setup/review?status=${reviewStatus}&offset=${page * 50}`)).then((response) => { if (active) { setAccounts(response.accounts); setError(""); } }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Payout accounts could not be loaded."); }).finally(() => { if (active) setLoadedKey(key); });
    } else {
      void portalApi<{ profiles: Profile[]; providerAvailable: boolean }>("/v1/payout-setup").then(async (response) => {
        if (!active) return;
        setProfiles(response.profiles); setProviderAvailable(response.providerAvailable); setError("");
        if (response.providerAvailable) { const result = await portalApi<{ banks: Bank[] }>("/v1/payout-setup/banks"); if (active) setBanks(result.banks); }
      }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Payout setup could not be loaded."); }).finally(() => { if (active) setLoadedKey(key); });
    }
    return () => { active = false; };
  }, [can, key, mode, scopedPath, reviewStatus, page]);
  async function resolveAccount(event: FormEvent) {
    event.preventDefault(); setBusy(true); setNotice("");
    const id = requestId || crypto.randomUUID(); setRequestId(id);
    try {
      const response = await portalApi<{ account: Account }>("/v1/payout-setup/resolve", { method: "POST", body: JSON.stringify({ agentProfileId: profileId, bankCode, accountNumber, requestId: id, authorizedAccount }) });
      setNotice(`Bank reports: ${response.account.account_name}. Setup status: ${response.account.status.replaceAll("_", " ").toLowerCase()}. A resolved name is not proof of ownership.`);
      setAccountNumber(""); setAuthorizedAccount(false); setRequestId(""); setVersion((value) => value + 1);
    } catch (caught) { if (caught instanceof PortalApiError && caught.details?.restartRequired === true) setRequestId(""); setNotice(caught instanceof Error ? caught.message : "The bank could not be resolved. Retry retains the same request ID."); }
    finally { setBusy(false); }
  }
  async function reviewAccount(event: FormEvent) {
    event.preventDefault(); if (!selection) return; setBusy(true); setNotice("");
    try {
      await portalApi(scopedPath(`/v1/payout-setup/${selection.id}/review`), { method: "POST", body: JSON.stringify({ decision, reason, ownershipConfirmed: decision === "APPROVED" && ownershipConfirmed }) });
      setNotice("Payout account decision recorded and audited. No money was moved."); setSelection(null); setVersion((value) => value + 1);
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : "The review could not be saved."); }
    finally { setBusy(false); }
  }
  const loading = loadedKey !== key;
  return <PortalShell active={mode === "admin" ? "admin" : "agents"} eyebrow={mode === "admin" ? "Finance review" : "Approved agents"} title={mode === "admin" ? "Payout account review" : "Set up your payout account"} description="Bank resolution checks an account name. Eligibility also requires identity and ownership review." actions={<button className="button button--secondary" onClick={() => { setSelection(null); setVersion((value) => value + 1); }}>Refresh</button>}>
    {mode === "admin" && <div className="workspace-toolbar"><label>Review status<select value={reviewStatus} onChange={(event) => { setReviewStatus(event.target.value); setSelection(null); setPage(0); }}><option value="PENDING_REVIEW">Pending review</option><option value="APPROVED">Approved / eligibility</option><option value="REJECTED">Rejected / corrections</option></select></label></div>}
    {notice && <p className="workspace-notice" role="status">{notice}</p>}{loading ? <div className="table-skeleton" aria-label="Loading payout accounts"><div /><div /><div /></div> : error ? <section className="state-panel state-panel--error"><p>{error}</p><button className="button button--secondary" onClick={() => setVersion((value) => value + 1)}>Try again</button></section> : mode === "agent" ? <>
      {!profiles.length ? <section className="state-panel"><h2>Agent approval needed</h2><p>Payout setup opens after your application is approved.</p></section> : <><div className="table-scroll"><table className="operational-table"><thead><tr><th>Agent role</th><th>Bank</th><th>Resolved name</th><th>Account</th><th>Review status</th></tr></thead><tbody>{profiles.map((profile) => <tr key={profile.id}><td>{profile.display_name} · {profile.agent_type}</td><td>{profile.account?.bank_name ?? "Not set up"}</td><td>{profile.account?.account_name ?? "—"}</td><td>{profile.account ? `•••• ${profile.account.account_last4}` : "—"}</td><td>{profile.account?.status ?? "NOT_STARTED"}{profile.account?.review_note && <p>{profile.account.review_note}</p>}</td></tr>)}</tbody></table></div>
      {!providerAvailable ? <p className="workspace-notice">Bank resolution is unavailable. Your saved application and earnings remain unchanged. Please try again when payout setup is available.</p> : <form className="form-stack manage-form" onSubmit={resolveAccount}><h2>Resolve bank details</h2><label>Approved role<select required value={profileId} onChange={(event) => { setProfileId(event.target.value); setRequestId(""); }}><option value="">Choose an approved role</option>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.display_name} · {profile.agent_type}</option>)}</select></label><label>Find bank<input type="search" value={bankQuery} onChange={(event) => setBankQuery(event.target.value)} /></label><label>Bank<select required value={bankCode} onChange={(event) => { setBankCode(event.target.value); setRequestId(""); }}><option value="">Choose a bank</option>{banks.filter((bank) => bank.code === bankCode || bank.name.toLowerCase().includes(bankQuery.toLowerCase())).map((bank) => <option key={bank.code} value={bank.code}>{bank.name}</option>)}</select></label><label>Account number<input required type="text" inputMode="numeric" autoComplete="off" pattern="[0-9]{10}" maxLength={10} value={accountNumber} onChange={(event) => { setAccountNumber(event.target.value.replace(/\D/g, "")); setRequestId(""); }} /></label><label className="checkbox"><input required type="checkbox" checked={authorizedAccount} onChange={(event) => setAuthorizedAccount(event.target.checked)} />I own or am authorized to use this payout account.</label><button className="button button--primary" disabled={busy}>{busy ? "Resolving bank account…" : "Resolve account name"}</button></form>}</>}
    </> : <>
      <div className="table-scroll"><table className="operational-table"><thead><tr><th>Agent</th><th>Bank / account</th><th>Resolved name</th><th>Name check</th><th>Review / mode</th><th>Eligibility</th><th>Action</th></tr></thead><tbody>{accounts.map((account) => <tr key={account.id}><td>{account.display_name}<small className="catalogue-ids">{account.legal_name}</small></td><td>{account.bank_name} · •••• {account.account_last4}</td><td>{account.account_name}</td><td>{account.name_match}</td><td>{account.status} · {account.provider_mode}</td><td>{account.payout_eligible ? "Eligible" : "Requirements pending"}</td><td><button className="text-button" disabled={account.status !== "PENDING_REVIEW"} onClick={() => { setSelection(account); setReason(""); setOwnershipConfirmed(false); setDecision("REJECTED"); }}>Review</button></td></tr>)}</tbody></table>{!accounts.length && <p className="table-empty">No payout accounts in this scope.</p>}</div><div className="workspace-pagination"><span>Page {page + 1}</span><button className="button button--secondary" disabled={page === 0} onClick={() => { setPage((value) => value - 1); setSelection(null); }}>Previous</button><button className="button button--secondary" disabled={accounts.length < 50} onClick={() => { setPage((value) => value + 1); setSelection(null); }}>Next</button></div>
      {selection && accounts.some((account) => account.id === selection.id) && <form className="form-stack manage-form" onSubmit={reviewAccount}><h2>Review {selection.display_name}</h2><p className="scope-caption">{scopeLabel} · {selection.bank_name} · •••• {selection.account_last4}</p><p>{selection.account_name} · Name check: {selection.name_match}</p><label>Decision<select value={decision} onChange={(event) => setDecision(event.target.value)}><option value="REJECTED">Request correction / reject</option><option value="APPROVED">Approve account setup</option></select></label>{decision === "APPROVED" && <label className="checkbox"><input required type="checkbox" checked={ownershipConfirmed} onChange={(event) => setOwnershipConfirmed(event.target.checked)} />I reviewed supporting ownership evidence. The resolved name alone was not my evidence.</label>}<label>Specific reason / reviewed evidence<textarea required minLength={12} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></label><p className="field-help">Test-mode accounts are not payout eligible. This action does not execute a payout.</p><div className="form-actions"><button type="button" className="button button--secondary" onClick={() => setSelection(null)}>Cancel</button><button className="button button--primary" disabled={busy}>{busy ? "Recording decision…" : "Record account decision"}</button></div></form>}
    </>}
  </PortalShell>;
}
