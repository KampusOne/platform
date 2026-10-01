"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PortalShell } from "./portal-shell";
import { usePortalAuth } from "./auth-provider";
import { portalApi } from "@/lib/api";
import { AgentApplicationIllustration } from "./agent-illustrations";
import { AgentFaceCapture } from "./agent-face-capture";
import {PhoneField,BirthDateField} from './intake-fields';

type Application = {
  id: string;
  agent_type: string;
  display_name: string;
  status: string;
  review_note: string | null;
  bank_status?: string;
  university_name?: string;
};
type School = { id: string; name: string };
type Upload = { id: string; url?: string };
const initial = {
  universityId: "",
  agentType: "VENDOR",
  displayName: "",
  phoneE164: "",
  whatsappPhone: "",
  statement: "",
  legalName: "",
  address: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  birthDate: "",
  isStudent: true,
  matricNumber: "",
  department: "",
  businessName: "",
  businessAddress: "",
  guardianName: "",
  guardianPhone: "",
  guardianEmail: "",
  guardianRelationship: "",
  campus: "",
  serviceLocation: "",
  campusPermission: "REVIEW",
  tutorSubjects: [] as string[],
  tutorLevels: [] as string[],
  experience: "",
  identityDocumentId: "",
  portraitDocumentId: "",
  studentDocumentId: "",
  riderDocumentIds: [] as string[],
  businessDocumentIds: [] as string[],
  businessCategories: [] as string[],
  nin: "",
  clientRequestId: "",
  publishContacts: false,
  portraitSource: "UPLOAD",
};
type FormValues = typeof initial;
const steps = [
  "Your details",
  "Your campus",
  "Your work",
  "Evidence",
  "Review & agree",
];
const phonePattern = /^\+[1-9]\d{7,14}$/;
const termsVersion = "2026-09-21";
const fieldExamples:Record<string,string>={legalName:'e.g. Osas Egharevba',displayName:'e.g. Osas Kitchen',address:'e.g. 12 Uselu Road, Benin City',businessAddress:'e.g. June 12 shopping complex, Ugbowo',emergencyContactName:'e.g. Itohan Egharevba',guardianName:'e.g. Itohan Egharevba',guardianEmail:'e.g. itohan@example.com',matricNumber:'e.g. ENG2200123'};
const businessCategories = [
  "Restaurant",
  "Supermarket",
  "Groceries",
  "Fashion",
  "Beauty",
  "Electronics",
  "Printing",
  "Other",
];
function ageOnDate(value: string) {
  const birthday = new Date(value),
    today = new Date();
  if (Number.isNaN(birthday.getTime())||birthday.toISOString().slice(0,10)!==value) return 0;
  let age = today.getFullYear() - birthday.getFullYear();
  if (
    today.getMonth() < birthday.getMonth() ||
    (today.getMonth() === birthday.getMonth() &&
      today.getDate() < birthday.getDate())
  )
    age--;
  return age;
}

