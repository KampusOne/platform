"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { usePortalAuth } from "@/components/auth-provider";

export type SurfaceKey = "admin" | "agents" | "engineering";

const navigation: Array<{ key: SurfaceKey; href: string; label: string; glyph: string }> = [
  { key: "admin", href: "/admin", label: "Administration", glyph: "A" },
  { key: "agents", href: "/agents", label: "Agent workspace", glyph: "W" },
  { key: "engineering", href: "/engineering", label: "System status", glyph: "S" },
];

type PortalShellProps = {
  active: SurfaceKey;
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function PortalShell({ active, eyebrow, title, description, actions, children }: PortalShellProps) {
  const { user, signOut } = usePortalAuth();
  const initials = user?.email.slice(0, 2).toUpperCase() ?? "K1";

  return (
    <div className="portal-frame">
      <aside className="sidebar">
        <Link href="/" className="brand-link" aria-label="KampusOne operations home">
          <Image src="/kampusone-horizontal-ink.png" width={168} height={41} priority alt="KampusOne" />
        </Link>
        <p className="workspace-label">Operations platform</p>
        <nav className="portal-nav" aria-label="Operational workspaces">
          {navigation.map((item) => (
            <Link href={item.href} key={item.key} className="nav-item" aria-current={active === item.key ? "page" : undefined}>
              <span className="nav-glyph" aria-hidden="true">{item.glyph}</span>{item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar__support">
          <strong>Need help?</strong>
          <span>Review the live release requirements in System status.</span>
          <Link href="/engineering">Open requirements →</Link>
        </div>
        <div className="sidebar__foot">
          <span className="status-dot status-dot--online" aria-hidden="true" />
          <span><strong>Connected workspace</strong>Data comes from the KampusOne API</span>
        </div>
      </aside>

      <div className="portal-content">
        <header className="topbar">
          <div><span className="status-dot status-dot--online" />Secure session</div>
          <div className="operator-menu">
            <span className="operator-avatar">{initials}</span>
            <span><strong>{user?.email}</strong><small>{user?.operatorRoles.length ? user.operatorRoles.join(" · ").replaceAll("_", " ") : "Verified account"}</small></span>
            <button className="text-button" onClick={() => void signOut()}>Sign out</button>
          </div>
        </header>
        <main className="portal-main">
          <header className="portal-header">
            <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="portal-header__description">{description}</p></div>
            {actions && <div className="portal-header__actions">{actions}</div>}
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}
