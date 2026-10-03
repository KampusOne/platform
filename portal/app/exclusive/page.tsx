import { Suspense } from "react";
import { notFound } from "next/navigation";

import { AccessGate } from "@/components/access-gate";
import { TrustedVendorApplication } from "@/components/trusted-vendor-application";

type ExclusivePageProps = {
  searchParams: Promise<{ invite?: string | string[] }>;
};

export default async function ExclusiveInvitePage({
  searchParams,
}: ExclusivePageProps) {
  const params = await searchParams;
  const invite = Array.isArray(params.invite)
    ? params.invite[0]
    : params.invite;

  // Resolve before rendering a Suspense boundary so disabled campaigns send HTTP 404.
  if (!invite || !/^[a-f0-9]{64}$/.test(invite)) {
    notFound();
  }

  const origin = (
    process.env.KAMPUSONE_API_ORIGIN ??
    process.env.NEXT_PUBLIC_KAMPUSONE_API_URL ??
    "https://platformp.divine-haze-54eb.workers.dev"
  ).replace(/\/$/, "");
  const response = await fetch(`${origin}/v1/trusted-vendors/availability`, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok)
    throw new Error(
      "The invitation service could not be reached. Please try again shortly.",
    );
  const availability = (await response.json()) as { enabled?: boolean };
  if (availability.enabled !== true) notFound();

  return (
    <AccessGate surface="agents">
      <Suspense fallback={<p>Checking your invitation…</p>}>
        <TrustedVendorApplication />
      </Suspense>
    </AccessGate>
  );
}
