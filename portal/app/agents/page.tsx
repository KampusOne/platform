import type { Metadata } from "next";

import { AgentApplication } from "@/components/agent-application";
import { PortalShell } from "@/components/portal-shell";

export const metadata: Metadata = { title: "Agent application" };

export default function AgentsPage() {
  return (
    <PortalShell
      active="agents"
      eyebrow="Agent portal · Apply and track"
      title="Help your campus work better."
      description="Apply once, upload evidence privately and follow every review decision from your own portal."
    >
      <AgentApplication />
    </PortalShell>
  );
}
