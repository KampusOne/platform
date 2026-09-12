"use client";

import Image from "next/image";
import Link from "next/link";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { PortalShell } from "@/components/portal-shell";
import { PortalApiError, portalApi } from "@/lib/api";

type Scalar = string | number | null;
type Dashboard = {
  metrics: {
    users: {
      total: Scalar;
      new_30d: Scalar;
      email_verified: Scalar;
      onboarded: Scalar;
    };
    applications: {
      pending: Scalar;
      approved: Scalar;
      tutors: Scalar;
      vendors: Scalar;
      riders: Scalar;
    };
    content: {
      published_posts: Scalar;
      draft_posts: Scalar;
      published_places: Scalar;
    };
    commerce: {
      tutorial_bookings: Scalar;
      orders: Scalar;
      active_deliveries: Scalar;
      open_disputes: Scalar;
      payment_anomalies: Scalar;
    };
    revenue: {
      tutorial_gmv_kobo: Scalar;
      store_gmv_kobo: Scalar;
      delivery_gmv_kobo: Scalar;
      recognized_revenue_kobo: Scalar;
    };
  };
  revenueTrend: Array<{ day: string; gmv_kobo: Scalar }>;
  queues: { applications: AgentApplication[] };
  generatedAt: string;
};
type UserRecord = {
  id: string;
  email: string;
  roles: string[];
  status: string;
  email_verified_at: string | null;
  created_at: string;
  last_login_at: string | null;
  display_name: string | null;
  username: string | null;
  current_level: string | null;
  verification_status: string | null;
  onboarding_completed_at: string | null;
  university_name: string | null;
};
type AgentApplication = {
  id: string;
  agent_type: string;
  display_name: string;
  phone_e164?: string;
  statement?: string;
  evidence?: unknown;
  legal_name?: string;
  address_text?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  phone_verified_at?: string | null;
  terms_version?: string;
  terms_accepted_at?: string | null;
  kyc_status?: string;
  bank_status?: string;
  bank_account_name?: string | null;
  bank_account_last4?: string | null;
  status: string;
  review_note?: string | null;
  submitted_at: string;
  reviewed_at?: string | null;
  email?: string;
  username?: string | null;
};
type AuditEvent = {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  outcome: string;
  request_id: string;
  metadata: Record<string, unknown>;
};
type ReleasePhase = {
  phase_key: string;
  title: string;
  status: string;
  summary: string;
  requirements: string[] | Record<string, unknown>;
  updated_at: string;
};
type ContentContext = {
  universities: Array<{ id: string; name: string; slug: string }>;
  sources: Array<{
    id: string;
    university_id: string;
    name: string;
    verified: boolean;
  }>;
};
type Operations = {
  categories: Array<{
    id: string;
    university_id: string;
    name: string;
    status: string;
    listing_rules: string | null;
  }>;
  zones: Array<{
    id: string;
    university_id: string;
    name: string;
    base_fee_kobo: Scalar;
    active: boolean;
  }>;
  disputes: Array<{
    id: string;
    category: string;
    reason: string;
    status: string;
    tutorial_booking_id: string | null;
    order_id: string | null;
    opened_by_email: string;
    created_at: string;
  }>;
  payoutRequests: Array<{
    id: string;
    amount_kobo: Scalar;
    status: string;
    provider_reference: string | null;
    review_note: string | null;
    requested_at: string;
    display_name: string;
    agent_type: string;
    email: string;
  }>;
  paymentEvents: Array<{
    id: string;
    provider: string;
    provider_reference: string;
    amount_kobo: Scalar;
    state: string;
    resource_type: string | null;
    resource_id: string | null;
    review_reason: string | null;
    resolution_code: string | null;
    received_at: string;
  }>;
};
type TutorialListingAdmin = {
  id: string;
  university_id: string;
  university_name: string;
  course_code: string;
  title: string;
  tutor_name: string;
  format: string;
  price_kobo: Scalar;
  capacity: Scalar;
  status: string;
  review_status: string;
  review_note: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  is_demo: boolean;
  booking_count: Scalar;
  updated_at: string;
};
type TutorialResourceAdmin = {
  id: string;
  university_id: string;
  university_name: string;
  course_code: string;
  title: string;
  resource_type: string;
  access_model: string;
  price_kobo: Scalar;
  publisher_name: string;
  status: string;
  review_note: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  is_demo: boolean;
  updated_at: string;
};
type TutorialAdmin = {
  listings: TutorialListingAdmin[];
  resources: TutorialResourceAdmin[];
  summary: {
    listings: number;
    resources: number;
    pending: number;
    demo: number;
  };
};
type View =
  | "overview"
  | "users"
  | "applications"
  | "tutorials"
  | "content"
  | "operations"
  | "audit";

const money = (value: Scalar) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0) / 100);
const number = (value: Scalar) =>
  new Intl.NumberFormat("en-NG").format(Number(value ?? 0));
const date = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("en-NG", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
const label = (value: string) =>
  value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());

function ErrorPanel({
  error,
  retry,
}: {
  error: PortalApiError;
  retry(): void;
}) {
  if (error.status === 403) return <BootstrapPanel retry={retry} />;
  return (
    <section className="state-panel state-panel--error">
      <strong>Dashboard unavailable</strong>
      <p>{error.message}</p>
      <button className="button button--secondary" onClick={retry}>
        Try again
      </button>
    </section>
  );
}

