"use client";
import { useEffect, useState } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
import { PortalShell } from "./portal-shell";
import { GoogleAnalyticsReport } from "./google-analytics-report";
import { DailyActivity } from "./daily-activity";
import { downloadCsv } from "@/lib/csv";
import { DailyAppReport } from "./daily-app-report";
type Row = Record<string, string | number | null>;
type Engagement = {
  days: number;
  generatedAt: string;
  definition: string;
  totals: {
    events: number;
    active_users: number;
    collection_started_at: string | null;
  };
  daily: Row[];
  screens: Row[];
  universities: Row[];
  platforms: Row[];
  interactions: Row[];
  platformReady: boolean;
  retention: { eligible_users: number; returned_users: number };
};
type AiUsage = {
  usage: Row[];
  configuration: {
    enabled: boolean;
    textConfigured: boolean;
    visionConfigured: boolean;
  };
};
type PendingReport = { ready: false; message: string };
const label = (key: string) => key.replaceAll("_", " ");
function Table({
  title,
  rows,
  columns,
}: {
  title: string;
  rows: Row[];
  columns: string[];
}) {
  function download() {
    downloadCsv(
      title.toLowerCase().replaceAll(" ", "-") + ".csv",
      columns,
      rows,
    );
  }
  return (
    <section className="panel">
      <div className="workspace-toolbar">
        <h2>{title}</h2>
        <button
          className="button button--secondary"
          disabled={!rows.length}
          onClick={download}
        >
          Export CSV
        </button>
      </div>
      <div className="table-scroll">
        <table className="operational-table">
          <thead>
            <tr>
              {columns.map((key) => (
                <th key={key}>{label(key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={String(row.id ?? index)}>
                {columns.map((key) => (
                  <td key={key}>{row[key] ?? "—"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="table-empty">No recorded activity in this period.</p>
        )}
      </div>
    </section>
  );
}
export function UsageReport({ kind }: { kind: "engagement" | "ai" }) {
  const { scopedPath, scopeLabel, can } = useAdminContext();
  const [days, setDays] = useState(30),
    [retry, setRetry] = useState(0),
    [platform, setPlatform] = useState("");
  const permission = kind === "ai" ? "ai.view" : "analytics.view";
  const path = scopedPath(
      `/v1/admin/reports/${kind}?days=${days}&platform=${platform}`,
    ),
    key = `${path}:${retry}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    data?: Engagement | AiUsage | PendingReport;
    error?: string;
  }>();
  useEffect(() => {
    if (!can(permission)) return;
    const controller = new AbortController();
    void portalApi<Engagement | AiUsage | PendingReport>(path, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setLoaded({ key, data });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setLoaded({
            key,
            error: e instanceof Error ? e.message : "Report could not load.",
          });
      });
    return () => controller.abort();
  }, [key, path, can, permission]);
  const current = loaded?.key === key ? loaded : undefined;
  const data = current?.data;
  return (
    <PortalShell
      active="admin"
      eyebrow={scopeLabel}
      title={kind === "ai" ? "AI usage & configuration" : "Engagement reports"}
      description={
        kind === "ai"
          ? "Request states for the past 30 days. Prompts, attachments and answers stay private."
          : "Measured activity from this app’s event records."
      }
    >
      {!can(permission) ? (
        <section className="state-panel">
          Your staff permissions do not include this report.
        </section>
      ) : (
        <>
          {kind === "engagement" && <DailyAppReport refresh={retry} />}
          <div className="workspace-toolbar">
            {kind === "engagement" && (
              <>
                <label>
                  Period
                  <select
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  >
                    {[7, 30, 90].map((n) => (
                      <option key={n} value={n}>
                        Last {n} days
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Recorded app platform
                  <select
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                  >
                    <option value="">All platforms</option>
                    <option value="android">Android</option>
                    <option value="ios">iPhone / iPad</option>
                    <option value="web">Web</option>
                    <option value="unknown">
                      Unclassified historical events
                    </option>
                  </select>
                </label>
              </>
            )}
            <button
              className="button button--secondary"
              onClick={() => setRetry((v) => v + 1)}
            >
              Refresh
            </button>
          </div>
          {current?.error ? (
            <section className="state-panel state-panel--error" role="alert">
              <p>{current.error}</p>
              <button
                className="button button--secondary"
                onClick={() => setRetry((v) => v + 1)}
              >
                Retry
              </button>
            </section>
          ) : !data ? (
            <div className="table-skeleton" aria-label="Loading report">
              <div />
              <div />
              <div />
            </div>
          ) : "ready" in data ? (
            <section className="state-panel" role="status">
              <p>{data.message}</p>
            </section>
          ) : "totals" in data ? (
            <>
              <div className="workspace-toolbar">
                <p>
                  <strong>{data.totals.active_users}</strong> active accounts
                </p>
                <p>
                  <strong>{data.totals.events}</strong> recorded events
                </p>
                <p>
                  Return rate:{" "}
                  <strong>
                    {data.retention.eligible_users
                      ? `${Math.round((100 * data.retention.returned_users) / data.retention.eligible_users)}%`
                      : "Not enough history"}
                  </strong>
                </p>
              </div>
              <p className="field-help">
                {data.definition} First collected:{" "}
                {data.totals.collection_started_at
                  ? new Date(
                      data.totals.collection_started_at,
                    ).toLocaleDateString()
                  : "No records"}
                .
              </p>
              {!data.platformReady && (
                <p className="workspace-notice">
                  Platform and interaction collection awaits the queued database
                  migration. Historical records remain available.
                </p>
              )}
              <div className="analytics-metrics">
                {data.platforms.map((row) => (
                  <article className="metric-card" key={String(row.platform)}>
                    <span>
                      {{
                        ios: "iPhone / iPad",
                        android: "Android",
                        web: "Web",
                        unknown: "Unclassified",
                      }[String(row.platform)] ?? row.platform}
                    </span>
                    <strong>{Number(row.active_users).toLocaleString()}</strong>
                    <small>
                      {Number(row.events).toLocaleString()} recorded events
                    </small>
                  </article>
                ))}
              </div>
              <DailyActivity rows={data.daily} />
              <Table
                title="Daily activity"
                rows={data.daily}
                columns={["day", "active_users", "events"]}
              />
              <Table
                title="Screen usage"
                rows={data.screens}
                columns={["screen", "views", "active_users"]}
              />
              <Table
                title="University comparison"
                rows={data.universities}
                columns={["name", "active_users", "events"]}
              />
              <Table
                title="Buttons, content actions & scroll milestones"
                rows={data.interactions}
                columns={[
                  "screen",
                  "event",
                  "action",
                  "component",
                  "percent_scrolled",
                  "events",
                  "active_users",
                ]}
              />
            </>
          ) : (
            <>
              <div className="workspace-toolbar">
                <p>
                  AI:{" "}
                  <strong>
                    {data.configuration.enabled ? "Enabled" : "Paused"}
                  </strong>
                </p>
                <p>
                  Text credentials:{" "}
                  <strong>
                    {data.configuration.textConfigured
                      ? "Configured"
                      : "Missing"}
                  </strong>
                </p>
                <p>
                  Vision credentials:{" "}
                  <strong>
                    {data.configuration.visionConfigured
                      ? "Configured"
                      : "Missing"}
                  </strong>
                </p>
              </div>
              <p className="field-help">
                Configured credentials do not prove provider availability.
                Billed cost and provider latency have not been measured.
              </p>
              <Table
                title="AI requests"
                rows={data.usage}
                columns={["mode", "status", "requests", "latest_at"]}
              />
            </>
          )}
          {kind === "engagement" && (
            <GoogleAnalyticsReport days={days} refresh={retry} />
          )}
        </>
      )}
    </PortalShell>
  );
}
