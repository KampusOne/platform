"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { portalApi } from "@/lib/api";
import { ApplicationChecks } from "./application-checks";
import { TransientNotice } from "./transient-notice";

type Details = {
  birth_date: string;
  is_student: boolean;
  matric_number: string | null;
  department: string | null;
  business_name: string | null;
  business_address: string | null;
  identity_document_id: string;
  portrait_document_id: string;
  student_document_id: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  guardian_email: string | null;
  guardian_relationship: string | null;
  guardian_consent_at: string | null;
  identity_recorded: boolean;
  identity_submission?: {
    last4: string;
    submittedAt: string;
    verified: boolean;
  } | null;
  role_details?: {
    whatsappPhone?: string;
    campus?: string;
    serviceLocation?: string;
    campusPermission?: string;
    tutorSubjects?: string[];
    tutorLevels?: string[];
    experience?: string;
    riderDocumentIds?: string[];
    businessDocumentIds?: string[];
    businessCategories?: string[];
    publishContacts?: boolean;
    portraitSource?: string;
  };
};
export function ApplicationDocuments({ id }: { id: string }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [fileLink, setFileLink] = useState<string | null>(null);
  const [revealReason, setRevealReason] = useState("");
  const [identityValue, setIdentityValue] = useState<{
    applicationId: string;
    nin: string;
  } | null>(null);
  const currentId = useRef(id);
  useEffect(() => {
    currentId.current = id;
    return () => {
      currentId.current = "";
    };
  }, [id]);
  useEffect(() => {
    const hide = () => setIdentityValue(null);
    const hidden = () => {
      if (document.hidden) hide();
    };
    document.addEventListener("visibilitychange", hidden);
    const timer = identityValue ? window.setTimeout(hide, 120000) : undefined;
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      if (timer) window.clearTimeout(timer);
    };
  }, [identityValue]);
  async function revealIdentity() {
    if (busy || revealReason.trim().length < 10) return;
    const target = id;
    setBusy(true);
    setError("");
    try {
      const result = await portalApi<{ nin: string }>(
        `/v1/manage/applications/${target}/nin`,
        {
          method: "POST",
          body: JSON.stringify({ reason: revealReason.trim() }),
        },
      );
      if (currentId.current === target && !document.hidden)
        setIdentityValue({ applicationId: target, nin: result.nin });
    } catch (e) {
      if (currentId.current === target)
        setError(
          e instanceof Error
            ? e.message
            : "The private identity could not be opened.",
        );
    } finally {
      if (currentId.current === target) setBusy(false);
    }
  }
  const load = useCallback(async () => {
    const r = await portalApi<{ details: Details | null }>(
      `/v1/manage/applications/${id}/documents`,
    );
    setDetails(r.details);
    setLoaded(true);
  }, [id]);
  useEffect(() => {
    let active = true;
    void portalApi<{ details: Details | null }>(
      `/v1/manage/applications/${id}/documents`,
    )
      .then((r) => {
        if (active) {
          setDetails(r.details);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function openFile(mediaId: string) {
    setBusy(true);
    setError("");
    setFileLink(null);
    try {
      const r = await portalApi<{ url: string }>(
        `/v1/media/${mediaId}/access`,
        { method: "POST" },
      );
      setFileLink(r.url);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not open this document.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function record(
    e: FormEvent<HTMLFormElement>,
    kind: "identity" | "guardian",
  ) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    setBusy(true);
    setError("");
    try {
      await portalApi(`/v1/manage/applications/${id}/${kind}`, {
        method: "POST",
        body: JSON.stringify({
          evidence: data.get("evidence"),
          ...(kind === "identity" ? { nin: data.get("nin") } : {}),
        }),
      });
      form.reset();
      setIdentityValue(null);
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not record this review.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!loaded)
    return <div className="panel-skeleton" aria-label="Loading documents" />;
  if (!details)
    return (
      <div className="sub-form">
        <h3>Documents unavailable</h3>
        <button
          className="button button--secondary"
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          Retry
        </button>
        <TransientNotice message={error} />
      </div>
    );
  return (
    <section className="sub-form form-stack">
      <ApplicationChecks applicationId={id} />
      <h3>Application evidence</h3>
      <dl className="detail-list">
        <div>
          <dt>Date of birth</dt>
          <dd>{details.birth_date.slice(0, 10)}</dd>
        </div>
        <div>
          <dt>Applicant</dt>
          <dd>{details.is_student ? "Student" : "Non-student"}</dd>
        </div>
        {details.is_student ? (
          <>
            <div>
              <dt>Matric number</dt>
              <dd>{details.matric_number}</dd>
            </div>
            <div>
              <dt>Department</dt>
              <dd>{details.department}</dd>
            </div>
          </>
        ) : null}
        {details.business_name ? (
          <div>
            <dt>Business</dt>
            <dd>{details.business_name}</dd>
          </div>
        ) : null}
        {details.business_address ? (
          <div>
            <dt>Business address</dt>
            <dd>{details.business_address}</dd>
          </div>
        ) : null}
      </dl>
      {details.role_details && (
        <dl className="detail-list">
          {(
            [
              ["WhatsApp", details.role_details.whatsappPhone],
              ["Campus", details.role_details.campus],
              ["Service area", details.role_details.serviceLocation],
              ["Campus permission", details.role_details.campusPermission],
              [
                "Business categories",
                details.role_details.businessCategories?.join(", "),
              ],
              [
                "Public contact consent",
                details.role_details.publishContacts
                  ? "Telephone and WhatsApp"
                  : "Contacts remain private",
              ],
              [
                "Face photograph",
                details.role_details.portraitSource === "CAMERA"
                  ? "Captured with camera"
                  : "Uploaded photograph",
              ],
              [
                "Teaching subjects",
                details.role_details.tutorSubjects?.join(", "),
              ],
              ["Teaching levels", details.role_details.tutorLevels?.join(", ")],
              ["Background", details.role_details.experience],
            ] as const
          )
            .filter(([, value]) => Boolean(value))
            .map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
        </dl>
      )}
      <div className="button-row">
        {(
          [
            ["Identity document", details.identity_document_id],
            ["Portrait", details.portrait_document_id],
            ["Student ID", details.student_document_id],
          ] as const
        ).map(([name, mediaId]) =>
          mediaId ? (
            <button
              key={mediaId}
              className="button button--secondary"
              disabled={busy}
              onClick={() => void openFile(mediaId)}
            >
              {name}
            </button>
          ) : null,
        )}
        {details.role_details?.riderDocumentIds?.map((mediaId, index) => (
          <button
            className="button button--secondary"
            key={mediaId}
            disabled={busy}
            onClick={() => void openFile(mediaId)}
          >
            Rider evidence {index + 1}
          </button>
        ))}
        {details.role_details?.businessDocumentIds?.map((mediaId, index) => (
          <button
            className="button button--secondary"
            key={"business-" + mediaId}
            disabled={busy}
            onClick={() => void openFile(mediaId)}
          >
            Business evidence {index + 1}
          </button>
        ))}
      </div>
      {fileLink ? (
        <a
          className="button button--primary"
          href={fileLink}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          Open document · link expires in 90 seconds
        </a>
      ) : null}
      {details.identity_submission && (
        <section className="private-evidence form-stack">
          <h3>Submitted NIN · ending {details.identity_submission.last4}</h3>
          <p className="field-help">
            This is the applicant’s submission. Confirm it with your
            verification provider and compare the portrait with the evidence
            before recording a review.
          </p>
          {identityValue?.applicationId === id ? (
            <>
              <p className="identity-reveal" aria-label="Submitted NIN">
                {identityValue.nin}
              </p>
              <p className="field-help">
                Hides after two minutes or when you leave this tab.
              </p>
              <button
                type="button"
                className="text-button"
                onClick={() => setIdentityValue(null)}
              >
                Hide NIN
              </button>
            </>
          ) : (
            <>
              <label>
                Reason for viewing
                <input
                  value={revealReason}
                  onChange={(e) => setRevealReason(e.target.value)}
                  minLength={10}
                  maxLength={200}
                  autoComplete="off"
                  placeholder="Identity verification for this application"
                />
              </label>
              <button
                type="button"
                className="button button--secondary"
                disabled={busy || revealReason.trim().length < 10}
                onClick={() => void revealIdentity()}
              >
                View submitted NIN · audited
              </button>
            </>
          )}
        </section>
      )}
      {details.identity_recorded ? (
        <p className="status-label">Identity review recorded</p>
      ) : (
        <form
          className="form-stack"
          onSubmit={(e) => void record(e, "identity")}
        >
          <h3>Identity review</h3>
          <label>
            Verified NIN
            <input
              name="nin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{11}"
              minLength={11}
              maxLength={11}
              required
            />
          </label>
          <label>
            Evidence checked
            <textarea
              name="evidence"
              minLength={20}
              maxLength={1000}
              required
              placeholder="Record the verification method and reference, not the NIN."
            />
          </label>
          <button className="button button--secondary" disabled={busy}>
            Record identity review
          </button>
        </form>
      )}
      {details.guardian_name ? (
        <>
          <h3>Guardian consent</h3>
          <dl className="detail-list">
            <div>
              <dt>Name</dt>
              <dd>{details.guardian_name}</dd>
            </div>
            <div>
              <dt>Relationship</dt>
              <dd>{details.guardian_relationship}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{details.guardian_phone}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{details.guardian_email}</dd>
            </div>
          </dl>
          {details.guardian_consent_at ? (
            <p className="status-label">Guardian consent reviewed</p>
          ) : (
            <form
              className="form-stack"
              onSubmit={(e) => void record(e, "guardian")}
            >
              <label>
                Independent consent evidence
                <textarea
                  name="evidence"
                  minLength={20}
                  maxLength={2000}
                  required
                  placeholder="Record how the guardian's identity and consent were confirmed."
                />
              </label>
              <button className="button button--secondary" disabled={busy}>
                Record guardian consent
              </button>
            </form>
          )}
        </>
      ) : null}
      <TransientNotice message={error} />
    </section>
  );
}
