"use client";

import { useState } from "react";

type Documents = Record<"studentId" | "portrait" | "identity", string>;

const initialDocuments: Documents = { studentId: "", portrait: "", identity: "" };

export function AgentApplication() {
  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [consented, setConsented] = useState(false);
  const [documents, setDocuments] = useState<Documents>(initialDocuments);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    applicantType: "student",
    programme: "",
    level: "",
    desiredRole: "campus_support",
    statement: "",
  });

  const formReady = form.fullName.trim().length > 2 && /@/.test(form.email) && form.phone.trim().length >= 10 && form.statement.trim().length >= 40;
  const documentsReady = Object.values(documents).every(Boolean);

  function setField(name: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function setDocument(name: keyof Documents, file?: File) {
    if (!file) return;
    setDocuments((current) => ({ ...current, [name]: file.name }));
  }

  if (submitted) {
    return (
      <section className="application-complete" id="status">
        <div className="application-complete__mark">✓</div>
        <p className="section-kicker">Sample submission complete</p>
        <h2>Your application is safely in review.</h2>
        <p>Automated checks can organise evidence, but they do not make an uncertain document fail. An operator reviews anything inconclusive.</p>
        <div className="timeline">
          <div className="timeline__item timeline__item--done"><span /><div><strong>Application received</strong><small>Profile and consent recorded</small></div></div>
          <div className="timeline__item timeline__item--active"><span /><div><strong>Automated consistency checks</strong><small>File integrity, readable text and name comparison</small></div></div>
          <div className="timeline__item"><span /><div><strong>Manual review if needed</strong><small>An authorised operator makes the final decision</small></div></div>
          <div className="timeline__item"><span /><div><strong>Role activation</strong><small>Only approved, campus-scoped abilities are assigned</small></div></div>
        </div>
        <div className="sample-notice">This interaction uses sample state in the review build. Live submission turns on after Supabase migration and portal authentication checks pass.</div>
      </section>
    );
  }

  return (
    <section className="application-workspace" id="apply">
      <div className="application-steps" aria-label="Application progress">
        {["About you", "Evidence", "Review"].map((label, index) => <div className={index <= step ? "active" : ""} key={label}><span>{index < step ? "✓" : index + 1}</span><small>{label}</small></div>)}
      </div>

      {step === 0 ? (
        <div className="application-panel">
          <div className="form-heading"><p className="section-kicker">Step 1 · Profile</p><h2>Tell us how you will help on campus.</h2><p>Use the same name that appears on your evidence. Sensitive national identity numbers are not collected in this form.</p></div>
          <div className="form-grid">
            <label><span>Full legal name</span><input value={form.fullName} onChange={(event) => setField("fullName", event.target.value)} placeholder="As shown on your documents" /></label>
            <label><span>Email address</span><input value={form.email} onChange={(event) => setField("email", event.target.value)} placeholder="you@example.com" type="email" /></label>
            <label><span>Phone number</span><input value={form.phone} onChange={(event) => setField("phone", event.target.value)} placeholder="+234…" type="tel" /></label>
            <label><span>Applicant type</span><select value={form.applicantType} onChange={(event) => setField("applicantType", event.target.value)}><option value="student">Student</option><option value="non_student">Non-student</option></select></label>
            <label><span>Programme or department</span><input value={form.programme} onChange={(event) => setField("programme", event.target.value)} placeholder="e.g. Computer Engineering" /></label>
            <label><span>Level</span><select value={form.level} onChange={(event) => setField("level", event.target.value)}><option value="">Choose level</option><option>100</option><option>200</option><option>300</option><option>400</option><option>500</option><option>Not a student</option></select></label>
            <label><span>Role requested</span><select value={form.desiredRole} onChange={(event) => setField("desiredRole", event.target.value)}><option value="campus_support">Campus support</option><option value="verification">Verification</option><option value="vendor_support">Vendor support</option><option value="events">Events</option></select></label>
            <label className="form-grid__wide"><span>Why are you a good fit?</span><textarea value={form.statement} onChange={(event) => setField("statement", event.target.value)} placeholder="Tell us how you will help, what you understand about the responsibility, and your campus experience." /><small>{form.statement.trim().length}/40 minimum characters</small></label>
          </div>
          <div className="form-actions"><span>Fields marked by context are checked again before activation.</span><button disabled={!formReady} onClick={() => setStep(1)} type="button">Continue to evidence <b>→</b></button></div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="application-panel" id="documents">
          <div className="form-heading"><p className="section-kicker">Step 2 · Evidence</p><h2>Upload clear, complete documents.</h2><p>Files are private and should be retained only for the verification/legal period. PDF, JPG or PNG; 10 MB maximum in the live flow.</p></div>
          <div className="upload-list">
            <UploadRow label="School ID or admission evidence" description="Required for student agents" value={documents.studentId} onFile={(file) => setDocument("studentId", file)} />
            <UploadRow label="Recent portrait" description="Used for a human face-to-document comparison" value={documents.portrait} onFile={(file) => setDocument("portrait", file)} />
            <UploadRow label="Government-issued identity evidence" description="The live provider returns a reference; Campus One avoids plaintext NIN storage" value={documents.identity} onFile={(file) => setDocument("identity", file)} />
          </div>
          <div className="privacy-callout"><strong>What automation checks</strong><p>File integrity, readable text, expiry dates and whether names are reasonably consistent. It cannot guarantee that a document is genuine, and uncertainty is sent to manual review.</p></div>
          <div className="form-actions"><button className="button-secondary" onClick={() => setStep(0)} type="button">Back</button><button disabled={!documentsReady} onClick={() => setStep(2)} type="button">Review application <b>→</b></button></div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="application-panel">
          <div className="form-heading"><p className="section-kicker">Step 3 · Consent and review</p><h2>One last check before submission.</h2><p>Submitting does not grant access. Approval creates only the narrow role needed for assigned work.</p></div>
          <div className="review-card">
            <div><span>Applicant</span><strong>{form.fullName}</strong><small>{form.email} · {form.phone}</small></div>
            <div><span>Role requested</span><strong>{form.desiredRole.replace("_", " ")}</strong><small>{form.programme || "Programme not added"} · {form.level || "Level not added"}</small></div>
            <div><span>Evidence</span><strong>{Object.values(documents).filter(Boolean).length} files ready</strong><small>Encrypted private upload in the live environment</small></div>
          </div>
          <label className="consent-row"><input checked={consented} onChange={(event) => setConsented(event.target.checked)} type="checkbox" /><span><strong>I confirm these details are mine and accurate.</strong><small>I understand that verification evidence is processed for safety, access control and legal compliance under the published privacy notice.</small></span></label>
          <div className="form-actions"><button className="button-secondary" onClick={() => setStep(1)} type="button">Back</button><button disabled={!consented} onClick={() => setSubmitted(true)} type="button">Submit application <b>→</b></button></div>
        </div>
      ) : null}
    </section>
  );
}

function UploadRow({ label, description, value, onFile }: { label: string; description: string; value: string; onFile: (file?: File) => void }) {
  return (
    <label className="upload-row">
      <span className={`upload-icon ${value ? "upload-icon--done" : ""}`}>{value ? "✓" : "↑"}</span>
      <span className="upload-copy"><strong>{label}</strong><small>{value || description}</small></span>
      <span className="upload-action">{value ? "Replace" : "Choose file"}</span>
      <input accept=".pdf,.jpg,.jpeg,.png" onChange={(event) => onFile(event.target.files?.[0])} type="file" />
    </label>
  );
}
