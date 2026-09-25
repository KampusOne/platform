"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { usePortalAuth } from "@/components/auth-provider";
import { useAdminContext } from "@/components/admin-context";
import { adminGroups, adminModules, type AdminModule } from "@/lib/admin-modules";

export type SurfaceKey = "admin" | "agents" | "engineering";
type PortalShellProps = { active: SurfaceKey; eyebrow: string; title: string; description: string; actions?: ReactNode; children: ReactNode };

function AdminNavigation({ pathname }: { pathname: string }) {
  const { user } = usePortalAuth();
  const { can } = useAdminContext();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string[]>(["overview", "universities", "agents"]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const scroll = useRef<HTMLElement>(null);
  const storageKey = `k1-admin-navigation:${user?.id}`;
  useEffect(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as { expanded?: string[]; favorites?: string[]; scroll?: number } | null;
      if (stored?.expanded) queueMicrotask(() => setExpanded(stored.expanded!));
      if (stored?.favorites) queueMicrotask(() => setFavorites(stored.favorites!));
      if (scroll.current) scroll.current.scrollTop = stored?.scroll ?? 0;
    } catch { /* Navigation works without storage. */ }
  }, [storageKey]);
  function persist(nextExpanded = expanded, nextFavorites = favorites) {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ expanded: nextExpanded, favorites: nextFavorites, scroll: scroll.current?.scrollTop ?? 0 })); } catch { /* Optional preference only. */ }
  }
  function toggleFavorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id];
    setFavorites(next); persist(expanded, next);
  }
  function itemLink(item: AdminModule) {
    return <div className="admin-nav-row" key={item.id}><Link href={item.href!} prefetch={false} className="nav-item" aria-current={pathname === item.href ? "page" : undefined} onClick={() => { persist(); setMobileOpen(false); }}>{item.label}</Link><button type="button" className="nav-favorite" aria-label={`${favorites.includes(item.id) ? "Remove" : "Add"} ${item.label} ${favorites.includes(item.id) ? "from" : "to"} favorites`} aria-pressed={favorites.includes(item.id)} onClick={() => toggleFavorite(item.id)}>{favorites.includes(item.id) ? "★" : "☆"}</button></div>;
  }
  const normalized = query.trim().toLowerCase();
  const groups = adminGroups.map((group) => ({ ...group, items: group.items.filter((item) => (can(item.permission) || can("*")) && (!normalized || `${group.label} ${item.label}`.toLowerCase().includes(normalized))) })).filter((group) => group.items.length);
  return <>
    <button className="button button--secondary admin-mobile-toggle" aria-expanded={mobileOpen} aria-controls="admin-navigation" onClick={() => setMobileOpen(!mobileOpen)}>Workspaces</button>
    <div className={`admin-navigation ${mobileOpen ? "admin-navigation--open" : ""}`} id="admin-navigation">
      <label className="nav-search"><span className="sr-only">Search workspaces</span><input type="search" placeholder="Find a workspace…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="nav-controls"><span>{groups.length} sections</span><button type="button" onClick={() => { const next = expanded.length === adminGroups.length ? [] : adminGroups.map((group) => group.id); setExpanded(next); persist(next); }}>{expanded.length === adminGroups.length ? "Collapse all" : "Expand all"}</button></div>
      <nav className="admin-nav-scroll" ref={scroll} onScroll={() => persist()} aria-label="Administration workspaces">
        {!normalized && favorites.some((id) => adminModules.some((item) => item.id === id && item.href && can(item.permission))) && <section className="nav-group"><h2 className="nav-group-favorites">Favorites</h2>{adminModules.filter((item) => favorites.includes(item.id) && item.href && can(item.permission)).map(itemLink)}</section>}
        {groups.map((group) => {
          const isOpen = Boolean(normalized) || expanded.includes(group.id) || group.items.some((item) => item.href === pathname);
          return <section className="nav-group" key={group.id}><button className="nav-group-toggle" type="button" aria-expanded={isOpen} aria-controls={`nav-${group.id}`} onClick={() => { const next = expanded.includes(group.id) ? expanded.filter((item) => item !== group.id) : [...expanded, group.id]; setExpanded(next); persist(next); }}><span>{group.label}</span><span aria-hidden="true">{isOpen ? "−" : "+"}</span></button><div id={`nav-${group.id}`} hidden={!isOpen}>{group.items.map((item) => item.href ? itemLink(item) : <div key={item.id} className="nav-planned" title={item.dependency}><span>{item.label}</span><small>Planned</small></div>)}</div></section>;
        })}
        {!groups.length && <p className="table-empty">No matching workspaces</p>}
      </nav>
    </div>
  </>;
}

