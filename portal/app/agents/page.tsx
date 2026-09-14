import type { Metadata } from "next";

import { AccessGate } from "@/components/access-gate";
import { AgentApplication } from "@/components/agent-application";

export const metadata: Metadata = { title: "Agent application" };

export default function AgentsPage() {
  return (
    <AccessGate surface="agents">
      <AgentApplication />
    </AccessGate>
  );
}
