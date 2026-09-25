"use client";
import { useEffect, useState } from "react";
import { portalApi } from "@/lib/api";
import { useAdminContext } from "./admin-context";
import { PortalShell } from "./portal-shell";
type Row = Record<string, string | number | null>;
type Engagement = { days: number; generatedAt: string; definition: string; totals: { events: number; active_users: number; collection_started_at: string | null }; daily: Row[]; screens: Row[]; universities: Row[]; retention: { eligible_users: number; returned_users: number } };
type AiUsage = { usage: Row[]; configuration: { enabled: boolean; textConfigured: boolean; visionConfigured: boolean } };
const label = (key: string) => key.replaceAll("_", " ");
function Table({ title, rows, columns }: { title: string; rows: Row[]; columns: string[] }) {
  function download() {
    const cell = (value: unknown) => { const text = String(value ?? "");return '"' + (/^[=+@\-\t\r]/.test(text) ? "'" : "") + text.replaceAll('"', '""') + '"'; };
    const url = URL.createObjectURL(new Blob([[columns.map(cell).join(","), ...rows.map(row => columns.map(key => cell(row[key])).join(","))].join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");link.href = url;link.download = title.toLowerCase().replaceAll(" ", "-") + ".csv";link.click();setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="panel"><div className="workspace-toolbar"><h2>{title}</h2><button className="button button--secondary" disabled={!rows.length} onClick={download}>Export CSV</button></div><div className="table-scroll"><table className="operational-table"><thead><tr>{columns.map(key => <th key={key}>{label(key)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)}>{columns.map(key => <td key={key}>{row[key] ?? "—"}</td>)}</tr>)}</tbody></table>{!rows.length && <p className="table-empty">No recorded activity in this period.</p>}</div></section>;
}
function DailyActivity({ rows }: { rows: Row[] }) {
  if (!rows.length) return null;
  const maximum = Math.max(1, ...rows.map(row => Number(row.active_users) || 0));
  const width = 640, height = 180, gap = width / rows.length;
  return <section className="panel"><h2>Active accounts by day</h2><p className="field-help">Recorded days in West Africa Time. Exact values are in the table below.</p>
    <svg viewBox={`0 0 ${width} ${height + 28}`} role="img" aria-label={`Daily active accounts from ${rows[0].day} to ${rows.at(-1)?.day}; highest daily count ${maximum}.`} style={{ width: "100%", maxHeight: 240, color: "var(--k1-brand-600)" }}>
      {rows.map((row, index) => { const barHeight = ((Number(row.active_users) || 0) / maximum) * (height - 12); return <rect key={String(row.day)} x={index * gap + gap * 0.15} y={height - barHeight} width={gap * 0.7} height={barHeight} rx={Math.min(3, gap * 0.12)} fill="currentColor"><title>{`${row.day}: ${row.active_users} active accounts`}</title></rect>; })}
      <text x={0} y={height + 24} fontSize={13} fill="currentColor">{String(rows[0].day)}</text>
      <text x={width} y={height + 24} textAnchor="end" fontSize={13} fill="currentColor">{String(rows.at(-1)?.day)}</text>
    </svg>
  </section>;
}
export function UsageReport({ kind }: { kind: "engagement" | "ai" }) {
  const { scopedPath, scopeLabel, can } = useAdminContext();
  const [days, setDays] = useState(30), [retry, setRetry] = useState(0);
  const permission = kind === "ai" ? "ai.view" : "analytics.view";
  const path = scopedPath(`/v1/admin/reports/${kind}?days=${days}`), key = `${path}:${retry}`;
  const [loaded, setLoaded] = useState<{ key: string; data?: Engagement | AiUsage; error?: string }>();
  useEffect(() => {
    if (!can(permission)) return;
    const controller = new AbortController();
    void portalApi<Engagement | AiUsage>(path, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setLoaded({ key, data }); }).catch(e => { if (!controller.signal.aborted) setLoaded({ key, error: e instanceof Error ? e.message : "Report could not load." }); });
    return () => controller.abort();
  }, [key, path, can, permission]);
  const current = loaded?.key === key ? loaded : undefined;
  const data = current?.data;
  return <PortalShell active="admin" eyebrow={scopeLabel} title={kind === "ai" ? "AI usage & configuration" : "Engagement reports"} description={kind === "ai" ? "Request states for the past 30 days. Prompts, attachments and answers stay private." : "Measured activity from this app’s event records."}>
    {!can(permission) ? <section className="state-panel">Your staff permissions do not include this report.</section> : <>
      <div className="workspace-toolbar">{kind === "engagement" && <label>Period<select value={days} onChange={e => setDays(Number(e.target.value))}>{[7, 30, 90].map(n => <option key={n} value={n}>Last {n} days</option>)}</select></label>}<button className="button button--secondary" onClick={() => setRetry(v => v + 1)}>Refresh</button></div>
      {current?.error ? <section className="state-panel state-panel--error" role="alert"><p>{current.error}</p><button className="button button--secondary" onClick={() => setRetry(v => v + 1)}>Retry</button></section> : !data ? <div className="table-skeleton" aria-label="Loading report"><div /><div /><div /></div> : "totals" in data ? <>
        <div className="workspace-toolbar"><p><strong>{data.totals.active_users}</strong> active accounts</p><p><strong>{data.totals.events}</strong> recorded events</p><p>Return rate: <strong>{data.retention.eligible_users ? `${Math.round(100 * data.retention.returned_users / data.retention.eligible_users)}%` : "Not enough history"}</strong></p></div>
        <p className="field-help">{data.definition} First collected: {data.totals.collection_started_at ? new Date(data.totals.collection_started_at).toLocaleDateString() : "No records"}.</p>
        <DailyActivity rows={data.daily} />
        <Table title="Daily activity" rows={data.daily} columns={["day", "active_users", "events"]} /><Table title="Screen usage" rows={data.screens} columns={["screen", "views", "active_users"]} /><Table title="University comparison" rows={data.universities} columns={["name", "active_users", "events"]} />
      </> : <>
        <div className="workspace-toolbar"><p>AI: <strong>{data.configuration.enabled ? "Enabled" : "Paused"}</strong></p><p>Text credentials: <strong>{data.configuration.textConfigured ? "Configured" : "Missing"}</strong></p><p>Vision credentials: <strong>{data.configuration.visionConfigured ? "Configured" : "Missing"}</strong></p></div>
        <p className="field-help">Configured credentials do not prove provider availability. Billed cost and provider latency have not been measured.</p><Table title="AI requests" rows={data.usage} columns={["mode", "status", "requests", "latest_at"]} />
      </>}
    </>}
  </PortalShell>;
}
