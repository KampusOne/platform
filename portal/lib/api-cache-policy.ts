/** Browser RAM only. Unknown, role-sensitive, financial and metered routes
 * always fetch fresh state; no default TTL for newly introduced endpoints. */
export function portalReadCacheTtl(path: string): number {
  const route = (path.split("?")[0] ?? "").replace(/\/$/, "");
  if (route === "/v1/config/public") return 15_000;
  if (route === "/v1/student/catalog") return 60_000;
  if (/^\/v1\/maps\/campuses\/[^/]+\/(?:places|features)$/.test(route)) return 15_000;
  if (["/v1/student/timetable", "/v1/student/gpa", "/v1/calendar", "/v1/calendar/exam-periods", "/v1/learning/alarms", "/v1/learning/courses"].includes(route)) return 30_000;
  if (route === "/v1/student/me") return 10_000;
  if (route === "/v1/student/home") return 8_000;
  if (/^\/v1\/student\/feed(?:\/[^/]+(?:\/comments)?)?$/.test(route)) return 5_000;
  if (route === "/v1/messages/inbox" || /^\/v1\/messages\/threads\/[^/]+$/.test(route)) return 1_500;
  if (route === "/v1/notifications/inbox") return 2_000;
  return 0;
}
export function portalCacheScope(user: {id: string; universityId: string | null; roles: string[]; operatorRoles: string[]} | null): string | null {
  return user ? JSON.stringify([user.id, user.universityId, [...user.roles].sort(), [...user.operatorRoles].sort()]) : null;
}
export function portalCacheExpiry(path: string, now: number, ttl: number): number {
  const midnight = (Math.floor((now + 3_600_000) / 86_400_000) + 1) * 86_400_000 - 3_600_000;
  return path.split("?")[0] === "/v1/student/home" ? Math.min(now + ttl, midnight) : now + ttl;
}
