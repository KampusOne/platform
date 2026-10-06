"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { usePortalAuth } from "./auth-provider";
import { portalApi } from "@/lib/api";
import { PhoneField, BirthDateField } from "./intake-fields";
import { normalizeIntakePhone } from "@/lib/intake-phone";
import { AgentApplicationIllustration } from "./agent-illustrations";
import { AgentIntakeShell } from "./agent-intake-shell";
import {
  AgentOperationsFields,
  emptyOperations,
  validateOperations,
  type AgentOperations,
} from "./agent-operations-fields";
import styles from "./agent-intake.module.css";

type VendorDraft = {
  businessName: string;
  legalName: string;
  address: string;
  category: string;
  campus: string;
  phone: string;
  whatsapp: string;
  birth: string;
  request: string;
  acquisition: string;
  acquisitionOther: string;
  operations: AgentOperations;
};
const blank: VendorDraft = {
  businessName: "",
  legalName: "",
  address: "",
  category: "",
  campus: "",
  phone: "",
  whatsapp: "",
  birth: "",
  request: "",
  acquisition: "",
  acquisitionOther: "",
  operations: emptyOperations,
};
const categories = [
  "Restaurant",
  "Supermarket",
  "Groceries",
  "Fashion",
  "Beauty",
  "Electronics",
  "Printing",
  "Other",
];
const steps = [
  "Your contact details",
  "Your business",
  "How you work",
  "Review & submit",
];
type Invitation = { university_name: string; application_id: string | null };

function ageOnDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 0;
  const birthday = new Date(value + "T00:00:00Z");
  if (
    Number.isNaN(birthday.getTime()) ||
    birthday.toISOString().slice(0, 10) !== value
  )
    return 0;
  const today = new Date();
  let age = today.getUTCFullYear() - birthday.getUTCFullYear();
  if (
    today.getUTCMonth() < birthday.getUTCMonth() ||
    (today.getUTCMonth() === birthday.getUTCMonth() &&
      today.getUTCDate() < birthday.getUTCDate())
  )
    age--;
  return age;
}

export function TrustedVendorApplication() {
  const { user } = usePortalAuth();
  const params = useSearchParams();
  return (
    <TrustedVendorForm key={`${user?.id}:${params.get("invite") ?? ""}`} />
  );
}

