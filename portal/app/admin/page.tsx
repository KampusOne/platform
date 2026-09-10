import type { Metadata } from "next";

import { AdminOperations } from "@/components/admin-operations";
import { PortalShell } from "@/components/portal-shell";

export const metadata: Metadata = { title: "Campus operations" };

export default function AdminPage() {
  return (
    <PortalShell
      active="admin"
      eyebrow="KampusOne operations · Protected"
      title="Review people and evidence with context."
      description="A separate operational workspace for agent applications, verification decisions, publishing and platform safety."
    >
      <AdminOperations />
    </PortalShell>
  );
}
