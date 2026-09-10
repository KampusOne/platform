"use client";

import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PortalAuth, usePortalSession } from "@/components/portal-auth";
import { portalSupabase } from "@/lib/supabase-browser";

type ApplicationStatus = "submitted" | "under_review" | "needs_information" | "approved" | "rejected";
type Application = {
  id: string;
  institution_id: string;
  applicant_user_id: string;
  full_name: string;
  email: string;
  phone: string;
  applicant_type: "student" | "non_student";
  programme: string | null;
  current_level: number | null;
  matriculation_number: string | null;
  desired_roles: string[];
  statement: string;
  status: ApplicationStatus;
  status_reason: string | null;
  submitted_at: string | null;
  updated_at: string;
};

type Evidence = {
  id: string;
  kind: string;
  object_path: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  verification_status: "pending" | "pass" | "review" | "fail";
  extracted_name: string | null;
  name_match_score: number | null;
};

const sampleApplication: Application = {
  id: "a18d9bc0-preview",
  institution_id: "uniben-preview",
  applicant_user_id: "preview-user",
  full_name: "Ada Osagie",
  email: "ada@example.edu",
  phone: "+2348000000000",
  applicant_type: "student",
  programme: "Computer Science",
  current_level: 300,
  matriculation_number: "CSC/22/0000",
  desired_roles: ["verification", "campus_support"],
  statement: "I know the campus academic offices and want to help students resolve verified support requests promptly.",
  status: "under_review",
  status_reason: null,
  submitted_at: "2026-09-10T08:30:00.000Z",
  updated_at: "2026-09-10T08:35:00.000Z",
};

const sampleEvidence: Evidence[] = [
  { id: "doc-preview-1", kind: "government_id", object_path: "", original_filename: "government-id.pdf", mime_type: "application/pdf", size_bytes: 1240000, verification_status: "review", extracted_name: "Ada Osagie", name_match_score: 0.96 },
  { id: "doc-preview-2", kind: "student_id", object_path: "", original_filename: "student-card.jpg", mime_type: "image/jpeg", size_bytes: 820000, verification_status: "pending", extracted_name: null, name_match_score: null },
];

const allowedRoles = new Set(["platform_operator", "institution_admin", "verification_agent"]);

export function AdminOperations() {
  const { configured, loading, session } = usePortalSession();
  if (loading) return <div className="portal-loading">Checking operator access…</div>;
  if (!configured) return <OperationsWorkspace preview applications={[sampleApplication]} sampleDocuments={sampleEvidence} />;
  if (!session) return <PortalAuth allowSignup={false} body="Only invited, institution-scoped operators can enter. There is no public admin registration route." title="Sign in to KampusOne operations" />;
  return <AuthenticatedOperations session={session} />;
}

function AuthenticatedOperations({ session }: { session: Session }) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [authorised, setAuthorised] = useState<boolean>();
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!portalSupabase) return;
    setLoading(true);
    const roleResult = await portalSupabase.from("role_assignments").select("role,institution_id");
    if (roleResult.error) {
      setMessage(roleResult.error.message);
      setAuthorised(false);
      setLoading(false);
      return;
    }
    const hasRole = (roleResult.data ?? []).some((assignment) => allowedRoles.has(assignment.role));
    setAuthorised(hasRole);
    if (!hasRole) {
      setLoading(false);
      return;
    }
    const result = await portalSupabase.from("agent_applications").select("id,institution_id,applicant_user_id,full_name,email,phone,applicant_type,programme,current_level,matriculation_number,desired_roles,statement,status,status_reason,submitted_at,updated_at").neq("status", "draft").order("submitted_at", { ascending: false });
    if (result.error) setMessage(result.error.message);
    else setApplications((result.data ?? []) as Application[]);
    setLoading(false);
  }, []);

  useEffect(() => { queueMicrotask(() => void refresh()); }, [refresh]);

  if (loading) return <div className="portal-loading">Loading the application queue…</div>;
  if (!authorised) {
    return <section className="access-denied"><span>!</span><p className="section-kicker">Access denied</p><h2>This account has no operations role.</h2><p>{session.user.email} is signed in, but no trusted platform, institution or verification role was found. Roles cannot be self-assigned.</p>{message ? <p className="form-message">{message}</p> : null}<button className="text-button" onClick={() => void portalSupabase?.auth.signOut()} type="button">Sign out</button></section>;
  }

  return <><div className="signed-in-bar"><span>Operator <strong>{session.user.email}</strong></span><button onClick={() => void portalSupabase?.auth.signOut()} type="button">Sign out</button></div>{message ? <p className="form-message">{message}</p> : null}<OperationsWorkspace accessToken={session.access_token} applications={applications} onRefresh={refresh} /></>;
}

