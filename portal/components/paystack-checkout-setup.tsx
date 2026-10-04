"use client";

import { useEffect, useState } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";

type Setup = { ready: boolean; reviewed: boolean; providerMode: "live" | "test" };

/** One account confirmation, next to the price owner is editing. */
export function PaystackCheckoutSetup({ onSaved }: { onSaved?: (() => void) | undefined }) {
  const { access, can } = useAdminContext();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const mayConfirm = can("finance.review") && Boolean(access?.grants?.some((grant) => grant.university_id === null && grant.permissions.includes("finance.review")));

  useEffect(() => {
    if (!can("finance.view")) return;
    const controller = new AbortController();
    void portalApi<Setup>("/v1/admin/finance/payment-pricing/account-review", { signal: controller.signal }).then((result) => {
      if (!result || typeof result.ready !== "boolean" || typeof result.reviewed !== "boolean" || !["live", "test"].includes(result.providerMode))
        throw new Error("Checkout setup could not load.");
      if (!controller.signal.aborted) { setSetup(result); setError(""); }
    }).catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Checkout setup could not load."); });
    return () => controller.abort();
  }, [can, retry]);

  async function confirm() {
    if (!setup?.ready || !confirmed || busy || !mayConfirm) return;
    setBusy(true); setError("");
    try {
      const result = await portalApi<{ passFeesDisabled: boolean }>("/v1/admin/finance/payment-pricing/account-review", {
        method: "POST", body: JSON.stringify({ providerMode: setup.providerMode, passFeesDisabled: true }),
      });
      if (result.passFeesDisabled !== true) throw new Error("Checkout setup was not confirmed. Try again.");
      setSetup((current) => current ? { ...current, reviewed: true } : current);
      setConfirmed(false);
      onSaved?.();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Checkout setup could not be saved."); }
    finally { setBusy(false); }
  }

  return <section className="panel" aria-label="Paystack checkout setup">
    <h2>Payment setup</h2>
    {setup?.reviewed ? <p className="notice" role="status">Paystack checkout is ready. Processing is included in your Kira price.</p> : <>
      <p>Keep the price shown in KampusOne equal to the Paystack total. In <a href="https://dashboard.paystack.com/#/settings/preferences" target="_blank" rel="noopener noreferrer">Paystack Settings → Preferences</a>, turn off <strong>Pass fees to customers</strong>, then confirm here once.</p>
      {mayConfirm ? <>
        <label className="checkbox"><input type="checkbox" checked={confirmed} disabled={busy || !setup?.ready} onChange={(event) => setConfirmed(event.target.checked)} />I checked the {setup?.providerMode ?? "current"} account and turned off Pass fees to customers.</label>
        <button type="button" className="button button--primary" disabled={!confirmed || busy || !setup?.ready} onClick={() => void confirm()}>{busy ? "Saving…" : "Confirm payment setup"}</button>
      </> : setup ? <p>Ask your platform finance administrator to confirm this account setting.</p> : null}
    </>}
    {error ? <p className="notice notice--error" role="alert">{error} <button type="button" className="text-link" onClick={() => setRetry((value) => value + 1)}>Try again</button></p> : null}
    {!setup && !error ? <p aria-busy="true">Loading checkout setup…</p> : null}
  </section>;
}
