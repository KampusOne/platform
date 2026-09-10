import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export type SurfaceKey = "admin" | "agents" | "engineering";

const navigation: Record<SurfaceKey, Array<{ href: string; label: string; marker: string }>> = {
  admin: [
    { href: "#overview", label: "Overview", marker: "01" },
    { href: "#applications", label: "Applications", marker: "02" },
    { href: "#verification", label: "Verification", marker: "03" },
    { href: "#publishing", label: "Publishing", marker: "04" },
    { href: "#safety", label: "Safety", marker: "05" },
  ],
  agents: [
    { href: "#application", label: "Application", marker: "01" },
    { href: "#requirements", label: "Requirements", marker: "02" },
    { href: "#documents", label: "Documents", marker: "03" },
    { href: "#status", label: "Status", marker: "04" },
  ],
  engineering: [
    { href: "#roadmap", label: "Roadmap", marker: "01" },
    { href: "#requirements", label: "Requirements", marker: "02" },
    { href: "#architecture", label: "Architecture", marker: "03" },
    { href: "#notes", label: "Builder notes", marker: "04" },
  ],
};

const surfaceMeta: Record<SurfaceKey, { label: string; state: string; notice: string }> = {
  admin: { label: "Operations", state: "Operator gate pending", notice: "The operational controls are structured previews. Live student and applicant records stay disconnected until operator authentication and tenant policy pass." },
  agents: { label: "Agent portal", state: "Application preview", notice: "The application journey is reviewable now. Private document upload remains locked until storage policy and review ownership are approved." },
  engineering: { label: "Build tracker", state: "Read-only tracker", notice: "This is the delivery source of truth: finished work includes evidence, blockers name their required input, and planned work is not presented as complete." },
};

type PortalShellProps = {
  active: SurfaceKey;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
};

export function PortalShell({
  active,
  eyebrow,
  title,
  description,
  children,
}: PortalShellProps) {
  const meta = surfaceMeta[active];
  return (
    <div className="portal-frame">
      <aside className="sidebar">
        <Link href="/" className="brand-link" aria-label="KampusOne platform preview home">
          <Image
            src="/brand/kampusone-horizontal-ink.svg"
            width={153}
            height={37}
            priority
            alt="KampusOne"
          />
        </Link>

        <nav className="portal-nav" aria-label={`${meta.label} sections`}>
          <p className="nav-label">{meta.label}</p>
          {navigation[active].map((item, index) => (
            <Link
              href={item.href}
              key={item.href}
              className="nav-item"
              aria-current={index === 0 ? "page" : undefined}
            >
              <span className="nav-item__marker" aria-hidden="true">{item.marker}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar__foot">
          <span className="status-dot" aria-hidden="true" />
          <span>
            <strong>{meta.state}</strong>
            {active === "engineering" ? "No secrets shown" : "Sensitive writes locked"}
          </span>
        </div>
      </aside>

      <main className="portal-main">
        <header className="portal-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
            <p className="portal-header__description">{description}</p>
          </div>
          <div className="operator-placeholder" aria-label="Authentication status">
            <span aria-hidden="true">K1</span>
            <div>
              <strong>{meta.state}</strong>
              <small>{active === "engineering" ? "Updated with build evidence" : "No privileged session"}</small>
            </div>
          </div>
        </header>

        <div className="preview-notice" role="status">
          <span className="preview-notice__icon" aria-hidden="true">
            i
          </span>
          <p>
            <strong>{active === "engineering" ? "Delivery record." : "Protected preview."}</strong>{" "}
            {meta.notice}
          </p>
        </div>

        {children}
      </main>
    </div>
  );
}
