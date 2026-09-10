import type { Metadata } from "next";

import { PortalShell } from "@/components/portal-shell";
import { StatusLabel } from "@/components/status-label";

export const metadata: Metadata = { title: "Agent preview" };

export default function AgentsPage() {
  return (
    <PortalShell
      active="agents"
      eyebrow="Agent desk · Assigned work only"
      title="A narrow queue, not a master key."
      description="Campus agents resolve explicitly assigned tasks with evidence, escalation, and a permanent activity trail."
    >
      <section className="split-layout split-layout--agent">
        <div className="primary-panel">
          <div className="section-heading">
            <div>
              <p className="section-kicker">Assignment queue</p>
              <h2>No live tasks connected</h2>
            </div>
            <StatusLabel tone="gated">Preview only</StatusLabel>
          </div>
          <div className="intentional-empty">
            <span className="empty-symbol" aria-hidden="true">✓</span>
            <div>
              <strong>The queue is deliberately empty.</strong>
              <p>
                Pilot tasks will appear only after operator identity, institution scope, and
                escalation ownership are configured.
              </p>
            </div>
          </div>
        </div>

        <aside className="side-panel">
          <p className="section-kicker">Agent boundary</p>
          <h2>Every action answers four questions.</h2>
          <ol className="question-list">
            <li><span>01</span>Who assigned it?</li>
            <li><span>02</span>Which campus owns it?</li>
            <li><span>03</span>What evidence is required?</li>
            <li><span>04</span>Who handles an exception?</li>
          </ol>
        </aside>
      </section>

      <section className="work-section">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Capability map</p>
            <h2>Least privilege by workflow</h2>
          </div>
        </div>
        <div className="capability-table" role="table" aria-label="Agent capability readiness">
          <div className="capability-row capability-row--head" role="row">
            <span role="columnheader">Workflow</span>
            <span role="columnheader">Agent ability</span>
            <span role="columnheader">State</span>
          </div>
          <div className="capability-row" role="row">
            <strong role="cell">Academic data correction</strong>
            <span role="cell">Propose, never silently publish</span>
            <StatusLabel tone="progress">Designed</StatusLabel>
          </div>
          <div className="capability-row" role="row">
            <strong role="cell">Student verification</strong>
            <span role="cell">Review assigned evidence</span>
            <StatusLabel tone="progress">Policy next</StatusLabel>
          </div>
          <div className="capability-row" role="row">
            <strong role="cell">Financial adjustment</strong>
            <span role="cell">No direct capability</span>
            <StatusLabel tone="gated">Blocked</StatusLabel>
          </div>
        </div>
      </section>
    </PortalShell>
  );
}