function TrustedVendorForm() {
  const params = useSearchParams();
  const { user } = usePortalAuth();
  const token = params.get("invite") ?? "";
  const validToken = /^[a-f0-9]{64}$/.test(token);
  const [invite, setInvite] = useState<Invitation | null>(null);
  const [draft, setDraft] = useState<VendorDraft>(blank);
  const [draftKey, setDraftKey] = useState("");
  const [step, setStep] = useState(0);
  const [whatsappSame, setWhatsappSame] = useState(true);
  const [terms, setTerms] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [version, setVersion] = useState(0);
  const [saved, setSaved] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  function update<K extends keyof VendorDraft>(
    field: K,
    value: VendorDraft[K],
  ) {
    setDraft((current) => ({
      ...current,
      [field]: value,
      request: crypto.randomUUID(),
    }));
    setFieldErrors((current) => ({ ...current, [field]: "" }));
  }
  useEffect(() => {
    let active = true;
    if (!validToken) return;
    void (async () => {
      const response = await portalApi<{ invite: Invitation }>(
        "/v1/trusted-vendors/invite",
        { method: "POST", body: JSON.stringify({ token }) },
      );
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(token),
      );
      const key = `k1.exclusive.v2.${user?.id}.${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")}`;
      let restored: Partial<VendorDraft> = {},
        restoredStep = 0,
        restoredWhatsappSame = true;
      try {
        const raw = sessionStorage.getItem(key);
        if (raw) {
          const stored = JSON.parse(raw) as {
            draft?: Partial<VendorDraft>;
            step?: number;
            whatsappSame?: boolean;
          };
          restored = stored.draft ?? {};
          restoredStep = Math.min(3, Math.max(0, Number(stored.step ?? 0)));
          restoredWhatsappSame = stored.whatsappSame !== false;
        }
      } catch {
        /* Tab storage is optional. */
      }
      if (!active) return;
      setInvite(response.invite);
      setSubmitted(Boolean(response.invite.application_id));
      setDraft({
        ...blank,
        ...restored,
        phone: normalizeIntakePhone(restored.phone ?? ""),
        whatsapp: normalizeIntakePhone(restored.whatsapp ?? ""),
        operations: { ...emptyOperations, ...restored.operations },
        request: restored.request || crypto.randomUUID(),
      });
      setStep(restoredStep);
      setWhatsappSame(restoredWhatsappSame);
      setDraftKey(key);
      setError("");
    })().catch((caught: unknown) => {
      if (active)
        setError(
          caught instanceof Error
            ? caught.message
            : "Your invitation could not be checked. Try again.",
        );
    });
    return () => {
      active = false;
    };
  }, [token, user?.id, validToken, version]);
  useEffect(() => {
    if (!draftKey) return;
    try {
      if (submitted) sessionStorage.removeItem(draftKey);
      else
        sessionStorage.setItem(
          draftKey,
          JSON.stringify({ draft, step, whatsappSame }),
        );
      queueMicrotask(() => setSaved(true));
    } catch {
      queueMicrotask(() => setSaved(false));
    }
  }, [draftKey, draft, step, submitted, whatsappSame]);

  function validate(currentStep: number) {
    const errors: Record<string, string> = {};
    if (currentStep === 0) {
      if (draft.legalName.trim().length < 2)
        errors.legalName = "Enter your name.";
      const age = ageOnDate(draft.birth);
      if (age < 18 || age > 110)
        errors.birth = "Invited business representatives must be at least 18.";
      if (!/^\+234[789]\d{9}$/.test(draft.phone))
        errors.phone = "Enter a valid Nigerian mobile number.";
      if (!whatsappSame && !/^\+234[789]\d{9}$/.test(draft.whatsapp))
        errors.whatsapp = "Enter a valid WhatsApp number.";
    }
    if (currentStep === 1) {
      if (draft.businessName.trim().length < 2)
        errors.businessName = "Enter your business name.";
      if (!categories.includes(draft.category))
        errors.category = "Choose a business category.";
      if (draft.campus.trim().length < 2)
        errors.campus = "Choose or enter the campus you serve.";
      if (draft.address.trim().length < 10)
        errors.address = "Enter your business or pickup address.";
    }
    if (currentStep === 2)
      Object.assign(errors, validateOperations(draft.operations));
    if (currentStep === 3) {
      if (!authorized)
        errors.authorized = "Confirm that you represent this business.";
      if (!terms) errors.terms = "Accept the agent terms to submit.";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length)
      setError("Check the highlighted answers below.");
    return !Object.keys(errors).length;
  }
  function goTo(next: number) {
    setStep(next);
    setFieldErrors({});
    setError("");
    requestAnimationFrame(() => {
      heading.current?.focus();
      heading.current?.scrollIntoView({ behavior: "instant", block: "start" });
    });
  }
  async function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !invite) return;
    setError("");
    if (!validate(step)) return;
    if (step < 3) {
      goTo(step + 1);
      return;
    }
    for (let index = 0; index < 3; index++) {
      if (!validate(index)) {
        setStep(index);
        requestAnimationFrame(() => heading.current?.focus());
        return;
      }
    }
    setBusy(true);
    try {
      const operations = draft.operations;
      const description = `${operations.primaryOffer.trim()}. ${operations.joiningReason}. Available ${operations.serviceDays.join(", ")} from ${operations.openingTime} to ${operations.closingTime}. Support: ${operations.supportChannel}, ${operations.responseTime.toLowerCase()}.`;
      await portalApi("/v1/trusted-vendors/submit", {
        method: "POST",
        body: JSON.stringify({
          token,
          requestId: draft.request,
          businessName: draft.businessName.trim(),
          legalName: draft.legalName.trim(),
          birthDate: draft.birth,
          description,
          address: draft.address.trim(),
          category: draft.category,
          campus: draft.campus.trim(),
          phone: draft.phone,
          whatsapp: whatsappSame ? draft.phone : draft.whatsapp,
          operations,
          ...(draft.acquisition ? {acquisition:{source:draft.acquisition,other:draft.acquisitionOther}} : {}),
          adultAuthorized: true,
          terms: true,
        }),
      });
      setSubmitted(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Your answers are kept. Try submitting again.",
      );
    } finally {
      setBusy(false);
    }
  }
  function text(
    field: "legalName" | "businessName" | "address" | "campus" | "acquisitionOther",
    label: string,
    placeholder: string,
    maxLength = 160,
  ) {
    return (
      <label>
        {label}
        <input
          value={draft[field]}
          maxLength={maxLength}
          placeholder={placeholder}
          autoComplete={
            field === "legalName"
              ? "name"
              : field === "address"
                ? "street-address"
                : undefined
          }
          aria-invalid={Boolean(fieldErrors[field])}
          onChange={(event) => update(field, event.target.value)}
        />
        {fieldErrors[field] && (
          <span className="field-error" role="alert">
            {fieldErrors[field]}
          </span>
        )}
      </label>
    );
  }

  return (
    <AgentIntakeShell
      title="Your Exclusive business profile"
      description="Tell us about your business and how you serve students. Your invitation takes you through a simple question based application."
    >
      <section className={`application-form ${styles.exclusiveCard}`}>
        {!validToken || (error && !invite) ? (
          <section className="state-panel" role="alert">
            <h2>Invitation unavailable</h2>
            <p>{error || "Open the invitation sent to your business email."}</p>
            {validToken && (
              <button
                className="button button--secondary"
                onClick={() => setVersion((current) => current + 1)}
              >
                Try again
              </button>
            )}
            <Link href="/agents" className="button button--secondary">
              Regular agent application
            </Link>
          </section>
        ) : !invite ? (
          <div
            className={styles.loading}
            aria-busy="true"
            aria-label="Checking your invitation"
          >
            <span />
            <span />
            <span />
          </div>
        ) : submitted ? (
          <section className="application-success" role="status">
            <AgentApplicationIllustration complete />
            <h2>We have your business profile</h2>
            <p>
              Our team will review your answers and contact you through your
              KampusOne email. You can check the decision in your applications.
            </p>
            <Link className="button button--primary" href="/agents">
              View application status
            </Link>
          </section>
        ) : (
          <form
            className="form-stack agent-onboarding-form"
            onSubmit={(event) => void next(event)}
            noValidate
          >
            <div className="onboarding-stepbar">
              <button
                type="button"
                className="onboarding-back"
                aria-label="Previous step"
                disabled={busy || step === 0}
                onClick={() => goTo(step - 1)}
              >
                ‹
              </button>
              <div
                role="progressbar"
                className="onboarding-progress"
                aria-label="Exclusive application progress"
                aria-valuemin={0}
                aria-valuemax={4}
                aria-valuenow={step + 1}
              >
                <span style={{ width: `${((step + 1) / 4) * 100}%` }} />
              </div>
              <span className="onboarding-stepcount">{step + 1} of 4</span>
            </div>
            <header>
              <p className="onboarding-kicker">{invite.university_name}</p>
              <h2 ref={heading} tabIndex={-1}>
                {steps[step]}
              </h2>
              <p className="field-help">
                {step === 0
                  ? "A real person we can contact about this business."
                  : step === 1
                    ? "Details students will use to find your business."
                    : step === 2
                      ? "Choose the options that match your usual service."
                      : "Check everything before sending your application."}
              </p>
            </header>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <fieldset className="wizard-step" disabled={busy}>
              {step === 0 && (
                <>
                  {text(
                    "legalName",
                    "Representative name",
                    "e.g. Osas Egharevba",
                  )}
                  <BirthDateField
                    value={draft.birth}
                    onChange={(value) => update("birth", value)}
                    error={fieldErrors.birth}
                    minAge={18}
                  />
                  <PhoneField
                    id="exclusive-phone"
                    label="Phone number"
                    value={draft.phone}
                    onChange={(value) => update("phone", value)}
                    error={fieldErrors.phone}
                  />
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={whatsappSame}
                      onChange={(event) =>
                        setWhatsappSame(event.target.checked)
                      }
                    />
                    Use this number for WhatsApp too
                  </label>
                  {!whatsappSame && (
                    <PhoneField
                      id="exclusive-whatsapp"
                      label="WhatsApp number"
                      value={draft.whatsapp}
                      onChange={(value) => update("whatsapp", value)}
                      error={fieldErrors.whatsapp}
                    />
                  )}
                </>
              )}
              {step === 1 && (
                <>
                  {text("businessName", "Business name", "e.g. Osas Kitchen")}
                  <label>Where did you hear about KampusOne? <span>optional</span><select value={draft.acquisition} onChange={event=>update("acquisition",event.target.value)}><option value="">Choose an option</option>{["FACEBOOK","TIKTOK","WHATSAPP","INSTAGRAM","FRIENDS","OTHER"].map(value=><option key={value} value={value}>{({FACEBOOK:"Facebook",TIKTOK:"TikTok",WHATSAPP:"WhatsApp",INSTAGRAM:"Instagram",FRIENDS:"Friends",OTHER:"Other"} as Record<string,string>)[value]}</option>)}</select></label>
                  {draft.acquisition==="OTHER"&&text("acquisitionOther","Tell us where","How you found KampusOne")}
                  <label>
                    Business category
                    <select
                      value={draft.category}
                      onChange={(event) =>
                        update("category", event.target.value)
                      }
                      aria-invalid={Boolean(fieldErrors.category)}
                    >
                      <option value="">Choose a category</option>
                      {categories.map((category) => (
                        <option key={category}>{category}</option>
                      ))}
                    </select>
                    {fieldErrors.category && (
                      <span className="field-error">
                        {fieldErrors.category}
                      </span>
                    )}
                  </label>
                  {text(
                    "campus",
                    "Campus or service area",
                    "e.g. Ugbowo campus",
                    100,
                  )}
                  {text(
                    "address",
                    "Business or pickup address",
                    "e.g. June 12 shopping complex, Ugbowo",
                    500,
                  )}
                </>
              )}
              {step === 2 && (
                <AgentOperationsFields
                  value={draft.operations}
                  onChange={(value) => update("operations", value)}
                  errors={fieldErrors}
                />
              )}
              {step === 3 && (
                <>
                  <div className={styles.reviewCard}>
                    <dl className="application-review">
                      <dt>Representative</dt>
                      <dd>
                        {draft.legalName} · {draft.phone}
                      </dd>
                      <dt>Business</dt>
                      <dd>
                        {draft.businessName} · {draft.category}
                      </dd>
                      <dt>Campus / address</dt>
                      <dd>
                        {draft.campus} · {draft.address}
                      </dd>
                      <dt>Products / services</dt>
                      <dd>{draft.operations.primaryOffer}</dd>
                      <dt>Available</dt>
                      <dd>
                        {draft.operations.serviceDays.join(", ")} ·{" "}
                        {draft.operations.openingTime} to{" "}
                        {draft.operations.closingTime}
                      </dd>
                      <dt>Fulfilment</dt>
                      <dd>{draft.operations.fulfilmentMethods.join(", ")}</dd>
                      <dt>Customer support</dt>
                      <dd>
                        {draft.operations.supportChannel} ·{" "}
                        {draft.operations.responseTime}
                      </dd>
                    </dl>
                  </div>
                  <details>
                    <summary>Agent terms</summary>
                    <p className="field-help">
                      Provide accurate business and contact details, follow
                      campus rules, fulfil orders as agreed and respond to
                      customers. Approval is reviewed by our team. Store access
                      and payout eligibility are separate; withdrawals require
                      verified bank details. Your invitation applies only to
                      this business and account.
                    </p>
                  </details>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={authorized}
                      onChange={(event) => setAuthorized(event.target.checked)}
                    />
                    I am at least 18 and authorised to represent this business.
                  </label>
                  {fieldErrors.authorized && (
                    <span className="field-error">
                      {fieldErrors.authorized}
                    </span>
                  )}
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={terms}
                      onChange={(event) => setTerms(event.target.checked)}
                    />
                    I accept the agent terms and confirm these answers are
                    accurate.
                  </label>
                  {fieldErrors.terms && (
                    <span className="field-error">{fieldErrors.terms}</span>
                  )}
                </>
              )}
            </fieldset>
            <div className="form-actions">
              {step > 0 && (
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={busy}
                  onClick={() => goTo(step - 1)}
                >
                  Back
                </button>
              )}
              <small className="field-help">
                {saved
                  ? "Progress saved in this tab"
                  : "Keep this tab open to preserve your answers"}
              </small>
              <button className="button button--primary" disabled={busy}>
                {busy
                  ? "Submitting…"
                  : step === 3
                    ? "Submit application"
                    : "Continue"}
              </button>
            </div>
          </form>
        )}
      </section>
    </AgentIntakeShell>
  );
}