export function PortalShell({ active, eyebrow, title, description, actions, children }: PortalShellProps) {
  const { user, signOut } = usePortalAuth();
  const { access, scope, scopeLabel, setScope, can } = useAdminContext();
  const [signOutError, setSignOutError] = useState("");
  const pathname = usePathname();
  const routeModules = adminModules.filter((module) => module.href === pathname);
  const current = routeModules.find((module) => can(module.permission)) ?? routeModules[0];
  const permitted = active !== "admin" || !routeModules.length || routeModules.some((module) => can(module.permission));
  const initials = user?.email.slice(0, 2).toUpperCase() ?? "K1";
  return <div className={`portal-frame ${active === "admin" ? "portal-frame--admin" : ""}`}>
    <aside className="sidebar">
      <Link href={`/${active}`} className="brand-link" aria-label="KampusOne workspace home"><Image src="/kampusone-horizontal-ink.png" width={168} height={41} priority alt="KampusOne" /></Link>
      <p className="workspace-label">{active === "agents" ? "Your agent account" : active === "admin" ? "Administration & operations" : "Engineering"}</p>
      {active === "admin" ? <AdminNavigation pathname={pathname} /> : <nav className="portal-nav" aria-label="Workspaces"><Link className="nav-item" href={`/${active}`} aria-current={pathname === `/${active}` ? "page" : undefined}>{active === "agents" ? "Applications" : "System status"}</Link>{active === "agents" && <><Link className="nav-item" href="/agents/dashboard" aria-current={pathname === "/agents/dashboard" ? "page" : undefined}>Agent dashboard</Link><Link className="nav-item" href="/agents/payouts" aria-current={pathname === "/agents/payouts" ? "page" : undefined}>Payout setup</Link></>}</nav>}
    </aside>
    <div className="portal-content">
      <header className="topbar">
        {active === "admin" ? <label className="university-context"><span>University context</span><select aria-label="University context" value={scope} onChange={(event) => setScope(event.target.value)}>{access?.allUniversities && <option value="">All universities</option>}{access?.universities?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <div>Signed in to KampusOne</div>}
        <div className="operator-menu"><span className="operator-avatar">{initials}</span><span><strong>{user?.email}</strong><small>{active === "admin" ? "Provisioned workspace access" : "KampusOne account"}</small></span><button className="text-button" onClick={() => { setSignOutError(""); void signOut().catch((error: unknown) => setSignOutError(error instanceof Error ? error.message : "Sign out could not be completed. Try again.")); }}>Sign out</button></div>
      </header>
      {signOutError && <p className="form-error" role="alert">{signOutError}</p>}
      <main className="portal-main">
        {active === "admin" && <nav className="admin-breadcrumb" aria-label="Breadcrumb"><Link href="/admin">Operations</Link><span aria-hidden="true">/</span><span>{current?.label ?? title}</span></nav>}
        <header className="portal-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="portal-header__description">{description}</p>}{active === "admin" && <p className="scope-caption">Scope: <strong>{scopeLabel}</strong></p>}</div>{actions && permitted && <div className="portal-header__actions">{actions}</div>}</header>
        {permitted ? children : <section className="state-panel" role="alert"><h2>This workspace is restricted</h2><p>Your account has not been granted access to this module.</p></section>}
      </main>
    </div>
  </div>;
}
