import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export type SurfaceKey = "admin" | "agents" | "engineering";

const navigation: Array<{ key: SurfaceKey; href: string; label: string }> = [
  { key: "admin", href: "/admin", label: "Admin" },
  { key: "agents", href: "/agents", label: "Agents" },
  { key: "engineering", href: "/engineering", label: "Engineering" },
];

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
        <Link href="/" className="brand-link" aria-label="KampusOne platform preview home">
          <Image
            src="/brand/kampusone-horizontal-ink.svg"
            width={153}
            height={37}
            priority
            alt="KampusOne"
          />
        </Link>

        <nav className="portal-nav" aria-label="Operational surfaces">
          <p className="nav-label">Workspaces</p>
          {navigation.map((item) => (
            <Link
              href={item.href}
              key={item.key}
              className="nav-item"
              aria-current={active === item.key ? "page" : undefined}
            >
              <span className="nav-item__signal" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar__foot">
          <span className="status-dot" aria-hidden="true" />
          <span>
            <strong>Preview mode</strong>
            Live mutations are locked
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
              <strong>Identity gate pending</strong>
              <small>No operator signed in</small>
            </div>
          </div>
        </header>

        <div className="preview-notice" role="status">
          <span className="preview-notice__icon" aria-hidden="true">
            i
          </span>
          <p>
            <strong>Architecture preview.</strong> All records shown here are structural examples;
            no live student or institution data is connected.
          </p>
        </div>

        {children}
      </main>
    </div>
  );
}
