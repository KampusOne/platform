import { ExclusiveCampaignControl } from "@/components/exclusive-campaign-control";
import { PortalShell } from "@/components/portal-shell";
export default function Page(){return <PortalShell active="admin" eyebrow="Agent campaign" title="Exclusive onboarding" description="Open or close the shared Exclusive vendor application link."><ExclusiveCampaignControl/></PortalShell>;}
