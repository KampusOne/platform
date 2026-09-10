"use client";

import type { Session } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

import { PortalAuth, usePortalSession } from "@/components/portal-auth";
import { portalSupabase } from "@/lib/supabase-browser";

type Institution = { id: string; name: string; short_name: string };
type ApplicationStatus = "draft" | "submitted" | "under_review" | "needs_information" | "approved" | "rejected" | "withdrawn";
type Application = {
  id: string;
  institution_id: string;
  full_name: string;
  status: ApplicationStatus;
  status_reason: string | null;
  submitted_at: string | null;
  updated_at: string;
};

const roleOptions = [
  { value: "verification", label: "Verification support" },
  { value: "campus_support", label: "Campus support" },
  { value: "vendor_support", label: "Vendor support" },
  { value: "events", label: "Events support" },
] as const;

const previewInstitutions: Institution[] = [{ id: "preview", name: "University of Benin", short_name: "UNIBEN" }];
const evidenceMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);

const statusCopy: Record<ApplicationStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  needs_information: "More information needed",
  approved: "Approved",
  rejected: "Not approved",
  withdrawn: "Withdrawn",
};

export function AgentApplication() {
  const { configured, loading, session } = usePortalSession();

  if (loading) return <div className="portal-loading">Loading secure agent access…</div>;
  if (!configured) return <AgentPreview />;
  if (!session) return <PortalAuth allowSignup body="Use your KampusOne account or create one. Email verification is required before an application can be submitted." title="Apply to become a KampusOne agent" />;
  return <AuthenticatedApplication session={session} />;
}

function AgentPreview() {
  return (
    <section className="agent-preview" id="application">
      <div className="preview-ribbon"><span>Application preview</span><strong>Secure submission unlocks when this portal receives its Supabase public environment.</strong></div>
      <ApplicationForm disabled onSubmit={() => undefined} sessionEmail="applicant@example.edu" />
    </section>
  );
}

function AuthenticatedApplication({ session }: { session: Session }) {
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [application, setApplication] = useState<Application>();
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    const client = portalSupabase;
    if (!client) return;
    let live = true;
    void Promise.all([
      client.from("institutions").select("id,name,short_name").eq("status", "active").order("name"),
      client.from("agent_applications").select("id,institution_id,full_name,status,status_reason,submitted_at,updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]).then(([institutionResult, applicationResult]) => {
      if (!live) return;
      if (institutionResult.error) setMessage(institutionResult.error.message);
      else setInstitutions(institutionResult.data ?? []);
      if (applicationResult.error) setMessage(applicationResult.error.message);
      else setApplication(applicationResult.data as Application | undefined);
      setLoading(false);
    });
    return () => { live = false; };
  }, []);

  if (loading) return <div className="portal-loading">Checking your application…</div>;

  if (application && application.status !== "draft" && application.status !== "needs_information") {
    return <ApplicationStatusView application={application} email={session.user.email ?? ""} />;
  }

  if (!institutions.length) {
    return (
      <section className="intentional-empty" id="application">
        <span className="empty-symbol" aria-hidden="true">!</span>
        <div><strong>Applications are waiting for the verified campus catalogue.</strong><p>Your account is ready, but no active institution has been published yet. The tracker names the required catalogue owner.</p><button className="text-button" onClick={() => void portalSupabase?.auth.signOut()} type="button">Sign out</button></div>
      </section>
    );
  }

  return (
    <section id="application">
      <div className="signed-in-bar"><span>Signed in as <strong>{session.user.email}</strong></span><button onClick={() => void portalSupabase?.auth.signOut()} type="button">Sign out</button></div>
      {message ? <p className="form-message" role="status">{message}</p> : null}
      <ApplicationForm
        application={application}
        institutions={institutions}
        onSubmit={(next) => setApplication(next)}
        session={session}
        sessionEmail={session.user.email ?? ""}
      />
    </section>
  );
}

