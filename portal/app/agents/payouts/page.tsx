import { AccessGate } from "@/components/access-gate";
import { PayoutSetupWorkspace } from "@/components/payout-setup-workspace";
export default function PayoutSetupPage() { return <AccessGate surface="agents"><PayoutSetupWorkspace mode="agent" /></AccessGate>; }
