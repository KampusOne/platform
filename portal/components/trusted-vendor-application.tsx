"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { usePortalAuth } from "./auth-provider";
import { portalApi } from "@/lib/api";
import { PhoneField, BirthDateField } from "./intake-fields";
import { AgentApplicationIllustration } from "./agent-illustrations";

type VendorDraft = {
  businessName: string;
  legalName: string;
  description: string;
  address: string;
  category: string;
  campus: string;
  phone: string;
  whatsapp: string;
  birth: string;
  request: string;
};

const blank: VendorDraft = {
  businessName: "",
  legalName: "",
  description: "",
  address: "",
  category: "Groceries",
  campus: "",
  phone: "",
  whatsapp: "",
  birth: "",
  request: "",
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

const steps = ["Your details", "Your business", "Review & agree"];
const kickers = ["Let’s start", "Tell us about the business", "Almost done"];

function ageOnDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 0;
  const birthday = new Date(value + "T00:00:00Z");
  if (Number.isNaN(birthday.getTime())) return 0;
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
    <TrustedVendorForm
      key={`${user?.id}:${params.get("invite") ?? ""}`}
    />
  );
}

function TrustedVendorForm() {
  const params = useSearchParams();
  const { user } = usePortalAuth();
  const token = params.get("invite") ?? "";
  const validToken = /^[a-f0-9]{64}$/.test(token);

  const [invite, setInvite] = useState<{
    university_name: string;
    application_id: string | null;
  } | null>(null);
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

  const update = (field: keyof VendorDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: "" }));
  };

  useEffect(() => {
    let active = true;
    if (!validToken) return () => void (active = false);

    void (async () => {
      const response = await portalApi<{
        invite: { university_name: string; application_id: string | null };
      }>("/v1/trusted-vendors/invite", {
        method: "POST",
        body: JSON.stringify({ token }),
      });

      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(token),
      );
      const key = `k1.trusted-vendor.${user?.id}.${Array.from(
        new Uint8Array(digest),
        (value) => value.toString(16).padStart(2, "0"),
      ).join("")}`;

      let restored: Partial<VendorDraft> = {};
      let restoredStep = 0;
      let restoredWhatsappSame = true;
      try {
        const raw = sessionStorage.getItem(key);
        if (raw) {
          const saved = JSON.parse(raw) as {
            draft?: Partial<VendorDraft>;
            step?: number;
            whatsappSame?: boolean;
          };
          if (saved.draft) restored = saved.draft;
          restoredStep = Math.min(2, Math.max(0, Number(saved.step ?? 0)));
          restoredWhatsappSame = saved.whatsappSame !== false;
        }
      } catch {
        // Session storage is optional.
      }

      if (!active) return;
      setInvite(response.invite);
      setSubmitted(Boolean(response.invite.application_id));
      setDraft({
        ...blank,
        ...restored,
        request: restored.request || crypto.randomUUID(),
      });
      setStep(restoredStep);
      setWhatsappSame(restoredWhatsappSame);
      setDraftKey(key);
    })().catch((caught) => {
      if (active)
        setError(
          caught instanceof Error
            ? caught.message
            : "Your invitation could not be checked.",
        );
    });

    return () => {
      active = false;
    };
  }, [token, user?.id, validToken]);

  useEffect(() => {
    if (!draftKey) return;
    try {
      if (submitted) sessionStorage.removeItem(draftKey);
      else
        sessionStorage.setItem(
          draftKey,
          JSON.stringify({ draft, step, whatsappSame }),
        );
    } catch {
      // The form still works if storage is unavailable.
    }
  }, [draftKey, draft, step, submitted, whatsappSame]);

  function validate(currentStep: number) {
    const errors: Record<string, string> = {};
    if (currentStep === 0) {
      if (draft.legalName.trim().length < 2)
        errors.legalName = "Enter your legal name.";
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
        errors.businessName = "Enter the business name.";
      if (draft.campus.trim().length < 2)
        errors.campus = "Choose or enter the campus you serve.";
      if (draft.address.trim().length < 10)
        errors.address = "Enter a complete business address.";
      if (draft.description.trim().length < 20)
        errors.description =
          "Tell us what the business offers in at least 20 characters.";
    }
    if (currentStep === 2) {
      if (!authorized) errors.authorized = "Confirm that you represent this business.";
      if (!terms) errors.terms = "Accept the KampusOne agent terms to continue.";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length)
      setError("Check the highlighted details below.");
    return Object.keys(errors).length === 0;
  }

  function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!validate(step)) return;
    if (step < 2) setStep((current) => current + 1);
    else void submit();
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await portalApi("/v1/trusted-vendors/submit", {
        method: "POST",
        body: JSON.stringify({
          token,
          requestId: draft.request,
          businessName: draft.businessName.trim(),
          legalName: draft.legalName.trim(),
          birthDate: draft.birth,
          description: draft.description.trim(),
          address: draft.address.trim(),
          category: draft.category,
          campus: draft.campus.trim(),
          phone: draft.phone,
          ...(whatsappSame
            ? { whatsapp: draft.phone }
            : draft.whatsapp
              ? { whatsapp: draft.whatsapp }
              : {}),
          adultAuthorized: true,
          terms: true,
        }),
      });
      setSubmitted(true);
      window.location.assign("https://agents.kampusone.app/agents");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Your application is kept. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!validToken)
    return (
      <main className="agent-login-page">
        <section
          className="agent-login-shell agent-onboarding-form trusted-vendor-onboarding"
          style={{ maxWidth: 660 }}
        >
          <AgentApplicationIllustration step={1} complete={false} />
          <p className="eyebrow">Agent network</p>
          <h1>Use your complete private invitation link.</h1>
          <p className="field-help">
            Exclusive is invitation only. If you do not have a private link,
            continue with the standard vendor, tutor or rider application.
          </p>
          <a className="button button--primary button--wide" href="/agents">
            Open standard application
          </a>
        </section>
      </main>
    );

  const uniben =
    invite?.university_name.toLowerCase() === "university of benin";

  if (submitted)
    return (
      <main className="agent-login-page">
        <section
          className="agent-login-shell agent-onboarding-form trusted-vendor-onboarding exclusive-agent-form"
          style={{ maxWidth: 680 }}
        >
          <AgentApplicationIllustration step={2} complete />
          <p className="onboarding-kicker">Submitted</p>
          <h1>Your business is under review</h1>
          <p className="field-help">
            We have your Exclusive application. We will email the decision.
          </p>
          <a className="button button--primary button--wide" href="/agents">
            Return to agent applications
          </a>
        </section>
      </main>
    );

  return (
    <main className="agent-login-page">
      <section
        className="agent-login-shell trusted-vendor-onboarding exclusive-agent-form"
        style={{ maxWidth: 720 }}
      >
        <form className="form-stack agent-onboarding-form" onSubmit={next} noValidate>
          <div className="onboarding-stepbar">
            <button
              type="button"
              aria-label="Previous step"
              disabled={busy || step === 0}
              onClick={() => {
                setStep((current) => Math.max(0, current - 1));
                setError("");
              }}
              className="onboarding-back"
            >
              ‹
            </button>
            <div
              role="progressbar"
              aria-label="Exclusive application progress"
              aria-valuemin={1}
              aria-valuemax={steps.length}
              aria-valuenow={step + 1}
              className="onboarding-progress"
            >
              <span style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
            </div>
            <span className="onboarding-stepcount">
              {step + 1} of {steps.length}
            </span>
          </div>

          <div className="onboarding-mobile-art">
            <AgentApplicationIllustration step={Math.min(4, step * 2)} />
          </div>

          <header>
            <p className="onboarding-kicker">{kickers[step]}</p>
            <h2>{steps[step]}</h2>
            <p className="field-help">
              {invite?.university_name ?? "Checking your invitation…"}
            </p>
          </header>

          {error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : null}

          {!invite ? (
            <p className="field-help">Checking your invitation…</p>
          ) : (
            <fieldset className="wizard-step" disabled={busy}>
              {step === 0 && (
                <>
                  <label>
                    Full legal name
                    <input
                      value={draft.legalName}
                      onChange={(event) => update("legalName", event.target.value)}
                      required
                      minLength={2}
                      maxLength={160}
                      placeholder="e.g. Osas Egharevba"
                      autoComplete="name"
                      aria-invalid={Boolean(fieldErrors.legalName)}
                    />
                    {fieldErrors.legalName ? (
                      <span className="field-error">{fieldErrors.legalName}</span>
                    ) : null}
                  </label>
                  <BirthDateField
                    value={draft.birth}
                    minAge={18}
                    error={fieldErrors.birth}
                    onChange={(value) => update("birth", value)}
                  />
                  <PhoneField
                    id="trusted-phone"
                    label="Phone number"
                    value={draft.phone}
                    error={fieldErrors.phone}
                    onChange={(value) => update("phone", value)}
                  />
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={whatsappSame}
                      onChange={(event) => setWhatsappSame(event.target.checked)}
                    />
                    WhatsApp uses this phone number
                  </label>
                  {!whatsappSame ? (
                    <PhoneField
                      id="trusted-whatsapp"
                      label="WhatsApp number"
                      value={draft.whatsapp}
                      error={fieldErrors.whatsapp}
                      onChange={(value) => update("whatsapp", value)}
                    />
                  ) : null}
                </>
              )}

              {step === 1 && (
                <>
                  <label>
                    Business name
                    <input
                      value={draft.businessName}
                      onChange={(event) =>
                        update("businessName", event.target.value)
                      }
                      required
                      minLength={2}
                      maxLength={160}
                      placeholder="e.g. Osas Kitchen"
                      aria-invalid={Boolean(fieldErrors.businessName)}
                    />
                    {fieldErrors.businessName ? (
                      <span className="field-error">
                        {fieldErrors.businessName}
                      </span>
                    ) : null}
                  </label>
                  <label>
                    Business category
                    <select
                      value={draft.category}
                      onChange={(event) => update("category", event.target.value)}
                    >
                      {categories.map((category) => (
                        <option key={category}>{category}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Campus or service area
                    {uniben ? (
                      <select
                        required
                        value={draft.campus}
                        onChange={(event) => update("campus", event.target.value)}
                        aria-invalid={Boolean(fieldErrors.campus)}
                      >
                        <option value="" disabled>
                          Choose your campus
                        </option>
                        <option>Ugbowo</option>
                        <option>Ekehuan</option>
                        <option>Both campuses</option>
                      </select>
                    ) : (
                      <input
                        value={draft.campus}
                        onChange={(event) => update("campus", event.target.value)}
                        required
                        maxLength={100}
                        placeholder="e.g. Main campus"
                        aria-invalid={Boolean(fieldErrors.campus)}
                      />
                    )}
                    {fieldErrors.campus ? (
                      <span className="field-error">{fieldErrors.campus}</span>
                    ) : null}
                  </label>
                  <label>
                    Business address
                    <input
                      value={draft.address}
                      onChange={(event) => update("address", event.target.value)}
                      required
                      minLength={10}
                      maxLength={500}
                      placeholder="e.g. June 12 shopping complex"
                      aria-invalid={Boolean(fieldErrors.address)}
                    />
                    {fieldErrors.address ? (
                      <span className="field-error">{fieldErrors.address}</span>
                    ) : null}
                  </label>
                  <label>
                    What does your business offer?
                    <textarea
                      value={draft.description}
                      onChange={(event) =>
                        update("description", event.target.value)
                      }
                      required
                      minLength={20}
                      maxLength={2000}
                      placeholder="Tell us what you sell or provide, who you serve, and when you are usually available."
                      aria-invalid={Boolean(fieldErrors.description)}
                    />
                    {fieldErrors.description ? (
                      <span className="field-error">
                        {fieldErrors.description}
                      </span>
                    ) : null}
                  </label>
                </>
              )}

              {step === 2 && (
                <>
                  <div className="exclusive-review">
                    <div>
                      <span>Representative</span>
                      <strong>{draft.legalName}</strong>
                    </div>
                    <div>
                      <span>Business</span>
                      <strong>{draft.businessName}</strong>
                    </div>
                    <div>
                      <span>Category</span>
                      <strong>{draft.category}</strong>
                    </div>
                    <div>
                      <span>Campus / area</span>
                      <strong>{draft.campus}</strong>
                    </div>
                    <div>
                      <span>Phone</span>
                      <strong>{draft.phone}</strong>
                    </div>
                    <div>
                      <span>Address</span>
                      <strong>{draft.address}</strong>
                    </div>
                  </div>
                  <p className="exclusive-fast-track-note">
                    This Exclusive application is reviewed from the information
                    you provide here. No document upload is required in this
                    fast track.
                  </p>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={authorized}
                      onChange={(event) => setAuthorized(event.target.checked)}
                    />
                    I am at least 18 and authorised to represent this business.
                  </label>
                  {fieldErrors.authorized ? (
                    <span className="field-error">{fieldErrors.authorized}</span>
                  ) : null}
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={terms}
                      onChange={(event) => setTerms(event.target.checked)}
                    />
                    I accept the KampusOne agent terms and confirm these details
                    are accurate.
                  </label>
                  {fieldErrors.terms ? (
                    <span className="field-error">{fieldErrors.terms}</span>
                  ) : null}
                </>
              )}
            </fieldset>
          )}

          <div className="form-actions">
            {step > 0 ? (
              <button
                type="button"
                className="button button--secondary"
                disabled={busy}
                onClick={() => {
                  setStep((current) => current - 1);
                  setError("");
                }}
              >
                Back
              </button>
            ) : null}
            <span className="exclusive-save-note">Saved on this device</span>
            <button
              className="button button--primary"
              disabled={busy || !invite}
            >
              {busy
                ? "Saving…"
                : step === 2
                  ? "Submit Exclusive application"
                  : "Continue"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
