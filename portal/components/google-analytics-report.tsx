"use client";
import { useEffect, useState } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
import { downloadCsv } from "@/lib/csv";
import { DailyActivity } from "./daily-activity";
import {ScreenTimeReport} from './screen-time-report';
import {HorizontalBars} from './analytics-visuals';
type Row = Record<string, string | number>;
type Report =
  | {
      state: "ready";
      generatedAt: string;
      days: number;
      platformDimension: string;
      totals: Row;
      daily: Row[];
      platforms: Row[];
      screens: Row[];
      events: Row[];
      timeZone: string | null;
      limited: boolean;
      thresholded: boolean;
    }
  | {
      state: "paused" | "setup_required" | "unavailable" | "scope_limited";
      message: string;
    };
function Values({ title, rows }: { title: string; rows: Row[] }) {
  const columns = rows.length ? Object.keys(rows[0]!) : [];
  const labelColumn = columns.find((column) => typeof rows[0]?.[column] === "string");
  const numericColumn = columns
    .filter((column) => column !== labelColumn)
    .sort((a, b) => {
      const score = (key: string) =>
        /activeUsers|screenPageViews|eventCount|sessions|userEngagementDuration/i.test(key)
          ? 1
          : 0;
      return score(b) - score(a);
    })
    .find((column) => rows.some((row) => Number.isFinite(Number(row[column]))));
  const chartRows =
    labelColumn && numericColumn
      ? rows.map((row) => ({
          label: String(row[labelColumn]),
          value: Number(row[numericColumn]) || 0,
        }))
      : [];
  return (
    <section className="panel">
      {chartRows.length ? (
        <HorizontalBars
          title={`${title} · ${numericColumn?.replace("customEvent:", "")}`}
          rows={chartRows}
          limit={12}
        />
      ) : null}
      <div className="panel-heading">
        <h3>{title}</h3>
        <button
          className="button button--secondary"
          disabled={!rows.length}
          onClick={() =>
            downloadCsv(
              `ga4-${title.toLowerCase().replaceAll(" ", "-")}.csv`,
              columns,
              rows,
            )
          }
        >
          Export CSV
        </button>
      </div>
      <div className="table-scroll">
        <table className="operational-table">
          <thead>
            <tr>
              {columns.map((k) => (
                <th key={k}>{k.replace("customEvent:", "")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {columns.map((k) => (
                  <td key={k}>{r[k]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="table-empty">GA4 returned no rows in this period.</p>
        )}
      </div>
    </section>
  );
}
export function GoogleAnalyticsReport({
  days,
  refresh,
}: {
  days: number;
  refresh: number;
}) {
  const { can, scopedPath } = useAdminContext(),
    path = scopedPath(`/v1/admin/reports/google-analytics?days=${days}`),
    key = `${path}:${refresh}`,
    [loaded, setLoaded] = useState<{
      key: string;
      data?: Report;
      error?: string;
    }>();
  useEffect(() => {
    if (!can("analytics.view")) return;
    const controller = new AbortController();
    void portalApi<Report>(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setLoaded({ key, data });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setLoaded({
            key,
            error: e instanceof Error ? e.message : "GA4 report unavailable.",
          });
      });
    return () => controller.abort();
  }, [path, key, can]);
  const value = loaded?.key === key ? loaded : undefined,
    data = value?.data;
  if (!can("analytics.view")) return null;
  return (
    <section className="ga4-workspace">
      <ScreenTimeReport/>
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Google Analytics 4</p>
          <h2>Connected property reports</h2>
        </div>
      </div>
      {!value ? (
        <div className="table-skeleton" aria-label="Loading GA4 report">
          <div />
          <div />
        </div>
      ) : value.error ? (
        <p role="alert" className="state-panel state-panel--error">
          {value.error}
        </p>
      ) : data?.state !== "ready" ? (
        <div className="state-panel">
          <strong>
            {data?.state === "paused"
              ? "Reporting paused"
              : data?.state === "scope_limited"
                ? "Platform property"
                : data?.state === "setup_required"
                  ? "Reporting connection needed"
                  : "Report temporarily unavailable"}
          </strong>
          <p>{data?.message}</p>
        </div>
      ) : (
        <>
          <p className="field-help">
            GA4 property data for the last {days} days. Property time zone:{" "}
            {data.timeZone ?? "Not returned"}. Retrieved{" "}
            {new Date(data.generatedAt).toLocaleString()}. May lag behind recent
            app activity; counts use GA4’s definitions and can differ from
            recorded account activity.
          </p>
          {(data.limited || data.thresholded) && (
            <p className="workspace-notice">
              {data.limited
                ? "Some GA4 report rows exceed the 1,000-row limit. "
                : ""}
              {data.thresholded
                ? "GA4 reports thresholding or grouped data for this period. Values may be incomplete."
                : ""}
            </p>
          )}
          <div className="analytics-metrics">
            {Object.entries(data.totals).map(([k, v]) => (
              <article className="metric-card" key={k}>
                <span>
                  {{
                    activeUsers: "GA4 active users",
                    sessions: "Sessions",
                    screenPageViews: "Page and screen views",
                    eventCount: "Events",
                  }[k] ?? k}
                </span>
                <strong>
                  {typeof v === "number" ? v.toLocaleString() : v}
                </strong>
              </article>
            ))}
          </div>
          {!Object.keys(data.totals).length && (
            <p className="state-panel">
              GA4 returned no aggregate measurements for this period.
            </p>
          )}
          <DailyActivity
            rows={data.daily.map((row) => ({
              day: String(row.date).replace(
                /^(\d{4})(\d{2})(\d{2})$/,
                "$1-$2-$3",
              ),
              active_users: Number(row.activeUsers),
            }))}
            title="GA4 active users by day"
            description={`Reported days in the GA4 property time zone (${data.timeZone ?? "not returned"}). Missing days remain gaps; exact values are below.`}
          />
          <Values title="Daily GA4 activity" rows={data.daily} />
          <Values
            title={
              data.platformDimension === "platform"
                ? "GA4 stream platforms"
                : "GA4 app platforms"
            }
            rows={data.platforms}
          />
          <Values title="GA4 screen activity" rows={data.screens} />
          <Values title="GA4 event activity" rows={data.events} />
        </>
      )}
    </section>
  );
}