function BootstrapPanel({ retry }: { retry(): void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function bootstrap(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await portalApi("/v1/admin/bootstrap", {
        method: "POST",
        headers: token ? { "X-Admin-Bootstrap-Token": token } : undefined,
        body: "{}",
      });
      retry();
    } catch (caught) {
      setError(
        caught instanceof PortalApiError ? caught.message : "Bootstrap failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="bootstrap-panel">
      <div>
        <p className="eyebrow">One-time setup</p>
        <h2>Activate the first platform administrator</h2>
        <p>
          If this is the verified initial-admin email, activate it directly. A
          deployment bootstrap credential remains available as a recovery method
          and stops working after the first administrator is created.
        </p>
      </div>
      <form className="form-stack" onSubmit={bootstrap}>
        {error && <p className="form-error">{error}</p>}
        <button className="button button--primary" disabled={busy}>
          {busy ? "Activating…" : "Activate this verified account"}
        </button>
        <details>
          <summary>Use recovery credential</summary>
          <label>
            Bootstrap credential
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
            />
          </label>
          <button
            className="button button--secondary"
            disabled={busy}
            type="submit"
          >
            Activate with credential
          </button>
        </details>
      </form>
    </section>
  );
}

export function AdminDashboard() {
  const [view, setView] = useState<View>("overview");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [applications, setApplications] = useState<AgentApplication[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [phases, setPhases] = useState<ReleasePhase[]>([]);
  const [context, setContext] = useState<ContentContext>({
    universities: [],
    sources: [],
  });
  const [tutorials, setTutorials] = useState<TutorialAdmin>({
    listings: [],
    resources: [],
    summary: { listings: 0, resources: 0, pending: 0, demo: 0 },
  });
  const [operations, setOperations] = useState<Operations>({
    categories: [],
    zones: [],
    disputes: [],
    payoutRequests: [],
    paymentEvents: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PortalApiError | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setRefreshKey((value) => value + 1);
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all([
      portalApi<Dashboard>("/v1/admin/dashboard"),
      portalApi<{ users: UserRecord[] }>("/v1/admin/users"),
      portalApi<{ applications: AgentApplication[] }>("/v1/admin/applications"),
      portalApi<{ events: AuditEvent[] }>("/v1/admin/audit"),
      portalApi<{ phases: ReleasePhase[] }>("/v1/admin/release-phases"),
      portalApi<ContentContext>("/v1/admin/content/context"),
      portalApi<TutorialAdmin>("/v1/admin/tutorials").catch((caught) => {
        if (
          caught instanceof PortalApiError &&
          (caught.status === 404 || caught.code === "FEATURE_DISABLED")
        ) {
          return {
            listings: [],
            resources: [],
            summary: { listings: 0, resources: 0, pending: 0, demo: 0 },
          };
        }
        throw caught;
      }),
      portalApi<Operations>("/v1/admin/operations"),
    ])
      .then(
        ([
          nextDashboard,
          nextUsers,
          nextApplications,
          nextAudit,
          nextPhases,
          nextContext,
          nextTutorials,
          nextOperations,
        ]) => {
          if (!active) return;
          setDashboard(nextDashboard);
          setUsers(nextUsers.users);
          setApplications(nextApplications.applications);
          setAudit(nextAudit.events);
          setPhases(nextPhases.phases);
          setContext(nextContext);
          setTutorials(nextTutorials);
          setOperations(nextOperations);
        },
      )
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof PortalApiError
              ? caught
              : new PortalApiError(
                  500,
                  "REQUEST_FAILED",
                  "The operations data could not be loaded.",
                ),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  const revenue = useMemo(
    () =>
      dashboard
        ? Number(dashboard.metrics.revenue.tutorial_gmv_kobo ?? 0) +
          Number(dashboard.metrics.revenue.store_gmv_kobo ?? 0) +
          Number(dashboard.metrics.revenue.delivery_gmv_kobo ?? 0)
        : 0,
    [dashboard],
  );
  const maxTrend = Math.max(
    1,
    ...(dashboard?.revenueTrend.map((item) => Number(item.gmv_kobo ?? 0)) ?? [
      0,
    ]),
  );

  return (
    <PortalShell
      active="admin"
      eyebrow="Administration · Live operations"
      title="Campus operations center"
      description="Track users, revenue, agent approvals, trusted content, and privileged activity from the real platform records."
      actions={
        <button className="button button--secondary" onClick={load}>
          Refresh data
        </button>
      }
    >
      <nav className="section-tabs" aria-label="Administration sections">
        {(
          [
            "overview",
            "users",
            "applications",
            "tutorials",
            "content",
            "operations",
            "audit",
          ] as View[]
        ).map((item) => (
          <button
            key={item}
            aria-current={view === item ? "page" : undefined}
            onClick={() => setView(item)}
          >
            {item === "operations" ? "Commerce & finance" : label(item)}
          </button>
        ))}
      </nav>
      {loading && (
        <section className="state-panel">
          <span className="spinner" />
          <strong>Loading live operations…</strong>
        </section>
      )}
      {!loading && error && <ErrorPanel error={error} retry={load} />}
      {!loading && !error && dashboard && view === "overview" && (
        <>
          <section className="metric-grid">
            <article className="metric-card metric-card--accent">
              <span>Gross transaction value</span>
              <strong>{money(revenue)}</strong>
              <small>
                Confirmed tutorials + products + delivery fees, with no double
                counting
              </small>
            </article>
            <article className="metric-card">
              <span>Recognized platform revenue</span>
              <strong>
                {money(dashboard.metrics.revenue.recognized_revenue_kobo)}
              </strong>
              <small>
                Posted credits to ledger revenue accounts; commission awaits the
                approved rate
              </small>
            </article>
            <article className="metric-card">
              <span>Registered users</span>
              <strong>{number(dashboard.metrics.users.total)}</strong>
              <small>
                {number(dashboard.metrics.users.new_30d)} joined in the last 30
                days
              </small>
            </article>
            <article className="metric-card">
              <span>Pending applications</span>
              <strong>{number(dashboard.metrics.applications.pending)}</strong>
              <small>
                {number(dashboard.metrics.applications.approved)} approved
                agents
              </small>
            </article>
            <article className="metric-card">
              <span>Open disputes</span>
              <strong>
                {number(dashboard.metrics.commerce.open_disputes)}
              </strong>
              <small>
                {number(dashboard.metrics.commerce.payment_anomalies)} payment
                events need review ·{" "}
                {number(dashboard.metrics.commerce.active_deliveries)} active
                deliveries
              </small>
            </article>
          </section>
          <section className="dashboard-grid">
            <article className="panel panel--wide">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">Revenue analysis</p>
                  <h2>30-day platform GMV</h2>
                </div>
                <span className="data-label">{money(revenue)} total</span>
              </div>
              <div
                className="revenue-chart"
                aria-label="Daily gross transaction value for the last 30 days"
              >
                {dashboard.revenueTrend.map((point, index) => (
                  <div
                    className="chart-column"
                    key={point.day}
                    title={`${point.day}: ${money(point.gmv_kobo)}`}
                  >
                    <span
                      style={{
                        height: `${Math.max(3, (Number(point.gmv_kobo ?? 0) / maxTrend) * 100)}%`,
                      }}
                    />
                    <small>
                      {index % 6 === 0
                        ? new Date(point.day).toLocaleDateString("en-NG", {
                            day: "numeric",
                            month: "short",
                          })
                        : ""}
                    </small>
                  </div>
                ))}
              </div>
              <div className="revenue-split">
                <div>
                  <span>Tutorials</span>
                  <strong>
                    {money(dashboard.metrics.revenue.tutorial_gmv_kobo)}
                  </strong>
                </div>
                <div>
                  <span>Store</span>
                  <strong>
                    {money(dashboard.metrics.revenue.store_gmv_kobo)}
                  </strong>
                </div>
                <div>
                  <span>Delivery fees</span>
                  <strong>
                    {money(dashboard.metrics.revenue.delivery_gmv_kobo)}
                  </strong>
                </div>
              </div>
            </article>
            <article className="panel campus-visual">
              <Image
                src="/brand-scenes/campus-life.png"
                alt="KampusOne students on campus"
                width={1024}
                height={1024}
              />
              <div>
                <p className="section-kicker">Community health</p>
                <h2>
                  {number(dashboard.metrics.users.onboarded)} onboarded students
                </h2>
                <p>
                  {number(dashboard.metrics.users.email_verified)}{" "}
                  email-verified accounts,{" "}
                  {number(dashboard.metrics.content.published_posts)} published
                  posts, and{" "}
                  {number(dashboard.metrics.content.published_places)} mapped
                  places.
                </p>
              </div>
            </article>
          </section>
          <section className="dashboard-grid dashboard-grid--equal">
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">Review queue</p>
                  <h2>Agent applications</h2>
                </div>
                <button
                  className="text-button"
                  onClick={() => setView("applications")}
                >
                  Open queue →
                </button>
              </div>
              <CompactApplications items={dashboard.queues.applications} />
            </article>
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">Delivery readiness</p>
                  <h2>Release phases</h2>
                </div>
                <Link className="text-button" href="/engineering">
                  All requirements →
                </Link>
              </div>
              <div className="phase-list">
                {phases.map((phase) => (
                  <div key={phase.phase_key}>
                    <span
                      className={`state-badge state-badge--${phase.status.toLowerCase()}`}
                    >
                      {label(phase.status)}
                    </span>
                    <strong>{phase.title}</strong>
                    <small>{phase.summary}</small>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </>
      )}
      {!loading && !error && view === "users" && <UsersView users={users} />}
      {!loading && !error && view === "applications" && (
        <ApplicationsView applications={applications} onChanged={load} />
      )}
      {!loading && !error && view === "tutorials" && (
        <TutorialsView data={tutorials} context={context} onChanged={load} />
      )}
      {!loading && !error && view === "content" && (
        <ContentView context={context} onChanged={load} />
      )}
      {!loading && !error && view === "operations" && (
        <OperationsView
          operations={operations}
          context={context}
          onChanged={load}
        />
      )}
      {!loading && !error && view === "audit" && <AuditView events={audit} />}
    </PortalShell>
  );
}

function CompactApplications({ items }: { items: AgentApplication[] }) {
  if (!items.length)
    return (
      <div className="empty-row">
        <strong>Review queue is clear</strong>
        <span>New submitted applications will appear here.</span>
      </div>
    );
  return (
    <div className="list-stack">
      {items.map((item) => (
        <div className="list-row" key={item.id}>
          <span className="list-avatar">
            {item.display_name.slice(0, 2).toUpperCase()}
          </span>
          <span>
            <strong>{item.display_name}</strong>
            <small>
              {label(item.agent_type)} · {date(item.submitted_at)}
            </small>
          </span>
          <span className="state-badge state-badge--pending">
            {label(item.status)}
          </span>
        </div>
      ))}
    </div>
  );
}

function UsersView({ users }: { users: UserRecord[] }) {
  const [query, setQuery] = useState("");
  const visible = users.filter((user) =>
    `${user.email} ${user.display_name ?? ""} ${user.username ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section className="panel table-panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Identity directory</p>
          <h2>{users.length} registered users</h2>
        </div>
        <input
          className="search-input"
          placeholder="Search users"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="data-table">
        <div className="table-row table-row--head">
          <span>User</span>
          <span>Campus</span>
          <span>Verification</span>
          <span>Joined</span>
        </div>
        {visible.map((user) => (
          <div className="table-row" key={user.id}>
            <span>
              <strong>{user.display_name || user.email.split("@")[0]}</strong>
              <small>{user.email}</small>
            </span>
            <span>
              <strong>{user.university_name || "Not onboarded"}</strong>
              <small>
                {user.current_level
                  ? `${user.current_level} level`
                  : "No academic profile"}
              </small>
            </span>
            <span>
              <span
                className={`state-badge ${user.email_verified_at ? "state-badge--live" : "state-badge--attention"}`}
              >
                {user.email_verified_at ? "Email verified" : "Unverified"}
              </span>
              <small>{label(user.verification_status || "pending")}</small>
            </span>
            <span>{date(user.created_at)}</span>
          </div>
        ))}
      </div>
      {!visible.length && (
        <div className="empty-row">
          <strong>No matching users</strong>
          <span>Change the search text to see other live accounts.</span>
        </div>
      )}
    </section>
  );
}

function ApplicationsView({
  applications,
  onChanged,
}: {
  applications: AgentApplication[];
  onChanged(): void;
}) {
  const [selected, setSelected] = useState<AgentApplication | null>(null);
  return (
    <section className="dashboard-grid dashboard-grid--review">
      <article className="panel table-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Trust and safety</p>
            <h2>Agent applications</h2>
          </div>
          <span className="data-label">{applications.length} total</span>
        </div>
        <div className="list-stack list-stack--applications">
          {applications.map((item) => (
            <button
              className="application-row"
              key={item.id}
              onClick={() => setSelected(item)}
              aria-current={selected?.id === item.id}
            >
              <span className="list-avatar">
                {item.display_name.slice(0, 2).toUpperCase()}
              </span>
              <span>
                <strong>{item.display_name}</strong>
                <small>
                  {item.email} · {label(item.agent_type)}
                </small>
              </span>
              <span
                className={`state-badge state-badge--${item.status === "APPROVED" ? "live" : item.status === "SUBMITTED" ? "pending" : "attention"}`}
              >
                {label(item.status)}
              </span>
            </button>
          ))}
        </div>
        {!applications.length && (
          <div className="empty-row">
            <strong>No applications yet</strong>
            <span>
              Applications submitted by signed-in users will appear here.
            </span>
          </div>
        )}
      </article>
      <ApplicationInspector
        item={selected}
        onChanged={() => {
          setSelected(null);
          onChanged();
        }}
      />
    </section>
  );
}

function ApplicationInspector({
  item,
  onChanged,
}: {
  item: AgentApplication | null;
  onChanged(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!item)
    return (
      <aside className="panel inspector">
        <p className="section-kicker">Review details</p>
        <h2>Select an application</h2>
        <p>
          Open an application to inspect its statement and record a reasoned
          decision.
        </p>
      </aside>
    );
  const itemId = item.id;
  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await portalApi(`/v1/admin/applications/${itemId}/review`, {
        method: "POST",
        body: JSON.stringify({
          decision: form.get("decision"),
          note: form.get("note"),
        }),
      });
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof PortalApiError ? caught.message : "Review failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await portalApi(`/v1/admin/applications/${itemId}/verification`, {
        method: "POST",
        body: JSON.stringify({
          identityStatus: form.get("identityStatus"),
          phoneVerified: form.get("phoneVerified") === "on",
          bankStatus: form.get("bankStatus"),
          providerReference: form.get("providerReference") || null,
          bankAccountName: form.get("bankAccountName") || null,
          bankAccountLast4: form.get("bankAccountLast4") || null,
          note: form.get("verificationNote"),
        }),
      });
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof PortalApiError
          ? caught.message
          : "Verification review failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  const reviewable = [
    "SUBMITTED",
    "IN_REVIEW",
    "NEEDS_CORRECTION",
    "REJECTED",
  ].includes(item.status);
  return (
    <aside className="panel inspector">
      <p className="section-kicker">{label(item.agent_type)} application</p>
      <h2>{item.display_name}</h2>
      <dl className="detail-list">
        <div>
          <dt>Legal name</dt>
          <dd>{item.legal_name || "—"}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{item.email}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{item.phone_e164}</dd>
        </div>
        <div>
          <dt>Identity</dt>
          <dd>{label(item.kyc_status ?? "not started")}</dd>
        </div>
        <div>
          <dt>Bank</dt>
          <dd>{label(item.bank_status ?? "not started")}</dd>
        </div>
        <div>
          <dt>Terms</dt>
          <dd>{item.terms_accepted_at ? "Accepted" : "Missing"}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{label(item.status)}</dd>
        </div>
      </dl>
      <h3>Applicant statement</h3>
      <p>{item.statement}</p>
      {item.review_note && (
        <div className="review-note">
          <strong>Previous review note</strong>
          <p>{item.review_note}</p>
        </div>
      )}
      {reviewable &&
      !["VERIFIED", "MANUALLY_VERIFIED"].includes(item.kyc_status ?? "") ? (
        <form className="form-stack sub-form" onSubmit={verify}>
          <div>
            <p className="section-kicker">Layered verification</p>
            <h3>Record pilot review</h3>
          </div>
          <label>
            Identity decision
            <select name="identityStatus">
              <option value="MANUALLY_VERIFIED">Manually verified</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </label>
          <label className="checkbox">
            <input type="checkbox" name="phoneVerified" /> Phone evidence
            verified
          </label>
          <label>
            Bank resolution
            <select name="bankStatus">
              <option value="NOT_STARTED">Not started</option>
              <option value="VERIFIED">Verified</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </label>
          <div className="form-grid">
            <label>
              Account name
              <input name="bankAccountName" />
            </label>
            <label>
              Last 4 digits
              <input
                name="bankAccountLast4"
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
              />
            </label>
          </div>
          <label>
            Provider/reference
            <input name="providerReference" />
          </label>
          <label>
            Verification note
            <textarea
              name="verificationNote"
              minLength={10}
              required
              placeholder="Record what evidence was reviewed. Never paste a raw NIN or BVN."
            />
          </label>
          <button className="button button--secondary" disabled={busy}>
            {busy ? "Saving…" : "Record verification"}
          </button>
        </form>
      ) : null}
      {reviewable ? (
        <form className="form-stack sub-form" onSubmit={review}>
          <label>
            Application decision
            <select name="decision" defaultValue="APPROVED">
              <option value="APPROVED">Approve</option>
              <option value="NEEDS_CORRECTION">Request correction</option>
              <option value="REJECTED">Reject</option>
            </select>
          </label>
          <label>
            Reviewer note
            <textarea
              name="note"
              minLength={3}
              required
              placeholder="Record the evidence and reason for this decision."
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="button button--primary" disabled={busy}>
            {busy ? "Saving…" : "Record decision"}
          </button>
        </form>
      ) : (
        <p className="form-notice">
          This application has a completed decision.
        </p>
      )}
    </aside>
  );
}

function TutorialsView({
  data,
  context,
  onChanged,
}: {
  data: TutorialAdmin;
  context: ContentContext;
  onChanged(): void;
}) {
  const [universityId, setUniversityId] = useState(
    context.universities[0]?.id ?? "",
  );
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function changeDemo(action: "seed" | "remove") {
    if (!universityId) return;
    if (
      action === "remove" &&
      !window.confirm(
        "Remove all demo tutorials and materials for this university? Existing history will be preserved.",
      )
    )
      return;
    setBusy(`demo-${action}`);
    setError("");
    setNotice("");
    try {
      const result =
        action === "seed"
          ? await portalApi<{
              listings: number;
              resources: number;
              cancelledBookings?: number;
            }>("/v1/admin/tutorials/demo", {
              method: "POST",
              body: JSON.stringify({ universityId }),
            })
          : await portalApi<{
              listings: number;
              resources: number;
              cancelledBookings?: number;
            }>(
              `/v1/admin/tutorials/demo?universityId=${encodeURIComponent(universityId)}`,
              { method: "DELETE" },
            );
      setNotice(
        action === "seed"
          ? `Demo catalogue ready: ${result.listings} tutorials and ${result.resources} learning materials.`
          : `Demo catalogue removed: ${result.listings} tutorials, ${result.resources} materials, and ${result.cancelledBookings ?? 0} future bookings.`,
      );
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof PortalApiError
          ? caught.message
          : "The demo catalogue could not be changed.",
      );
    } finally {
      setBusy("");
    }
  }

  async function review(
    event: FormEvent<HTMLFormElement>,
    kind: "listings" | "resources",
    id: string,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(id);
    setError("");
    setNotice("");
    try {
      await portalApi(`/v1/admin/tutorials/${kind}/${id}/review`, {
        method: "POST",
        body: JSON.stringify({
          decision: form.get("decision"),
          note: form.get("note"),
        }),
      });
      setNotice(
        `${kind === "listings" ? "Tutorial" : "Learning material"} decision saved and audited.`,
      );
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof PortalApiError
          ? caught.message
          : "The moderation decision could not be saved.",
      );
    } finally {
      setBusy("");
    }
  }

  async function remove(
    kind: "listings" | "resources",
    id: string,
    title: string,
  ) {
    if (
      !window.confirm(
        `Remove “${title}”? Existing transaction history will be preserved.`,
      )
    )
      return;
    setBusy(id);
    setError("");
    setNotice("");
    try {
      await portalApi(`/v1/admin/tutorials/${kind}/${id}`, {
        method: "DELETE",
      });
      setNotice(
        `${kind === "listings" ? "Tutorial" : "Learning material"} removed.`,
      );
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof PortalApiError
          ? caught.message
          : "The item could not be removed.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <section className="metric-grid">
        <article className="metric-card metric-card--accent">
          <span>Published catalogue</span>
          <strong>{data.summary.listings}</strong>
          <small>Live and draft tutorial listings</small>
        </article>
        <article className="metric-card">
          <span>Learning materials</span>
          <strong>{data.summary.resources}</strong>
          <small>Past questions, notes, PDFs and audiobooks</small>
        </article>
        <article className="metric-card">
          <span>Moderation queue</span>
          <strong>{data.summary.pending}</strong>
          <small>Items awaiting an administrator decision</small>
        </article>
        <article className="metric-card">
          <span>Demo records</span>
          <strong>{data.summary.demo}</strong>
          <small>Clearly labelled and removable</small>
        </article>
      </section>
      <section className="panel tutorial-demo-panel">
        <div>
          <p className="section-kicker">Pilot controls</p>
          <h2>Demo tutorial catalogue</h2>
          <p>
            Load a realistic free catalogue for testing. Removing it
            soft-deletes the samples, closes their future sessions, and keeps
            audit and booking history intact.
          </p>
        </div>
        <div className="tutorial-demo-actions">
          <label>
            University
            <select
              value={universityId}
              onChange={(event) => setUniversityId(event.target.value)}
            >
              {context.universities.map((university) => (
                <option key={university.id} value={university.id}>
                  {university.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button button--primary"
            disabled={!universityId || Boolean(busy)}
            onClick={() => void changeDemo("seed")}
          >
            {busy === "demo-seed" ? "Loading…" : "Load demo catalogue"}
          </button>
          <button
            className="button button--danger"
            disabled={!universityId || Boolean(busy) || !data.summary.demo}
            onClick={() => void changeDemo("remove")}
          >
            {busy === "demo-remove" ? "Removing…" : "Remove demo catalogue"}
          </button>
        </div>
      </section>
      {notice && (
        <p className="form-notice operations-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="form-error operations-notice" role="alert">
          {error}
        </p>
      )}
      <section className="dashboard-grid dashboard-grid--equal">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Tutor submissions</p>
              <h2>Tutorial listings</h2>
            </div>
            <span className="data-label">{data.listings.length}</span>
          </div>
          {data.listings.map((item) => (
            <details className="review-item" key={item.id}>
              <summary>
                <span>
                  <strong>
                    {item.course_code} · {item.title}
                  </strong>
                  <small>
                    {item.tutor_name} · {label(item.format)} ·{" "}
                    {money(item.price_kobo)}
                    {item.is_demo ? " · Demo" : ""}
                  </small>
                </span>
                <span>
                  <span
                    className={`state-badge state-badge--${item.review_status === "APPROVED" ? "live" : item.review_status === "PENDING" ? "attention" : "pending"}`}
                  >
                    {label(item.review_status)}
                  </span>
                  <small>{number(item.booking_count)} bookings</small>
                </span>
              </summary>
              <p>
                {item.university_name} · Updated {date(item.updated_at)}
                {item.review_note ? ` · Last note: ${item.review_note}` : ""}
              </p>
              <form
                className="form-stack"
                onSubmit={(event) => void review(event, "listings", item.id)}
              >
                <label>
                  Decision
                  <select
                    name="decision"
                    defaultValue={
                      item.review_status === "APPROVED"
                        ? "APPROVED"
                        : "NEEDS_CORRECTION"
                    }
                  >
                    <option value="APPROVED">Approve and publish</option>
                    <option value="NEEDS_CORRECTION">Request changes</option>
                    <option value="REJECTED">Reject</option>
                  </select>
                </label>
                <label>
                  Reviewer note
                  <textarea
                    name="note"
                    minLength={3}
                    required
                    placeholder="Record what was checked and why."
                  />
                </label>
                <div className="inline-actions">
                  <button
                    className="button button--small"
                    disabled={Boolean(busy)}
                  >
                    {busy === item.id ? "Saving…" : "Save decision"}
                  </button>
                  <button
                    className="text-button text-button--danger"
                    disabled={Boolean(busy)}
                    onClick={() => void remove("listings", item.id, item.title)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </form>
            </details>
          ))}
          {!data.listings.length && (
            <div className="empty-row">
              <strong>No tutorial listings</strong>
              <span>
                Load the demo catalogue or approve a tutor submission.
              </span>
            </div>
          )}
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Academic library</p>
              <h2>Learning materials</h2>
            </div>
            <span className="data-label">{data.resources.length}</span>
          </div>
          {data.resources.map((item) => (
            <details className="review-item" key={item.id}>
              <summary>
                <span>
                  <strong>
                    {item.course_code} · {item.title}
                  </strong>
                  <small>
                    {label(item.resource_type)} · {item.publisher_name}
                    {item.is_demo ? " · Demo" : ""}
                  </small>
                </span>
                <span>
                  <span
                    className={`state-badge state-badge--${item.status === "PUBLISHED" ? "live" : item.status === "SUBMITTED" ? "attention" : "pending"}`}
                  >
                    {label(item.status)}
                  </span>
                  <small>{label(item.access_model)}</small>
                </span>
              </summary>
              <p>
                {item.university_name} · Updated {date(item.updated_at)}
                {item.review_note ? ` · Last note: ${item.review_note}` : ""}
              </p>
              <form
                className="form-stack"
                onSubmit={(event) => void review(event, "resources", item.id)}
              >
                <label>
                  Decision
                  <select
                    name="decision"
                    defaultValue={
                      item.status === "PUBLISHED"
                        ? "APPROVED"
                        : "NEEDS_CORRECTION"
                    }
                  >
                    <option value="APPROVED">Approve and publish</option>
                    <option value="NEEDS_CORRECTION">Request changes</option>
                    <option value="REJECTED">Reject</option>
                  </select>
                </label>
                <label>
                  Reviewer note
                  <textarea
                    name="note"
                    minLength={3}
                    required
                    placeholder="Record content, ownership and quality checks."
                  />
                </label>
                <div className="inline-actions">
                  <button
                    className="button button--small"
                    disabled={Boolean(busy)}
                  >
                    {busy === item.id ? "Saving…" : "Save decision"}
                  </button>
                  <button
                    className="text-button text-button--danger"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void remove("resources", item.id, item.title)
                    }
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </form>
            </details>
          ))}
          {!data.resources.length && (
            <div className="empty-row">
              <strong>No learning materials</strong>
              <span>
                Submitted notes, PDFs and audio resources will appear here.
              </span>
            </div>
          )}
        </article>
      </section>
    </>
  );
}

function ContentView({
  context,
  onChanged,
}: {
  context: ContentContext;
  onChanged(): void;
}) {
  const [kind, setKind] = useState<"post" | "place" | "source">("post");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const defaultUniversity = context.universities[0]?.id ?? "";
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (kind === "source")
        await portalApi("/v1/admin/content/sources", {
          method: "POST",
          body: JSON.stringify({
            universityId: form.get("universityId"),
            name: form.get("name"),
            sourceUrl: form.get("sourceUrl") || null,
          }),
        });
      if (kind === "post")
        await portalApi("/v1/admin/content/posts", {
          method: "POST",
          body: JSON.stringify({
            universityId: form.get("universityId"),
            sourceId: form.get("sourceId"),
            category: form.get("category"),
            title: form.get("title"),
            summary: form.get("summary"),
            body: form.get("body"),
            imageUrl: form.get("imageUrl") || null,
            urgent: form.get("urgent") === "on",
            sponsored: false,
            publishNow: form.get("publishNow") === "on",
          }),
        });
      if (kind === "place")
        await portalApi("/v1/admin/content/places", {
          method: "POST",
          body: JSON.stringify({
            universityId: form.get("universityId"),
            name: form.get("name"),
            category: form.get("category"),
            description: form.get("description") || null,
            latitude: form.get("latitude")
              ? Number(form.get("latitude"))
              : null,
            longitude: form.get("longitude")
              ? Number(form.get("longitude"))
              : null,
            accessibilityNotes: form.get("accessibilityNotes") || null,
            imageUrl: form.get("imageUrl") || null,
            publishNow: form.get("publishNow") === "on",
          }),
        });
      setNotice(`${label(kind)} saved successfully.`);
      formElement.reset();
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof PortalApiError
          ? caught.message
          : "Content could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function verifySource(id: string) {
    setBusy(true);
    setError("");
    try {
      await portalApi(`/v1/admin/content/sources/${id}/verify`, {
        method: "POST",
        body: "{}",
      });
      setNotice("Content source verified for 90 days.");
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof PortalApiError
          ? caught.message
          : "Source could not be verified.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="dashboard-grid dashboard-grid--content">
      <article className="panel content-intro">
        <Image
          src="/brand-scenes/campus-life.png"
          alt="Students walking through campus"
          width={1024}
          height={1024}
        />
        <div>
          <p className="section-kicker">Campus publishing</p>
          <h2>Make the student experience feel alive.</h2>
          <p>
            Publish timely campus posts, real locations, and verified sources.
            Image URLs are stored with the content and rendered in the student
            feed.
          </p>
        </div>
      </article>
      <article className="panel">
        <div className="source-strip">
          {context.sources.map((source) => (
            <span key={source.id}>
              <strong>{source.name}</strong>
              <small>
                {source.verified ? "Verified" : "Verification required"}
              </small>
              {!source.verified && (
                <button
                  className="text-button"
                  onClick={() => void verifySource(source.id)}
                >
                  Verify
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="segmented">
          {(["post", "place", "source"] as const).map((item) => (
            <button
              key={item}
              aria-pressed={kind === item}
              onClick={() => setKind(item)}
            >
              New {item}
            </button>
          ))}
        </div>
        <form className="form-stack" onSubmit={create}>
          <label>
            University
            <select
              name="universityId"
              defaultValue={defaultUniversity}
              required
            >
              {context.universities.map((university) => (
                <option value={university.id} key={university.id}>
                  {university.name}
                </option>
              ))}
            </select>
          </label>
          {kind === "post" && (
            <>
              <label>
                Verified source
                <select name="sourceId" required defaultValue="">
                  <option value="" disabled>
                    Select source
                  </option>
                  {context.sources.map((source) => (
                    <option value={source.id} key={source.id}>
                      {source.name}
                      {source.verified ? " · verified" : " · pending"}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-grid">
                <label>
                  Category
                  <select name="category">
                    <option>UPDATE</option>
                    <option>EVENT</option>
                    <option>SPORTS</option>
                    <option>OPPORTUNITY</option>
                    <option>EMERGENCY</option>
                  </select>
                </label>
                <label>
                  Image URL
                  <input name="imageUrl" type="url" placeholder="https://…" />
                </label>
              </div>
              <label>
                Title
                <input name="title" minLength={4} maxLength={180} required />
              </label>
              <label>
                Summary
                <textarea
                  name="summary"
                  minLength={4}
                  maxLength={500}
                  required
                />
              </label>
              <label>
                Full post
                <textarea name="body" minLength={4} required />
              </label>
              <div className="check-row">
                <label>
                  <input type="checkbox" name="urgent" /> Urgent
                </label>
                <label>
                  <input type="checkbox" name="publishNow" /> Publish now
                </label>
              </div>
              {!context.sources.some((source) => source.verified) && (
                <p className="form-error">
                  Create and verify a trusted source before publishing a post.
                </p>
              )}
            </>
          )}
          {kind === "place" && (
            <>
              <div className="form-grid">
                <label>
                  Place name
                  <input name="name" required />
                </label>
                <label>
                  Category
                  <select name="category">
                    <option>ACADEMIC</option>
                    <option>SERVICE</option>
                    <option>TRANSPORT</option>
                    <option>HOSTEL</option>
                    <option>FOOD</option>
                    <option>HEALTH</option>
                    <option>SPORT</option>
                  </select>
                </label>
              </div>
              <label>
                Description
                <textarea name="description" />
              </label>
              <div className="form-grid">
                <label>
                  Latitude
                  <input name="latitude" type="number" step="any" />
                </label>
                <label>
                  Longitude
                  <input name="longitude" type="number" step="any" />
                </label>
              </div>
              <label>
                Accessibility notes
                <input name="accessibilityNotes" />
              </label>
              <label>
                Image URL
                <input name="imageUrl" type="url" />
              </label>
              <label className="checkbox">
                <input type="checkbox" name="publishNow" /> Publish now
              </label>
            </>
          )}
          {kind === "source" && (
            <>
              <label>
                Source name
                <input
                  name="name"
                  minLength={2}
                  maxLength={120}
                  required
                  placeholder="UNIBEN Student Affairs"
                />
              </label>
              <label>
                Official URL
                <input name="sourceUrl" type="url" placeholder="https://…" />
              </label>
              <p className="field-help">
                New sources require a separate administrator verification before
                publishing.
              </p>
            </>
          )}
          {notice && <p className="form-notice">{notice}</p>}
          {error && <p className="form-error">{error}</p>}
          <button
            className="button button--primary"
            disabled={busy || (kind === "post" && !context.sources.length)}
          >
            {busy ? "Saving…" : `Save ${kind}`}
          </button>
        </form>
      </article>
    </section>
  );
}

function OperationsView({
  operations,
  context,
  onChanged,
}: {
  operations: Operations;
  context: ContentContext;
  onChanged(): void;
}) {
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const universityId = context.universities[0]?.id ?? "";
  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await portalApi("/v1/admin/operations/categories", {
        method: "POST",
        body: JSON.stringify({
          universityId: form.get("universityId"),
          name: form.get("name"),
          listingRules: form.get("listingRules") || null,
          status: form.get("status"),
        }),
      });
      setNotice("Product category saved.");
      formElement.reset();
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof PortalApiError
          ? caught.message
          : "Category could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function createZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await portalApi("/v1/admin/operations/zones", {
        method: "POST",
        body: JSON.stringify({
          universityId: form.get("universityId"),
          name: form.get("name"),
          baseFeeKobo: Math.round(Number(form.get("fee")) * 100),
          active: form.get("active") === "on",
        }),
      });
      setNotice("Delivery zone saved.");
      formElement.reset();
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof PortalApiError
          ? caught.message
          : "Zone could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function reviewDispute(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await portalApi(`/v1/admin/operations/disputes/${id}/review`, {
        method: "POST",
        body: JSON.stringify({
          status: form.get("status"),
          resolutionCode: form.get("resolutionCode") || null,
          note: form.get("note"),
        }),
      });
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof PortalApiError
          ? caught.message
          : "Dispute review failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function reviewPayout(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await portalApi(`/v1/admin/operations/payouts/${id}/review`, {
        method: "POST",
        body: JSON.stringify({
          status: form.get("status"),
          note: form.get("note"),
          providerReference: form.get("providerReference") || null,
        }),
      });
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof PortalApiError
          ? caught.message
          : "Payout review failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function reviewPaymentEvent(
    event: FormEvent<HTMLFormElement>,
    id: string,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await portalApi(`/v1/admin/operations/payment-events/${id}/review`, {
        method: "POST",
        body: JSON.stringify({
          resolutionCode: form.get("resolutionCode"),
          note: form.get("note"),
        }),
      });
      setNotice(
        "External reconciliation evidence recorded; this note did not move funds.",
      );
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof PortalApiError
          ? caught.message
          : "Payment event review failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function releaseEligible() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await portalApi<{
        released: { bookings: number; orders: number; deliveries: number };
      }>("/v1/admin/operations/release-eligible-earnings", {
        method: "POST",
        body: "{}",
      });
      setNotice(
        `Released ${result.released.bookings} tutorial, ${result.released.orders} vendor, and ${result.released.deliveries} rider earning records.`,
      );
      onChanged();
    } catch (caught) {
      setError(
        caught instanceof PortalApiError
          ? caught.message
          : "Earnings release failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="metric-grid">
        <article className="metric-card">
          <span>Product categories</span>
          <strong>{operations.categories.length}</strong>
          <small>
            {
              operations.categories.filter((item) => item.status === "APPROVED")
                .length
            }{" "}
            approved
          </small>
        </article>
        <article className="metric-card">
          <span>Delivery zones</span>
          <strong>{operations.zones.length}</strong>
          <small>
            {operations.zones.filter((item) => item.active).length} active
          </small>
        </article>
        <article className="metric-card">
          <span>Open disputes</span>
          <strong>
            {
              operations.disputes.filter((item) =>
                ["OPEN", "UNDER_REVIEW"].includes(item.status),
              ).length
            }
          </strong>
          <small>Financial release remains frozen</small>
        </article>
        <article className="metric-card">
          <span>Payment review queue</span>
          <strong>
            {
              operations.paymentEvents.filter(
                (item) => item.state === "REQUIRES_REVIEW",
              ).length
            }
          </strong>
          <small>Late, unknown, or mismatched payments</small>
        </article>
        <article className="metric-card metric-card--accent">
          <span>Payout review queue</span>
          <strong>
            {
              operations.payoutRequests.filter((item) =>
                [
                  "REQUESTED",
                  "IN_REVIEW",
                  "APPROVED",
                  "PROCESSING",
                  "FAILED",
                ].includes(item.status),
              ).length
            }
          </strong>
          <small>Every decision is audited</small>
        </article>
      </section>
      {notice && <p className="form-notice operations-notice">{notice}</p>}
      {error && <p className="form-error operations-notice">{error}</p>}
      <section className="dashboard-grid dashboard-grid--equal">
        <article className="panel">
          <p className="section-kicker">Controlled catalogue</p>
          <h2>Product categories</h2>
          <div className="compact-chips">
            {operations.categories.map((item) => (
              <span key={item.id}>
                {item.name}
                <small>{label(item.status)}</small>
              </span>
            ))}
          </div>
          <form className="form-stack sub-form" onSubmit={createCategory}>
            <label>
              University
              <select name="universityId" defaultValue={universityId}>
                {context.universities.map((university) => (
                  <option value={university.id} key={university.id}>
                    {university.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <label>
                Category name
                <input name="name" required />
              </label>
              <label>
                State
                <select name="status">
                  <option value="APPROVED">Approved</option>
                  <option value="PENDING">Pending</option>
                  <option value="RESTRICTED">Restricted</option>
                  <option value="PROHIBITED">Prohibited</option>
                </select>
              </label>
            </div>
            <label>
              Listing rules
              <textarea
                name="listingRules"
                placeholder="Allowed products, weight, safety and fulfilment rules."
              />
            </label>
            <button className="button button--secondary" disabled={busy}>
              Save category
            </button>
          </form>
        </article>
        <article className="panel">
          <p className="section-kicker">Campus logistics</p>
          <h2>Delivery zones and fees</h2>
          <div className="compact-chips">
            {operations.zones.map((item) => (
              <span key={item.id}>
                {item.name}
                <small>
                  {money(item.base_fee_kobo)} ·{" "}
                  {item.active ? "active" : "paused"}
                </small>
              </span>
            ))}
          </div>
          <form className="form-stack sub-form" onSubmit={createZone}>
            <label>
              University
              <select name="universityId" defaultValue={universityId}>
                {context.universities.map((university) => (
                  <option value={university.id} key={university.id}>
                    {university.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <label>
                Zone name
                <input name="name" required />
              </label>
              <label>
                Delivery fee (₦)
                <input name="fee" type="number" min="0" required />
              </label>
            </div>
            <label className="checkbox">
              <input type="checkbox" name="active" defaultChecked /> Accept new
              orders in this zone
            </label>
            <button className="button button--secondary" disabled={busy}>
              Save zone
            </button>
          </form>
        </article>
      </section>
      <section className="dashboard-grid dashboard-grid--equal">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Support queue</p>
              <h2>Disputes</h2>
            </div>
          </div>
          {operations.disputes.map((item) => (
            <details className="review-item" key={item.id}>
              <summary>
                <span>
                  <strong>{label(item.category)}</strong>
                  <small>
                    {item.opened_by_email} · {date(item.created_at)}
                  </small>
                </span>
                <span
                  className={`state-badge state-badge--${item.status === "OPEN" ? "attention" : "pending"}`}
                >
                  {label(item.status)}
                </span>
              </summary>
              <p>{item.reason}</p>
              <form
                className="form-stack"
                onSubmit={(event) => void reviewDispute(event, item.id)}
              >
                <label>
                  Status
                  <select name="status">
                    <option value="UNDER_REVIEW">Under review</option>
                    <option value="RESOLVED">Resolved</option>
                    <option value="CLOSED">Closed</option>
                  </select>
                </label>
                <label>
                  Resolution
                  <select name="resolutionCode" defaultValue="">
                    <option value="">No final resolution</option>
                    <option value="RELEASE_EARNINGS">Release earnings</option>
                    <option value="REFUND_REQUIRED">Refund required</option>
                    <option value="NO_ACTION">No action</option>
                    <option value="PARTIAL_REFUND_REVIEW">
                      Partial refund review
                    </option>
                  </select>
                </label>
                <label>
                  Decision note
                  <textarea name="note" minLength={10} required />
                </label>
                <button className="button button--small" disabled={busy}>
                  Save decision
                </button>
              </form>
            </details>
          ))}
          {!operations.disputes.length && (
            <div className="empty-row">
              <strong>No disputes</strong>
              <span>Linked purchase disputes will appear here.</span>
            </div>
          )}
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Finance queue</p>
              <h2>Payout requests</h2>
            </div>
            <button
              className="button button--small"
              disabled={busy}
              onClick={() => void releaseEligible()}
            >
              Release eligible
            </button>
          </div>
          {operations.payoutRequests.map((item) => (
            <details className="review-item" key={item.id}>
              <summary>
                <span>
                  <strong>
                    {item.display_name} · {label(item.agent_type)}
                  </strong>
                  <small>
                    {item.email} · {date(item.requested_at)}
                  </small>
                </span>
                <span>
                  <strong>{money(item.amount_kobo)}</strong>
                  <small>{label(item.status)}</small>
                </span>
              </summary>
              <form
                className="form-stack"
                onSubmit={(event) => void reviewPayout(event, item.id)}
              >
                <label>
                  Next state
                  <select name="status">
                    <option value="IN_REVIEW">In review</option>
                    <option value="APPROVED">Approved</option>
                    <option value="PROCESSING">Processing</option>
                    <option value="PAID">Paid</option>
                    <option value="FAILED">Failed</option>
                    <option value="REJECTED">Rejected</option>
                  </select>
                </label>
                <label>
                  Provider reference
                  <input
                    name="providerReference"
                    placeholder="Required when marking paid"
                  />
                </label>
                <label>
                  Finance note
                  <textarea name="note" minLength={3} required />
                </label>
                <button className="button button--small" disabled={busy}>
                  Save finance decision
                </button>
              </form>
            </details>
          ))}
          {!operations.payoutRequests.length && (
            <div className="empty-row">
              <strong>No payout requests</strong>
              <span>Eligible agent requests will appear here.</span>
            </div>
          )}
        </article>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Payment reconciliation</p>
            <h2>Provider events</h2>
          </div>
          <span className="data-label">
            {operations.paymentEvents.length} recent events
          </span>
        </div>
        {operations.paymentEvents.map((item) => (
          <details className="review-item" key={item.id}>
            <summary>
              <span>
                <strong>
                  {item.provider} · {item.provider_reference}
                </strong>
                <small>
                  {item.resource_type
                    ? label(item.resource_type)
                    : "Unknown resource"}{" "}
                  · {date(item.received_at)}
                </small>
              </span>
              <span>
                <strong>{money(item.amount_kobo)}</strong>
                <small>{label(item.state)}</small>
              </span>
            </summary>
            <p>
              {item.review_reason
                ? label(item.review_reason)
                : item.resolution_code
                  ? `Resolved: ${label(item.resolution_code)}`
                  : "Provider event processed normally."}
            </p>
            {item.state === "REQUIRES_REVIEW" && (
              <form
                className="form-stack"
                onSubmit={(event) => void reviewPaymentEvent(event, item.id)}
              >
                <label>
                  Resolution
                  <select name="resolutionCode">
                    <option value="REFUNDED">Refunded</option>
                    <option value="MATCHED_MANUALLY">Matched manually</option>
                    <option value="DUPLICATE_CONFIRMED">
                      Duplicate confirmed
                    </option>
                    <option value="REJECTED_AS_INVALID">
                      Rejected as invalid
                    </option>
                  </select>
                </label>
                <label>
                  Reconciliation note
                  <textarea name="note" minLength={10} required />
                </label>
                <button className="button button--small" disabled={busy}>
                  Resolve event
                </button>
              </form>
            )}
          </details>
        ))}
        {!operations.paymentEvents.length && (
          <div className="empty-row">
            <strong>No provider events</strong>
            <span>
              Successful payment webhooks and exceptions will appear here.
            </span>
          </div>
        )}
      </section>
    </>
  );
}

function AuditView({ events }: { events: AuditEvent[] }) {
  return (
    <section className="panel table-panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Immutable evidence</p>
          <h2>Privileged activity</h2>
        </div>
        <span className="data-label">{events.length} recent events</span>
      </div>
      <div className="data-table">
        <div className="table-row table-row--audit table-row--head">
          <span>Event</span>
          <span>Target</span>
          <span>Outcome</span>
          <span>Time</span>
        </div>
        {events.map((event) => (
          <div className="table-row table-row--audit" key={event.id}>
            <span>
              <strong>{label(event.action.replaceAll(".", "_"))}</strong>
              <small>Request {event.request_id}</small>
            </span>
            <span>
              <strong>{label(event.target_type)}</strong>
              <small>{event.target_id || "System"}</small>
            </span>
            <span>
              <span
                className={`state-badge state-badge--${event.outcome === "SUCCESS" ? "live" : "attention"}`}
              >
                {label(event.outcome)}
              </span>
            </span>
            <span>{date(event.occurred_at)}</span>
          </div>
        ))}
      </div>
      {!events.length && (
        <div className="empty-row">
          <strong>No privileged actions recorded yet</strong>
          <span>
            Reviews, publishing, bootstrap, and delivery assignments will appear
            here.
          </span>
        </div>
      )}
    </section>
  );
}
