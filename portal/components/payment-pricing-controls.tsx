"use client";

import { useEffect, useState, type FormEvent } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";

export type ProviderFeeProfile = {
  id: string;
  universityId: string;
  version: string;
  transactionClass: string;
  channel: string;
  cardNetwork: string;
  collection: {
    basisPoints: number;
    flatKobo: number;
    flatWaivedBelowKobo: number;
    capKobo: number | null;
  };
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "APPROVED" | "DISABLED";
  varianceToleranceKobo: number;
  sourceUrl: string;
  eligibilityEvidence: string | null;
  approvedAt: string;
};
type ProfileResponse = {
  ready: boolean;
  profiles: ProviderFeeProfile[];
  publishedProfiles: Partial<ProviderFeeProfile>[];
};
type AccountReview = {
  ready: boolean;
  reviewed: boolean;
  providerMode: string;
  review: {
    id: string;
    providerMode: string;
    passFeesDisabled: boolean;
    reviewedAt: string;
    reviewedBy: string;
    reason: string;
    evidence: string;
    expiresAt: string | null;
  } | null;
};
type PricingAlert = {
  id: string;
  universityId: string;
  providerReference: string;
  kind: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};
const base = "/v1/admin/finance/payment-pricing";
const classes = [
  ["LOCAL_COLLECTION", "Local online collection"],
  ["INTERNATIONAL_CARD", "International Visa, Mastercard or Verve"],
  ["INTERNATIONAL_AMEX", "International American Express"],
  ["DEDICATED_VIRTUAL_ACCOUNT", "Dedicated virtual account"],
  ["VIRTUAL_TERMINAL_TRANSFER", "Virtual terminal · transfer"],
  ["VIRTUAL_TERMINAL_USSD", "Virtual terminal · USSD"],
  ["VIRTUAL_TERMINAL_LOCAL_CARD", "Virtual terminal · local card"],
  [
    "VIRTUAL_TERMINAL_INTERNATIONAL_CARD",
    "Virtual terminal · international card",
  ],
  ["PHYSICAL_TERMINAL_CARD", "Physical terminal · card"],
  ["PHYSICAL_TERMINAL_TRANSFER", "Physical terminal · transfer"],
  ["PHYSICAL_TERMINAL_USSD", "Physical terminal · USSD"],
  ["EDUCATION_LOCAL_CARD", "Negotiated education · local card"],
  ["EDUCATION_OTHER", "Negotiated education · other methods"],
] as const;
const labelFor = (value: string) =>
  classes.find(([id]) => id === value)?.[1] ??
  value.replaceAll("_", " ").toLowerCase();
const restricted = (value: string) =>
  value === "DEDICATED_VIRTUAL_ACCOUNT" ||
  value.includes("TERMINAL") ||
  value.startsWith("EDUCATION_");
export const formatPricingMoney = (value: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  }).format(value / 100);
const time = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString()
    : "Date unavailable";
