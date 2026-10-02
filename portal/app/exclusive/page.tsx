import { Suspense } from "react";
import { redirect } from "next/navigation";

import { AccessGate } from "@/components/access-gate";
import { TrustedVendorApplication } from "@/components/trusted-vendor-application";

type ExclusivePageProps = {
  searchParams: Promise<{ invite?: string | string[] }>;
};

export default async function ExclusiveInvitePage({
  searchParams,
}: ExclusivePageProps) {
  const params = await searchParams;
  const invite = Array.isArray(params.invite) ? params.invite[0] : params.invite;

  // /exclusive is only the signed, invitation-only business fast-track.
  // Never strand someone on a vendor form when they only opened the bare route.
  if (!invite || !/^[a-f0-9]{64}$/.test(invite)) {
    redirect("https://agents.kampusone.app/agents");
  }

  return (
    <AccessGate surface="agents">
      <Suspense fallback={<p>Checking your invitation…</p>}>
        <TrustedVendorApplication />
      </Suspense>
    </AccessGate>
  );
}
