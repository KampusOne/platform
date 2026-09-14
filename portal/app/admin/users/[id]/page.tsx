import { AccessGate } from "@/components/access-gate";
import { UserDetail } from "@/components/user-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <AccessGate surface="admin">
      <UserDetail id={(await params).id} />
    </AccessGate>
  );
}
