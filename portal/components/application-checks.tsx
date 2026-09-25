"use client";
import { useEffect, useState } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
type Check = { id: string; check_version: string; status: string; review_group: string | null; flags: { code: string; severity: string; message: string; fields?: string[] }[]; coverage: { notPerformed?: string[] }; attempts: number; error_code?: string | null; created_at: string; completed_at?: string | null; current: boolean };
export function ApplicationChecks({ applicationId }: { applicationId: string }) {
  const { can } = useAdminContext();
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!can("agents.verify")) return;
    let active = true;
    void portalApi<{ checks: Check[] }>(`/v1/admin/applications/${applicationId}/checks`).then((result) => { if (active) { setChecks(result.checks); setError(""); } }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Checks could not be loaded."); });
    return () => { active = false; };
  }, [applicationId, can, version]);
  async function run() {
    setBusy(true); setError("");
    try { await portalApi(`/v1/admin/applications/${applicationId}/checks`, { method: "POST", body: "{}" }); setVersion((value) => value + 1); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Checks could not be completed."); }
    finally { setBusy(false); }
  }
  if (!can("agents.verify")) return null;
  return <section className="sub-form"><div className="panel-heading"><div><p className="section-kicker">Evidence checks</p><h3>Application consistency</h3></div><button className="button button--secondary" disabled={busy} onClick={() => void run()}>{busy ? "Checking submitted records…" : "Run checks"}</button></div><p className="field-help">Checks inspect recorded fields and file metadata. A reviewer must make the approval decision; a complete result does not prove identity or document authenticity.</p>{error && <p className="form-error" role="alert">{error}</p>}{!checks && !error && <div className="table-skeleton" aria-label="Loading check history"><div /><div /></div>}{checks?.length === 0 && <p className="muted">No checks recorded for this application.</p>}{checks?.map((check) => <details className="review-item" key={check.id} open={check.current}><summary><strong>{check.review_group?.replaceAll("_", " ") ?? check.status}</strong><span>{check.current ? "Current submission" : "Previous submission"}</span></summary><p className="field-help">{check.check_version} · {new Date(check.completed_at ?? check.created_at).toLocaleString()} · {check.status}</p>{check.flags?.length ? <ul className="application-check-flags">{check.flags.map((flag, index) => <li key={`${flag.code}-${index}`}><strong>{flag.code.replaceAll("_", " ")}</strong><p>{flag.message}</p>{flag.fields?.length ? <small>Fields: {flag.fields.join(", ")}</small> : null}</li>)}</ul> : <p>No metadata flags were recorded. Human review is still required.</p>}{check.error_code && <p className="form-error">Check failure: {check.error_code}</p>}<p className="field-help">Not performed: {check.coverage?.notPerformed?.join(", ") || "OCR, document authenticity, image-generation detection or fraud determination"}.</p></details>)}</section>;
}
