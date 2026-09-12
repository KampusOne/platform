"use client";

import Image from "next/image";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { PortalShell } from "@/components/portal-shell";
import { PortalApiError, portalApi } from "@/lib/api";

type Scalar = string | number | null;
type AgentApplication = {
  id: string;
  agent_type: "TUTOR" | "VENDOR" | "RIDER";
  display_name: string;
  phone_e164: string;
  legal_name?: string;
  kyc_status?: string;
  bank_status?: string;
  phone_verified_at?: string | null;
  status: string;
  review_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
};
type AgentProfile = {
  id: string;
  agent_type: "TUTOR" | "VENDOR" | "RIDER";
  display_name: string;
  biography: string | null;
  status: string;
  verified_at: string;
};
type Dashboard = {
  applications: AgentApplication[];
  profiles: AgentProfile[];
  metrics: {
    tutorials: {
      listings: Scalar;
      bookings: Scalar;
      completed: Scalar;
      gross_revenue_kobo: Scalar;
      pending_earnings_kobo: Scalar;
      available_earnings_kobo: Scalar;
    };
    store: {
      products: Scalar;
      orders: Scalar;
      delivered: Scalar;
      gross_revenue_kobo: Scalar;
      pending_earnings_kobo: Scalar;
      available_earnings_kobo: Scalar;
    };
    deliveries: {
      jobs: Scalar;
      delivered: Scalar;
      active: Scalar;
      pending_earnings_kobo: Scalar;
      available_earnings_kobo: Scalar;
    };
  };
  activity: {
    bookings: Array<{
      id: string;
      title: string;
      status: string;
      amount_kobo: Scalar;
      scheduled_for: string | null;
      created_at: string;
    }>;
    orders: Array<{
      id: string;
      status: string;
      subtotal_kobo: Scalar;
      delivery_fee_kobo: Scalar;
      total_kobo: Scalar;
      created_at: string;
    }>;
  };
};
type Catalog = {
  universities: Array<{ id: string; name: string; slug: string }>;
};
type Tutorial = {
  id: string;
  course_code: string;
  title: string;
  description: string;
  format: string;
  price_kobo: Scalar;
  capacity: Scalar;
  status: string;
  location_text: string | null;
  cancellation_cutoff_hours: Scalar;
  review_status: string;
  review_note: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  updated_at: string;
};
type TutorialResource = {
  id: string;
  listing_id: string | null;
  course_code: string;
  title: string;
  description: string;
  resource_type: string;
  access_model: string;
  price_kobo: Scalar;
  level_code: string | null;
  batch_label: string | null;
  preview_text: string | null;
  file_url: string | null;
  page_count: Scalar;
  duration_seconds: Scalar;
  status: string;
  review_note: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  updated_at: string;
};
type TutorialWindow = {
  id: string;
  listing_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  capacity: Scalar;
  status: string;
  bookings: Scalar;
};
type TutorialBooking = {
  id: string;
  status: string;
  amount_kobo: Scalar;
  scheduled_for: string | null;
  completion_available_at: string | null;
  completion_available: boolean;
  student_confirmed_at: string | null;
  tutor_confirmed_at: string | null;
  created_at: string;
  course_code: string;
  title: string;
  student_name: string;
};
type Product = {
  id: string;
  name: string;
  description: string;
  category: string;
  price_kobo: Scalar;
  stock_quantity: Scalar;
  image_url: string | null;
  status: string;
  updated_at: string;
};
type VendorOrder = {
  id: string;
  status: string;
  subtotal_kobo: Scalar;
  delivery_fee_kobo: Scalar;
  total_kobo: Scalar;
  delivery_note: string | null;
  zone_name: string | null;
  item_count: Scalar;
  created_at: string;
  updated_at: string;
};
type Delivery = {
  id: string;
  order_id: string;
  zone_name: string;
  status: string;
  rider_earning_kobo: Scalar;
  earning_formula_version: string;
  reserved_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  created_at: string;
};
type EarningsBucket = {
  pending_kobo: Scalar;
  available_kobo: Scalar;
  reserved_kobo: Scalar;
  withdrawn_kobo: Scalar;
};
type Earnings = {
  tutorials: EarningsBucket;
  store: EarningsBucket;
  deliveries: EarningsBucket;
  payoutRequests: Array<{
    id: string;
    amount_kobo: Scalar;
    status: string;
    requested_at: string;
    agent_type: string;
    display_name: string;
  }>;
};
type View =
  | "overview"
  | "apply"
  | "tutorials"
  | "store"
  | "deliveries"
  | "earnings";

const money = (value: Scalar) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0) / 100);
const number = (value: Scalar) =>
  new Intl.NumberFormat("en-NG").format(Number(value ?? 0));
const label = (value: string) =>
  value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-NG", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";