export function pricingMinor(value: string, label = "Amount") {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new Error(
      `${label}: enter a non-negative amount with up to two decimal places.`,
    );
  const [whole, fraction = ""] = value.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount > 2_000_000_000)
    throw new Error(`${label} is outside the supported range.`);
  return amount;
}
export function validProviderProfiles(
  value: unknown,
): value is ProfileResponse {
  if (!value || typeof value !== "object") return false;
  const result = value as ProfileResponse;
  return (
    typeof result.ready === "boolean" &&
    Array.isArray(result.publishedProfiles) &&
    Array.isArray(result.profiles) &&
    result.publishedProfiles.every(
      (profile) =>
        profile &&
        typeof profile === "object" &&
        typeof profile.transactionClass === "string" &&
        profile.collection &&
        typeof profile.collection === "object" &&
        [
          profile.collection.basisPoints,
          profile.collection.flatKobo,
          profile.collection.flatWaivedBelowKobo,
        ].every((amount) => Number.isSafeInteger(amount) && amount >= 0) &&
        (profile.collection.capKobo === null ||
          Number.isSafeInteger(profile.collection.capKobo)),
    ) &&
    result.profiles.every(
      (profile) =>
        profile &&
        typeof profile === "object" &&
        typeof profile.id === "string" &&
        typeof profile.universityId === "string" &&
        typeof profile.version === "string" &&
        typeof profile.transactionClass === "string" &&
        typeof profile.channel === "string" &&
        typeof profile.cardNetwork === "string" &&
        ["APPROVED", "DISABLED"].includes(profile.status) &&
        typeof profile.effectiveFrom === "string" &&
        Number.isFinite(Date.parse(profile.effectiveFrom)) &&
        (profile.effectiveTo === null ||
          (typeof profile.effectiveTo === "string" &&
            Number.isFinite(Date.parse(profile.effectiveTo)))) &&
        typeof profile.collection === "object" &&
        profile.collection !== null &&
        [
          profile.collection.basisPoints,
          profile.collection.flatKobo,
          profile.collection.flatWaivedBelowKobo,
          profile.varianceToleranceKobo,
        ].every((amount) => Number.isSafeInteger(amount) && amount >= 0) &&
        (profile.collection.capKobo === null ||
          (Number.isSafeInteger(profile.collection.capKobo) &&
            profile.collection.capKobo >= 0)),
    )
  );
}
function validAccountReview(value: AccountReview) {
  return (
    value &&
    typeof value.ready === "boolean" &&
    typeof value.reviewed === "boolean" &&
    ["live", "test"].includes(value.providerMode) &&
    (value.review === null ||
      (value.review &&
        typeof value.review === "object" &&
        typeof value.review.passFeesDisabled === "boolean" &&
        [
          value.review.id,
          value.review.providerMode,
          value.review.reviewedAt,
          value.review.reviewedBy,
          value.review.reason,
          value.review.evidence,
        ].every((field) => typeof field === "string")))
  );
}

export function PaymentPricingControls({
  onProfilesChanged,
}: {
  onProfilesChanged?: () => void;
}) {
  const { scope } = useAdminContext();
  return (
    <ScopedPaymentPricing key={scope} onProfilesChanged={onProfilesChanged} />
  );
}

