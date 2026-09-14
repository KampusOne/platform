import { AccessGate } from "@/components/access-gate";
import { CommunityManagement } from "@/components/community-management";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <AccessGate surface="admin">
      <CommunityManagement id={(await params).id} />
    </AccessGate>
  );
}
