import { notFound } from "next/navigation";
import { AdminWorkspace } from "@/components/admin-workspace";
import { getAdminModule } from "@/lib/admin-modules";
export default async function WorkspacePage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  if (!getAdminModule(workspace)?.dataset) notFound();
  return <AdminWorkspace key={workspace} workspace={workspace} />;
}
