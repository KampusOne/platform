import type { Metadata } from "next";

import { PortalShell } from "@/components/portal-shell";
import { StatusLabel } from "@/components/status-label";

export const metadata: Metadata = { title: "Admin preview" };

const foundations = [
  ["Institution tenancy", "Schema ready", "ready"],
  ["Student verification", "Identity next", "progress"],
  ["Academic catalogue", "Import contract", "progress"],
  ["Financial operations", "Hard-gated", "gated"],
] as const;

export default function AdminPage() {
  return (
    <PortalShell
      active="admin"
      eyebrow="Admin · UNIBEN pilot"
      title="Campus operations, with guardrails."
      description="Configure the institution, review trusted workflows, and see exactly who changed what."
    >
      <section className="split-layout">
        <div className="primary-panel">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Foundation readiness</p>
              <h2>What can safely come online</h2>
            </div>
            <span className="data-label">Phase 0</span>
          </div>

          <div className="readiness-list">
            {foundations.map(([label, status, tone], index) => (
              <div className="readiness-row" key={label}>
                <span className="row-index">{String(index + 1).padStart(2, "0")}</span>
                <strong>{label}</strong>
                <StatusLabel tone={tone}>{status}</StatusLabel>
              </div>
            ))}
          </div>
        </div>

        <aside className="side-panel side-panel--dark">
          <p className="section-kicker section-kicker--light">Release rule</p>
          <h2>Nothing sensitive ships on confidence alone.</h2>
          <p>
            Authentication, tenant policies, audit evidence, and a rollback path must all pass
            before an operational control is enabled.
          </p>
          <dl className="mini-facts">
            <div>
              <dt>Write access</dt>
              <dd>Locked</dd>
            </div>
            <div>
              <dt>Production data</dt>
              <dd>Disconnected</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="work-section">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Next operational slice</p>
            <h2>Identity and academic setup</h2>
          </div>
        </div>
        <div className="sequence">
          <div><span>1</span><p><strong>Invite pilot operators</strong>Assign institution-scoped roles.</p></div>
          <div><span>2</span><p><strong>Import the academic map</strong>Validate faculties through venues.</p></div>
          <div><span>3</span><p><strong>Verify the evidence</strong>Run policy, audit, and recovery checks.</p></div>
        </div>
      </section>
    </PortalShell>
  );
}
