"use client";

import { useCallback, useEffect, useState } from "react";

import { PortalShell } from "@/components/portal-shell";
import { PortalApiError, portalApi } from "@/lib/api";

type Live = { status: "ok"; service: string; environment: string; requestId: string };
type Ready = { status: "ready" | "not_ready"; checks: Record<string, boolean>; requestId: string };
type Config = { environment: string; maintenance: boolean; minimumAppVersion: string; features: Record<string, boolean> };
type Phase = { phase_key: string; title: string; status: string; summary: string; requirements: string[] | Record<string, unknown>; updated_at: string };

const label = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());

export function EngineeringDashboard() {
  const [state, setState] = useState<{ live: Live; ready: Ready; config: Config; phases: Phase[] } | null>(null);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(true); const [key, setKey] = useState(0);
  const reload = useCallback(() => { setLoading(true); setError(""); setKey((value) => value + 1); }, []);
  useEffect(() => { let active = true; void Promise.all([portalApi<Live>("/health/live"), portalApi<Ready>("/health/ready"), portalApi<Config>("/v1/config/public"), portalApi<{ phases: Phase[] }>("/v1/admin/release-phases")]).then(([live, ready, config, phases]) => { if (active) setState({ live, ready, config, phases: phases.phases }); }).catch((caught) => { if (active) setError(caught instanceof PortalApiError ? caught.message : "System evidence could not be loaded."); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [key]);
  return <PortalShell active="engineering" eyebrow="Engineering · Runtime evidence" title="System status and release gates" description="Live service responses and explicit requirements determine whether a capability is ready—not a preview label or a hard-coded badge." actions={<button className="button button--secondary" onClick={reload}>Run checks again</button>}>
    {loading && <section className="state-panel"><span className="spinner" /><strong>Checking live services…</strong></section>}
    {!loading && error && <section className="state-panel state-panel--error"><strong>System evidence unavailable</strong><p>{error}</p><button className="button button--secondary" onClick={reload}>Try again</button></section>}
    {!loading && state && <>
      <section className="system-strip"><div><span>API process</span><strong><i className="status-dot status-dot--online" />{label(state.live.status)}</strong></div><div><span>Provider readiness</span><strong><i className={`status-dot ${state.ready.status === "ready" ? "status-dot--online" : "status-dot--attention"}`} />{label(state.ready.status)}</strong></div><div><span>Environment</span><strong>{label(state.config.environment)}</strong></div><div><span>Minimum app</span><strong>{state.config.minimumAppVersion}</strong></div></section>
      <section className="dashboard-grid dashboard-grid--equal">
        <article className="panel"><div className="panel-heading"><div><p className="section-kicker">Provider checks</p><h2>Release-critical configuration</h2></div><span className="data-label">Request {state.ready.requestId.slice(0, 8)}</span></div><div className="check-list">{Object.entries(state.ready.checks).map(([name, ok]) => <div key={name}><span className={`check-icon ${ok ? "check-icon--good" : "check-icon--bad"}`}>{ok ? "✓" : "!"}</span><span><strong>{label(name)}</strong><small>{ok ? "Configured" : "Required before release"}</small></span></div>)}</div></article>
        <article className="panel"><div className="panel-heading"><div><p className="section-kicker">Runtime flags</p><h2>Capabilities in this environment</h2></div>{state.config.maintenance && <span className="state-badge state-badge--attention">Maintenance</span>}</div><div className="check-list">{Object.entries(state.config.features).map(([name, enabled]) => <div key={name}><span className={`check-icon ${enabled ? "check-icon--good" : "check-icon--neutral"}`}>{enabled ? "✓" : "–"}</span><span><strong>{label(name)}</strong><small>{enabled ? "Enabled" : "Disabled at the API boundary"}</small></span></div>)}</div></article>
      </section>
      <section className="panel phase-board"><div className="panel-heading"><div><p className="section-kicker">Delivery roadmap</p><h2>Phase status and requirements</h2></div><span className="data-label">Database-backed</span></div><div className="phase-columns">{state.phases.map((phase) => { const requirements = Array.isArray(phase.requirements) ? phase.requirements : Object.values(phase.requirements).map(String); return <article key={phase.phase_key}><div><span className="phase-number">{phase.phase_key}</span><span className={`state-badge state-badge--${phase.status.toLowerCase()}`}>{label(phase.status)}</span></div><h3>{phase.title}</h3><p>{phase.summary}</p><ul>{requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul></article>; })}</div></section>
      <section className="panel evidence-note"><div><p className="section-kicker">What this page proves</p><h2>No status here is invented in the browser.</h2></div><p>API liveness, secret readiness, feature flags, and phase requirements are read at request time. Deployment health from Cloudflare, Vercel, EAS, and Neon must be connected separately before this can claim production release readiness.</p></section>
    </>}
  </PortalShell>;
}
