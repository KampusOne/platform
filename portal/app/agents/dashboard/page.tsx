import { AccessGate } from "@/components/access-gate";
import { AgentDashboard } from "@/components/agent-dashboard";
export default function AgentDashboardPage() { return <AccessGate surface="agents"><AgentDashboard /></AccessGate>; }
