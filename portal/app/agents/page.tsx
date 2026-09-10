import type { Metadata } from "next";

import { AgentApplication } from "@/components/agent-application";
import { PortalShell } from "@/components/portal-shell";

export const metadata: Metadata = { title: "Agent application" };

export default function AgentsPage() {
  return (
    <PortalShell
      active="agents"
      eyebrow="Campus One agents · Apply"
      title="Help your campus—with a role people can trust."
      description="Apply for a narrow Campus One role, provide private evidence and follow every verification step without wondering what happened."
    >
      <section className="agent-intro-band">
        <div><span>01</span><p><strong>Apply</strong>Tell us the role and campus context.</p></div>
        <div><span>02</span><p><strong>Verify</strong>Automation organises; people decide uncertainty.</p></div>
        <div><span>03</span><p><strong>Activate</strong>Receive only the abilities your role needs.</p></div>
        <div><span>04</span><p><strong>Stay accountable</strong>Every sensitive action leaves evidence.</p></div>
      </section>
      <AgentApplication />
      <section className="agent-support" id="support">
        <div><p className="section-kicker">Need help?</p><h2>A document problem should not become a silent rejection.</h2></div>
        <p>If an upload is unreadable or a name has changed, the reviewer can request context. Support and appeal routes are part of the live release gate.</p>
      </section>
    </PortalShell>
  );
}
