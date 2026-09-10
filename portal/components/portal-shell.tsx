import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export type SurfaceKey = "admin" | "agents" | "engineering";

const navigation: Record<SurfaceKey, Array<{ href: string; label: string }>> = {
  admin: [
    { href: "/admin#overview", label: "Overview" },
    { href: "/admin#applications", label: "Applications" },
    { href: "/admin#verification", label: "Verification" },
    { href: "/admin#audit", label: "Audit trail" },
  ],
  agents: [
    { href: "/agents#apply", label: "Apply" },
    { href: "/agents#documents", label: "Documents" },
    { href: "/agents#status", label: "Application status" },
    { href: "/agents#support", label: "Help" },
  ],
  engineering: [
    { href: "/engineering#overview", label: "Overview" },
    { href: "/engineering#phases", label: "Build phases" },
    { href: "/engineering#requirements", label: "Requirements" },
    { href: "/engineering#notes", label: "Build notes" },
  ],
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
  return (
    <div className="portal-frame">
      <aside className="sidebar">
        <Link href={`/${active}`} className="brand-link" aria-label="KampusOne workspace home">
          <Image
            src="/brand/kampusone-horizontal-ink.svg"
            width={153}
            height={37}
            priority
            alt="KampusOne"
          />
        </Link>

        <nav className="portal-nav" aria-label="Operational surfaces">
          <p className="nav-label">Workspace</p>
          {navigation[active].map((item, index) => (
            <Link
              href={item.href}
              key={item.href}
              className="nav-item"
              aria-current={index === 0 ? "page" : undefined}
            >
              <span className="nav-item__signal" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar__foot">
          <span className="status-dot" aria-hidden="true" />
          <span>
            <strong>Phase 1 build</strong>
            Sensitive providers remain gated
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
              <strong>Protected workspace</strong>
              <small>Role enforcement is the release gate</small>
            </div>
          </div>
        </header>

        <div className="preview-notice" role="status">
          <span className="preview-notice__icon" aria-hidden="true">
            i
          </span>
          <p>
            <strong>Review environment.</strong> Sample records are labelled. Production writes stay
            off until identity, role and audit checks pass.
          </p>
        </div>

        {children}
      </main>
    </div>
  );
}