function ApplicationForm({ disabled = false, institutions = previewInstitutions, session, sessionEmail, application, onSubmit }: { disabled?: boolean; institutions?: Institution[]; session?: Session; sessionEmail: string; application?: Application; onSubmit: (application: Application) => void }) {
  const [institutionId, setInstitutionId] = useState(application?.institution_id ?? institutions[0]?.id ?? "");
  const [fullName, setFullName] = useState(application?.full_name ?? "");
  const [phone, setPhone] = useState("");
  const [applicantType, setApplicantType] = useState<"student" | "non_student">("student");
  const [programme, setProgramme] = useState("");
  const [level, setLevel] = useState("200");
  const [matriculationNumber, setMatriculationNumber] = useState("");
  const [roles, setRoles] = useState<string[]>(["campus_support"]);
  const [statement, setStatement] = useState("");
  const [documents, setDocuments] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const localDraftKey = session ? `kampusone:agent-draft:v1:${session.user.id}` : "kampusone:agent-draft:v1:preview";

  useEffect(() => {
    if (disabled) return;
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      try {
        const stored = window.localStorage.getItem(localDraftKey);
        if (!stored) return;
        const draft = JSON.parse(stored) as { institutionId?: string; fullName?: string; phone?: string; applicantType?: "student" | "non_student"; programme?: string; level?: string; matriculationNumber?: string; roles?: string[]; statement?: string };
        setInstitutionId((current) => draft.institutionId ?? current);
        setFullName(draft.fullName ?? "");
        setPhone(draft.phone ?? "");
        setApplicantType(draft.applicantType ?? "student");
        setProgramme(draft.programme ?? "");
        setLevel(draft.level ?? "200");
        setMatriculationNumber(draft.matriculationNumber ?? "");
        setRoles(draft.roles?.length ? draft.roles : ["campus_support"]);
        setStatement(draft.statement ?? "");
        setMessage("Your saved draft was restored on this device. Re-select files before submission.");
      } catch {
        setMessage("The local draft could not be restored.");
      }
    });
    return () => { live = false; };
  }, [disabled, localDraftKey]);

  const ready = useMemo(() => fullName.trim().length >= 2 && /^\+[1-9][0-9]{7,14}$/.test(phone) && statement.trim().length >= 40 && roles.length > 0 && consent, [consent, fullName, phone, roles.length, statement]);

  function toggleRole(role: string) {
    setRoles((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role]);
  }

  function saveLocalDraft() {
    window.localStorage.setItem(localDraftKey, JSON.stringify({ institutionId, fullName, phone, applicantType, programme, level, matriculationNumber, roles, statement }));
    setMessage("Draft saved on this device. Identity files are never kept in browser storage.");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !portalSupabase || !session) {
      setMessage("This is a reviewable preview. Secure submission is not connected on this deployment yet.");
      return;
    }
    if (!ready) {
      setMessage("Complete the required fields, use an international phone number and write at least 40 characters.");
      return;
    }
    if (documents.some((file) => file.size > 15 * 1024 * 1024 || !evidenceMimeTypes.has(file.type))) {
      setMessage("Each evidence file must be a PDF, JPG or PNG no larger than 15 MB.");
      return;
    }
    setBusy(true);
    setMessage(undefined);
    const base = {
      institution_id: institutionId,
      applicant_user_id: session.user.id,
      full_name: fullName.trim(),
      email: sessionEmail.trim().toLowerCase(),
      phone,
      applicant_type: applicantType,
      programme: applicantType === "student" ? programme.trim() || null : null,
      current_level: applicantType === "student" ? Number(level) : null,
      matriculation_number: applicantType === "student" ? matriculationNumber.trim() || null : null,
      desired_roles: roles,
      statement: statement.trim(),
    };

    const draftResult = application
      ? await portalSupabase.from("agent_applications").update(base).eq("id", application.id).select("id,institution_id,full_name,status,status_reason,submitted_at,updated_at").single()
      : await portalSupabase.from("agent_applications").insert({ ...base, status: "draft" }).select("id,institution_id,full_name,status,status_reason,submitted_at,updated_at").single();

    if (draftResult.error) {
      setBusy(false);
      setMessage(draftResult.error.message);
      return;
    }
    const draft = draftResult.data as Application;

    for (const file of documents) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120);
      const path = `${session.user.id}/${draft.id}/${crypto.randomUUID()}-${safeName}`;
      const upload = await portalSupabase.storage.from("agent-evidence").upload(path, file, { contentType: file.type, upsert: false });
      if (upload.error) {
        setBusy(false);
        setMessage(`Draft saved, but ${file.name} was not uploaded: ${upload.error.message}`);
        onSubmit(draft);
        return;
      }
      const metadata = await portalSupabase.from("agent_application_documents").insert({
        institution_id: institutionId,
        application_id: draft.id,
        kind: file.type === "application/pdf" ? "government_id" : "student_id",
        object_path: path,
        original_filename: file.name,
        mime_type: file.type,
        size_bytes: file.size,
      });
      if (metadata.error) {
        await portalSupabase.storage.from("agent-evidence").remove([path]);
        setBusy(false);
        setMessage(`File uploaded, but its review record needs support: ${metadata.error.message}`);
        onSubmit(draft);
        return;
      }
    }

    const submittedAt = new Date().toISOString();
    const submitted = await portalSupabase.from("agent_applications").update({ status: "submitted", submitted_at: submittedAt }).eq("id", draft.id).select("id,institution_id,full_name,status,status_reason,submitted_at,updated_at").single();
    setBusy(false);
    if (submitted.error) {
      setMessage(`Draft saved, but submission needs attention: ${submitted.error.message}`);
      onSubmit(draft);
      return;
    }
    setMessage("Application submitted. Uncertain automated checks will stay pending for a human reviewer.");
    window.localStorage.removeItem(localDraftKey);
    onSubmit(submitted.data as Application);
  }

  return (
    <form className="application-form" onSubmit={(event) => void submit(event)}>
      <div className="application-form__heading"><div><p className="section-kicker">Agent application</p><h2>Tell us how you can support your campus.</h2><p>Save your evidence once. Automated checks assist an accountable human reviewer—they do not make the final decision alone.</p></div><span className="data-label">About 8 minutes</span></div>

      <fieldset><legend>01 · Identity</legend><div className="form-grid"><label>Institution<select disabled={disabled} onChange={(event) => setInstitutionId(event.target.value)} value={institutionId}>{institutions.map((institution) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}</select></label><label>Full legal name<input disabled={disabled} onChange={(event) => setFullName(event.target.value)} placeholder="As shown on your documents" required value={fullName} /></label><label>Email address<input disabled value={sessionEmail} /></label><label>Phone number<input disabled={disabled} onChange={(event) => setPhone(event.target.value)} placeholder="+234…" required type="tel" value={phone} /></label></div></fieldset>

      <fieldset><legend>02 · Campus relationship</legend><div className="choice-line"><button aria-pressed={applicantType === "student"} disabled={disabled} onClick={() => setApplicantType("student")} type="button">Current student</button><button aria-pressed={applicantType === "non_student"} disabled={disabled} onClick={() => setApplicantType("non_student")} type="button">Not a current student</button></div>{applicantType === "student" ? <div className="form-grid form-grid--three"><label>Programme<input disabled={disabled} onChange={(event) => setProgramme(event.target.value)} placeholder="Computer Education" value={programme} /></label><label>Current level<select disabled={disabled} onChange={(event) => setLevel(event.target.value)} value={level}>{[100,200,300,400,500,600].map((item) => <option key={item}>{item}</option>)}</select></label><label>Matric number<input disabled={disabled} onChange={(event) => setMatriculationNumber(event.target.value)} value={matriculationNumber} /></label></div> : null}</fieldset>

      <fieldset><legend>03 · Work interests</legend><p className="fieldset-help">Choose at least one. Approval grants only explicitly assigned workflows.</p><div className="role-grid">{roleOptions.map((role) => <button aria-pressed={roles.includes(role.value)} disabled={disabled} key={role.value} onClick={() => toggleRole(role.value)} type="button"><span>{roles.includes(role.value) ? "✓" : "+"}</span>{role.label}</button>)}</div><label>Why do you want to be an agent?<textarea disabled={disabled} maxLength={1200} minLength={40} onChange={(event) => setStatement(event.target.value)} placeholder="Tell us about your campus knowledge, availability and relevant experience." required rows={5} value={statement} /><small>{statement.length}/1200 characters</small></label></fieldset>

      <fieldset id="documents"><legend>04 · Evidence</legend><div className="upload-zone"><span aria-hidden="true">↑</span><div><strong>Government ID and student ID</strong><p>PDF, JPG or PNG · 15 MB maximum each · private storage only</p></div><input accept="application/pdf,image/jpeg,image/png" aria-label="Choose identity documents" disabled={disabled} multiple onChange={(event) => setDocuments(Array.from(event.target.files ?? []))} type="file" /></div>{documents.length ? <ul className="selected-files">{documents.map((file) => <li key={`${file.name}-${file.size}`}>{file.name}<span>{(file.size / 1024 / 1024).toFixed(2)} MB</span></li>)}</ul> : null}</fieldset>

      <label className="consent-row"><input checked={consent} disabled={disabled} onChange={(event) => setConsent(event.target.checked)} type="checkbox" /><span>I confirm this information is accurate and consent to identity/document checks for agent onboarding. I understand that uncertain results stay pending for human review.</span></label>
      {message ? <p className="form-message" role="status">{message}</p> : null}
      <div className="application-actions"><button className="portal-secondary-button" disabled={disabled || busy} onClick={saveLocalDraft} type="button">Save draft</button><button className="portal-primary-button" disabled={disabled || busy || !ready} type="submit">{busy ? "Submitting securely…" : "Submit application"}</button></div>
    </form>
  );
}

function ApplicationStatusView({ application, email }: { application: Application; email: string }) {
  return (
    <section className="application-status" id="status">
      <span className={`application-status__mark application-status__mark--${application.status}`}>{application.status === "approved" ? "✓" : "→"}</span>
      <p className="section-kicker">Application {application.id.slice(0, 8).toUpperCase()}</p>
      <h2>{statusCopy[application.status]}</h2>
      <p>Submitted by {application.full_name} · {email}</p>
      {application.status_reason ? <div className="status-reason"><strong>Reviewer note</strong><p>{application.status_reason}</p></div> : null}
      <dl><div><dt>Submitted</dt><dd>{application.submitted_at ? new Date(application.submitted_at).toLocaleDateString() : "Draft"}</dd></div><div><dt>Last updated</dt><dd>{new Date(application.updated_at).toLocaleString()}</dd></div></dl>
      <button className="text-button" onClick={() => void portalSupabase?.auth.signOut()} type="button">Sign out</button>
    </section>
  );
}
