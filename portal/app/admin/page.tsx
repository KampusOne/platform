import type { Metadata } from "next";

import { AccessGate } from "@/components/access-gate";
import { ScopedAdminDashboard } from "@/components/scoped-admin-dashboard";

export const metadata: Metadata = { title: "Administration" };

export default function AdminPage() {
  return <AccessGate surface="admin"><ScopedAdminDashboard /></AccessGate>;
}
