"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { PortalApiError, portalApi } from "@/lib/api";
import { usePortalAuth } from "./auth-provider";

type AdminAccess = { permissions: string[]; universityIds: string[]; allUniversities: boolean; universities?: { id: string; name: string }[] };
type AdminContextValue = {
  access: AdminAccess | null;
  scope: string;
  scopeLabel: string;
  setScope(scope: string): void;
  can(permission: string): boolean;
  scopedPath(path: string): string;
};
const AdminContext = createContext<AdminContextValue>({ access: null, scope: "", scopeLabel: "All universities", setScope() {}, can: () => false, scopedPath: (path) => path });
export const useAdminContext = () => useContext(AdminContext);

export function AdminProvider({ children }: { children: ReactNode }) {
  const { user } = usePortalAuth();
  return <AccountAdminProvider key={user?.id ?? "anonymous"}>{children}</AccountAdminProvider>;
}

function AccountAdminProvider({ children }: { children: ReactNode }) {
  const { user } = usePortalAuth();
  const [access, setAccess] = useState<AdminAccess | null>(null);
  const [scope, updateScope] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!user) return;
    let active = true;
    void portalApi<AdminAccess>("/v1/admin/access").then((result) => {
      if (!active) return;
      setAccess(result);
      setError(null);
      let saved = "";
      try { saved = sessionStorage.getItem(`k1-admin-scope:${user.id}`) ?? ""; } catch { /* Storage is optional. */ }
      updateScope(saved && (result.allUniversities || result.universityIds.includes(saved)) ? saved : result.allUniversities ? "" : result.universityIds[0] ?? "");
    }).catch((caught) => { if (active) setError(caught instanceof Error ? caught : new Error("Access could not be checked.")); });
    return () => { active = false; };
  }, [user, version]);
  const setScope = useCallback((value: string) => {
    if (!access || (value && !access.allUniversities && !access.universityIds.includes(value))) return;
    updateScope(value);
    try { sessionStorage.setItem(`k1-admin-scope:${user?.id}`, value); } catch { /* Scope still works without persistence. */ }
  }, [access, user]);
  const can = useCallback((permission: string) => Boolean(access?.permissions.includes("*") || access?.permissions.includes(permission)), [access]);
  const scopedPath = useCallback((path: string) => {
    const [base, search = ""] = path.split("?");
    const params = new URLSearchParams(search);
    if (scope) params.set("universityId", scope);
    return `${base}${params.size ? `?${params}` : ""}`;
  }, [scope]);
  if (error) return <main className="session-loader"><section className="state-panel state-panel--error" role="alert"><h1>{error instanceof PortalApiError && error.status === 403 ? "Administrator access required" : "Access check unavailable"}</h1><p>{error.message}</p><button className="button button--secondary" onClick={() => setVersion((value) => value + 1)}>Check again</button></section></main>;
  if (!access) return <main className="session-loader" aria-busy="true"><div className="table-skeleton"><div /><div /><div /></div><span>Checking workspace access…</span></main>;
  const scopeLabel = scope ? access.universities?.find((item) => item.id === scope)?.name ?? "Selected university" : access.allUniversities ? "All universities" : "All authorized universities";
  return <AdminContext.Provider value={{ access, scope, scopeLabel, setScope, can, scopedPath }}>{children}</AdminContext.Provider>;
}
