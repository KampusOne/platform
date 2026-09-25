"use client";
import Link from "next/link";
import { useState } from "react";
import { adminGroups } from "@/lib/admin-modules";
import { useAdminContext } from "./admin-context";
import { PortalShell } from "./portal-shell";
export function AdminCatalogue() {
  const { can } = useAdminContext();
  const [query, setQuery] = useState("");
  return <PortalShell active="admin" eyebrow="Internal delivery catalogue" title="Modules & dependencies" description="Implementation status is separate from production verification."><div className="workspace-toolbar"><label>Search capabilities<input className="search-input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a module or requirement" /></label></div>{adminGroups.map((group) => ({ ...group, items: group.items.filter((item) => can(item.permission) && `${group.label} ${item.label} ${item.requirements?.join(" ")}`.toLowerCase().includes(query.toLowerCase())) })).filter((group) => group.items.length).map((group) => <section key={group.id} className="catalogue-section"><h2>{group.label}</h2><div className="table-scroll"><table className="operational-table"><thead><tr><th>Capability</th><th>Implementation</th><th>Dependency / evidence</th></tr></thead><tbody>{group.items.map((item) => <tr key={item.id}><td>{item.href ? <Link className="text-link" href={item.href}>{item.label}</Link> : item.label}{item.requirements && <small className="catalogue-ids">Requirements {item.requirements.join(", ")}</small>}</td><td><span className="state-badge">{item.href ? "Implemented · release checks required" : "Planned"}</span></td><td>{item.dependency ?? "Live API workspace; a successful production check is still required."}</td></tr>)}</tbody></table></div></section>)}</PortalShell>;
}
