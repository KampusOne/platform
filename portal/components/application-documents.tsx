"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { portalApi } from "@/lib/api";
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
};
export function ApplicationDocuments({ id }: { id: string }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [fileLink, setFileLink] = useState<string | null>(null);
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
