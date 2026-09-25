"use client";

import {AcademicScopeFields} from "./academic-scope-fields";
import {GuidelineBody} from "./guideline-body";
import { useEffect, useState, type FormEvent } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
import { PortalShell } from "./portal-shell";

type Claim = { id: string; claim_kind: string; source_key: string; report_ref: string; page: number; filename: string; review_status: string; payload: Record<string, unknown>; metadata_json: { pages?: number } };
type Guideline = {body:string;faculty_id?:string;department_id?:string;source_key:string;source_excerpt:string;issuing_institution:string;document_date?:string;programme_name?:string; id: string; institution_id: string; title: string; version: number; status: string; source_url: string; source_page: number; effective_from: string | null; session_label: string | null };
type Claims = { rows: Claim[]; total: number; page: number; pageSize: number };
const failure = (error: unknown) => error instanceof Error ? error.message : "This operation could not be completed. Please try again.";
const inputClass = "search-input";

export function AcademicSourceWorkspace() {
  const { access, scope, scopedPath, can } = useAdminContext();
  const [tab, setTab] = useState<"claims" | "guidelines">("claims");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("PENDING");
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ key: string; claims?: Claims; guidelines?: Guideline[] } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Claim | null>(null);
  const [revisionGuide,setRevisionGuide]=useState<Guideline|null>(null);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState("publish");
  const key = JSON.stringify([tab, scope, search, status, page, version]);
  const claimAccess = Boolean(access?.allUniversities && can("academic.view"));

  useEffect(() => {
    if (!can("academic.view") || (tab === "claims" && !claimAccess)) return;
    let active = true;
    const path = tab === "claims"
      ? `/v1/admin/academic/claims?status=${status}&q=${encodeURIComponent(search)}&page=${page}`
      : scopedPath("/v1/admin/academic/guidelines");
    void portalApi<Claims | { rows: Guideline[] }>(path).then((data) => {
      if (!active) return;
      setResult(tab === "claims" ? { key, claims: data as Claims } : { key, guidelines: data.rows as Guideline[] });
      setError("");
    }).catch((caught) => { if (active) setError(failure(caught)); });
    return () => { active = false; };
  }, [can, claimAccess, key, page, scopedPath, search, status, tab]);

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const values = new FormData(event.currentTarget);
    const text = (name: string) => String(values.get(name) ?? "").trim();
    const reject = decision === "reject" || selected.claim_kind !== "institution";
    const payload = reject ? { decision: "REJECTED", reason: text("reason") } : {
      name: text("name"), slug: text("slug"), primarySourceUrl: text("url"),
      existingInstitutionId: text("existing") || undefined, sourceVerified: values.has("verified"), reason: text("reason"),
    };
    setBusy(true); setNotice("");
    try {
      await portalApi(`/v1/admin/academic/claims/${selected.id}/${reject ? "review" : "publish-institution"}`, { method: "POST", body: JSON.stringify(payload) });
      setNotice(reject ? "Source claim rejected. The review reason has been recorded." : "Institution published with its reviewed source and audit record.");
      setSelected(null); setVersion((value) => value + 1);
    } catch (caught) { setNotice(failure(caught)); } finally { setBusy(false); }
  }

  async function publishGuideline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const text = (name: string) => String(values.get(name) ?? "").trim();
    const payload = {
      universityId: scope || revisionGuide?.institution_id || text("universityId"), title: text("title"), body: text("body"),
      facultyId: text("facultyId") || undefined, departmentId: text("departmentId") || undefined,
      sourceUrl: text("sourceUrl"), sourceKey: text("sourceKey"), sourcePage: Number(text("sourcePage")),
      sourceExcerpt: text("sourceExcerpt"), issuingInstitution: text("issuingInstitution"),
      documentDate: text("documentDate") || undefined, effectiveFrom: text("effectiveFrom") || undefined,
      sessionLabel: text("sessionLabel") || undefined, programmeName: text("programmeName") || undefined,
      replacesId: text("replacesId") || undefined, sourceVerified: values.has("sourceVerified"), reason: text("reason"),
    };
    setBusy(true); setNotice("");
    try {
      const saved = await portalApi<{ version: number }>("/v1/admin/academic/guidelines", { method: "POST", body: JSON.stringify(payload) });
      setNotice(`Guideline version ${saved.version} published. Its source and scope have been recorded.`);
      form.reset(); setRevisionGuide(null); setVersion((value) => value + 1);
    } catch (caught) { setNotice(failure(caught)); } finally { setBusy(false); }
  }

  const current = result?.key === key ? result : null;
  return <PortalShell active="admin" eyebrow="Academic evidence" title="Sources & guidelines" description="Review source claims, resolve conflicting records and publish rules with provenance.">
    <div className="workspace-toolbar"><button className={`button button--${tab === "claims" ? "primary" : "secondary"}`} onClick={() => { setTab("claims"); setSelected(null); setError(""); }}>Source claims</button><button className={`button button--${tab === "guidelines" ? "primary" : "secondary"}`} onClick={() => { setTab("guidelines"); setSelected(null); setError(""); }}>Published guidelines</button></div>
    {notice && <p className="workspace-notice" role="status">{notice}</p>}
    {!can("academic.view") ? <p className="state-panel">Academic review permission is required.</p> : tab === "claims" && !claimAccess ? <p className="state-panel">Unassigned source claims require global academic access. University reviewers can manage guidelines within their authorized scope.</p> : <>
      {tab === "claims" && <><p className="field-help">Source claims are reviewed globally; the university selector applies to guidelines. The supplied compilations contain incomplete and conflicting records. Institution claims need a verified primary source before publication. Profile and rule references provide evidence for separate catalogue and guideline review.</p><form className="workspace-toolbar" onSubmit={(event) => { event.preventDefault(); setSearch(query); setPage(1); setSelected(null); }}><label>Search source claims<input className={inputClass} value={query} onChange={(event) => setQuery(event.target.value)} /></label><label>Status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); setSelected(null); }}><option value="PENDING">Pending review</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="ALL">All</option></select></label><button className="button button--secondary">Search</button></form></>}
      {error ? <section className="state-panel state-panel--error" role="alert"><p>{error}</p><button className="button button--secondary" onClick={() => setVersion((value) => value + 1)}>Try again</button></section> : !current ? <div className="table-skeleton" aria-label="Loading academic records"><div /><div /><div /></div> : tab === "claims" ? <>
        <div className="table-scroll"><table className="operational-table"><thead><tr><th>Source / page</th><th>Claim</th><th>Status</th><th>Review</th></tr></thead><tbody>{current.claims?.rows.map((claim) => <tr key={claim.id}><td>{claim.filename}<br />Page {claim.page}</td><td>{claim.claim_kind}<br />{String(claim.payload.name ?? claim.payload.institution ?? claim.report_ref)}</td><td>{claim.review_status}</td><td><button className="text-button" onClick={() => { setSelected(claim); setDecision(claim.claim_kind === "institution" ? "publish" : "reject"); }}>Inspect evidence</button></td></tr>)}</tbody></table>{!current.claims?.rows.length && <p className="table-empty">No matching claims. Reviewed source batches must be staged before they appear here.</p>}</div>
        <div className="form-actions"><button className="button button--secondary" disabled={page <= 1} onClick={() => { setPage((value) => value - 1); setSelected(null); }}>Previous</button><span>Page {page} · {current.claims?.total ?? 0} records</span><button className="button button--secondary" disabled={page * 25 >= (current.claims?.total ?? 0)} onClick={() => { setPage((value) => value + 1); setSelected(null); }}>Next</button></div>
      </> : <div className="table-scroll"><table className="operational-table"><thead><tr><th>Guideline</th><th>Status</th><th>Source</th><th>Effective date / session</th></tr></thead><tbody>{current.guidelines?.map((item) => <tr key={item.id}><td>{item.title}{can("academic.manage")&&<button className="text-button" onClick={()=>setRevisionGuide(item)}>Edit guideline</button>}<br />Version {item.version}<br /><small>{item.id}</small></td><td>{item.status}</td><td><a href={item.source_url} target="_blank" rel="noopener noreferrer">Primary source</a> · page {item.source_page}</td><td>{item.effective_from?.slice(0, 10) ?? "Not recorded"} · {item.session_label ?? "Not specified"}</td></tr>)}</tbody></table>{!current.guidelines?.length && <p className="table-empty">No guidelines in this scope.</p>}</div>}
      {tab === "claims" && selected && <section className="panel"><div className="workspace-toolbar"><h2>Review source evidence</h2><button className="text-button" onClick={() => setSelected(null)}>Close</button></div><p>{selected.filename} · page {selected.page}</p><p className="field-help">Source key: {selected.source_key}</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(selected.payload, null, 2)}</pre>
        {selected.review_status === "PENDING" && can("academic.manage") && <form className="form-stack" onSubmit={(event) => void review(event)} key={selected.id}><label>Review decision<select value={decision} onChange={(event) => setDecision(event.target.value)}>{selected.claim_kind === "institution" && <option value="publish">Publish / link institution</option>}<option value="reject">Reject this claim</option></select></label>{decision === "publish" && selected.claim_kind === "institution" && <><label>Verified institution name<input required name="name" minLength={3} maxLength={160} defaultValue={String(selected.payload.name ?? "")} /></label><label>URL slug<input required name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={180} /></label><label>Existing institution ID, if linking<input name="existing" placeholder="Leave blank to create an institution" /></label><label>Verified primary source URL<input required type="url" name="url" placeholder="https://…" /></label><label><input required type="checkbox" name="verified" /> I checked the primary source and resolved identity conflicts.</label></>}<label>Review reason<textarea required name="reason" minLength={20} maxLength={2000} /></label><button className="button button--primary" disabled={busy}>{busy ? "Saving review…" : decision === "publish" ? "Publish reviewed institution" : "Reject claim"}</button></form>}
      </section>}
      {tab === "guidelines" && can("academic.manage") && <details className="panel" open={Boolean(revisionGuide)||undefined}><summary>Publish a sourced guideline or revision</summary><form className="form-stack" onSubmit={(event) => void publishGuideline(event)} key={scope+(revisionGuide?.id??"new")}>
        <p className="field-help">Publication is immediate after validation. Include only rules verified in the issuing institution’s current source. Revision preserves the previous version.</p>
        <AcademicScopeFields scope={scope||revisionGuide?.institution_id||""} facultyId={revisionGuide?.faculty_id} departmentId={revisionGuide?.department_id}/>
        <label>Title<input defaultValue={revisionGuide?.title} required name="title" minLength={3} maxLength={180} /></label><GuidelineBody initial={revisionGuide?.body}/>
        <label>Primary source URL<input defaultValue={revisionGuide?.source_url} required type="url" name="sourceUrl" placeholder="https://…" /></label><label>Registered PDF source key (leave blank for a web source)<input defaultValue={revisionGuide?.source_key} name="sourceKey" maxLength={240} /></label><label>Source page<input required type="number" min={1} name="sourcePage" defaultValue={revisionGuide?.source_page??1} /></label><label>Source excerpt<textarea defaultValue={revisionGuide?.source_excerpt} required name="sourceExcerpt" minLength={10} maxLength={2000} /></label><label>Issuing institution<input defaultValue={revisionGuide?.issuing_institution} required name="issuingInstitution" /></label><label>Document date<input type="date" name="documentDate" /></label><label>Effective from<input type="date" name="effectiveFrom" /></label><label>Academic session (optional)<input name="sessionLabel" maxLength={40} /></label><label>Programme (optional)<input name="programmeName" maxLength={180} /></label><label>Published guideline ID being replaced (optional)<input defaultValue={revisionGuide?.id} name="replacesId" /></label><label>Publication reason<textarea required name="reason" minLength={20} maxLength={2000} /></label><label><input required type="checkbox" name="sourceVerified" /> I verified the source, scope and effective date.</label><button className="button button--primary" disabled={busy}>{busy ? "Publishing…" : "Publish reviewed guideline"}</button>
      </form></details>}
    </>}
  </PortalShell>;
}
