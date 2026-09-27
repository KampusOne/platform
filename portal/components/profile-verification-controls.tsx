"use client";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { portalApi } from "@/lib/api";

type VerificationStatus = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";
type Decision = Exclude<VerificationStatus, "PENDING">;
const statuses: VerificationStatus[] = ["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"];

export function ProfileVerificationControls({
  userId,
  currentStatus,
  onSaved,
}: {
  userId: string;
  currentStatus?: string | null;
  onSaved?: () => void;
}) {
  const current = statuses.includes(currentStatus as VerificationStatus) ? currentStatus as VerificationStatus : null;
  const choices = useMemo(
    () => ([
      { value: "VERIFIED" as const, label: "Verify profile" },
      { value: "REJECTED" as const, label: "Reject verification" },
      { value: "UNVERIFIED" as const, label: "Mark unverified" },
    ]).filter((choice) => choice.value !== current),
    [current],
  );
  const [decision, setDecision] = useState<Decision>(choices[0]?.value ?? "VERIFIED");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const lock = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || decision === current || lock.current || !confirmed || reason.trim().length < 10) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await portalApi<{ verification: { status: VerificationStatus } }>(
        `/v1/admin/users/${encodeURIComponent(userId)}/verification`,
        {
          method: "POST",
          body: JSON.stringify({ status: decision, expected: current, reason: reason.trim() }),
        },
      );
      setMessage(`Account verification is now ${result.verification.status}.`);
      setReason("");
      setConfirmed(false);
      onSaved?.();
    } catch (caught) {
      setConfirmed(false);
      setError(caught instanceof Error ? caught.message : "The verification decision could not be recorded.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <section className="form-stack manage-form" aria-labelledby="profile-verification-heading">
    <h2 id="profile-verification-heading">Account verification</h2>
    <p className="muted">This changes the user’s actual verification status shown in the Account verification workspace. The public brown badge is controlled separately.</p>
    <p><strong>Current status:</strong> {current ?? "UNKNOWN"}</p>
    {message ? <p role="status">{message}</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {!current ? <p className="form-error" role="alert">This account returned an unknown verification status. Reload before making a decision.</p> : <form className="form-stack" onSubmit={(event) => void submit(event)}>
      <label>Decision<select value={decision} disabled={busy} onChange={(event) => setDecision(event.target.value as Decision)}>{choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select></label>
      <label>Reason for this decision<textarea required minLength={10} maxLength={1000} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="Record what you reviewed and why this status is appropriate." /></label>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} style={{ width: "auto", marginTop: 4 }} /><span>Confirm this verification decision for the selected account.</span></label>
      <button className="button button--primary" type="submit" disabled={busy || !confirmed || reason.trim().length < 10 || decision === current}>{busy ? "Recording…" : "Record verification decision"}</button>
    </form>}
  </section>;
}
