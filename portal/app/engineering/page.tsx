import type { Metadata } from "next";

import { AccessGate } from "@/components/access-gate";
import { EngineeringDashboard } from "@/components/engineering-dashboard";

export const metadata: Metadata = { title: "System status" };

export default function EngineeringPage() {
  return <AccessGate surface="engineering"><EngineeringDashboard /></AccessGate>;
}