export function AgentDashboard() {
  const [view, setView] = useState<View>("overview");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [catalog, setCatalog] = useState<Catalog>({ universities: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => {
    setLoading(true);
    setError("");
    setRefreshKey((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      portalApi<Dashboard>("/v1/agents/dashboard"),
      portalApi<Catalog>("/v1/student/catalog"),
    ])
      .then(([nextDashboard, nextCatalog]) => {
        if (active) {
          setDashboard(nextDashboard);
          setCatalog(nextCatalog);
          if (
            nextDashboard.applications.length === 0 &&
            nextDashboard.profiles.length === 0
          ) {
            setView("apply");
          }
        }
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof PortalApiError
              ? caught.message
              : "The agent workspace could not load.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const gross =
    Number(dashboard?.metrics.tutorials.gross_revenue_kobo ?? 0) +
    Number(dashboard?.metrics.store.gross_revenue_kobo ?? 0);
  return (
    <PortalShell
      active="agents"
      eyebrow="Agent workspace · Verified accounts"
      title="Your campus business desk"
      description="Apply, publish services, track orders and bookings, and complete assigned deliveries from one accountable workspace."
      actions={
        <button className="button button--secondary" onClick={reload}>
          Refresh data
        </button>
      }
    >
      <nav className="section-tabs" aria-label="Agent sections">
        {(
          [
            "overview",
            "apply",
            "tutorials",
            "store",
            "deliveries",
            "earnings",
          ] as View[]
        ).map((item) => (
          <button
            key={item}
            aria-current={view === item ? "page" : undefined}
            onClick={() => setView(item)}
          >
            {item === "apply" ? "Applications" : label(item)}
          </button>
        ))}
      </nav>
      {loading && (
        <section className="state-panel">
          <span className="spinner" />
          <strong>Loading your workspace…</strong>
        </section>
      )}
      {!loading && error && (
        <section className="state-panel state-panel--error">
          <strong>Workspace unavailable</strong>
          <p>{error}</p>
          <button className="button button--secondary" onClick={reload}>
            Try again
          </button>
        </section>
      )}
      {!loading && !error && dashboard && view === "overview" && (
        <AgentOverview dashboard={dashboard} gross={gross} setView={setView} />
      )}
      {!loading && !error && dashboard && view === "apply" && (
        <Applications
          dashboard={dashboard}
          catalog={catalog}
          onChanged={reload}
        />
      )}
      {!loading && !error && view === "tutorials" && (
        <>
          <TutorialWorkspace onChanged={reload} />
          <TutorialResourcesPanel onChanged={reload} />
          <TutorialBookingPanel onChanged={reload} />
        </>
      )}
      {!loading && !error && view === "store" && (
        <StoreWorkspace onChanged={reload} />
      )}
      {!loading && !error && view === "deliveries" && (
        <DeliveryWorkspace onChanged={reload} />
      )}
      {!loading && !error && dashboard && view === "earnings" && (
        <EarningsWorkspace profiles={dashboard.profiles} />
      )}
    </PortalShell>
  );
}

function AgentOverview({
  dashboard,
  gross,
  setView,
}: {
  dashboard: Dashboard;
  gross: number;
  setView(view: View): void;
}) {
  const activeProfiles = new Set(
    dashboard.profiles
      .filter((profile) => profile.status === "ACTIVE")
      .map((profile) => profile.agent_type),
  );
  return (
    <>
      <section className="metric-grid">
        <article className="metric-card metric-card--accent">
          <span>Gross earnings activity</span>
          <strong>{money(gross)}</strong>
          <small>Paid or completed bookings and qualifying orders</small>
        </article>
        <article className="metric-card">
          <span>Tutorial bookings</span>
          <strong>{number(dashboard.metrics.tutorials.bookings)}</strong>
          <small>
            {number(dashboard.metrics.tutorials.completed)} completed
          </small>
        </article>
        <article className="metric-card">
          <span>Store orders</span>
          <strong>{number(dashboard.metrics.store.orders)}</strong>
          <small>{number(dashboard.metrics.store.delivered)} delivered</small>
        </article>
        <article className="metric-card">
          <span>Active deliveries</span>
          <strong>{number(dashboard.metrics.deliveries.active)}</strong>
          <small>
            {number(dashboard.metrics.deliveries.delivered)} completed jobs
          </small>
        </article>
      </section>
      <section className="dashboard-grid">
        <article className="panel agent-hero">
          <div>
            <p className="section-kicker">Agent status</p>
            <h2>
              {activeProfiles.size
                ? `${activeProfiles.size} active role${activeProfiles.size === 1 ? "" : "s"}`
                : "Start with a verified application"}
            </h2>
            <p>
              Roles unlock only after an administrator reviews your identity and
              evidence. One account can apply separately as a tutor, vendor, or
              rider.
            </p>
            <div className="role-chips">
              {(["TUTOR", "VENDOR", "RIDER"] as const).map((role) => (
                <span
                  className={
                    activeProfiles.has(role)
                      ? "role-chip role-chip--active"
                      : "role-chip"
                  }
                  key={role}
                >
                  {activeProfiles.has(role) ? "✓ " : ""}
                  {label(role)}
                </span>
              ))}
            </div>
            <button
              className="button button--primary"
              onClick={() => setView("apply")}
            >
              Manage applications
            </button>
          </div>
          <Image
            src="/brand-scenes/tutorials.png"
            alt="Students learning together with KampusOne"
            width={1024}
            height={1024}
          />
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Your applications</p>
              <h2>Review status</h2>
            </div>
          </div>
          {dashboard.applications.length ? (
            <div className="application-cards">
              {dashboard.applications.map((application) => (
                <div key={application.id}>
                  <span
                    className={`state-badge state-badge--${application.status === "APPROVED" ? "live" : application.status === "SUBMITTED" ? "pending" : "attention"}`}
                  >
                    {label(application.status)}
                  </span>
                  <strong>{label(application.agent_type)}</strong>
                  <small>Submitted {date(application.submitted_at)}</small>
                  {application.review_note && <p>{application.review_note}</p>}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-row">
              <strong>No application submitted</strong>
              <span>Apply from this workspace when you are ready.</span>
            </div>
          )}
        </article>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Business activity</p>
            <h2>Recent bookings and orders</h2>
          </div>
        </div>
        <div className="activity-grid">
          <div>
            <h3>Tutorials</h3>
            {dashboard.activity.bookings.length ? (
              dashboard.activity.bookings.map((booking) => (
                <div className="activity-row" key={booking.id}>
                  <span>
                    <strong>{booking.title}</strong>
                    <small>{date(booking.created_at)}</small>
                  </span>
                  <span>
                    <strong>{money(booking.amount_kobo)}</strong>
                    <small>{label(booking.status)}</small>
                  </span>
                </div>
              ))
            ) : (
              <div className="empty-row">
                <span>No bookings yet.</span>
              </div>
            )}
          </div>
          <div>
            <h3>Store</h3>
            {dashboard.activity.orders.length ? (
              dashboard.activity.orders.map((order) => (
                <div className="activity-row" key={order.id}>
                  <span>
                    <strong>Order #{order.id.slice(0, 8)}</strong>
                    <small>{date(order.created_at)}</small>
                  </span>
                  <span>
                    <strong>{money(order.total_kobo)}</strong>
                    <small>{label(order.status)}</small>
                  </span>
                </div>
              ))
            ) : (
              <div className="empty-row">
                <span>No orders yet.</span>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function Applications({
  dashboard,
  catalog,
  onChanged,
}: {
  dashboard: Dashboard;
  catalog: Catalog;
  onChanged(): void;
}) {
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await portalApi("/v1/agents/applications", {
        method: "POST",
        body: JSON.stringify({
          universityId: form.get("universityId"),
          agentType: form.get("agentType"),
          displayName: form.get("displayName"),
          phoneE164: form.get("phoneE164"),
          statement: form.get("statement"),
          legalName: form.get("legalName"),
          address: form.get("address"),
          emergencyContactName: form.get("emergencyContactName"),
          emergencyContactPhone: form.get("emergencyContactPhone"),
          acceptedAgentTerms: form.get("acceptedAgentTerms") === "on",
          termsVersion: "2026-09-10",
        }),
      });
      setNotice("Your application was submitted for identity and role review.");
      formElement.reset();
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof PortalApiError
          ? caught.message
          : "Application could not be submitted.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="dashboard-grid dashboard-grid--content">
      <article className="panel content-intro">
        <Image
          src="/brand-scenes/rider.png"
          alt="Campus delivery rider illustration"
          width={1024}
          height={1024}
        />
        <div>
          <p className="section-kicker">Verified work</p>
          <h2>Choose how you serve campus.</h2>
          <p>
            Tutors teach students, vendors sell campus essentials, and riders
            complete assigned deliveries. Each role has its own review and
            operating boundary.
          </p>
        </div>
        <div className="application-cards">
          {dashboard.applications.map((application) => (
            <div key={application.id}>
              <span
                className={`state-badge state-badge--${application.status === "APPROVED" ? "live" : "pending"}`}
              >
                {label(application.status)}
              </span>
              <strong>{label(application.agent_type)}</strong>
              <small>
                Identity: {label(application.kyc_status ?? "not started")}
              </small>
              {application.review_note && <p>{application.review_note}</p>}
            </div>
          ))}
        </div>
      </article>
      <article className="panel">
        <p className="section-kicker">New application</p>
        <h2>Submit your details</h2>
        <form className="form-stack" onSubmit={submit}>
          <label>
            University
            <select name="universityId" required defaultValue="">
              <option value="" disabled>
                Select your campus
              </option>
              {catalog.universities.map((university) => (
                <option value={university.id} key={university.id}>
                  {university.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            <label>
              Agent role
              <select name="agentType">
                <option value="TUTOR">Tutor</option>
                <option value="VENDOR">Vendor</option>
                <option value="RIDER">Rider</option>
              </select>
            </label>
            <label>
              Public name
              <input
                name="displayName"
                minLength={2}
                maxLength={120}
                required
              />
            </label>
          </div>
          <label>
            Full legal name
            <input
              name="legalName"
              minLength={2}
              maxLength={160}
              autoComplete="name"
              required
            />
          </label>
          <label>
            Residential address
            <textarea
              name="address"
              minLength={10}
              maxLength={500}
              autoComplete="street-address"
              required
            />
          </label>
          <div className="form-grid">
            <label>
              Phone number
              <input
                name="phoneE164"
                type="tel"
                pattern="\+[1-9][0-9]{7,14}"
                placeholder="+2348012345678"
                required
              />
            </label>
            <label>
              Emergency contact name
              <input name="emergencyContactName" minLength={2} required />
            </label>
          </div>
          <label>
            Emergency contact phone
            <input
              name="emergencyContactPhone"
              type="tel"
              pattern="\+[1-9][0-9]{7,14}"
              placeholder="+2348012345678"
              required
            />
          </label>
          <label>
            Why should students trust you?
            <textarea
              name="statement"
              minLength={20}
              maxLength={1000}
              required
              placeholder="Describe your experience, campus connection, and how you will fulfil this role."
            />
          </label>
          <label className="checkbox">
            <input type="checkbox" name="acceptedAgentTerms" required /> I
            accept the role rules, prohibited activities, verification, and
            payout terms.
          </label>
          <p className="field-help">
            KampusOne stores provider references and review outcomes—not raw
            NIN/BVN values. Approval is never automatic.
          </p>
          {notice && <p className="form-notice">{notice}</p>}
          {error && <p className="form-error">{error}</p>}
          <button
            className="button button--primary"
            disabled={busy || !catalog.universities.length}
          >
            {busy ? "Submitting…" : "Submit for review"}
          </button>
        </form>
      </article>
    </section>
  );
}

function useWorkspaceData<T>(path: string, key: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PortalApiError | null>(null);
  useEffect(() => {
    let active = true;
    void portalApi<T>(path)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof PortalApiError
              ? caught
              : new PortalApiError(
                  500,
                  "REQUEST_FAILED",
                  "This workspace could not load.",
                ),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [key, path]);
  return { data, loading, error };
}

function WorkspaceGate({ error }: { error: PortalApiError }) {
  return (
    <div className="workspace-gate">
      <strong>
        {error.status === 403 ? "Approval required" : "Workspace unavailable"}
      </strong>
      <p>{error.message}</p>
      <span>Use Applications to submit or correct your agent application.</span>
    </div>
  );
}

function TutorialWorkspace({ onChanged }: { onChanged(): void }) {
  const [key, setKey] = useState(0);
  const { data, loading, error } = useWorkspaceData<{
    listings: Tutorial[];
    bookings: TutorialBooking[];
    resources: TutorialResource[];
  }>("/v1/agents/tutorials", key);
  const availability = useWorkspaceData<{ windows: TutorialWindow[] }>(
    "/v1/agents/tutorial-availability",
    key,
  );
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setFormError("");
    setNotice("");
    try {
      await portalApi("/v1/agents/tutorials", {
        method: "POST",
        body: JSON.stringify({
          courseCode: form.get("courseCode"),
          title: form.get("title"),
          description: form.get("description"),
          format: form.get("format"),
          priceKobo: Math.round(Number(form.get("price")) * 100),
          capacity: Number(form.get("capacity")),
          locationText: form.get("locationText") || null,
          cancellationCutoffHours: Number(form.get("cancellationCutoffHours")),
        }),
      });
      setNotice(
        "Tutorial draft saved. Submit it when it is ready for administrator review.",
      );
      formElement.reset();
      setKey((value) => value + 1);
      onChanged();
    } catch (caught) {
      setFormError(
        caught instanceof PortalApiError
          ? caught.message
          : "Listing could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function changeStatus(
    id: string,
    status: "SUBMITTED" | "PAUSED" | "ARCHIVED",
  ) {
    setBusy(true);
    setFormError("");
    try {
      await portalApi(`/v1/agents/tutorials/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setNotice(
        status === "SUBMITTED"
          ? "Tutorial sent to an administrator for review."
          : `Tutorial ${label(status)}.`,
      );
      setKey((value) => value + 1);
      onChanged();
    } catch (caught) {
      setFormError(
        caught instanceof PortalApiError
          ? caught.message
          : "Status could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function addAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setFormError("");
    try {
      await portalApi("/v1/agents/tutorial-availability", {
        method: "POST",
        body: JSON.stringify({
          listingId: form.get("listingId"),
          startsAt: new Date(String(form.get("startsAt"))).toISOString(),
          endsAt: new Date(String(form.get("endsAt"))).toISOString(),
          capacity: Number(form.get("windowCapacity")),
        }),
      });
      setNotice("Bookable availability window added.");
      formElement.reset();
      setKey((value) => value + 1);
    } catch (caught) {
      setFormError(
        caught instanceof PortalApiError
          ? caught.message
          : "Availability could not be added.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="dashboard-grid dashboard-grid--content">
      <article className="panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Tutorial catalogue</p>
            <h2>Your listings</h2>
          </div>
          <span className="data-label">
            {data?.listings.length ?? 0} listings
          </span>
        </div>
        {loading && (
          <div className="state-panel">
            <span className="spinner" />
          </div>
        )}
        {error && <WorkspaceGate error={error} />}
        {data?.listings.map((item) => (
          <div className="catalog-row catalog-row--actions" key={item.id}>
            <span>
              <strong>
                {item.course_code} · {item.title}
              </strong>
              <small>
                {label(item.format)} · {number(item.capacity)} seats ·{" "}
                {label(item.status)} · Review {label(item.review_status)}
              </small>
              {item.location_text && <small>{item.location_text}</small>}
              {item.review_note && (
                <small>Admin note: {item.review_note}</small>
              )}
            </span>
            <span>
              <strong>{money(item.price_kobo)}</strong>
              <span className="inline-actions">
                {["DRAFT", "REJECTED", "PAUSED"].includes(item.status) && (
                  <button
                    className="text-button"
                    onClick={() => void changeStatus(item.id, "SUBMITTED")}
                  >
                    Submit for review
                  </button>
                )}
                {item.status === "PUBLISHED" && (
                  <button
                    className="text-button"
                    onClick={() => void changeStatus(item.id, "PAUSED")}
                  >
                    Pause
                  </button>
                )}
                <button
                  className="text-button text-button--danger"
                  onClick={() => void changeStatus(item.id, "ARCHIVED")}
                >
                  Archive
                </button>
              </span>
            </span>
          </div>
        ))}
        {data && !data.listings.length && (
          <div className="empty-row">
            <strong>No tutorial listings</strong>
            <span>Create the first one after tutor approval.</span>
          </div>
        )}
        <div className="sub-form">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Bookable schedule</p>
              <h3>Upcoming windows</h3>
            </div>
            <span className="data-label">
              {availability.data?.windows.length ?? 0}
            </span>
          </div>
          <div className="compact-chips">
            {availability.data?.windows.map((window) => (
              <span key={window.id}>
                <strong>{window.title}</strong>
                <small>
                  {date(window.starts_at)} · {number(window.bookings)}/
                  {number(window.capacity)} booked · {label(window.status)}
                </small>
              </span>
            ))}
          </div>
          {availability.data && !availability.data.windows.length && (
            <div className="empty-row">
              <span>Add a future window before students can book.</span>
            </div>
          )}
        </div>
        {formError && <p className="form-error">{formError}</p>}
      </article>
      <article className="panel">
        <p className="section-kicker">New tutorial</p>
        <h2>Build a bookable class</h2>
        <form className="form-stack" onSubmit={submit}>
          <div className="form-grid">
            <label>
              Course code
              <input name="courseCode" required />
            </label>
            <label>
              Format
              <select name="format">
                <option value="IN_PERSON">In person</option>
                <option value="ONLINE">Online</option>
                <option value="HYBRID">Hybrid</option>
              </select>
            </label>
          </div>
          <div className="form-grid">
            <label>
              Location or meeting link note
              <input
                name="locationText"
                maxLength={160}
                placeholder="Faculty library, Room 2"
              />
            </label>
            <label>
              Free cancellation cutoff
              <select name="cancellationCutoffHours" defaultValue="2">
                <option value="0">Until the session starts</option>
                <option value="1">1 hour before</option>
                <option value="2">2 hours before</option>
                <option value="6">6 hours before</option>
                <option value="24">24 hours before</option>
              </select>
            </label>
          </div>
          <label>
            Title
            <input name="title" minLength={3} required />
          </label>
          <label>
            Description
            <textarea name="description" minLength={20} required />
          </label>
          <div className="form-grid">
            <label>
              Price (₦)
              <input name="price" type="number" min="0" step="1" required />
            </label>
            <label>
              Capacity
              <input name="capacity" type="number" min="1" max="500" required />
            </label>
          </div>
          {notice && <p className="form-notice">{notice}</p>}
          <button
            className="button button--primary"
            disabled={busy || Boolean(error)}
          >
            {busy ? "Saving…" : "Save tutorial draft"}
          </button>
        </form>
        {data?.listings.some((item) => item.status === "PUBLISHED") ? (
          <form className="form-stack sub-form" onSubmit={addAvailability}>
            <div>
              <p className="section-kicker">Availability</p>
              <h3>Add a bookable window</h3>
            </div>
            <label>
              Tutorial
              <select name="listingId">
                {data.listings
                  .filter((item) => item.status === "PUBLISHED")
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.course_code} · {item.title}
                    </option>
                  ))}
              </select>
            </label>
            <div className="form-grid">
              <label>
                Starts
                <input type="datetime-local" name="startsAt" required />
              </label>
              <label>
                Ends
                <input type="datetime-local" name="endsAt" required />
              </label>
            </div>
            <label>
              Window capacity
              <input
                type="number"
                name="windowCapacity"
                min="1"
                max="500"
                required
              />
            </label>
            <button className="button button--secondary" disabled={busy}>
              Add availability
            </button>
          </form>
        ) : null}
      </article>
    </section>
  );
}

function TutorialResourcesPanel({ onChanged }: { onChanged(): void }) {
  const [key, setKey] = useState(0);
  const { data, loading, error } = useWorkspaceData<{
    listings: Tutorial[];
    bookings: TutorialBooking[];
    resources: TutorialResource[];
  }>("/v1/agents/tutorials", key);
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");
  const [busyId, setBusyId] = useState("");

  async function createResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusyId("create");
    setFormError("");
    setNotice("");
    try {
      await portalApi("/v1/agents/tutorial-resources", {
        method: "POST",
        body: JSON.stringify({
          listingId: form.get("listingId") || null,
          courseCode: form.get("courseCode"),
          title: form.get("title"),
          description: form.get("description"),
          resourceType: form.get("resourceType"),
          accessModel: form.get("accessModel"),
          priceKobo: 0,
          levelCode: form.get("levelCode") || null,
          batchLabel: form.get("batchLabel") || null,
          previewText: form.get("previewText") || null,
          fileUrl: form.get("fileUrl") || null,
          pageCount: form.get("pageCount")
            ? Number(form.get("pageCount"))
            : null,
          durationSeconds: form.get("durationMinutes")
            ? Math.round(Number(form.get("durationMinutes")) * 60)
            : null,
        }),
      });
      formElement.reset();
      setNotice(
        "Learning material saved as a draft. Submit it when the preview and ownership details are ready.",
      );
      setKey((value) => value + 1);
      onChanged();
    } catch (caught) {
      setFormError(
        caught instanceof PortalApiError
          ? caught.message
          : "The learning material could not be saved.",
      );
    } finally {
      setBusyId("");
    }
  }

  async function changeResource(id: string, status: "SUBMITTED" | "ARCHIVED") {
    setBusyId(id);
    setFormError("");
    setNotice("");
    try {
      await portalApi(`/v1/agents/tutorial-resources/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setNotice(
        status === "SUBMITTED"
          ? "Material sent to an administrator for review."
          : "Material archived.",
      );
      setKey((value) => value + 1);
      onChanged();
    } catch (caught) {
      setFormError(
        caught instanceof PortalApiError
          ? caught.message
          : "The material status could not be changed.",
      );
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="dashboard-grid dashboard-grid--content">
      <article className="panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Academic library</p>
            <h2>Your learning materials</h2>
          </div>
          <span className="data-label">
            {data?.resources?.length ?? 0} materials
          </span>
        </div>
        {loading && (
          <div className="state-panel">
            <span className="spinner" />
          </div>
        )}
        {error && <WorkspaceGate error={error} />}
        {(data?.resources ?? []).map((item) => (
          <div className="catalog-row catalog-row--actions" key={item.id}>
            <span>
              <strong>
                {item.course_code} · {item.title}
              </strong>
              <small>
                {label(item.resource_type)} · {label(item.access_model)} ·{" "}
                {label(item.status)}
              </small>
              {item.review_note && (
                <small>Admin note: {item.review_note}</small>
              )}
            </span>
            <span>
              <strong>
                {item.page_count
                  ? `${number(item.page_count)} pages`
                  : item.duration_seconds
                    ? `${Math.round(Number(item.duration_seconds) / 60)} min`
                    : "Preview"}
              </strong>
              <span className="inline-actions">
                {["DRAFT", "REJECTED"].includes(item.status) && (
                  <button
                    className="text-button"
                    disabled={Boolean(busyId)}
                    onClick={() => void changeResource(item.id, "SUBMITTED")}
                  >
                    Submit for review
                  </button>
                )}{" "}
                {item.status !== "ARCHIVED" && (
                  <button
                    className="text-button text-button--danger"
                    disabled={Boolean(busyId)}
                    onClick={() => void changeResource(item.id, "ARCHIVED")}
                  >
                    Archive
                  </button>
                )}
              </span>
            </span>
          </div>
        ))}
        {data && !(data.resources ?? []).length && (
          <div className="empty-row">
            <strong>No learning materials</strong>
            <span>Add a past question, note, PDF or audiobook preview.</span>
          </div>
        )}
        {notice && (
          <p className="form-notice" role="status">
            {notice}
          </p>
        )}
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
      </article>
      <article className="panel">
        <p className="section-kicker">New material</p>
        <h2>Add a study resource</h2>
        <form className="form-stack" onSubmit={createResource}>
          <div className="form-grid">
            <label>
              Course code
              <input name="courseCode" minLength={2} maxLength={24} required />
            </label>
            <label>
              Type
              <select name="resourceType">
                <option value="PAST_QUESTION">Past question</option>
                <option value="NOTE">Note</option>
                <option value="PDF">PDF</option>
                <option value="AUDIOBOOK">Audiobook</option>
              </select>
            </label>
          </div>
          <label>
            Title
            <input name="title" minLength={3} maxLength={180} required />
          </label>
          <label>
            Description
            <textarea
              name="description"
              minLength={10}
              maxLength={2000}
              required
            />
          </label>
          <div className="form-grid">
            <label>
              Related tutorial (optional)
              <select name="listingId" defaultValue="">
                <option value="">Standalone resource</option>
                {data?.listings.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.course_code} · {item.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Access
              <select name="accessModel" defaultValue="FREE">
                <option value="FREE">Free</option>
                <option value="BOOKING_INCLUDED">Included with booking</option>
              </select>
            </label>
          </div>
          <div className="form-grid">
            <label>
              Level (optional)
              <input name="levelCode" placeholder="200 LEVEL" />
            </label>
            <label>
              Session or batch
              <input name="batchLabel" placeholder="2024/2025" />
            </label>
          </div>
          <label>
            Preview text
            <textarea
              name="previewText"
              maxLength={5000}
              placeholder="Add a useful sample students can read before opening the material."
            />
          </label>
          <label>
            File URL (optional)
            <input name="fileUrl" type="url" placeholder="https://…" />
          </label>
          <div className="form-grid">
            <label>
              Page count
              <input name="pageCount" type="number" min="1" max="10000" />
            </label>
            <label>
              Audiobook minutes
              <input name="durationMinutes" type="number" min="1" max="1440" />
            </label>
          </div>
          <p className="field-help">
            Use only content you own or are allowed to share. Audiobooks require
            a duration. Private managed uploads will replace external file URLs
            before launch.
          </p>
          <button
            className="button button--primary"
            disabled={Boolean(busyId) || Boolean(error)}
          >
            {busyId === "create" ? "Saving…" : "Save material draft"}
          </button>
        </form>
      </article>
    </section>
  );
}

function TutorialBookingPanel({ onChanged }: { onChanged(): void }) {
  const [key, setKey] = useState(0);
  const { data, loading, error } = useWorkspaceData<{
    listings: Tutorial[];
    bookings: TutorialBooking[];
  }>("/v1/agents/tutorials", key);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  async function confirmBooking(id: string) {
    setBusyId(id);
    setActionError("");
    setNotice("");
    try {
      const result = await portalApi<{ status: string }>(
        `/v1/agents/tutorial-bookings/${id}/confirm`,
        { method: "POST", body: JSON.stringify({ confirmed: true }) },
      );
      setNotice(
        result.status === "COMPLETED"
          ? "Completion confirmed. The dispute window is now running."
          : "Your confirmation is saved. Waiting for the student.",
      );
      setKey((value) => value + 1);
      onChanged();
    } catch (caught) {
      setActionError(
        caught instanceof PortalApiError
          ? caught.message
          : "Booking completion could not be confirmed.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function reportNoShow(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusyId(id);
    setActionError("");
    setNotice("");
    try {
      await portalApi(`/v1/agents/tutorial-bookings/${id}/no-show`, {
        method: "POST",
        body: JSON.stringify({ reason: form.get("reason") }),
      });
      setNotice(
        "The no-show report is open for support review; related earnings remain reserved.",
      );
      setKey((value) => value + 1);
      onChanged();
    } catch (caught) {
      setActionError(
        caught instanceof PortalApiError
          ? caught.message
          : "The no-show report could not be opened.",
      );
    } finally {
      setBusyId(null);
    }
  }

  const sessionEnded = (booking: TutorialBooking) =>
    Boolean(booking.completion_available);

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Session operations</p>
          <h2>Student bookings</h2>
        </div>
        <span className="data-label">
          {data?.bookings.length ?? 0} bookings
        </span>
      </div>
      {loading && (
        <div className="state-panel">
          <span className="spinner" />
        </div>
      )}
      {error && <WorkspaceGate error={error} />}
      {notice && <p className="form-notice">{notice}</p>}
      {actionError && <p className="form-error">{actionError}</p>}
      {data?.bookings.map((booking) => (
        <div className="booking-operation" key={booking.id}>
          <div className="activity-row">
            <span>
              <strong>
                {booking.course_code} · {booking.student_name}
              </strong>
              <small>
                {date(booking.scheduled_for ?? booking.created_at)} ·{" "}
                {label(booking.status)}
              </small>
            </span>
            <span>
              <strong>{money(booking.amount_kobo)}</strong>
              {booking.status === "CONFIRMED" &&
              !booking.tutor_confirmed_at &&
              sessionEnded(booking) ? (
                <button
                  className="text-button"
                  disabled={busyId === booking.id}
                  onClick={() => void confirmBooking(booking.id)}
                >
                  {busyId === booking.id ? "Saving…" : "Confirm completed"}
                </button>
              ) : (
                <small>
                  {booking.tutor_confirmed_at
                    ? "Tutor confirmed"
                    : booking.status === "CONFIRMED" && !sessionEnded(booking)
                      ? "Available after session"
                      : "No action due"}
                </small>
              )}
            </span>
          </div>
          {booking.status === "CONFIRMED" && sessionEnded(booking) && (
            <details className="booking-no-show">
              <summary>Student did not attend?</summary>
              <form
                className="form-stack"
                onSubmit={(event) => void reportNoShow(event, booking.id)}
              >
                <label>
                  What happened?
                  <textarea
                    name="reason"
                    minLength={10}
                    maxLength={1000}
                    required
                    placeholder="Record the time, location and attendance evidence for support."
                  />
                </label>
                <p className="field-help">
                  This opens a reviewed dispute; it does not automatically
                  penalize the student or release money.
                </p>
                <button
                  className="button button--small"
                  disabled={busyId === booking.id}
                >
                  {busyId === booking.id
                    ? "Opening report…"
                    : "Open no-show report"}
                </button>
              </form>
            </details>
          )}
        </div>
      ))}
      {data && !data.bookings.length && (
        <div className="empty-row">
          <strong>No student bookings</strong>
          <span>
            Confirmed free or paid bookings will appear here for attendance and
            completion.
          </span>
        </div>
      )}
    </section>
  );
}

function StoreWorkspace({ onChanged }: { onChanged(): void }) {
  const [key, setKey] = useState(0);
  const { data, loading, error } = useWorkspaceData<{ products: Product[] }>(
    "/v1/agents/products",
    key,
  );
  const categories = useWorkspaceData<{
    categories: Array<{
      id: string;
      name: string;
      listing_rules: string | null;
    }>;
  }>("/v1/agents/product-categories", key);
  const orders = useWorkspaceData<{ orders: VendorOrder[] }>(
    "/v1/agents/orders",
    key,
  );
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickupCode, setPickupCode] = useState<{
    orderId: string;
    code: string;
  } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setFormError("");
    setNotice("");
    try {
      await portalApi("/v1/agents/products", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          description: form.get("description"),
          categoryId: form.get("categoryId"),
          priceKobo: Math.round(Number(form.get("price")) * 100),
          stockQuantity: Number(form.get("stockQuantity")),
          imageUrl: form.get("imageUrl") || null,
        }),
      });
      setNotice("Product saved as a draft.");
      formElement.reset();
      setKey((value) => value + 1);
      onChanged();
    } catch (caught) {
      setFormError(
        caught instanceof PortalApiError
          ? caught.message
          : "Product could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function changeProductStatus(
    id: string,
    status: "PUBLISHED" | "PAUSED" | "ARCHIVED",
  ) {
    setBusy(true);
    setFormError("");
    try {
      await portalApi(`/v1/agents/products/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setKey((value) => value + 1);
    } catch (caught) {
      setFormError(
        caught instanceof PortalApiError
          ? caught.message
          : "Product status could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function changeOrderStatus(
    id: string,
    status: "ACCEPTED" | "READY" | "CANCELLED",
  ) {
    setBusy(true);
    setFormError("");
    try {
      await portalApi(`/v1/agents/orders/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, note: null }),
      });
      setKey((value) => value + 1);
      onChanged();
    } catch (caught) {
      setFormError(
        caught instanceof PortalApiError
          ? caught.message
          : "Order status could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function revealPickupCode(id: string) {
    setBusy(true);
    setFormError("");
    try {
      const result = await portalApi<{ code: string }>(
        `/v1/agents/orders/${id}/pickup-code`,
      );
      setPickupCode({ orderId: id, code: result.code });
    } catch (caught) {
      setFormError(
        caught instanceof PortalApiError
          ? caught.message
          : "Pickup code could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="dashboard-grid dashboard-grid--content">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Vendor catalogue</p>
              <h2>Your products</h2>
            </div>
            <span className="data-label">
              {data?.products.length ?? 0} products
            </span>
          </div>
          {loading && (
            <div className="state-panel">
              <span className="spinner" />
            </div>
          )}
          {error && <WorkspaceGate error={error} />}
          {data?.products.map((item) => (
            <div className="product-row" key={item.id}>
              {item.image_url ? (
                <Image
                  src={item.image_url}
                  alt=""
                  width={52}
                  height={52}
                  unoptimized
                />
              ) : (
                <span className="product-placeholder">
                  {item.name.slice(0, 1)}
                </span>
              )}
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.category} · {number(item.stock_quantity)} in stock ·{" "}
                  {label(item.status)}
                </small>
              </span>
              <span>
                <strong>{money(item.price_kobo)}</strong>
                <span className="inline-actions">
                  {item.status !== "PUBLISHED" &&
                    item.status !== "ARCHIVED" && (
                      <button
                        className="text-button"
                        onClick={() =>
                          void changeProductStatus(item.id, "PUBLISHED")
                        }
                      >
                        Publish
                      </button>
                    )}
                  {item.status === "PUBLISHED" && (
                    <button
                      className="text-button"
                      onClick={() =>
                        void changeProductStatus(item.id, "PAUSED")
                      }
                    >
                      Pause
                    </button>
                  )}
                  <button
                    className="text-button text-button--danger"
                    onClick={() =>
                      void changeProductStatus(item.id, "ARCHIVED")
                    }
                  >
                    Archive
                  </button>
                </span>
              </span>
            </div>
          ))}
          {data && !data.products.length && (
            <div className="empty-row">
              <strong>No products yet</strong>
              <span>Create the first one after vendor approval.</span>
            </div>
          )}
          {formError && <p className="form-error">{formError}</p>}
        </article>
        <article className="panel">
          <p className="section-kicker">New product</p>
          <h2>Add a campus essential</h2>
          <form className="form-stack" onSubmit={submit}>
            <label>
              Product name
              <input name="name" minLength={2} required />
            </label>
            <div className="form-grid">
              <label>
                Approved category
                <select name="categoryId" defaultValue="" required>
                  <option value="" disabled>
                    Select category
                  </option>
                  {categories.data?.categories.map((category) => (
                    <option value={category.id} key={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Stock quantity
                <input name="stockQuantity" type="number" min="0" required />
              </label>
            </div>
            <label>
              Description
              <textarea name="description" minLength={10} required />
            </label>
            <div className="form-grid">
              <label>
                Price (₦)
                <input name="price" type="number" min="0" step="1" required />
              </label>
              <label>
                Image URL
                <input name="imageUrl" type="url" placeholder="https://…" />
              </label>
            </div>
            {!categories.loading && !categories.data?.categories.length && (
              <p className="form-error">
                An administrator must approve a product category before you can
                list an item.
              </p>
            )}
            {notice && <p className="form-notice">{notice}</p>}
            <button
              className="button button--primary"
              disabled={
                busy || Boolean(error) || !categories.data?.categories.length
              }
            >
              {busy ? "Saving…" : "Save product draft"}
            </button>
          </form>
        </article>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Order operations</p>
            <h2>Customer orders</h2>
          </div>
          <span className="data-label">
            {orders.data?.orders.length ?? 0} orders
          </span>
        </div>
        {orders.error && <WorkspaceGate error={orders.error} />}
        {orders.data?.orders.map((order) => (
          <div className="order-row" key={order.id}>
            <span>
              <strong>Order #{order.id.slice(0, 8)}</strong>
              <small>
                {number(order.item_count)} item(s) ·{" "}
                {order.zone_name ?? "No delivery zone"} ·{" "}
                {date(order.created_at)}
              </small>
            </span>
            <span>
              <strong>{money(order.total_kobo)}</strong>
              <small>{label(order.status)}</small>
            </span>
            <span className="inline-actions">
              {order.status === "PAID" && (
                <button
                  className="button button--small"
                  onClick={() => void changeOrderStatus(order.id, "ACCEPTED")}
                >
                  Accept
                </button>
              )}
              {order.status === "ACCEPTED" && (
                <button
                  className="button button--small"
                  onClick={() => void changeOrderStatus(order.id, "READY")}
                >
                  Mark ready
                </button>
              )}
              {order.status === "READY" && (
                <button
                  className="button button--small"
                  onClick={() => void revealPickupCode(order.id)}
                >
                  Pickup code
                </button>
              )}
            </span>
            {pickupCode?.orderId === order.id && (
              <strong className="handoff-code">{pickupCode.code}</strong>
            )}
          </div>
        ))}
        {orders.data && !orders.data.orders.length && (
          <div className="empty-row">
            <strong>No customer orders</strong>
            <span>Paid orders will appear here for fulfilment.</span>
          </div>
        )}
      </section>
    </>
  );
}

function DeliveryWorkspace({ onChanged }: { onChanged(): void }) {
  const [key, setKey] = useState(0);
  const { data, loading, error } = useWorkspaceData<{
    jobs: Delivery[];
    presence: { online: boolean; capacity_status: string };
  }>("/v1/agents/deliveries", key);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  async function reserve(id: string) {
    setBusyId(id);
    setActionError("");
    try {
      await portalApi(`/v1/agents/deliveries/${id}/reserve`, {
        method: "POST",
        body: "{}",
      });
      setKey((value) => value + 1);
      onChanged();
    } catch (caught) {
      setActionError(
        caught instanceof PortalApiError
          ? caught.message
          : "Delivery could not be reserved.",
      );
    } finally {
      setBusyId(null);
    }
  }
  async function updatePresence(online: boolean) {
    setActionError("");
    try {
      await portalApi("/v1/agents/rider-presence", {
        method: "PUT",
        body: JSON.stringify({
          online,
          capacityStatus: online ? "AVAILABLE" : "PAUSED",
        }),
      });
      setKey((value) => value + 1);
    } catch (caught) {
      setActionError(
        caught instanceof PortalApiError
          ? caught.message
          : "Availability could not be changed.",
      );
    }
  }
  async function handoff(
    event: FormEvent<HTMLFormElement>,
    job: Delivery,
    action: "pickup" | "complete",
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusyId(job.id);
    setActionError("");
    try {
      await portalApi(`/v1/agents/deliveries/${job.id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ code: form.get("code") }),
      });
      setKey((value) => value + 1);
      onChanged();
    } catch (caught) {
      setActionError(
        caught instanceof PortalApiError
          ? caught.message
          : "The handoff code could not be verified.",
      );
    } finally {
      setBusyId(null);
    }
  }
  return (
    <section className="dashboard-grid">
      <article className="panel rider-visual">
        <Image
          src="/brand-scenes/rider.png"
          alt="KampusOne campus bicycle rider"
          width={1024}
          height={1024}
        />
        <div>
          <p className="section-kicker">Rider operations</p>
          <h2>Assigned and available deliveries</h2>
          <p>
            Only approved riders can view the campus queue. You must be online
            and available before reserving a job. Pickup and delivery require
            different one-time codes.
          </p>
          <div className="presence-control">
            <span>
              <i
                className={`status-dot ${data?.presence.online ? "status-dot--online" : ""}`}
              />
              <strong>
                {data?.presence.online ? "Online for jobs" : "Offline"}
              </strong>
            </span>
            <button
              className="button button--secondary"
              onClick={() => void updatePresence(!data?.presence.online)}
            >
              {data?.presence.online ? "Go offline" : "Go online"}
            </button>
          </div>
        </div>
      </article>
      <article className="panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Delivery queue</p>
            <h2>{data?.jobs.length ?? 0} jobs visible</h2>
          </div>
        </div>
        {loading && (
          <div className="state-panel">
            <span className="spinner" />
          </div>
        )}
        {error && <WorkspaceGate error={error} />}
        {actionError && <p className="form-error">{actionError}</p>}
        {data?.jobs.map((job) => (
          <div className="delivery-job" key={job.id}>
            <div className="delivery-row">
              <span>
                <strong>Order #{job.order_id.slice(0, 8)}</strong>
                <small>
                  {job.zone_name} · {date(job.created_at)} ·{" "}
                  {money(job.rider_earning_kobo)}
                </small>
              </span>
              <span
                className={`state-badge state-badge--${job.status === "AVAILABLE" ? "pending" : "live"}`}
              >
                {label(job.status)}
              </span>
              {job.status === "AVAILABLE" && (
                <button
                  className="button button--small"
                  disabled={busyId === job.id || !data.presence.online}
                  onClick={() => void reserve(job.id)}
                >
                  {busyId === job.id ? "Reserving…" : "Reserve"}
                </button>
              )}
            </div>
            {job.status === "RESERVED" && (
              <form
                className="handoff-form"
                onSubmit={(event) => void handoff(event, job, "pickup")}
              >
                <label>
                  Vendor pickup code
                  <input
                    name="code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                  />
                </label>
                <button
                  className="button button--small"
                  disabled={busyId === job.id}
                >
                  Verify pickup
                </button>
              </form>
            )}
            {job.status === "PICKED_UP" && (
              <form
                className="handoff-form"
                onSubmit={(event) => void handoff(event, job, "complete")}
              >
                <label>
                  Customer delivery code
                  <input
                    name="code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                  />
                </label>
                <button
                  className="button button--small"
                  disabled={busyId === job.id}
                >
                  Complete delivery
                </button>
              </form>
            )}
          </div>
        ))}
        {data && !data.jobs.length && (
          <div className="empty-row">
            <strong>No delivery jobs</strong>
            <span>
              New paid orders assigned to your campus zone will appear here.
            </span>
          </div>
        )}
      </article>
    </section>
  );
}

function EarningsWorkspace({ profiles }: { profiles: AgentProfile[] }) {
  const [key, setKey] = useState(0);
  const { data, loading, error } = useWorkspaceData<Earnings>(
    "/v1/agents/earnings",
    key,
  );
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const available =
    Number(data?.tutorials.available_kobo ?? 0) +
    Number(data?.store.available_kobo ?? 0) +
    Number(data?.deliveries.available_kobo ?? 0);
  const pending =
    Number(data?.tutorials.pending_kobo ?? 0) +
    Number(data?.store.pending_kobo ?? 0) +
    Number(data?.deliveries.pending_kobo ?? 0);
  const reserved =
    Number(data?.tutorials.reserved_kobo ?? 0) +
    Number(data?.store.reserved_kobo ?? 0) +
    Number(data?.deliveries.reserved_kobo ?? 0);
  const withdrawn =
    Number(data?.tutorials.withdrawn_kobo ?? 0) +
    Number(data?.store.withdrawn_kobo ?? 0) +
    Number(data?.deliveries.withdrawn_kobo ?? 0);
  async function requestPayout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setNotice("");
    setFormError("");
    try {
      await portalApi("/v1/agents/payouts", {
        method: "POST",
        body: JSON.stringify({
          agentProfileId: form.get("agentProfileId"),
          amountKobo: Math.round(Number(form.get("amount")) * 100),
        }),
      });
      setNotice("Payout request submitted for finance review.");
      formElement.reset();
      setKey((value) => value + 1);
    } catch (caught) {
      setFormError(
        caught instanceof PortalApiError
          ? caught.message
          : "Payout request failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="metric-grid">
        <article className="metric-card metric-card--accent">
          <span>Available to request</span>
          <strong>{money(available)}</strong>
          <small>Net of open and paid withdrawals</small>
        </article>
        <article className="metric-card">
          <span>Pending release</span>
          <strong>{money(pending)}</strong>
          <small>Completion or dispute window still active</small>
        </article>
        <article className="metric-card">
          <span>Reserved for payout</span>
          <strong>{money(reserved)}</strong>
          <small>In finance review or processing</small>
        </article>
        <article className="metric-card">
          <span>Paid out</span>
          <strong>{money(withdrawn)}</strong>
          <small>Completed withdrawals</small>
        </article>
        <article className="metric-card">
          <span>Tutorial available</span>
          <strong>{money(data?.tutorials.available_kobo ?? 0)}</strong>
          <small>Verified completed sessions</small>
        </article>
        <article className="metric-card">
          <span>Store + delivery available</span>
          <strong>
            {money(
              Number(data?.store.available_kobo ?? 0) +
                Number(data?.deliveries.available_kobo ?? 0),
            )}
          </strong>
          <small>Fulfilled campus orders and jobs</small>
        </article>
      </section>
      <section className="dashboard-grid dashboard-grid--equal">
        <article className="panel">
          <p className="section-kicker">Controlled withdrawal</p>
          <h2>Request a payout</h2>
          <form className="form-stack" onSubmit={requestPayout}>
            <label>
              Agent account
              <select name="agentProfileId" defaultValue="" required>
                <option value="" disabled>
                  Select role
                </option>
                {profiles
                  .filter((profile) => profile.status === "ACTIVE")
                  .map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {label(profile.agent_type)} · {profile.display_name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Amount (₦)
              <input name="amount" type="number" min="100" step="1" required />
            </label>
            <p className="field-help">
              A verified payout account and sufficient available balance are
              required. Requests are balance-checked atomically and remain
              auditable; money is not auto-sent.
            </p>
            {notice && <p className="form-notice">{notice}</p>}
            {formError && <p className="form-error">{formError}</p>}
            <button
              className="button button--primary"
              disabled={busy || available < 10_000}
            >
              {busy ? "Submitting…" : "Request payout"}
            </button>
          </form>
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Payout history</p>
              <h2>Finance status</h2>
            </div>
          </div>
          {loading && (
            <div className="state-panel">
              <span className="spinner" />
            </div>
          )}
          {error && <WorkspaceGate error={error} />}
          {data?.payoutRequests.map((request) => (
            <div className="catalog-row" key={request.id}>
              <span>
                <strong>
                  {label(request.agent_type)} · {request.display_name}
                </strong>
                <small>{date(request.requested_at)}</small>
              </span>
              <span>
                <strong>{money(request.amount_kobo)}</strong>
                <small>{label(request.status)}</small>
              </span>
            </div>
          ))}
          {data && !data.payoutRequests.length && (
            <div className="empty-row">
              <strong>No payout requests</strong>
              <span>Requests and finance decisions will appear here.</span>
            </div>
          )}
        </article>
      </section>
    </>
  );
}
