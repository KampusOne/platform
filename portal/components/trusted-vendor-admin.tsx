"use client";

import { useEffect, useState, type FormEvent } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
import { ExclusiveCampaignControl } from "./exclusive-campaign-control";

type Row = {
  id: string;
  display_name: string;
  email: string;
  status: string;
  revision: string;
  legal_name: string;
  phone_e164: string;
  description: string;
  address: string;
  category: string;
  campus: string;
  document_media_id: string | null;
  review_note: string | null;
  invitation_reason: string;
  business_details?: {
    primaryOffer?: string;
    serviceDays?: string[];
    openingTime?: string;
    closingTime?: string;
    fulfilmentMethods?: string[];
    supportChannel?: string;
    responseTime?: string;
    joiningReason?: string;
  };
};

export function TrustedVendorAdmin() {
  const { scope, access, can, scopedPath } = useAdminContext();
  const [rows, setRows] = useState<Row[]>([]);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!can("agents.review")) return;
    let active = true;
    void portalApi<{ applications: Row[] }>(
      scopedPath("/v1/trusted-vendors/admin"),
    )
      .then((response) => {
        if (active) setRows(response.applications);
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Applications could not load.",
          );
      });
    return () => {
      active = false;
    };
  }, [scopedPath, version, can]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await portalApi<{ url: string }>(
        "/v1/trusted-vendors/admin/invites",
        {
          method: "POST",
          body: JSON.stringify({
            universityId: data.get("universityId"),
            email: data.get("email"),
            reason: data.get("reason"),
          }),
        },
      );
      setUrl(response.url);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Invitation could not be prepared.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function openDocument(row: Row) {
    if (!row.document_media_id) return;
    setBusy(true);
    setError("");
    try {
      const response = await portalApi<{ url: string }>(
        "/v1/media/" + row.document_media_id + "/access",
        { method: "POST" },
      );
      window.open(response.url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Document could not open.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function approveReviewed(row: Row) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await portalApi("/v1/trusted-vendors/admin/" + row.id + "/review", {
        method: "POST", body: JSON.stringify({ revision: row.revision, decision: "APPROVED", verifiedBusinessAndContact: true }),
      });
      setVersion((current) => current + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Approval could not finish."); }
    finally { setBusy(false); }
  }

  async function review(event: FormEvent<HTMLFormElement>, row: Row) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await portalApi("/v1/trusted-vendors/admin/" + row.id + "/review", {
        method: "POST",
        body: JSON.stringify({
          revision: row.revision,
          decision: data.get("decision"),
          note: data.get("note"),
          verifiedBusinessAndContact: true,
        }),
      });
      setVersion((current) => current + 1);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Review could not finish.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!can("agents.review")) return null;

  return (
    <section className="panel">
      <h2>Invited vendors</h2>
      <p className="field-help">
        Review Exclusive business answers and contact details, then approve once.
      </p>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {rows.map((row) => (
        <article className="panel" key={row.id}>
          <h3>
            {row.display_name} · {row.status}
          </h3>
          <p>
            {row.legal_name} · {row.email} · {row.phone_e164}
          </p>
          <p>
            {row.category} · {row.campus} · {row.address}
          </p>
          <p>{row.description}</p>
          {row.business_details && (
            <dl className="application-review">
              <dt>Available</dt>
              <dd>
                {row.business_details.serviceDays?.join(", ")} ·{" "}
                {row.business_details.openingTime} to{" "}
                {row.business_details.closingTime}
              </dd>
              <dt>Fulfilment</dt>
              <dd>{row.business_details.fulfilmentMethods?.join(", ")}</dd>
              <dt>Support</dt>
              <dd>
                {row.business_details.supportChannel} ·{" "}
                {row.business_details.responseTime}
              </dd>
              <dt>Joining reason</dt>
              <dd>{row.business_details.joiningReason}</dd>
            </dl>
          )}
          <p className="field-help">
            Invitation reason: {row.invitation_reason}
          </p>
          <div className="form-actions">
            <span className="field-help">
              Exclusive fast track · business and contact review required.
            </span>
            {row.document_media_id ? (
              <button
                type="button"
                className="button button--secondary"
                disabled={busy}
                onClick={() => void openDocument(row)}
              >
                Open verification document
              </button>
            ) : (
              <span className="field-help">Question based application</span>
            )}
          </div>

          {row.review_note ? <p>Reviewer note: {row.review_note}</p> : null}

          {["SUBMITTED", "IN_REVIEW"].includes(row.status) ? (
            <div className="form-stack">
              <button type="button" className="button button--primary" disabled={busy} onClick={() => void approveReviewed(row)}>{busy ? "Approving…" : "Approve reviewed vendor"}</button>
              <details><summary>Reject or record a specific review note</summary>
            <form
              className="form-stack"
              onSubmit={(event) => void review(event, row)}
            >
              <label>
                Decision
                <select name="decision">
                  <option value="APPROVED">Approve invited vendor</option>
                  <option value="REJECTED">Reject</option>
                </select>
              </label>
              <label>
                Verification note
                <textarea
                  name="note"
                  required
                  minLength={20}
                  maxLength={2000}
                  placeholder="Record how the business and authorised contact were verified."
                />
              </label>
              <label className="consent-row">
                <input type="checkbox" required />I verified the business and
                authorised adult contact using the submitted answers and
                appropriate reviewer checks.
              </label>
              <button className="button button--primary" disabled={busy}>
                Save review
              </button>
            </form>
              </details>
            </div>
          ) : null}
        </article>
      ))}
      <details>
        <summary>Exclusive invitations and campaign settings</summary>
        <ExclusiveCampaignControl />
        <p className="field-help">
          Create a seven day Exclusive invitation for one email address. Applicants
          answer business questions without uploading documents.
        </p>
        <form className="form-grid manage-form" onSubmit={invite}>
          <label>
            University
            <select name="universityId" defaultValue={scope} required>
              <option value="">Select university</option>
              {access?.universities?.map((university) => (
                <option key={university.id} value={university.id}>
                  {university.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Invited email
            <input
              type="email"
              name="email"
              required
              placeholder="owner@example.com"
            />
          </label>
          <label>
            Why this business is trusted
            <textarea name="reason" required minLength={10} maxLength={2000} />
          </label>
          <button className="button button--primary" disabled={busy}>
            Create invitation link
          </button>
        </form>

        {url ? (
          <label>
            Share this link with the invited business
            <input
              readOnly
              value={url}
              onFocus={(event) => event.target.select()}
            />
          </label>
        ) : null}

      </details>
    </section>
  );
}
