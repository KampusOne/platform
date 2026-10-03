"use client";
import { useAdminContext } from "./admin-context";
import { PortalShell } from "./portal-shell";
import { WorkspaceInsights } from "./workspace-insights";
export function MessageStatisticsPage(){const {scopeLabel,can}=useAdminContext();return <PortalShell active="admin" eyebrow={scopeLabel} title="Message activity" description="Recorded message counts and formats. Private conversations remain private.">{can("analytics.view")?<WorkspaceInsights module="messages"/>:<p className="state-panel">Your staff permissions do not include message analytics.</p>}</PortalShell>;}
