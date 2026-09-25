import { notFound, redirect } from "next/navigation";
import { AccessGate } from "@/components/access-gate";
import { type AdminView } from "@/components/admin-dashboard";
import { ScopedAdminDashboard } from "@/components/scoped-admin-dashboard";
import { ManagePanel, type ManageSection } from "@/components/manage-panel";
export default async function AdminSection({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (section === "users") redirect("/admin/workspaces/users");
  if (section === "audit") redirect("/admin/workspaces/audit");
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
        <ScopedAdminDashboard initialView={section as AdminView} />
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
