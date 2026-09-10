import type { Metadata } from "next";

import { PortalShell } from "@/components/portal-shell";
import { StatusLabel } from "@/components/status-label";

export const metadata: Metadata = { title: "Engineering preview" };

const deployables = [
  { name: "Student mobile", runtime: "Expo 57", signal: "Build pending", tone: "progress" },
  { name: "Operations portal", runtime: "Next.js 16", signal: "Build pending", tone: "progress" },
  { name: "Privileged API", runtime: "Cloudflare Worker", signal: "Dry run pending", tone: "progress" },
  { name: "Data foundation", runtime: "Supabase Postgres", signal: "Review pending", tone: "attention" },
] as const;

export default function EngineeringPage() {
  return (
    <PortalShell
      active="engineering"
      eyebrow="Engineering control room · Read only"
      title="Evidence before release."
      description="A single place to see deployable health, cost boundaries, and the checks blocking the next environment."
    >
      <section className="engineering-strip" aria-label="Release posture">
        <div><span>Environment</span><strong>Local foundation</strong></div>
        <div><span>Live traffic</span><strong>None</strong></div>
        <div><span>Paid providers</span><strong>All disabled</strong></div>
        <div><span>Release posture</span><strong>Hold</strong></div>
      </section>

      <section className="work-section work-section--flush">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Deployable map</p>
            <h2>Foundation verification</h2>
          </div>
          <span className="data-label">No live telemetry</span>
        </div>
        <div className="capability-table capability-table--systems" role="table" aria-label="Deployable state">
          <div className="capability-row capability-row--head" role="row">
            <span role="columnheader">System</span>
            <span role="columnheader">Runtime</span>
            <span role="columnheader">Verification</span>
          </div>
          {deployables.map((item) => (
            <div className="capability-row" role="row" key={item.name}>
              <strong role="cell">{item.name}</strong>
              <span role="cell">{item.runtime}</span>
              <StatusLabel tone={item.tone}>{item.signal}</StatusLabel>
            </div>
          ))}
        </div>
      </section>

      <section className="engineering-columns">
        <div className="control-block">
          <p className="section-kicker">Cost circuit</p>
          <h2>Break before billing</h2>
          <p>AI, SMS, email, and payment adapters begin off. Quotas and kill switches must be observable before credentials are added.</p>
          <StatusLabel tone="ready">Safe default active</StatusLabel>
        </div>
        <div className="control-block control-block--warm">
          <p className="section-kicker">Current blocker</p>
          <h2>Identity evidence</h2>
          <p>Operator login, role claims, tenant policies, and recovery must pass together before any dashboard receives real data.</p>
          <StatusLabel tone="attention">Phase 1 gate</StatusLabel>
        </div>
      </section>
    </PortalShell>
  );
}
