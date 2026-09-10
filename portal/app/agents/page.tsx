import type { Metadata } from "next";

import { AccessGate } from "@/components/access-gate";
import { AgentDashboard } from "@/components/agent-dashboard";

export const metadata: Metadata = { title: "Agent workspace" };

export default function AgentsPage() {
  return <AccessGate surface="agents"><AgentDashboard /></AccessGate>;
}
