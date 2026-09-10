import type { Metadata } from "next";

import { PortalShell } from "@/components/portal-shell";
import { DeliveryTracker } from "@/components/delivery-tracker";

export const metadata: Metadata = { title: "Build tracker" };

export default function EngineeringPage() {
  return (
    <PortalShell
      active="engineering"
      eyebrow="Build tracker · Read only"
      title="You can see exactly where the build stands."
      description="Every phase has scope, evidence, requirements, implementation notes and an honest completion state."
    >
      <DeliveryTracker />
    </PortalShell>
  );
}
