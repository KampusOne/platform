"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
import { DailyActivity } from "./daily-activity";
type Report =
  | { ready: false; message: string }
  | {
      totals: { active_users: number; events: number };
      daily: Record<string, string | number | null>[];
      platforms: Record<string, string | number | null>[];
      generatedAt: string;
      platformReady: boolean;
    };
export function ActivityOverview({ refresh }: { refresh: number }) {
  const { scopedPath, can } = useAdminContext(),
    path = scopedPath("/v1/admin/reports/engagement?days=30"),
    key = `${path}:${refresh}`,
    [loaded, setLoaded] = useState<{
      key: string;
      data?: Report;
      error?: string;
    }>();
  useEffect(() => {
    if (!can("analytics.view")) return;
    const c = new AbortController();
    void portalApi<Report>(path, { signal: c.signal })
      .then((data) => {
        if (!c.signal.aborted) setLoaded({ key, data });
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setLoaded({
            key,
            error:
              e instanceof Error ? e.message : "Activity report unavailable.",
          });
      });
    return () => c.abort();
  }, [path, key, can]);
  if (!can("analytics.view")) return null;
  const value = loaded?.key === key ? loaded : undefined,
    data = value?.data;
  return (
    <section className="activity-overview">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Recorded activity · last 30 days</p>
          <h2>People using KampusOne</h2>
        </div>
        <Link className="text-link" href="/admin/reports">
          All reports
        </Link>
      </div>
      {!value ? (
        <div className="table-skeleton" aria-label="Loading activity">
          <div />
          <div />
        </div>
      ) : value.error ? (
        <p role="alert" className="state-panel state-panel--error">
          {value.error}
        </p>
      ) : data && "ready" in data && data.ready === false ? (
        <p className="state-panel" role="status">
          {data.message}
        </p>
      ) : (
        data &&
        "totals" in data && (
          <>
            <div className="analytics-metrics">
              <article className="metric-card metric-card--accent">
                <span>Active accounts</span>
                <strong>{data.totals.active_users.toLocaleString()}</strong>
                <small>
                  {data.totals.events.toLocaleString()} recorded events
                </small>
              </article>
              {data.platforms.map((row) => (
                <article className="metric-card" key={String(row.platform)}>
                  <span>
                    {{
                      ios: "iPhone / iPad",
                      android: "Android",
                      web: "Web",
                      unknown: "Unclassified",
                    }[String(row.platform)] ?? String(row.platform)}
                  </span>
                  <strong>{Number(row.active_users).toLocaleString()}</strong>
                  <small>{Number(row.events).toLocaleString()} events</small>
                </article>
              ))}
            </div>
            <DailyActivity rows={data.daily} />
            <p className="field-help">
              Recorded accounts, not installs or estimated users. An account can
              use more than one platform.
              {!data.platformReady
                ? " Platform collection awaits the database update."
                : ""}{" "}
              Updated {new Date(data.generatedAt).toLocaleString()}.
            </p>
          </>
        )
      )}
    </section>
  );
}
