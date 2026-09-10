import type { Metadata } from "next";

import { AccessGate } from "@/components/access-gate";
import { AdminDashboard } from "@/components/admin-dashboard";

export const metadata: Metadata = { title: "Administration" };

export default function AdminPage() {
  return <AccessGate surface="admin"><AdminDashboard /></AccessGate>;
}
