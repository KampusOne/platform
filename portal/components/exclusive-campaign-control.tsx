"use client";

import { useEffect, useState } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
import styles from "./admin-reporting.module.css";

type Campaign = { enabled: boolean; canManage: boolean };

function readCampaign(value: unknown): Campaign {
  if (
    !value ||
    typeof value !== "object" ||
    !("enabled" in value) ||
    typeof value.enabled !== "boolean" ||
    !("canManage" in value) ||
    typeof value.canManage !== "boolean"
  ) {
    throw new Error("Campaign controls could not be checked. Please try again.");
  }
  return { enabled: value.enabled, canManage: value.canManage };
}

export function ExclusiveCampaignControl() {
  const { can } = useAdminContext();
  const allowed = can("agents.review");
  const [campaign, setCampaign] = useState<Campaign>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [copied, setCopied] = useState(false);
  const sharedLink = "https://agents.kampusone.app/exclusive";

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    void portalApi<unknown>("/v1/trusted-vendors/admin/campaign", {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    })
      .then(readCampaign)
      .then((data) => {
        if (!controller.signal.aborted) setCampaign(data);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Campaign controls could not load.",
          );
        }
      });
    return () => controller.abort();
  }, [allowed, version]);

  function retry() {
    setError("");
    setCampaign(undefined);
    setVersion((value) => value + 1);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(sharedLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  async function toggle() {
    if (!campaign?.canManage || busy || error) return;
    setBusy(true);
    try {
      const result = readCampaign(
        await portalApi<unknown>("/v1/trusted-vendors/admin/campaign", {
          method: "PATCH",
          body: JSON.stringify({ enabled: !campaign.enabled }),
        }),
      );
      setCampaign(result);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The campaign could not be changed. Check its status before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`panel ${styles.section}`} aria-labelledby="exclusive-campaign-title">
      <div className={styles.header}>
        <div>
          <p className="section-kicker">Exclusive campaign</p>
          <h2 id="exclusive-campaign-title">Control the shared Exclusive link</h2>
          <p>
            Share one reusable link with every Exclusive vendor. Signed-in applicants
            answer business questions while the normal agent application retains
            document verification.
          </p>
        </div>
        {allowed && campaign?.canManage && (
          <button
            className={`button ${campaign.enabled ? "button--secondary" : "button--primary"}`}
            disabled={busy || Boolean(error)}
            onClick={() => void toggle()}
          >
            {busy
              ? "Saving…"
              : campaign.enabled
                ? "Disable Exclusive page"
                : "Enable Exclusive page"}
          </button>
        )}
      </div>
      {!allowed ? (
        <div className="state-panel" role="status">
          <p>You need agent review access to view this campaign.</p>
        </div>
      ) : error ? (
        <div role="alert" className="state-panel state-panel--error">
          <p>{error}</p>
          <button className="button button--secondary" onClick={retry}>Retry</button>
        </div>
      ) : !campaign ? (
        <div role="status" aria-busy="true">
          <div className="table-skeleton" aria-hidden="true"><div /></div>
          <p>Checking campaign status and your access…</p>
        </div>
      ) : (
        <>
          <p role="status" className={styles.coverage}>
            {campaign.enabled
              ? "The Exclusive campaign is open. The shared link is live for signed-in applicants."
              : "The Exclusive campaign is closed. The shared link returns Page not found and new applications are blocked."}
          </p>
          <div className="form-stack">
            <label>
              Reusable Exclusive link
              <input
                readOnly
                value={sharedLink}
                onFocus={(event) => event.target.select()}
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => void copyLink()}
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </div>
          {!campaign.canManage && (
            <div className="state-panel">
              <p>
                You can view the campaign status. A reviewer with agent review
                access for all universities can open or close the campaign.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
