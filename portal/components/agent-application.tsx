"use client";
import Image from "next/image";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { PortalShell } from "./portal-shell";
import { TransientNotice } from "./transient-notice";
import { portalApi } from "@/lib/api";
import authArt from "../../mobile/assets/illustrations/auth-study-v2.png";
import homeArt from "../../mobile/assets/illustrations/home-student-v2.png";
import walkArt from "../../mobile/assets/illustrations/onboarding-walk-v2.png";
type Application = {
  id: string;
  agent_type: string;
  display_name: string;
  status: string;
  review_note: string | null;
};
type School = { id: string; name: string };
type Upload = { id: string; url: string };
const initial = {
  universityId: "",
  agentType: "VENDOR",
  displayName: "",
  phoneE164: "",
  statement: "",
  legalName: "",
  address: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  birthDate: "",
  isStudent: true,
  matricNumber: "",
  department: "",
  businessName: "",
  businessAddress: "",
  guardianName: "",
  guardianPhone: "",
  guardianEmail: "",
  guardianRelationship: "",
};
export function AgentApplication() {
  const [data, setData] = useState(initial);
  const [step, setStep] = useState(0);
  const [schools, setSchools] = useState<School[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [docs, setDocs] = useState<Record<string, Upload>>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [terms, setTerms] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [readEnd, setReadEnd] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    void portalApi<{ universities: School[] }>("/v1/student/catalog")
      .then((r) => setSchools(r.universities))
      .catch((e) => setNotice(e.message));
    void load();
  }, []);
  async function load() {
    try {
      setApplications(
        (await portalApi<{ applications: Application[] }>("/v1/applications"))
          .applications,
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not load applications");
    }
  }
  function field(
    key: keyof typeof initial,
    label: string,
    type = "text",
    required = true,
  ) {
    return (
      <label key={key}>
        {label}
        <input
          type={type}
          required={required}
          value={String(data[key])}
          onChange={(e) => setData((s) => ({ ...s, [key]: e.target.value }))}
        />
      </label>
    );
  }
  async function upload(key: string, file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setNotice("");
    try {
      const body = new FormData();
      body.append("kind", "kyc");
      body.append("file", file);
      const uploaded = await portalApi<Upload>("/v1/media", {
        method: "POST",
        body,
      });
      setDocs((s) => ({ ...s, [key]: uploaded }));
      setNotice("Document added");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (step < 2) {
      setStep((s) => s + 1);
      return;
    }
    if (!terms) return;
    setBusy(true);
    setNotice("");
    try {
      await portalApi("/v1/applications", {
        method: "POST",
        body: JSON.stringify({
          ...data,
          guardianEmail: data.guardianEmail || undefined,
          acceptedAgentTerms: true,
          termsVersion: "2026-09-13",
          identityDocumentId: docs.identityDocumentId?.id,
          portraitDocumentId: docs.portraitDocumentId?.id,
          studentDocumentId: docs.studentDocumentId?.id,
        }),
      });
      setStep(3);
      await load();
      setNotice("Application submitted");
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Could not submit application",
      );
    } finally {
      setBusy(false);
    }
  }
  const age = data.birthDate
    ? (Date.now() - new Date(data.birthDate).getTime()) / 31557600000
    : 0;
  const steps = ["About you", "Your documents", "Review & consent"];
  return (
    <PortalShell
      active="agents"
      eyebrow=""
      title="Become an agent"
      description=""
    >
      <TransientNotice message={notice} />
      <div className="application-layout">
        <aside className="application-art">
          <Image
            src={[authArt, homeArt, walkArt][Math.min(step, 2)]!}
            alt=""
            priority
            sizes="(max-width: 760px) 200px, 360px"
          />
          <ol>
            {steps.map((s, i) => (
              <li key={s} aria-current={step === i ? "step" : undefined}>
                <span>{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </aside>
        <section className="application-form">
          {step < 3 ? (
            <form ref={form} className="form-stack" onSubmit={submit}>
              <h2>{steps[step]}</h2>
              {step === 0 ? (
                <>
                  <label>
                    University
                    <select
                      required
                      value={data.universityId}
                      onChange={(e) =>
                        setData((s) => ({ ...s, universityId: e.target.value }))
                      }
                    >
                      <option value="">Choose a university</option>
                      {schools.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Apply as
                    <select
                      value={data.agentType}
                      onChange={(e) =>
                        setData((s) => ({ ...s, agentType: e.target.value }))
                      }
                    >
                      <option value="VENDOR">Vendor</option>
                      <option value="TUTOR">Tutor</option>
                      <option value="RIDER">Rider</option>
                    </select>
                  </label>
                  {field("legalName", "Full legal name")}
                  {field("birthDate", "Date of birth", "date")}
                  {field("phoneE164", "Phone with country code", "tel")}
                  {field("displayName", "Public display name")}
                  {field("address", "Address")}
                  <label>
                    <input
                      type="checkbox"
                      checked={data.isStudent}
                      onChange={(e) =>
                        setData((s) => ({ ...s, isStudent: e.target.checked }))
                      }
                    />{" "}
                    I am a student
                  </label>
                  {data.isStudent ? (
                    <>
                      {field("matricNumber", "Matric number")}
                      {field("department", "Department")}
                    </>
                  ) : null}
                  {field("businessName", "Business name", "text", false)}
                  {field("businessAddress", "Business address", "text", false)}
                  <label>
                    About your work
                    <textarea
                      required
                      minLength={20}
                      maxLength={1000}
                      value={data.statement}
                      onChange={(e) =>
                        setData((s) => ({ ...s, statement: e.target.value }))
                      }
                    />
                  </label>
                </>
              ) : null}
              {step === 1 ? (
                <>
                  {(
                    [
                      [
                        "identityDocumentId",
                        "Government-issued identity document",
                      ],
                      ["portraitDocumentId", "Portrait photograph"],
                      ...(data.isStudent
                        ? [["studentDocumentId", "Student ID"]]
                        : []),
                    ] as string[][]
                  ).map(([key, label]) => (
                    <label className="document-upload" key={key}>
                      {label}
                      <input
                        type="file"
                        accept={
                          key === "portraitDocumentId"
                            ? "image/jpeg,image/png,image/webp"
                            : "image/jpeg,image/png,image/webp,application/pdf"
                        }
                        disabled={busy}
                        onChange={(e) => void upload(key!, e.target.files?.[0])}
                      />
                      {docs[key!] ? <span>Added ✓</span> : null}
                    </label>
                  ))}
                  {field("emergencyContactName", "Emergency contact name")}
                  {field(
                    "emergencyContactPhone",
                    "Emergency contact phone",
                    "tel",
                  )}
                  {age < 18 ? (
                    <>
                      {field("guardianName", "Guardian name")}
                      {field("guardianPhone", "Guardian phone", "tel")}
                      {field("guardianEmail", "Guardian email", "email")}
                      {field("guardianRelationship", "Relationship")}
                    </>
                  ) : null}
                </>
              ) : null}
              {step === 2 ? (
                <>
                  <dl className="review-list">
                    <dt>Account</dt>
                    <dd>{data.legalName}</dd>
                    <dt>Role</dt>
                    <dd>{data.agentType.toLowerCase()}</dd>
                    <dt>Documents</dt>
                    <dd>{Object.keys(docs).length} added</dd>
                  </dl>
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => setTermsOpen(true)}
                  >
                    Read agent terms
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      checked={terms}
                      disabled={!readEnd}
                      onChange={(e) => setTerms(e.target.checked)}
                    />{" "}
                    I accept the agent terms and privacy policy.
                  </label>
                  {age < 18 ? (
                    <p className="muted">
                      Your guardian’s approval will be checked before
                      activation.
                    </p>
                  ) : null}
                </>
              ) : null}
              <div className="form-actions">
                {step > 0 ? (
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => setStep((s) => s - 1)}
                  >
                    Back
                  </button>
                ) : null}
                <button
                  className="button"
                  disabled={
                    busy ||
                    (step === 2 && !terms) ||
                    (step === 1 &&
                      (!docs.identityDocumentId ||
                        !docs.portraitDocumentId ||
                        (data.isStudent && !docs.studentDocumentId)))
                  }
                >
                  {busy
                    ? "Saving…"
                    : step === 2
                      ? "Submit application"
                      : "Continue"}
                </button>
              </div>
            </form>
          ) : (
            <div>
              <Image
                src={walkArt}
                alt=""
                width={200}
                height={180}
                style={{ objectFit: "contain" }}
              />
              <h2>Application received</h2>
              <button
                className="button button--secondary"
                onClick={() => {
                  setData(initial);
                  setDocs({});
                  setTerms(false);
                  setStep(0);
                }}
              >
                Apply for another role
              </button>
            </div>
          )}
          <section className="application-history">
            <h2>Your applications</h2>
            {applications.map((a) => (
              <div className="application-history__row" key={a.id}>
                <div>
                  <strong>{a.display_name}</strong>
                  <p>
                    {a.agent_type.toLowerCase()} ·{" "}
                    {a.status.replaceAll("_", " ").toLowerCase()}
                  </p>
                  {a.review_note ? <p>{a.review_note}</p> : null}
                </div>
                {a.status === "APPROVED" ? (
                  <a
                    className="button button--secondary"
                    href="kampusone://agent"
                  >
                    Open app
                  </a>
                ) : null}
              </div>
            ))}
          </section>
        </section>
      </div>
      {termsOpen ? (
        <div className="consent-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="consent-title"
            className="consent-dialog"
          >
            <h2 id="consent-title">Agent terms</h2>
            <div
              tabIndex={0}
              className="consent-scroll"
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollHeight - el.scrollTop - el.clientHeight < 12)
                  setReadEnd(true);
              }}
            >
              <h3>Accurate information</h3>
              <p>
                Provide your own identity documents and truthful business
                details. Your application, documents and guardian contact
                details are reviewed privately.
              </p>
              <h3>Eligibility</h3>
              <p>
                You must be at least 16. If you are under 18, your guardian must
                independently approve your participation and complete the
                verification requested by KampusOne. Accepting this document
                does not substitute for that approval.
              </p>
              <h3>Trading</h3>
              <p>
                Only approved roles can publish products, lessons or accept
                deliveries. Describe what you offer accurately, fulfil orders
                and respond to disputes. A verification badge does not guarantee
                every transaction.
              </p>
              <h3>Trial</h3>
              <p>
                The ten-month trial is claimed without a payment charge.
                Transaction commissions still apply. A trial does not bypass
                verification or activate automatic paid billing.
              </p>
              <h3>Earnings</h3>
              <p>
                Earnings may be pending until the service is completed and
                applicable review holds have ended. Commission and applicable
                payout fees are shown in your earnings and withdrawal
                statements. Refunds or disputes can affect available earnings.
              </p>
              <h3>Privacy and support</h3>
              <p>
                Identity and bank details are not public profile information.
                You can request access, correction or deletion through support.
                Payment, dispute and safety records may need to be retained.
                Keep your login private and report unauthorised activity
                promptly.
              </p>
            </div>
            <div className="form-actions">
              <button
                className="button button--secondary"
                onClick={() => setTermsOpen(false)}
              >
                Close
              </button>
              <button
                className="button"
                disabled={!readEnd}
                onClick={() => {
                  setTerms(true);
                  setTermsOpen(false);
                }}
              >
                Confirm
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </PortalShell>
  );
}
