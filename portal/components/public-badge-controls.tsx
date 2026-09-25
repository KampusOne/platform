"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { portalApi } from "@/lib/api";

type Badge = { id: string; display_name: string; verified: boolean; available: boolean };
export function PublicBadgeControls({ userId, onSaved }: { userId: string; onSaved?: () => void }) {
  const [badge, setBadge] = useState<Badge | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const lock = useRef(false);
  const generation = useRef(0);
  const alive = useRef(true);
  const path = `/v1/admin/public-badges/${encodeURIComponent(userId)}`;
  // The parent keys this component by user ID. Fetch results, not synchronous
  // state changes, synchronize the initial render with the external API.
  useEffect(() => {
    alive.current = true;
    const version = ++generation.current;
    const controller = new AbortController();
    void portalApi<{ badge: Badge }>(path, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted && version === generation.current) setBadge(result.badge);
    }).catch((caught) => {
      if (!controller.signal.aborted && version === generation.current) setError(caught instanceof Error ? caught.message : "Badge status could not load.");
    });
    return () => { alive.current = false; controller.abort(); };
  }, [path]);
  async function reload() {
    const version = ++generation.current;
    setError(""); setBadge(null); setConfirmed(false);
    try { const result = await portalApi<{ badge: Badge }>(path); if (alive.current && generation.current === version) setBadge(result.badge); }
    catch (caught) { if (alive.current && generation.current === version) setError(caught instanceof Error ? caught.message : "Badge status could not load."); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!badge?.available || lock.current || !confirmed || reason.trim().length < 6) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    const desired = !badge.verified, version = generation.current;
    try {
      const result = await portalApi<{ badge: Badge }>(path, { method: "PUT", body: JSON.stringify({ verified: desired, expected: badge.verified, reason: reason.trim() }) });
      if (alive.current && version === generation.current) { setBadge(result.badge); setReason(""); setConfirmed(false); setMessage(desired ? "Verification badge assigned." : "Verification badge removed."); onSaved?.(); }
    } catch (caught) {
      // A timed-out success must not turn a retry into an accidental reversal.
      try {
        const latest = await portalApi<{ badge: Badge }>(path);
        if (alive.current && version === generation.current) {
          setBadge(latest.badge); setConfirmed(false);
          if (latest.badge.verified === desired) { setMessage(desired ? "The verification badge is now assigned." : "The verification badge is now removed."); setReason(""); }
          else setError(caught instanceof Error ? caught.message : "The change was not confirmed. Review the current status before retrying.");
        }
      } catch { if (alive.current && version === generation.current) { setConfirmed(false); setError("The change could not be confirmed. Reload the badge status before trying again."); setBadge(null); } }
    } finally { lock.current = false; if (alive.current && version === generation.current) setBusy(false); }
  }
  return <section className="form-stack manage-form" aria-labelledby="public-badge-heading">
    <h2 id="public-badge-heading">Verification badge</h2>
    <p className="muted">Assign or remove the KampusOne badge shown beside this user’s name on their profile, posts and replies. This does not change identity verification, student eligibility, account restrictions or administrator permissions.</p>
    {message ? <p role="status">{message}</p> : null}
    {error ? <div role="alert"><p>{error}</p><button type="button" className="button button--secondary" disabled={busy} onClick={() => void reload()}>Reload badge status</button></div> : null}
    {!badge && !error ? <p role="status" className="muted">Loading badge status…</p> : null}
    {badge ? <>
      <p><strong>{badge.verified ? "Badge assigned" : "No badge assigned"}</strong> · {badge.display_name}</p>
      {!badge.available ? <p role="status" className="muted">The database update for badge controls has not been applied yet.</p> : <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <label>Reason for this decision<textarea required minLength={6} maxLength={1000} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="Record why this badge is being assigned or removed." /></label>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} style={{ width: "auto", marginTop: 4 }} /><span>Confirm {badge.verified ? "removing" : "assigning"} the badge for {badge.display_name}.</span></label>
        <button type="submit" className={badge.verified ? "button button--secondary" : "button"} disabled={busy || !confirmed || reason.trim().length < 6}>{busy ? "Saving…" : badge.verified ? "Remove verification badge" : "Assign verification badge"}</button>
      </form>}
    </> : null}
  </section>;
}
