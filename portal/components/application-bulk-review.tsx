"use client";
import { useState, type FormEvent } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
type Application = { id: string; display_name: string; agent_type: string; status: string; university_id?: string };
type Preview = { previewId: string; expiresAt: string; decision: string; applications: Application[] };
export function ApplicationBulkReview({ applications, onChanged }: { applications: Application[]; onChanged(): void }) {
  const { can, scopeLabel, access } = useAdminContext();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [decision, setDecision] = useState("NEEDS_CORRECTION");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const candidates = applications.filter((application) => ["SUBMITTED", "IN_REVIEW", "NEEDS_CORRECTION", "REJECTED"].includes(application.status));
  async function prepare(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { setPreview(await portalApi<Preview>("/v1/admin/applications/bulk-review/preview", { method: "POST", body: JSON.stringify({ applicationIds: selectedIds, decision }) })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "The selection could not be reviewed."); }
    finally { setBusy(false); }
  }
  async function confirm(event: FormEvent) {
    event.preventDefault(); if (!preview) return; setBusy(true); setError("");
    try { await portalApi(`/v1/admin/applications/bulk-review/${preview.previewId}/confirm`, { method: "POST", body: JSON.stringify({ confirm: true, note }) }); setNotice(`Decisions recorded for the ${preview.applications.length} reviewed applications. Applicant emails are queued separately.`); setPreview(null); setSelectedIds([]); setNote(""); onChanged(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No confirmed bulk result was received. Retry this reviewed selection."); }
    finally { setBusy(false); }
  }
  if (!can("agents.review")) return null;
  return <details className="panel application-bulk-panel"><summary>Review a selected group of applications</summary><p className="scope-caption">{scopeLabel} · Choose up to 25 records. Every selected application is checked again by the server before a decision.</p>{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="workspace-notice" role="status">{notice}</p>}{preview ? <form className="form-stack" onSubmit={confirm}><h3>Confirm {preview.decision.replaceAll("_", " ").toLowerCase()} for {preview.applications.length} applications</h3><div className="table-scroll"><table className="operational-table"><thead><tr><th>Applicant</th><th>Role</th><th>Current status</th><th>University</th></tr></thead><tbody>{preview.applications.map((application) => <tr key={application.id}><td>{application.display_name}<small className="catalogue-ids">{application.id}</small></td><td>{application.agent_type}</td><td>{application.status}</td><td>{access?.universities?.find((university) => university.id === application.university_id)?.name ?? application.university_id}</td></tr>)}</tbody></table></div><p className="field-help">Review expires {new Date(preview.expiresAt).toLocaleTimeString()}. Approval does not grant payout or staff access.</p><label>Specific shared decision reason<textarea required minLength={10} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label><div className="form-actions"><button type="button" className="button button--secondary" disabled={busy} onClick={() => setPreview(null)}>Change selection</button><button className="button button--primary" disabled={busy}>{busy ? "Recording reviewed decisions…" : "Confirm these exact decisions"}</button></div></form> : <form className="form-stack" onSubmit={prepare}><div className="table-scroll bulk-selection-scroll"><table className="operational-table"><thead><tr><th>Select</th><th>Applicant</th><th>Role</th><th>Status</th></tr></thead><tbody>{candidates.map((application) => <tr key={application.id}><td><input type="checkbox" aria-label={`Select ${application.display_name}`} checked={selectedIds.includes(application.id)} disabled={busy || (selectedIds.length >= 25 && !selectedIds.includes(application.id))} onChange={(event) => setSelectedIds(event.target.checked ? [...selectedIds, application.id] : selectedIds.filter((id) => id !== application.id))} /></td><td>{application.display_name}</td><td>{application.agent_type}</td><td>{application.status}</td></tr>)}</tbody></table>{!candidates.length && <p className="table-empty">No reviewable applications in this scope.</p>}</div><label>Proposed decision<select value={decision} onChange={(event) => setDecision(event.target.value)}><option value="NEEDS_CORRECTION">Request specific corrections</option><option value="APPROVED">Approve reviewed applications</option><option value="REJECTED">Reject with a specific reason</option></select></label><button className="button button--secondary" disabled={busy || !selectedIds.length}>{busy ? "Preparing review…" : `Preview ${selectedIds.length} selected records`}</button></form>}</details>;
}