export function AgentApplication() {
  const { user } = usePortalAuth();
  const [data, setData] = useState<FormValues>(initial);
  const [step, setStep] = useState(0);
  const [schools, setSchools] = useState<School[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [terms, setTerms] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [whatsappSame, setWhatsappSame] = useState(true);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [version, setVersion] = useState(0);
  const [privateIdentityReady, setPrivateIdentityReady] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([
      portalApi<{ universities: School[] }>("/v1/student/catalog"),
      portalApi<{ applications: Application[] }>("/v1/applications"),
      portalApi<{
        draft: {
          step: number;
          values: Partial<FormValues>;
          updated_at: string;
        } | null;
      }>("/v1/applications/draft"),
      portalApi<{
        profile: {
          display_name?: string;
          first_name?: string;
          last_name?: string;
          university_id?: string;
          department_name?: string;
          matriculation_number?: string;
        };
      }>("/v1/student/me"),
      portalApi<{ privateIdentityReady: boolean }>(
        "/v1/applications/requirements",
      ),
    ])
      .then(([catalog, history, draft, account, requirements]) => {
        if (!active) return;
        setSchools(catalog.universities);
        setApplications(history.applications);
        const profile = account.profile;
        setPrivateIdentityReady(requirements.privateIdentityReady);
        const defaults = {
          ...initial,
          clientRequestId: crypto.randomUUID(),
          displayName: profile.display_name ?? "",
          legalName: [profile.first_name, profile.last_name]
            .filter(Boolean)
            .join(" "),
          universityId: profile.university_id ?? "",
          department: profile.department_name ?? "",
          matricNumber: profile.matriculation_number ?? "",
        };
        setData({ ...defaults, ...draft.draft?.values });
        if (draft.draft) {
          setStep(Math.min(4, Math.max(0, draft.draft.step)));
          setSavedAt(draft.draft.updated_at);
          setNotice("Your saved application is ready to continue.");
          setWhatsappSame(
            !draft.draft.values.whatsappPhone ||
              draft.draft.values.whatsappPhone === draft.draft.values.phoneE164,
          );
        }
        setError("");
      })
      .catch((caught: unknown) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Your application could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [version]);
  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setData((current) => ({
      ...current,
      [key]: value,
      clientRequestId: crypto.randomUUID(),
    }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  }
  function field(
    key: keyof FormValues,
    label: string,
    type = "text",
    required = true,
  ) {
    if(key==='birthDate')return <BirthDateField key={key} value={data.birthDate} onChange={value=>update('birthDate',value)} error={fieldErrors[key]}/>;
    if(['phoneE164','whatsappPhone','emergencyContactPhone','guardianPhone'].includes(key))return <PhoneField key={key} id={`agent-${key}`} label={label.replace(' with country code','')} value={String(data[key])} onChange={value=>update(key,value as never)} error={fieldErrors[key]}/>;
    if(key==='guardianRelationship')return <label key={key}>{label}<select value={data.guardianRelationship} onChange={e=>update(key,e.target.value)} required><option value="">Select relationship</option>{['Mother','Father','Guardian','Sibling','Aunt','Uncle','Spouse'].map(value=><option key={value}>{value}</option>)}</select>{fieldErrors[key]?<span className="field-error">{fieldErrors[key]}</span>:null}</label>;
    return (
      <label key={key} htmlFor={`agent-${key}`}>
        {label}
        <input
          id={`agent-${key}`}
          type={type}
          required={required}
          value={String(data[key])}
          placeholder={fieldExamples[key]}
          aria-invalid={Boolean(fieldErrors[key])}
          aria-describedby={fieldErrors[key] ? `error-${key}` : undefined}
          onChange={(event) => update(key, event.target.value as never)}
          maxLength={
            key === "nin"
              ? 11
              : key === "address" || key === "businessAddress"
                ? 500
                : 160
          }
          inputMode={key === "nin" ? "numeric" : undefined}
          pattern={key === "nin" ? "[0-9]{11}" : undefined}
          autoComplete={
            key === "nin"
              ? "off"
              : key === "legalName"
                ? "name"
                : key === "phoneE164"
                  ? "tel"
                  : undefined
          }
        />
        {fieldErrors[key] && (
          <span className="field-error" id={`error-${key}`}>
            {fieldErrors[key]}
          </span>
        )}
      </label>
    );
  }
  function validate(currentStep: number): boolean {
    const errors: Record<string, string> = {};
    const requireField = (
      key: keyof FormValues,
      minimum: number,
      message: string,
    ) => {
      if (String(data[key]).trim().length < minimum) errors[key] = message;
    };
    if (currentStep === 0) {
      requireField("legalName", 2, "Enter your full legal name.");
      requireField("displayName", 2, "Enter a public display name.");
      if (ageOnDate(data.birthDate) < 16 || ageOnDate(data.birthDate) > 110)
        errors.birthDate =
          "Check your date of birth. Applicants must be at least 16.";
      if (!phonePattern.test(data.phoneE164))
        errors.phoneE164 = "Use a country code, for example +2348012345678.";
      if (!whatsappSame && !phonePattern.test(data.whatsappPhone))
        errors.whatsappPhone = "Use a valid WhatsApp number with country code.";
      requireField(
        "address",
        10,
        "Add a service contact address of at least 10 characters.",
      );
    }
    if (currentStep === 1) {
      if (!data.universityId)
        errors.universityId = "Choose the university you will serve.";
      requireField("campus", 2, "Enter your campus.");
      requireField("serviceLocation", 2, "Describe the area you can serve.");
      if (data.isStudent) {
        requireField("matricNumber", 2, "Enter your matric number.");
        requireField(
          "department",
          2,
          "Enter your department, including one not yet listed.",
        );
      }
    }
    if (currentStep === 2) {
      requireField(
        "statement",
        20,
        "Write at least 20 characters about the work you plan to offer.",
      );
      if (data.agentType === "VENDOR") {
        requireField("businessName", 2, "Enter the name of your business.");
        requireField("businessAddress", 5, "Enter the business location.");
        if (!data.businessCategories.length)
          errors.businessCategories = "Choose a business category.";
      }
      if (data.agentType === "TUTOR") {
        if (!data.tutorSubjects.length)
          errors.tutorSubjects = "Add at least one subject or course.";
        if (!data.tutorLevels.length)
          errors.tutorLevels = "Add at least one level or cohort.";
        requireField(
          "experience",
          10,
          "Describe your teaching background and evidence.",
        );
      }
    }
    if (currentStep === 3) {
      if (!/^\d{11}$/.test(data.nin))
        errors.nin = "Enter your eleven-digit NIN.";
      if (data.agentType === "VENDOR" && !data.businessDocumentIds.length)
        errors.businessDocumentIds =
          "Upload school or business evidence. CAC registration is optional.";
      for (const key of [
        "identityDocumentId",
        "portraitDocumentId",
        ...(data.isStudent ? ["studentDocumentId"] : []),
      ])
        if (!data[key as keyof FormValues])
          errors[key] = "Add this evidence before continuing.";
      if (data.agentType === "RIDER" && !data.riderDocumentIds.length)
        errors.riderDocumentIds = "Add bike or operating evidence.";
      requireField(
        "emergencyContactName",
        2,
        "Enter an emergency contact name.",
      );
      if (!phonePattern.test(data.emergencyContactPhone))
        errors.emergencyContactPhone = "Use a phone number with country code.";
      if (ageOnDate(data.birthDate) < 18) {
        requireField("guardianName", 2, "Enter a guardian name.");
        requireField("guardianRelationship", 2, "Describe your relationship.");
        if (!phonePattern.test(data.guardianPhone))
          errors.guardianPhone = "Use a phone number with country code.";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.guardianEmail))
          errors.guardianEmail = "Enter a valid guardian email.";
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length)
      setError("Please correct the highlighted details.");
    return !Object.keys(errors).length;
  }
  function values() {
    return {
      ...data,
      displayName:
        data.agentType === "VENDOR"
          ? data.businessName || data.displayName
          : data.displayName,
      whatsappPhone: whatsappSame ? data.phoneE164 : data.whatsappPhone,
    };
  }
  async function saveDraft(nextStep = step) {
    const response = await portalApi<{ draft: { updated_at: string } }>(
      "/v1/applications/draft",
      {
        method: "PUT",
        body: JSON.stringify({ step: nextStep, values: values() }),
      },
    );
    setSavedAt(response.draft.updated_at);
  }
  async function saveForLater() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await saveDraft();
      setNotice(
        "Application saved. Sign in with the same account to continue.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Your draft could not be saved. Your entries are still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function upload(key: keyof FormValues, file?: File) {
    if (!file || busy) return false;
    if (
      !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
        file.type,
      ) ||
      (key === "portraitDocumentId" && !file.type.startsWith("image/"))
    ) {
      setFieldErrors((current) => ({
        ...current,
        [key]: "Choose a JPG, PNG, WebP or supported PDF.",
      }));
      return false;
    }
    if (file.size > 10 * 1024 * 1024) {
      setFieldErrors((current) => ({
        ...current,
        [key]: "Choose a file smaller than 10 MB.",
      }));
      return false;
    }
    setBusy(true);
    setError("");
    setNotice(`Uploading ${file.name}…`);
    try {
      const body = new FormData();
      body.append("kind", "kyc");
      body.append("file", file);
      const uploaded = await portalApi<Upload>("/v1/media", {
        method: "POST",
        body,
      });
      update(
        key,
        (key === "riderDocumentIds"
          ? [...data.riderDocumentIds, uploaded.id].slice(-6)
          : key === "businessDocumentIds"
            ? [...data.businessDocumentIds, uploaded.id].slice(-4)
            : uploaded.id) as never,
      );
      setNotice(
        "Evidence uploaded privately. Save this step to keep it in your application.",
      );
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Upload failed. Choose the file to retry.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (busy) return;
    if (!validate(step)) return;
    if (step === 4) {
      for (let index = 0; index < 4; index++)
        if (!validate(index)) {
          setStep(index);
          requestAnimationFrame(() => heading.current?.focus());
          return;
        }
      if (!privateIdentityReady) {
        setNotice(
          "Private identity submission is being connected. Your application can be saved for later.",
        );
        return;
      }
    }
    setBusy(true);
    try {
      if (step < 4) {
        await saveDraft(step + 1);
        setStep((current) => current + 1);
        requestAnimationFrame(() => heading.current?.focus());
      } else {
        if (!terms) {
          setError("Read and accept the agent terms before submitting.");
          return;
        }
        await saveDraft();
        await portalApi("/v1/applications", {
          method: "POST",
          body: JSON.stringify({
            ...values(),
            guardianEmail: data.guardianEmail || undefined,
            studentDocumentId: data.isStudent
              ? data.studentDocumentId
              : undefined,
            acceptedAgentTerms: true,
            termsAccepted: true,
            termsVersion,
          }),
        });
        setSubmitted(true);
        setSavedAt(null);
        void portalApi<{ applications: Application[] }>("/v1/applications")
          .then((response) => setApplications(response.applications))
          .catch(() => undefined);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save your application. Your information is still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  function document(key: keyof FormValues, title: string) {
    const multiple =
      key === "riderDocumentIds" || key === "businessDocumentIds";
    const count = multiple ? (data[key] as string[]).length : data[key] ? 1 : 0;
    return (
      <div className="document-upload" key={key}>
        <label>
          {title}
          <input
            type="file"
            accept={
              key === "portraitDocumentId"
                ? "image/jpeg,image/png,image/webp"
                : "image/jpeg,image/png,image/webp,application/pdf"
            }
            disabled={
              busy ||
              (multiple && count >= (key === "riderDocumentIds" ? 6 : 4))
            }
            onChange={(event) => {
              void upload(key, event.target.files?.[0]).then((saved) => {
                if (saved && key === "portraitDocumentId")
                  update("portraitSource", "UPLOAD");
              });
              event.target.value = "";
            }}
          />
          <span>
            {count
              ? `${count} file${count > 1 ? "s" : ""} added`
              : "JPG, PNG, WebP or PDF · up to 10 MB"}
          </span>
          {fieldErrors[key] && (
            <span className="field-error">{fieldErrors[key]}</span>
          )}
        </label>
        {multiple &&
          (data[key] as string[]).map((mediaId, index) => (
            <div className="button-row" key={mediaId}>
              <span>Evidence {index + 1}</span>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() =>
                  update(
                    key,
                    (data[key] as string[]).filter(
                      (id) => id !== mediaId,
                    ) as never,
                  )
                }
              >
                Remove from application
              </button>
            </div>
          ))}
      </div>
    );
  }
  return (
    <PortalShell
      active="agents"
      eyebrow=""
      title="Agent application"
      description="Vendor, tutor or rider — complete one step at a time."
    >
      {loading ? (
        <div className="table-skeleton" aria-label="Loading your application">
          <div />
          <div />
          <div />
        </div>
      ) : error && !schools.length ? (
        <section className="state-panel state-panel--error">
          <h2>Application unavailable</h2>
          <p>{error}</p>
          <button
            className="button button--secondary"
            onClick={() => setVersion((current) => current + 1)}
          >
            Try again
          </button>
        </section>
      ) : (
        <div className="application-layout">
          <aside className="application-art">
            <AgentApplicationIllustration complete={submitted} step={step} />
            <ol>
              {steps.map((label, index) => (
                <li
                  key={label}
                  aria-current={
                    step === index && !submitted ? "step" : undefined
                  }
                >
                  <span>{index < step || submitted ? "✓" : index + 1}</span>
                  {label}
                </li>
              ))}
            </ol>
          </aside>
          <section className="application-form">
            {notice && (
              <p className="workspace-notice" role="status">
                {notice}
              </p>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {submitted ? (
              <section className="application-success">
                <AgentApplicationIllustration complete />
                <h2>Application received</h2>
                <p>
                  Your application is under review. A confirmation email has
                  been queued for your KampusOne email.
                </p>
                <button
                  className="button button--secondary"
                  onClick={() => {
                    setData({
                      ...initial,
                      clientRequestId: crypto.randomUUID(),
                      universityId: user?.universityId ?? "",
                    });
                    setTerms(false);
                    setStep(0);
                    setSubmitted(false);
                    setNotice("");
                  }}
                >
                  Apply for another role
                </button>
              </section>
            ) : (
              <form className="form-stack" onSubmit={submit} noValidate>
                <header>
                  <p className="eyebrow">
                    Step {step + 1} of {steps.length}
                  </p>
                  <h2 ref={heading} tabIndex={-1}>
                    {steps[step]}
                  </h2>
                  <p className="field-help">
                    {user?.email}
                    {savedAt
                      ? ` · Saved ${new Date(savedAt).toLocaleTimeString()}`
                      : ""}
                  </p>
                </header>
                <fieldset className="wizard-step" key={step} disabled={busy}>
                  {step === 0 && (
                    <>
                      {field("legalName", "Full legal name")}
                      {field("displayName", "Public display name")}
                      {field("birthDate", "Date of birth", "date")}
                      {field("phoneE164", "Phone with country code", "tel")}
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={whatsappSame}
                          onChange={(event) =>
                            setWhatsappSame(event.target.checked)
                          }
                        />
                        WhatsApp uses this phone number
                      </label>
                      {!whatsappSame &&
                        field(
                          "whatsappPhone",
                          "WhatsApp with country code",
                          "tel",
                        )}
                      {field("address", "Contact address")}
                    </>
                  )}
                  {step === 1 && (
                    <>
                      <label>
                        University
                        <select
                          required
                          value={data.universityId}
                          disabled={Boolean(user?.universityId)}
                          aria-invalid={Boolean(fieldErrors.universityId)}
                          onChange={(event) =>
                            update("universityId", event.target.value)
                          }
                        >
                          <option value="">Choose a university</option>
                          {schools.map((school) => (
                            <option key={school.id} value={school.id}>
                              {school.name}
                            </option>
                          ))}
                        </select>
                        {fieldErrors.universityId && (
                          <span className="field-error">
                            {fieldErrors.universityId}
                          </span>
                        )}
                      </label>
                      {field("campus", "Campus")}
                      {field(
                        "serviceLocation",
                        "Campus / off-campus area you serve",
                      )}
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={data.isStudent}
                          onChange={(event) =>
                            update("isStudent", event.target.checked)
                          }
                        />
                        I am a student
                      </label>
                      {data.isStudent && (
                        <>
                          {field("matricNumber", "Matric number")}
                          {field("department", "Department")}
                          <p className="field-help">
                            If your department is not in the catalogue, enter
                            its full name for review.
                          </p>
                        </>
                      )}
                    </>
                  )}
                  {step === 2 && (
                    <>
                      <label>
                        Apply as
                        <select
                          value={data.agentType}
                          onChange={(event) =>
                            update("agentType", event.target.value)
                          }
                        >
                          <option value="VENDOR">Vendor</option>
                          <option value="TUTOR">Tutor</option>
                          <option value="RIDER">Rider</option>
                        </select>
                      </label>
                      {data.agentType === "VENDOR" && (
                        <>
                          {field(
                            "businessName",
                            "Business / public store name",
                          )}
                          {field("businessAddress", "Business location")}
                          <fieldset className="agent-category-options">
                            <legend>Business category</legend>
                            {businessCategories.map((category) => (
                              <label className="checkbox" key={category}>
                                <input
                                  type="checkbox"
                                  checked={data.businessCategories.includes(
                                    category,
                                  )}
                                  onChange={(event) =>
                                    update(
                                      "businessCategories",
                                      event.target.checked
                                        ? [...data.businessCategories, category]
                                        : data.businessCategories.filter(
                                            (value) => value !== category,
                                          ),
                                    )
                                  }
                                />
                                {category}
                              </label>
                            ))}
                            {fieldErrors.businessCategories && (
                              <span className="field-error">
                                {fieldErrors.businessCategories}
                              </span>
                            )}
                          </fieldset>
                          <label>
                            Campus selling permission
                            <select
                              value={data.campusPermission}
                              onChange={(event) =>
                                update("campusPermission", event.target.value)
                              }
                            >
                              <option value="GRANTED">
                                Permission granted
                              </option>
                              <option value="NOT_REQUIRED">
                                Not required for this location
                              </option>
                              <option value="REVIEW">
                                I need a reviewer to confirm
                              </option>
                            </select>
                          </label>
                        </>
                      )}
                      {data.agentType === "TUTOR" && (
                        <>
                          <label>
                            Subjects / course codes, one per line
                            <textarea
                              required
                              value={data.tutorSubjects.join("\n")}
                              onChange={(event) =>
                                update(
                                  "tutorSubjects",
                                  event.target.value.split("\n"),
                                )
                              }
                              onBlur={() =>
                                update(
                                  "tutorSubjects",
                                  data.tutorSubjects
                                    .map((item) => item.trim())
                                    .filter(Boolean),
                                )
                              }
                            />
                            {fieldErrors.tutorSubjects && (
                              <span className="field-error">
                                {fieldErrors.tutorSubjects}
                              </span>
                            )}
                          </label>
                          <p className="field-help">
                            A subject not yet listed can be entered by its full
                            name for review.
                          </p>
                          <fieldset>
                            <legend>Levels / cohorts</legend>
                            {[
                              "100",
                              "200",
                              "300",
                              "400",
                              "500",
                              "600",
                              "Pre-degree",
                              "Postgraduate",
                            ].map((level) => (
                              <label className="checkbox" key={level}>
                                <input
                                  type="checkbox"
                                  checked={data.tutorLevels.includes(level)}
                                  onChange={(event) =>
                                    update(
                                      "tutorLevels",
                                      event.target.checked
                                        ? [...data.tutorLevels, level]
                                        : data.tutorLevels.filter(
                                            (value) => value !== level,
                                          ),
                                    )
                                  }
                                />
                                {level}
                              </label>
                            ))}
                          </fieldset>
                          <label>
                            Additional levels / cohorts, separated by commas
                            <input
                              value={data.tutorLevels.join(",")}
                              onChange={(event) =>
                                update(
                                  "tutorLevels",
                                  event.target.value.split(","),
                                )
                              }
                              onBlur={() =>
                                update(
                                  "tutorLevels",
                                  data.tutorLevels
                                    .map((item) => item.trim())
                                    .filter(Boolean),
                                )
                              }
                            />
                            {fieldErrors.tutorLevels && (
                              <span className="field-error">
                                {fieldErrors.tutorLevels}
                              </span>
                            )}
                          </label>
                          <label>
                            Teaching background & qualifications
                            <textarea
                              required
                              value={data.experience}
                              maxLength={2000}
                              onChange={(event) =>
                                update("experience", event.target.value)
                              }
                            />
                            {fieldErrors.experience && (
                              <span className="field-error">
                                {fieldErrors.experience}
                              </span>
                            )}
                          </label>
                        </>
                      )}
                      {data.agentType === "RIDER" && (
                        <p className="field-help">
                          Describe your riding experience and service area. You
                          will add bike and operating evidence in the next step.
                        </p>
                      )}
                      <label>
                        {data.agentType === "TUTOR"
                          ? "Why would you like to teach on KampusOne?"
                          : "About your work"}
                        <textarea
                          required
                          minLength={20}
                          maxLength={1000}
                          value={data.statement}
                          onChange={(event) =>
                            update("statement", event.target.value)
                          }
                        />
                        {fieldErrors.statement && (
                          <span className="field-error">
                            {fieldErrors.statement}
                          </span>
                        )}
                      </label>
                    </>
                  )}
                  {step === 3 && (
                    <>
                      <p className="field-help">
                        Evidence is private and used by authorized reviewers to
                        check this application.
                      </p>
                      {document("identityDocumentId", "Identity document")}
                      <AgentFaceCapture
                        hasPortrait={Boolean(data.portraitDocumentId)}
                        disabled={busy}
                        onUpload={async (file) => {
                          const saved = await upload(
                            "portraitDocumentId",
                            file,
                          );
                          if (saved) update("portraitSource", "CAMERA");
                          return saved;
                        }}
                      />
                      {field("nin", "NIN (11 digits)")}
                      <p className="field-help">
                        Your NIN is encrypted, stays private and is reviewed
                        separately. Providing a number or a photograph does not
                        verify your identity.
                      </p>
                      {data.agentType === "VENDOR" && (
                        <>
                          {document(
                            "businessDocumentIds",
                            "School or business documents (CAC optional)",
                          )}
                          {data.studentDocumentId && (
                            <label className="checkbox">
                              <input
                                type="checkbox"
                                checked={data.businessDocumentIds.includes(
                                  data.studentDocumentId,
                                )}
                                onChange={(event) =>
                                  update(
                                    "businessDocumentIds",
                                    event.target.checked
                                      ? [
                                          ...new Set([
                                            ...data.businessDocumentIds,
                                            data.studentDocumentId,
                                          ]),
                                        ]
                                      : data.businessDocumentIds.filter(
                                          (id) => id !== data.studentDocumentId,
                                        ),
                                  )
                                }
                              />
                              Use my student evidence as school/business
                              evidence
                            </label>
                          )}
                        </>
                      )}
                      {data.isStudent &&
                        document(
                          "studentDocumentId",
                          "Student ID / student evidence",
                        )}
                      {data.agentType === "RIDER" &&
                        document(
                          "riderDocumentIds",
                          "Bike image and operating documents",
                        )}
                      {field("emergencyContactName", "Emergency contact name")}
                      {field(
                        "emergencyContactPhone",
                        "Emergency contact with country code",
                        "tel",
                      )}
                      {ageOnDate(data.birthDate) < 18 && (
                        <>
                          {field("guardianName", "Guardian name")}
                          {field("guardianPhone", "Guardian phone", "tel")}
                          {field("guardianEmail", "Guardian email", "email")}
                          {field(
                            "guardianRelationship",
                            "Relationship to guardian",
                          )}
                        </>
                      )}
                    </>
                  )}
                  {step === 4 && (
                    <>
                      <dl className="application-review">
                        <dt>Legal / public name</dt>
                        <dd>
                          {data.legalName} / {data.displayName}
                        </dd>
                        <dt>Role</dt>
                        <dd>{data.agentType.toLowerCase()}</dd>
                        <dt>University</dt>
                        <dd>
                          {schools.find(
                            (school) => school.id === data.universityId,
                          )?.name ?? "Selected university"}
                        </dd>
                        <dt>Campus / area</dt>
                        <dd>
                          {data.campus} · {data.serviceLocation}
                        </dd>
                        <dt>Contact</dt>
                        <dd>{data.phoneE164}</dd>
                        <dt>About your work</dt>
                        <dd>{data.statement}</dd>
                        <dt>Business categories</dt>
                        <dd>
                          {data.businessCategories.join(", ") ||
                            "Not applicable"}
                        </dd>
                        <dt>Private identity</dt>
                        <dd>
                          NIN ending {data.nin.slice(-4)} · portrait{" "}
                          {data.portraitDocumentId ? "uploaded" : "missing"}
                        </dd>
                      </dl>
                      <details
                        open={termsOpen}
                        onToggle={(event) =>
                          setTermsOpen(event.currentTarget.open)
                        }
                      >
                        <summary>Agent terms · {termsVersion}</summary>
                        <div className="agent-terms">
                          <h3>Accurate information and review</h3>
                          <p>
                            Submit your own identity evidence and truthful
                            details. Authorized reviewers may request
                            corrections. Approval is separate from public
                            badges, publishing capabilities and payout
                            eligibility.
                          </p>
                          <h3>Eligibility and safety</h3>
                          <p>
                            Applicants must be at least 16. A guardian must
                            independently approve participation for applicants
                            under 18. Keep your account private and follow
                            university and service rules.
                          </p>
                          <h3>Selling and the free period</h3>
                          <p>
                            New eligible sellers may claim a twelve-month store
                            trial after approval. The account records the actual
                            claim and expiry dates. Commission may apply; the
                            trial does not activate automatic paid billing or
                            reset when you sign in again.
                          </p>
                          <h3>Orders and earnings</h3>
                          <p>
                            Describe services accurately, fulfil commitments and
                            respond to disputes. Payouts require approved
                            identity and verified payout details. Refunds and
                            review holds can affect available earnings.
                          </p>
                          <h3>Privacy and support</h3>
                          <p>
                            Identity documents and bank details are not public
                            profile information. Request corrections or account
                            assistance through KampusOne support. Operational,
                            safety and payment records are retained as required
                            by platform policy.
                          </p>
                        </div>
                      </details>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={data.publishContacts}
                          onChange={(event) =>
                            update("publishContacts", event.target.checked)
                          }
                        />
                        Publish my phone and WhatsApp on my approved business
                        profile. I can change them later.
                      </label>
                      {!privateIdentityReady && (
                        <p className="workspace-notice" role="status">
                          Private identity submission is being connected. Save
                          your application and return shortly.
                        </p>
                      )}
                      <label className="checkbox">
                        <input
                          required
                          type="checkbox"
                          checked={terms}
                          onChange={(event) => setTerms(event.target.checked)}
                        />
                        I have reviewed and accept the agent terms, version{" "}
                        {termsVersion}.
                      </label>
                    </>
                  )}
                </fieldset>
                <div className="form-actions">
                  {step > 0 && (
                    <button
                      type="button"
                      className="button button--secondary"
                      disabled={busy}
                      onClick={() => {
                        setStep((current) => current - 1);
                        setError("");
                        setFieldErrors({});
                      }}
                    >
                      Back
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => void saveForLater()}
                  >
                    Save for later
                  </button>
                  <button
                    className="button button--primary"
                    disabled={
                      busy || (step === 4 && (!terms || !privateIdentityReady))
                    }
                  >
                    {busy
                      ? "Saving…"
                      : step === 4
                        ? "Submit application"
                        : "Continue"}
                  </button>
                </div>
              </form>
            )}
            <section className="application-history">
              <h2>Your applications</h2>
              {!applications.length && (
                <p className="muted">
                  Your submitted applications will appear here.
                </p>
              )}
              {applications.map((application) => (
                <div className="application-history__row" key={application.id}>
                  <div>
                    <strong>{application.display_name}</strong>
                    <p>
                      {application.agent_type.toLowerCase()} ·{" "}
                      {application.status.replaceAll("_", " ").toLowerCase()}
                    </p>
                    {application.university_name && (
                      <p>{application.university_name}</p>
                    )}
                    {application.review_note && (
                      <p>{application.review_note}</p>
                    )}
                  </div>
                  {application.status === "APPROVED" && (
                    <div className="form-actions">
                      <Link
                        className="button button--secondary"
                        href="/agents/dashboard"
                      >
                        Open dashboard
                      </Link>
                      {application.bank_status !== "VERIFIED" && (
                        <Link
                          className="button button--primary"
                          href="/agents/payouts"
                        >
                          Set up payouts
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </section>
          </section>
        </div>
      )}
    </PortalShell>
  );
}
