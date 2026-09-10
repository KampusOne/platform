import type { Metadata } from "next";

import { BuildTracker } from "@/components/build-tracker";
import { PortalShell } from "@/components/portal-shell";
import { buildPhases, trackerUpdatedAt } from "@/lib/build-tracker";

export const metadata: Metadata = { title: "Build tracker" };

export default function EngineeringPage() {
  const tasks = buildPhases.flatMap((phase) => phase.items);
  const done = tasks.filter((task) => task.status === "done").length;
  const active = tasks.filter((task) => task.status === "in_progress").length;
  const blockers = tasks.filter(
    (task) => task.status === "blocked" || task.status === "needs_input",
  ).length;
  const percent = Math.round((done / tasks.length) * 100);

  return (
    <PortalShell
      active="engineering"
      eyebrow="Build tracker · Evidence-led"
      title="You can see exactly where Campus One stands."
      description="Phases, implementation evidence, decisions, blockers and the inputs needed from you—kept in one reviewable place."
    >
      <section className="tracker-overview" id="overview">
        <div className="tracker-progress">
          <div className="tracker-progress__copy">
            <span>Whole product plan</span>
            <strong>{percent}%</strong>
          </div>
          <div className="tracker-progress__track">
            <span style={{ width: `${percent}%` }} />
          </div>
          <small>{trackerUpdatedAt}</small>
        </div>
        <div className="tracker-metric">
          <span>Done</span><strong>{done}</strong><small>with evidence</small>
        </div>
        <div className="tracker-metric tracker-metric--active">
          <span>Building</span><strong>{active}</strong><small>current phase</small>
        </div>
        <div className="tracker-metric tracker-metric--attention">
          <span>Gates</span><strong>{blockers}</strong><small>blocked or input</small>
        </div>
      </section>

      <section className="architecture-band" aria-label="Deployment architecture">
        <div><span>Mobile</span><strong>Expo React Native</strong><small>Student utility</small></div>
        <div><span>Web</span><strong>Next.js on Vercel</strong><small>Separate host surfaces</small></div>
        <div><span>Privileged API</span><strong>Cloudflare Worker</strong><small>Secrets and provider calls</small></div>
        <div><span>Core + files</span><strong>Supabase</strong><small>Auth, RLS, storage</small></div>
        <div><span>Analytics</span><strong>Neon</strong><small>Consent-aware events</small></div>
      </section>

      <BuildTracker />
    </PortalShell>
  );
}
