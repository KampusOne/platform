import { notFound } from "next/navigation";
import { AccessGate } from "@/components/access-gate";
import { AdminDashboard, type AdminView } from "@/components/admin-dashboard";
import { ManagePanel, type ManageSection } from "@/components/manage-panel";
export default async function AdminSection({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (
    [
      "users",
      "applications",
      "tutorials",
      "content",
      "operations",
      "audit",
    ].includes(section)
  )
    return (
      <AccessGate surface="admin">
        <AdminDashboard initialView={section as AdminView} />
      </AccessGate>
    );
  if (
    [
      "universities",
      "trials",
      "vendors",
      "riders",
      "support",
      "communities",
    ].includes(section)
  )
    return (
      <AccessGate surface="admin">
        <ManagePanel section={section as ManageSection} />
      </AccessGate>
    );
  notFound();
}
