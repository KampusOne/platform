import type { Metadata } from "next";

import { AgentReview } from "@/components/agent-review";
import { PortalShell } from "@/components/portal-shell";

export const metadata: Metadata = { title: "Campus operations" };

export default function AdminPage() {
  return (
    <PortalShell
      active="admin"
      eyebrow="Campus operations · UNIBEN pilot"
      title="Review people, evidence and risk—without guesswork."
      description="A protected operating surface for agent verification, role activation and accountable decisions. Unknown evidence stays pending for a human."
    >
      <section className="operations-overview" id="overview">
        <div><span>Waiting review</span><strong>12</strong><small>4 assigned to you</small></div>
        <div><span>Manual checks</span><strong>7</strong><small>issuer or name context</small></div>
        <div><span>Verified today</span><strong>5</strong><small>sample metric</small></div>
        <div className="operations-overview__policy"><span>Release policy</span><strong>Human decision required</strong><small>automated checks assist; they do not silently activate roles</small></div>
      </section>
      <AgentReview />
    </PortalShell>
  );
}
