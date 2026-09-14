"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { usePortalAuth } from "@/components/auth-provider";

export type SurfaceKey = "admin" | "agents" | "engineering";

type PortalShellProps = {
  active: SurfaceKey;
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function PortalShell({
  active,
  eyebrow,
  title,
  description,
  actions,
  children,
}: PortalShellProps) {
  const { user, signOut } = usePortalAuth();
  const pathname = usePathname();
  const links =
    active === "agents"
      ? [["/agents", "Application"]]
      : active === "engineering"
        ? [["/engineering", "System status"]]
        : [
            ["/admin", "Overview"],
            ["/admin/universities", "Universities"],
            ["/admin/users", "Users"],
            ["/admin/applications", "Applications & KYC"],
            ["/admin/trials", "Free trials"],
            ["/admin/vendors", "Vendors"],
            ["/admin/tutorials", "Tutors & resources"],
            ["/admin/riders", "Riders"],
            ["/admin/operations", "Orders & finance"],
            ["/admin/content", "Campus content"],
            ["/admin/communities", "Communities"],
            ["/admin/support", "Support & appeals"],
            ["/admin/audit", "Audit history"],
          ];
  const initials = user?.email.slice(0, 2).toUpperCase() ?? "K1";

  return (
    <div className="portal-frame">
      <aside className="sidebar">
        <Link
          href={"/" + active}
          className="brand-link"
          aria-label="KampusOne workspace home"
        >
          <Image
            src="/kampusone-horizontal-ink.png"
            width={168}
            height={41}
            priority
            alt="KampusOne"
          />
        </Link>
        <p className="workspace-label">
          {active === "agents"
            ? "Agent application"
            : active === "admin"
              ? "Administration"
              : "Engineering"}
        </p>
        <nav className="portal-nav" aria-label="Operational workspaces">
          {links.map(([href, label]) => (
            <Link
              href={href!}
              key={href}
              className="nav-item"
              aria-current={pathname === href ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="portal-content">
        <header className="topbar">
          <div>
            <span className="status-dot status-dot--online" />
            Secure session
          </div>
          <div className="operator-menu">
            <span className="operator-avatar">{initials}</span>
            <span>
              <strong>{user?.email}</strong>
              <small>
                {user?.operatorRoles.length
                  ? user.operatorRoles.join(" · ").replaceAll("_", " ")
                  : "Verified account"}
              </small>
            </span>
            <button className="text-button" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </header>
        <main className="portal-main">
          <header className="portal-header">
            <div>
              <p className="eyebrow">{eyebrow}</p>
              <h1>{title}</h1>
              <p className="portal-header__description">{description}</p>
            </div>
            {actions && <div className="portal-header__actions">{actions}</div>}
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}