function ScopedPaymentPricing({
  onProfilesChanged,
}: {
  onProfilesChanged?: () => void;
}) {
  const { access, scope, can, scopedPath } = useAdminContext();
  const allowed = can("finance.view"),
    mayApprove = can("finance.review"),
    mayReviewAccount = mayApprove && Boolean(access?.allUniversities);
  const [profiles, setProfiles] = useState<ProfileResponse | null>(null);
  const [account, setAccount] = useState<AccountReview | null>(null);
  const [alerts, setAlerts] = useState<PricingAlert[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [accountError, setAccountError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<"profile" | "account" | null>(null);
  const [form, setForm] = useState({
    universityId: scope,
    version: "",
    transactionClass: "LOCAL_COLLECTION",
    channel: "ANY",
    cardNetwork: "ANY",
    rate: "",
    flat: "",
    threshold: "",
    cap: "",
    effectiveFrom: "",
    effectiveTo: "",
    status: "APPROVED",
    tolerance: "",
    sourceUrl: "https://paystack.com/pricing",
    note: "",
    evidence: "",
    confirmedEligibility: false,
  });
  const [review, setReview] = useState({
    providerMode: "live",
    passFeesDisabled: false,
    reason: "",
    evidence: "",
    expiresAt: "",
  });
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    void Promise.all([
      portalApi<ProfileResponse>(scopedPath(`${base}/profiles`), {
        signal: controller.signal,
      }),
      portalApi<AccountReview>(scopedPath(`${base}/account-review`), {
        signal: controller.signal,
      }),
      portalApi<{ ready: boolean; alerts: PricingAlert[] }>(
        scopedPath(`${base}/alerts`),
        { signal: controller.signal },
      ),
    ])
      .then(([p, a, v]) => {
        if (
          !validProviderProfiles(p) ||
          !validAccountReview(a) ||
          !v ||
          !Array.isArray(v.alerts) ||
          v.alerts.some(
            (alert) =>
              !alert ||
              typeof alert !== "object" ||
              typeof alert.id !== "string" ||
              typeof alert.kind !== "string" ||
              typeof alert.providerReference !== "string" ||
              typeof alert.createdAt !== "string" ||
              !alert.metadata ||
              typeof alert.metadata !== "object" ||
              Array.isArray(alert.metadata),
          )
        )
          throw new Error(
            "Payment pricing controls could not be read. Try again.",
          );
        if (!controller.signal.aborted) {
          setProfiles(p);
          setAccount(a);
          setAlerts(v.alerts);
          setLoadError("");
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(
            error instanceof Error
              ? error.message
              : "Payment pricing controls could not load.",
          );
      });
    return () => controller.abort();
  }, [allowed, scopedPath, version]);

  function change<K extends keyof typeof form>(
    field: K,
    value: (typeof form)[K],
  ) {
    setForm((previous) => ({ ...previous, [field]: value }));
    setFormError("");
    setNotice("");
  }
  function chooseClass(transactionClass: string) {
    const published = profiles?.publishedProfiles.find(
      (profile) => profile.transactionClass === transactionClass,
    );
    setForm((previous) => ({
      ...previous,
      transactionClass,
      status: restricted(transactionClass) ? "DISABLED" : "APPROVED",
      channel:
        published?.channel ??
        (transactionClass.includes("CARD") ||
        transactionClass === "INTERNATIONAL_AMEX"
          ? "card"
          : transactionClass.includes("TRANSFER") ||
              transactionClass === "DEDICATED_VIRTUAL_ACCOUNT"
            ? "bank_transfer"
            : transactionClass.includes("USSD")
              ? "ussd"
              : "ANY"),
      cardNetwork:
        transactionClass === "INTERNATIONAL_AMEX"
          ? "AMEX"
          : (published?.cardNetwork ?? "ANY"),
      sourceUrl: published?.sourceUrl ?? "https://paystack.com/pricing",
      rate: published?.collection
        ? String(published.collection.basisPoints / 100)
        : "",
      flat: published?.collection
        ? String(published.collection.flatKobo / 100)
        : "",
      threshold: published?.collection
        ? String(published.collection.flatWaivedBelowKobo / 100)
        : "",
      cap:
        published?.collection?.capKobo != null
          ? String(published.collection.capKobo / 100)
          : "",
      confirmedEligibility: false,
      evidence: "",
    }));
    setFormError("");
    setNotice("");
  }
  function profilePayload() {
    if (!form.universityId)
      throw new Error("Choose the campus for this rule profile.");
    if (form.version.trim().length < 3)
      throw new Error(
        "Enter a new profile version of at least three characters.",
      );
    const basisPoints = pricingMinor(form.rate, "Provider rate");
    if (basisPoints >= 10000)
      throw new Error("The provider percentage must be below 100%.");
    if (
      form.transactionClass === "INTERNATIONAL_AMEX" &&
      form.cardNetwork !== "AMEX"
    )
      throw new Error(
        "Use the American Express network for its separate international rule.",
      );
    if (
      form.transactionClass === "INTERNATIONAL_CARD" &&
      form.cardNetwork === "AMEX"
    )
      throw new Error(
        "Choose the separate American Express profile for that network.",
      );
    const starts = Date.parse(form.effectiveFrom),
      ends = form.effectiveTo ? Date.parse(form.effectiveTo) : null;
    if (!Number.isFinite(starts))
      throw new Error("Choose the effective start date and time.");
    if (ends !== null && (!Number.isFinite(ends) || ends <= starts))
      throw new Error("The effective end must be after the start.");
    if (
      restricted(form.transactionClass) &&
      form.status === "APPROVED" &&
      (!form.confirmedEligibility || form.evidence.trim().length < 10)
    )
      throw new Error(
        "Activation requires explicit product approval and the account's confirmed commercial terms.",
      );
    const source = new URL(form.sourceUrl);
    if (
      source.protocol !== "https:" ||
      ![
        "paystack.com",
        "support.paystack.com",
        "dashboard.paystack.com",
      ].includes(source.hostname)
    )
      throw new Error("Use an official HTTPS Paystack source.");
    if (form.note.trim().length < 10)
      throw new Error(
        "Add the reason and evidence for this new version (at least ten characters).",
      );
    return {
      universityId: form.universityId,
      version: form.version.trim(),
      transactionClass: form.transactionClass,
      channel: form.channel,
      cardNetwork: form.cardNetwork,
      collection: {
        basisPoints,
        flatKobo: pricingMinor(form.flat, "Flat fee"),
        flatWaivedBelowKobo: pricingMinor(form.threshold, "Flat fee threshold"),
        capKobo: form.cap ? pricingMinor(form.cap, "Fee cap") : null,
      },
      effectiveFrom: new Date(starts).toISOString(),
      effectiveTo: ends === null ? null : new Date(ends).toISOString(),
      status: form.status,
      varianceToleranceKobo: pricingMinor(
        form.tolerance,
        "Fee variance tolerance",
      ),
      sourceUrl: form.sourceUrl,
      approvalNote: form.note.trim(),
      eligibilityEvidence: form.evidence.trim() || null,
    };
  }
  async function approveProfile(event: FormEvent) {
    event.preventDefault();
    if (busy || !mayApprove || !profiles?.ready) return;
    setFormError("");
    setNotice("");
    try {
      const payload = profilePayload();
      setBusy("profile");
      const result = await portalApi<{ id: string }>(`${base}/profiles`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!result || typeof result.id !== "string")
        throw new Error(
          "The profile approval was not confirmed. Refresh the approved versions before retrying.",
        );
      setForm((previous) => ({
        ...previous,
        version: "",
        note: "",
        evidence: "",
        confirmedEligibility: false,
      }));
      setNotice(
        "New provider profile recorded. Existing transactions retain their original rule version.",
      );
      setVersion((previous) => previous + 1);
      onProfilesChanged?.();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "The profile could not be approved.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function recordAccountReview(event: FormEvent) {
    event.preventDefault();
    if (busy || !mayReviewAccount || !account?.ready) return;
    setAccountError("");
    setNotice("");
    if (!review.passFeesDisabled) {
      setAccountError(
        "Confirm only after checking that automatic pass-fees is disabled on the selected Paystack account.",
      );
      return;
    }
    if (
      review.reason.trim().length < 10 ||
      review.evidence.trim().length < 10
    ) {
      setAccountError(
        "Record the reason and reviewed account evidence, each at least ten characters.",
      );
      return;
    }
    setBusy("account");
    try {
      const expiresAt = review.expiresAt ? Date.parse(review.expiresAt) : null;
      if (expiresAt !== null && !Number.isFinite(expiresAt))
        throw new Error("Enter a valid review expiry date.");
      const response = await portalApi<{
        id: string;
        passFeesDisabled: boolean;
      }>(`${base}/account-review`, {
        method: "POST",
        body: JSON.stringify({
          ...review,
          reason: review.reason.trim(),
          evidence: review.evidence.trim(),
          expiresAt:
            expiresAt === null ? null : new Date(expiresAt).toISOString(),
        }),
      });
      if (
        !response ||
        typeof response.id !== "string" ||
        response.passFeesDisabled !== true
      )
        throw new Error(
          "Account review was not confirmed. Refresh before recording another review.",
        );
      setReview((previous) => ({
        ...previous,
        passFeesDisabled: false,
        reason: "",
        evidence: "",
        expiresAt: "",
      }));
      setNotice(
        "Account review recorded. This attestation does not change Paystack settings.",
      );
      setVersion((previous) => previous + 1);
    } catch (error) {
      setAccountError(
        error instanceof Error
          ? error.message
          : "The account review could not be recorded.",
      );
    } finally {
      setBusy(null);
    }
  }
  if (!allowed) return null;
  return (
    <>
      <section className="panel" aria-labelledby="provider-pricing-heading">
        <h2 id="provider-pricing-heading">Provider pricing & account review</h2>
        <p>
          Use immutable rules for each payment product. Ordinary checkout uses
          local or international online collection; virtual accounts, terminals
          and education terms require separate approval.
        </p>
        {loadError ? (
          <p className="notice notice--error" role="alert">
            {loadError}{" "}
            <button
              type="button"
              className="text-link"
              onClick={() => setVersion((previous) => previous + 1)}
            >
              Try again
            </button>
          </p>
        ) : null}
        {!profiles && !loadError ? (
          <p aria-busy="true">
            Loading provider rules and reconciliation alerts…
          </p>
        ) : null}
        {profiles && !profiles.ready ? (
          <p className="notice">
            Provider controls are awaiting the database update. Approval is
            unavailable.
          </p>
        ) : null}
        {notice ? (
          <p className="notice" role="status">
            {notice}
          </p>
        ) : null}
        <h3>Paystack automatic pass-fees</h3>
        <p>
          The accepted customer total must equal the initialized checkout
          amount. Review the actual Paystack account setting before recording
          that automatic pass-fees is disabled.
        </p>
        {account ? (
          <dl className="detail-list">
            <div>
              <dt>Account mode</dt>
              <dd>{account.providerMode === "live" ? "Live" : "Test"}</dd>
            </div>
            <div>
              <dt>Current review</dt>
              <dd>
                {account.reviewed
                  ? "Recorded for this account mode"
                  : "Review required"}
              </dd>
            </div>
            {account.review ? (
              <>
                <div>
                  <dt>Last attestation</dt>
                  <dd>
                    {account.review.passFeesDisabled
                      ? "Pass-fees disabled"
                      : "Pass-fees not confirmed disabled"}{" "}
                    · {account.review.providerMode}
                  </dd>
                </div>
                <div>
                  <dt>Reviewed</dt>
                  <dd>{time(account.review.reviewedAt)}</dd>
                </div>
                <div>
                  <dt>Review reason</dt>
                  <dd>{account.review.reason}</dd>
                </div>
                <div>
                  <dt>Review expiry</dt>
                  <dd>
                    {account.review.expiresAt
                      ? time(account.review.expiresAt)
                      : "No recorded expiry"}
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
        ) : null}
        {mayReviewAccount ? (
          <form className="form-stack" onSubmit={recordAccountReview}>
            <fieldset
              disabled={busy !== null || !account?.ready || Boolean(loadError)}
            >
              <legend>Record a new account review</legend>
              <div className="form-grid">
                <label>
                  Review expires at (optional)
                  <input
                    type="datetime-local"
                    value={review.expiresAt}
                    onChange={(event) =>
                      setReview((previous) => ({
                        ...previous,
                        expiresAt: event.target.value,
                      }))
                    }
                  />
                  <span className="field-help">
                    An expired review pauses payment initialization until a new
                    review is recorded.
                  </span>
                </label>
                <label>
                  Reviewed account mode
                  <select
                    aria-label="Reviewed account mode"
                    value={review.providerMode}
                    onChange={(event) => {
                      setReview((previous) => ({
                        ...previous,
                        providerMode: event.target.value,
                        passFeesDisabled: false,
                      }));
                      setAccountError("");
                    }}
                  >
                    <option value="live">Live</option>
                    <option value="test">Test</option>
                  </select>
                </label>
                <label>
                  Review reason
                  <textarea
                    required
                    minLength={10}
                    maxLength={2000}
                    value={review.reason}
                    onChange={(event) =>
                      setReview((previous) => ({
                        ...previous,
                        reason: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Account setting evidence
                  <textarea
                    required
                    minLength={10}
                    maxLength={2000}
                    value={review.evidence}
                    onChange={(event) =>
                      setReview((previous) => ({
                        ...previous,
                        evidence: event.target.value,
                      }))
                    }
                  />
                  <span className="field-help">
                    Record the reviewed account and setting reference. Do not
                    enter API keys, card details or credentials.
                  </span>
                </label>
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={review.passFeesDisabled}
                  onChange={(event) => {
                    setReview((previous) => ({
                      ...previous,
                      passFeesDisabled: event.target.checked,
                    }));
                    setAccountError("");
                  }}
                />
                I checked this account and confirmed automatic pass-fees is
                disabled.
              </label>
              {accountError ? (
                <p className="field-error" role="alert">
                  {accountError}
                </p>
              ) : null}
              <button
                className="button button--primary"
                type="submit"
                disabled={!review.passFeesDisabled}
              >
                {busy === "account"
                  ? "Recording review…"
                  : "Record reviewed setting"}
              </button>
            </fieldset>
          </form>
        ) : mayApprove ? (
          <p className="field-help">
            Account-wide review requires finance review access across all
            universities.
          </p>
        ) : null}
        <h3>Approved provider versions</h3>
        {profiles?.profiles.length ? (
          <div
            className="table-scroll"
            role="region"
            aria-label="Provider fee versions"
            tabIndex={0}
          >
            <table className="operational-table">
              <thead>
                <tr>
                  <th>Version & product</th>
                  <th>Context</th>
                  <th>Rate & flat fee</th>
                  <th>Threshold & cap</th>
                  <th>Effective window</th>
                  <th>Variance tolerance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {profiles.profiles.map((profile) => (
                  <tr key={profile.id}>
                    <td>
                      {profile.version}
                      <span className="record-meta">
                        {labelFor(profile.transactionClass)}
                      </span>
                    </td>
                    <td>
                      {profile.channel} · {profile.cardNetwork}
                    </td>
                    <td>
                      {profile.collection.basisPoints / 100}% +{" "}
                      {formatPricingMoney(profile.collection.flatKobo)}
                    </td>
                    <td>
                      Flat waived below{" "}
                      {formatPricingMoney(
                        profile.collection.flatWaivedBelowKobo,
                      )}
                      <span className="record-meta">
                        {profile.collection.capKobo === null
                          ? "No cap"
                          : `Cap ${formatPricingMoney(profile.collection.capKobo)}`}
                      </span>
                    </td>
                    <td>
                      {time(profile.effectiveFrom)}
                      <span className="record-meta">
                        {profile.effectiveTo
                          ? `Until ${time(profile.effectiveTo)}`
                          : "No end date"}
                      </span>
                    </td>
                    <td>{formatPricingMoney(profile.varianceToleranceKobo)}</td>
                    <td>
                      {profile.status === "DISABLED" ? "Disabled" : "Approved"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : profiles?.ready ? (
          <p className="table-empty">
            No reviewed provider profiles in this scope. Published baselines
            require approval before use.
          </p>
        ) : null}
        {mayApprove ? (
          <form className="form-stack" onSubmit={approveProfile}>
            <fieldset
              disabled={busy !== null || !profiles?.ready || Boolean(loadError)}
            >
              <legend>Review a new provider rule version</legend>
              <p className="field-help">
                Create a new version for changed terms. Effective dates select
                new quotes; existing transaction snapshots keep their original
                profile. Displayed baselines are reference values for review.
              </p>
              <p className="field-help">Date and time inputs use this browser&apos;s local timezone and are stored as an exact instant.</p>
              <div className="form-grid">
                <label>
                  Campus
                  <select
                    required
                    aria-label="Campus"
                    value={form.universityId}
                    onChange={(event) =>
                      change("universityId", event.target.value)
                    }
                  >
                    <option value="">Choose campus</option>
                    {access?.universities?.map((university) => (
                      <option key={university.id} value={university.id}>
                        {university.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  New profile version
                  <input
                    required
                    minLength={3}
                    maxLength={80}
                    value={form.version}
                    onChange={(event) => change("version", event.target.value)}
                  />
                </label>
                <label>
                  Payment product
                  <select
                    aria-label="Payment product"
                    value={form.transactionClass}
                    onChange={(event) => chooseClass(event.target.value)}
                  >
                    {classes.map(([id, label]) => (
                      <option value={id} key={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Channel
                  <select
                    aria-label="Channel"
                    value={form.channel}
                    onChange={(event) => change("channel", event.target.value)}
                  >
                    <option value="ANY">Applicable channels</option>
                    <option value="card">Card</option>
                    <option value="bank_transfer">Bank transfer</option>
                    <option value="ussd">USSD</option>
                  </select>
                </label>
                <label>
                  Card network
                  <select
                    aria-label="Card network"
                    value={form.cardNetwork}
                    onChange={(event) =>
                      change("cardNetwork", event.target.value)
                    }
                  >
                    {["ANY", "MASTERCARD", "VISA", "VERVE", "AMEX"].map(
                      (network) => (
                        <option key={network} value={network}>
                          {network === "ANY" ? "Applicable networks" : network}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  New version status
                  <select
                    aria-label="New version status"
                    value={form.status}
                    onChange={(event) => change("status", event.target.value)}
                  >
                    <option value="DISABLED">Disabled</option>
                    <option
                      value="APPROVED"
                      disabled={
                        restricted(form.transactionClass) &&
                        !form.confirmedEligibility
                      }
                    >
                      Approved for its payment product
                    </option>
                  </select>
                </label>
                {(
                  [
                    ["rate", "Provider rate (%)"],
                    ["flat", "Flat fee (₦)"],
                    ["threshold", "Flat fee waived below (₦)"],
                    ["cap", "Fee cap (₦, blank for no cap)"],
                    ["tolerance", "Allowed actual fee variance (₦)"],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field}>
                    {label}
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={
                        field === "rate"
                          ? 99.99
                          : field === "tolerance"
                            ? 1000000
                            : 20000000
                      }
                      step="0.01"
                      required={field !== "cap"}
                      value={form[field]}
                      onChange={(event) => change(field, event.target.value)}
                    />
                  </label>
                ))}
                <label>
                  Effective from
                  <input
                    required
                    type="datetime-local"
                    value={form.effectiveFrom}
                    onChange={(event) =>
                      change("effectiveFrom", event.target.value)
                    }
                  />
                </label>
                <label>
                  Effective until (optional)
                  <input
                    type="datetime-local"
                    value={form.effectiveTo}
                    min={form.effectiveFrom || undefined}
                    onChange={(event) =>
                      change("effectiveTo", event.target.value)
                    }
                  />
                </label>
                <label>
                  Official source
                  <input
                    required
                    type="url"
                    value={form.sourceUrl}
                    onChange={(event) =>
                      change("sourceUrl", event.target.value)
                    }
                  />
                </label>
                <label>
                  Approval reason & evidence
                  <textarea
                    required
                    minLength={10}
                    maxLength={2000}
                    value={form.note}
                    onChange={(event) => change("note", event.target.value)}
                  />
                </label>
              </div>
              {restricted(form.transactionClass) ? (
                <div className="sub-form">
                  <p className="notice">
                    This product begins disabled. Education eligibility must be
                    confirmed by Paystack for the actual merchant account. DVA
                    and terminal terms apply only to those approved products.
                  </p>
                  <label>
                    Confirmed product eligibility & commercial terms
                    <textarea
                      minLength={10}
                      maxLength={2000}
                      required={form.status === "APPROVED"}
                      value={form.evidence}
                      onChange={(event) =>
                        change("evidence", event.target.value)
                      }
                    />
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={form.confirmedEligibility}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setForm((previous) => ({
                          ...previous,
                          confirmedEligibility: checked,
                          status: checked ? previous.status : "DISABLED",
                        }));
                        setFormError("");
                      }}
                    />
                    I reviewed explicit product approval and the applicable
                    account terms.
                  </label>
                </div>
              ) : null}
              {formError ? (
                <p className="field-error" role="alert">
                  {formError}
                </p>
              ) : null}
              <button className="button button--primary" type="submit">
                {busy === "profile"
                  ? "Recording version…"
                  : "Record new provider version"}
              </button>
            </fieldset>
          </form>
        ) : null}
      </section>
      <section className="panel" aria-labelledby="fee-variance-heading">
        <h2 id="fee-variance-heading">Actual fee variance alerts</h2>
        <p>
          Verified provider fees are compared with the transaction&apos;s stored
          estimate and tolerance. Finance resolves differences internally; the
          customer is never charged again for a variance.
        </p>
        {alerts?.length ? (
          <div
            className="table-scroll"
            role="region"
            aria-label="Fee variance alerts"
            tabIndex={0}
          >
            <table className="operational-table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Alert</th>
                  <th>Expected fee</th>
                  <th>Actual fee</th>
                  <th>Variance</th>
                  <th>Allowed variance</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <tr key={alert.id}>
                    <td>{alert.providerReference}</td>
                    <td>{alert.kind.replaceAll("_", " ").toLowerCase()}</td>
                    <td>
                      {alertMoney(alert.metadata, [
                        "expectedProviderFeeKobo",
                        "estimatedProcessingKobo",
                        "expectedFeeKobo",
                      ])}
                    </td>
                    <td>
                      {alertMoney(alert.metadata, [
                        "actualProviderFeeKobo",
                        "actualFeeKobo",
                      ])}
                    </td>
                    <td>
                      {alertMoney(alert.metadata, [
                        "providerFeeVarianceKobo",
                        "varianceKobo",
                      ])}
                    </td>
                    <td>{alertMoney(alert.metadata, ["toleranceKobo"])}</td>
                    <td>{time(alert.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : alerts ? (
          <p className="table-empty">No recorded fee alerts in this scope.</p>
        ) : null}
      </section>
    </>
  );
}

function alertMoney(metadata: Record<string, unknown>, keys: string[]) {
  const value = keys
    .map((key) => metadata[key])
    .find(
      (amount) => typeof amount === "number" && Number.isSafeInteger(amount),
    );
  return typeof value === "number" ? formatPricingMoney(value) : "Not supplied";
}
