"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { PortalApiError, portalApi } from "@/lib/api";
import { getAdminModule } from "@/lib/admin-modules";
import { useAdminContext } from "./admin-context";
import { usePortalAuth } from "./auth-provider";
import { PortalShell } from "./portal-shell";

type Row = Record<string, unknown> & { id?: string };
type WorkspaceData = { rows: Row[]; total: number; page: number; pageSize: number; generatedAt?: string; collectionStartedAt?: string | null };
type SavedView = { name: string; query: string; status: string; sort: string; direction: string };
const label = (value: string) => ({ institution_id: "University", name: "Name / record", type: "Category / role", created_at: "Recorded", total_kobo: "Order total" }[value] ?? value.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase()));
function format(value: unknown, key: string) {
  if (value === null || value === undefined || value === "") return "—";
  if (key.endsWith("_kobo")) return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(Number(value) / 100);
  if (key.endsWith("_at") && !Number.isNaN(Date.parse(String(value)))) return new Date(String(value)).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
  if (Array.isArray(value)) return value.map(String).join(" · ");
  if (typeof value === "object") return "Structured record";
  return String(value);
}

export function AdminWorkspace({ workspace }: { workspace: string }) {
  const workspaceModule = getAdminModule(workspace)!;
  const { access, scope, scopeLabel, scopedPath, can } = useAdminContext();
  const { user } = usePortalAuth();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(workspaceModule.status ?? "");
  const [sort, setSort] = useState("");
  const [direction, setDirection] = useState("desc");
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ key: string; data: WorkspaceData | null; error: Error | null } | null>(null);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState("NEEDS_CORRECTION");
  const [departmentId, setDepartmentId] = useState("");
  const [catalog, setCatalog] = useState<{ faculties: { id: string; university_id: string }[]; departments: { id: string; faculty_id: string; name: string }[] } | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [busy, setBusy] = useState(false);
  const allowed = can(workspaceModule.permission);
  const queryKey = JSON.stringify([workspace, scope, search, status, sort, direction, page, version]);
  const storageKey = `k1-admin-views:${user?.id}:${workspace}`;
  useEffect(() => {
    const timeout = window.setTimeout(() => { setSearch(query); setPage(1); }, 350);
    return () => window.clearTimeout(timeout);
  }, [query]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as SavedView[];
      queueMicrotask(() => setSavedViews(Array.isArray(saved) ? saved : []));
    } catch { /* Saved view preferences are optional. */ }
  }, [storageKey]);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ q: search, status, sort, direction, page: String(page), pageSize: "25" });
    if (workspaceModule.type) params.set("type", workspaceModule.type);
    void portalApi<WorkspaceData>(scopedPath(`/v1/admin/workspaces/${workspaceModule.dataset}?${params}`), { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setResult({ key: queryKey, data, error: null });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ key: queryKey, data: null, error: error instanceof Error ? error : new Error("Records could not be loaded.") });
    });
    return () => controller.abort();
  }, [allowed, direction, workspaceModule.dataset, workspaceModule.type, page, queryKey, scopedPath, search, sort, status]);
  useEffect(() => {
    if (workspaceModule.dataset !== "academic-submissions" || !can("academic.manage")) return;
    let active = true;
    void portalApi<{ faculties: { id: string; university_id: string }[]; departments: { id: string; faculty_id: string; name: string }[] }>("/v1/student/catalog").then((value) => { if (active) setCatalog(value); }).catch((error: unknown) => { if (active) setCatalogError(error instanceof Error ? error.message : "Reviewed departments could not be loaded."); });
    return () => { active = false; };
  }, [workspaceModule.dataset, can]);
  function saveView() {
    const name = window.prompt("Name this view");
    if (!name?.trim()) return;
    const next = [...savedViews.filter((view) => view.name !== name.trim()), { name: name.trim(), query, status, sort, direction }].slice(-12);
    setSavedViews(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setNotice("View saved on this browser."); } catch { setNotice("View is available for this visit; browser storage is unavailable."); }
  }
  async function reviewSubmission(event: FormEvent) {
    event.preventDefault();
    if (!selected?.id) return;
    setBusy(true); setNotice("");
    try {
      await portalApi(scopedPath(`/v1/admin/academic-submissions/${selected.id}/review`), { method: "POST", body: JSON.stringify({ decision, reason, departmentId: decision === "APPROVED" ? departmentId : undefined }) });
      setSelected(null); setReason(""); setVersion((value) => value + 1); setNotice("Review recorded.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Review could not be recorded."); }
    finally { setBusy(false); }
  }
  const loading = allowed && result?.key !== queryKey;
  const current = result?.key === queryKey ? result : null;
  const rows = current?.data?.rows ?? [];
  const columns = workspaceModule.columns ?? [];
  return <PortalShell active="admin" eyebrow="Operational workspace" title={workspaceModule.label} description="" actions={<button className="button button--secondary" onClick={() => setVersion((value) => value + 1)}>Refresh</button>}>
    {allowed && <>
      <div className="workspace-toolbar"><label className="workspace-search">Search records<input className="search-input" type="search" placeholder="Search this workspace" value={query} onChange={(event) => setQuery(event.target.value)} /></label>{!["audit", "analytics", "universities"].includes(workspaceModule.dataset ?? "") && <label>Status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{(workspaceModule.dataset === "users" ? ["ACTIVE", "SUSPENDED", "BANNED"] : workspaceModule.dataset === "agents" ? ["SUBMITTED", "NEEDS_CORRECTION", "APPROVED", "REJECTED"] : workspaceModule.dataset === "content" ? ["PUBLISHED", "DRAFT", "REMOVED"] : workspaceModule.dataset === "finance" ? ["PENDING", "PAID", "DELIVERED", "CANCELLED", "REFUNDED"] : ["PENDING", "APPROVED", "NEEDS_CORRECTION", "REJECTED"]).map((value) => <option key={value}>{value}</option>)}</select></label>}<label>Saved views<select value="" onChange={(event) => { const view = savedViews.find((item) => item.name === event.target.value); if (view) { setQuery(view.query); setStatus(view.status); setSort(view.sort); setDirection(view.direction); setPage(1); } }}><option value="">Choose view</option>{savedViews.map((view) => <option key={view.name}>{view.name}</option>)}</select></label><button className="button button--secondary" onClick={saveView}>Save view</button></div>
      {notice && <p className="workspace-notice" role="status">{notice}</p>}
      {loading ? <section className="workspace-loading" aria-busy="true" aria-label={`Loading ${workspaceModule.label}`}><div className="skeleton-heading" /><div className="table-skeleton">{[0, 1, 2, 3, 4, 5].map((row) => <div key={row} />)}</div></section> : current?.error ? <section className="state-panel state-panel--error" role="alert"><h2>{current.error instanceof PortalApiError && current.error.status === 403 ? "Access restricted" : "Records unavailable"}</h2><p>{current.error.message}</p><button className="button button--secondary" onClick={() => setVersion((value) => value + 1)}>Try again</button></section> : <>
        <div className="workspace-summary"><strong>{current?.data ? `${current.data.total.toLocaleString()} records` : "Records unavailable"}</strong><span>{scopeLabel}</span>{current?.data?.generatedAt && <time dateTime={current.data.generatedAt}>Updated {new Date(current.data.generatedAt).toLocaleTimeString()}</time>}</div>
        {workspaceModule.dataset === "analytics" && <p className="field-help">Counts cover recorded events only. A period without instrumentation cannot establish inactivity.</p>}
        <div className="table-scroll"><table className="operational-table"><caption className="sr-only">{workspaceModule.label} for {scopeLabel}</caption><thead><tr>{columns.map((key) => <th key={key} aria-sort={sort === key ? direction === "asc" ? "ascending" : "descending" : "none"}><button disabled={!["name", "type", "status", "created_at"].includes(key)} onClick={() => { setSort(key); setDirection(sort === key && direction === "desc" ? "asc" : "desc"); setPage(1); }}>{label(key)} {sort === key ? direction === "asc" ? "↑" : "↓" : ""}</button></th>)}{["users", "universities", "academic-submissions", "agents"].includes(workspaceModule.dataset!) && <th>Action</th>}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? `${page}-${index}`}>{columns.map((key) => <td key={key}>{key === "name" && workspaceModule.dataset === "users" ? <span className="table-identity">{typeof row.profile_image_url === "string" && row.profile_image_url.startsWith("https://") ? <Image src={row.profile_image_url as string} alt="" width={32} height={32} unoptimized /> : <span className="table-avatar" aria-hidden="true">{String(row.name ?? "?").slice(0, 1).toUpperCase()}</span>}<span>{format(row[key], key)}</span></span> : key === "institution_id" ? (access?.universities?.find((university) => university.id === row[key])?.name ?? format(row[key], key)) : ["status", "state", "outcome"].includes(key) ? <span className="state-badge">{format(row[key], key)}</span> : <span className={key === "body" ? "table-excerpt" : undefined}>{format(row[key], key)}</span>}</td>)}{workspaceModule.dataset === "users" && <td>{row.id && <Link className="text-link" href={`/admin/users/${row.id}`}>Inspect profile</Link>}</td>}{workspaceModule.dataset === "universities" && <td>{row.id && <UniversityAction id={row.id} />}</td>}{workspaceModule.dataset === "agents" && <td>{can("agents.review") ? <Link className="text-link" href="/admin/applications">Open review queue</Link> : "View only"}</td>}{workspaceModule.dataset === "academic-submissions" && <td>{can("academic.manage") ? <button className="text-button" onClick={() => { setSelected(row); setDepartmentId(""); setDecision("NEEDS_CORRECTION"); setNotice(""); }}>Review</button> : "View only"}</td>}</tr>)}</tbody></table>{!rows.length && <div className="workspace-empty"><h2>{query || status ? "No matching records" : "No records yet"}</h2><p>{query || status ? "Adjust the search or filters." : "Records will appear when they are created in this university scope."}</p>{(query || status) && <button className="button button--secondary" onClick={() => { setQuery(""); setStatus(""); }}>Clear filters</button>}</div>}</div>
        <div className="workspace-pagination"><span>Page {page} of {Math.max(1, Math.ceil((current?.data?.total ?? 0) / 25))}</span><button className="button button--secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="button button--secondary" disabled={page * 25 >= (current?.data?.total ?? 0)} onClick={() => setPage((value) => value + 1)}>Next</button></div>
      </>}
      {selected && rows.some((row) => row.id === selected.id) && <section className="panel"><h2>Review academic submission</h2><p className="scope-caption">{scopeLabel} · Record {selected.id}</p><dl className="review-list">{columns.map((key) => <div key={key}><dt>{label(key)}</dt><dd>{format(selected[key], key)}</dd></div>)}</dl><form className="form-stack" onSubmit={reviewSubmission}><label>Review status<select value={decision} onChange={(event) => setDecision(event.target.value)}><option value="REJECTED">Reject submission</option><option value="NEEDS_CORRECTION">Request correction</option><option value="APPROVED">Approve and link reviewed department</option></select></label>{decision === "APPROVED" && <label>Reviewed department in this university<select required value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">Choose a reviewed department</option>{catalog?.departments.filter((department) => catalog.faculties.some((faculty) => faculty.id === department.faculty_id && faculty.university_id === selected.institution_id)).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select>{catalogError && <span className="field-error">{catalogError}</span>}</label>}<p className="field-help">Approval links the provisional student profile to an existing reviewed department. Submitted wording is not automatically published as an official programme.</p><label>Specific review reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} required minLength={10} maxLength={2000} /></label><div className="form-actions"><button type="button" className="button button--secondary" onClick={() => setSelected(null)}>Cancel</button><button className="button button--primary" disabled={busy}>{busy ? "Recording review…" : "Record review"}</button></div></form></section>}
    </>}
  </PortalShell>;
}
function UniversityAction({ id }: { id: string }) {
  const { setScope } = useAdminContext();
  return <Link className="text-link" href="/admin/workspaces/users" onClick={() => setScope(id)}>Open university</Link>;
}
