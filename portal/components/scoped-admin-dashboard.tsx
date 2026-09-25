"use client";
import { AdminDashboard, type AdminView } from "./admin-dashboard";
import { useAdminContext } from "./admin-context";
export function ScopedAdminDashboard({ initialView = "overview" }: { initialView?: AdminView }) {
  const { scope } = useAdminContext();
  return <AdminDashboard key={`${initialView}:${scope}`} initialView={initialView} />;
}