function OperationsWorkspace({ applications, preview = false, sampleDocuments = [], onRefresh, accessToken }: { applications: Application[]; preview?: boolean; sampleDocuments?: Evidence[]; onRefresh?: () => Promise<void>; accessToken?: string }) {
  const [filter, setFilter] = useState<"all" | ApplicationStatus>("all");
  const [selectedId, setSelectedId] = useState(applications[0]?.id);
  const [documents, setDocuments] = useState<Evidence[]>(sampleDocuments);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const selected = applications.find((application) => application.id === selectedId) ?? applications[0];
  const visible = useMemo(() => filter === "all" ? applications : applications.filter((item) => item.status === filter), [applications, filter]);

  useEffect(() => {
    if (preview || !portalSupabase || !selected) return;
    let live = true;
    void portalSupabase.from("agent_application_documents").select("id,kind,object_path,original_filename,mime_type,size_bytes,verification_status,extracted_name,name_match_score").eq("application_id", selected.id).order("created_at").then((result) => {
      if (!live) return;
      if (result.error) setMessage(result.error.message);
      else setDocuments((result.data ?? []) as Evidence[]);
    });
    return () => { live = false; };
  }, [preview, selected]);

  async function reviewApplication(decision: "started" | "request_information" | "approve" | "reject") {
    if (preview || !portalSupabase || !selected) {
      setMessage("Preview controls do not mutate data. Connect operator access to use this decision.");
      return;
    }
    if (reason.trim().length < 4) {
      setMessage("Add a clear decision reason first. It becomes part of the audit record.");
      return;
    }
    setBusy(true);
    try {
      await callWorker(`/v1/admin/agent-applications/${selected.id}/review`, { decision, reason: reason.trim() });
      setMessage(`Decision recorded: ${decision.replace("_", " ")}.`);
      setReason("");
      await onRefresh?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The review could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewDocument(document: Evidence, outcome: "pass" | "review" | "fail") {
    if (preview || !portalSupabase) {
      setMessage("Preview controls do not mutate document checks.");
      return;
    }
    if (reason.trim().length < 4) {
      setMessage("Add a review reason before changing document status.");
      return;
    }
    setBusy(true);
    try {
      await callWorker(`/v1/admin/agent-documents/${document.id}/review`, { outcome, reason: reason.trim() });
      setDocuments((current) => current.map((item) => item.id === document.id ? { ...item, verification_status: outcome } : item));
      setMessage(`${document.original_filename} marked ${outcome}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The document review could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function viewDocument(document: Evidence) {
    if (preview || !portalSupabase || !document.object_path) {
      setMessage("The preview never exposes a real identity file.");
      return;
    }
    const result = await portalSupabase.storage.from("agent-evidence").createSignedUrl(document.object_path, 120);
    if (result.error) setMessage(result.error.message);
    else window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
  }

  const pending = applications.filter((item) => ["submitted", "under_review", "needs_information"].includes(item.status)).length;

  async function callWorker(path: string, body: Record<string, string>) {
    const apiUrl = process.env.NEXT_PUBLIC_KAMPUSONE_API_URL?.replace(/\/$/, "");
    if (!apiUrl || !accessToken) throw new Error("The Cloudflare API connection is not configured for this portal.");
    const response = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as { error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? "The Cloudflare API could not record this decision.");
    return payload;
  }

  return (
    <section className="operations" id="overview">
      {preview ? <div className="preview-ribbon"><span>Operations preview</span><strong>Synthetic record only · real controls require an invited operator session.</strong></div> : null}
      <div className="ops-metrics"><div><span>Open queue</span><strong>{pending}</strong><small>applications needing attention</small></div><div><span>Pending evidence</span><strong>{documents.filter((item) => item.verification_status === "pending").length}</strong><small>never counted as failed</small></div><div><span>Approved</span><strong>{applications.filter((item) => item.status === "approved").length}</strong><small>role grants are audited</small></div><div><span>Automation</span><strong>Safe off</strong><small>NIN/OCR keys not connected</small></div></div>

      <div className="ops-workspace" id="applications">
        <div className="application-queue">
          <div className="queue-head"><div><p className="section-kicker">Application queue</p><h2>Agent review</h2></div><select aria-label="Filter applications" onChange={(event) => setFilter(event.target.value as typeof filter)} value={filter}><option value="all">All states</option><option value="submitted">Submitted</option><option value="under_review">Under review</option><option value="needs_information">Needs information</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></div>
          <div className="queue-list">{visible.length ? visible.map((application) => <button aria-pressed={selected?.id === application.id} key={application.id} onClick={() => setSelectedId(application.id)} type="button"><span className="queue-avatar">{application.full_name.split(" ").map((part) => part[0]).join("").slice(0,2)}</span><span><strong>{application.full_name}</strong><small>{application.applicant_type === "student" ? `${application.programme ?? "Student"} · ${application.current_level ?? "—"} level` : "Non-student applicant"}</small></span><span className={`ops-status ops-status--${application.status}`}>{application.status.replaceAll("_", " ")}</span></button>) : <div className="queue-empty">No applications match this view.</div>}</div>
        </div>

        <div className="review-desk" id="verification">
          {selected ? <>
            <div className="review-head"><div><p className="section-kicker">Applicant detail</p><h2>{selected.full_name}</h2><p>{selected.email} · {selected.phone}</p></div><span className={`ops-status ops-status--${selected.status}`}>{selected.status.replaceAll("_", " ")}</span></div>
            <dl className="identity-facts"><div><dt>Relationship</dt><dd>{selected.applicant_type === "student" ? "Current student" : "Non-student"}</dd></div><div><dt>Programme</dt><dd>{selected.programme ?? "Not applicable"}</dd></div><div><dt>Level</dt><dd>{selected.current_level ?? "—"}</dd></div><div><dt>Matric number</dt><dd>{selected.matriculation_number ?? "Not supplied"}</dd></div></dl>
            <div className="review-block"><strong>Requested work</strong><div className="role-tags">{selected.desired_roles.map((role) => <span key={role}>{role.replaceAll("_", " ")}</span>)}</div></div>
            <div className="review-block"><strong>Applicant statement</strong><p>{selected.statement}</p></div>
            <div className="review-block"><div className="review-block__head"><strong>Private evidence</strong><small>Signed links expire in 2 minutes</small></div>{documents.length ? <div className="document-list">{documents.map((document) => <div key={document.id}><button className="document-main" onClick={() => void viewDocument(document)} type="button"><span>{document.mime_type === "application/pdf" ? "PDF" : "IMG"}</span><span><strong>{document.original_filename}</strong><small>{document.kind.replaceAll("_", " ")} · {(document.size_bytes / 1024 / 1024).toFixed(2)} MB</small></span><span className={`document-state document-state--${document.verification_status}`}>{document.verification_status}</span></button><div className="document-actions"><button disabled={busy} onClick={() => void reviewDocument(document, "pass")} type="button">Pass</button><button disabled={busy} onClick={() => void reviewDocument(document, "review")} type="button">Keep pending</button><button disabled={busy} onClick={() => void reviewDocument(document, "fail")} type="button">Fail</button></div>{document.extracted_name ? <p className="document-signal">Extracted name: {document.extracted_name} · match {document.name_match_score ? `${Math.round(document.name_match_score * 100)}%` : "not scored"}</p> : null}</div>)}</div> : <p className="queue-empty">No document metadata is attached yet.</p>}</div>
            <label className="review-reason">Decision reason<textarea onChange={(event) => setReason(event.target.value)} placeholder="Required for document and application decisions" rows={3} value={reason} /></label>
            {message ? <p className="form-message" role="status">{message}</p> : null}
            <div className="review-actions"><button disabled={busy} onClick={() => void reviewApplication("request_information")} type="button">Request information</button><button disabled={busy} onClick={() => void reviewApplication("reject")} type="button">Reject</button><button className="approve" disabled={busy} onClick={() => void reviewApplication("approve")} type="button">Approve agent</button></div>
          </> : <div className="queue-empty">Choose an application to inspect.</div>}
        </div>
      </div>

      <div className="ops-boundaries" id="safety"><div><p className="section-kicker">Verification rule</p><h3>Uncertain means pending.</h3><p>OCR, metadata and name-match signals support review. They never silently reject a person or claim a document is genuine.</p></div><div id="publishing"><p className="section-kicker">Next operations module</p><h3>Publishing and safety controls.</h3><p>Official posts, blogs, events, listing suspension and account actions arrive after operator identity acceptance.</p></div></div>
    </section>
  );
}
