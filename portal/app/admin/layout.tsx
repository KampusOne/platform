import { AccessGate } from "@/components/access-gate";
import { AdminProvider } from "@/components/admin-context";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AccessGate surface="admin"><AdminProvider>{children}</AdminProvider></AccessGate>;
}
