/** The HTTP request is shared; cancellation belongs to each caller, not the cache. */
export function waitForRequest<T>(operation: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Request cancelled"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new Error("Request cancelled"));
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

/** Background bookkeeping never evicts unrelated screen data. */
export function invalidationTargets(path: string): string[] | null {
  const resource = path.split("?")[0] ?? "";
  if (/^\/v1\/student\/feed\/[^/]+\/view$/.test(resource) ||
      ["/v1/student/events", "/v1/analytics/events", "/v1/notifications/alarm-events"].includes(resource)) return [];
  if (/^\/v1\/notifications\/(?:devices|deliveries|attempts)(?:\/|$)/.test(resource)) return [];
  if (resource.startsWith("/v1/account/streak")) return ["/v1/account/streak", "/v1/student/home"];
  if (resource.startsWith("/v1/student/feed") || resource.startsWith("/v1/student/publishing"))
    return ["/v1/student/feed", "/v1/student/publishing", "/v1/student/home", "/v1/people", "/v1/discovery", "/v1/communities", "/v1/notifications"];
  if (resource.startsWith("/v1/media")) return /^\/v1\/media\/message-uploads(?:\/|$)/.test(resource) ? [] : ["/v1/student/me", "/v1/student/feed", "/v1/student/home", "/v1/people"];
  if (resource.startsWith("/v1/student/timetable") || resource.startsWith("/v1/learning/timetable"))
    return ["/v1/student/timetable", "/v1/student/home", "/v1/learning/alarms", "/v1/calendar", "/v1/exams"];
  if (resource.startsWith("/v1/student/gpa")) return ["/v1/student/gpa", "/v1/student/home"];
  if (/^\/v1\/messages\/threads\/[^/]+\/read$/.test(resource)) return ["/v1/messages/inbox"];
  if (resource.startsWith("/v1/messages")) return ["/v1/messages", "/v1/notifications"];
  if (resource.startsWith("/v1/notifications")) return ["/v1/notifications", "/v1/learning/alarms"];
  if (resource.startsWith("/v1/learning/alarms")) return ["/v1/learning/alarms", "/v1/student/timetable", "/v1/student/home"];
  if (resource.startsWith("/v1/learning/courses")) return ["/v1/learning/courses", "/v1/student/timetable", "/v1/student/home", "/v1/student/gpa"];
  if (resource.startsWith("/v1/calendar") || resource.startsWith("/v1/exams"))
    return ["/v1/calendar", "/v1/exams", "/v1/student/home", "/v1/learning/alarms"];
  if (resource.startsWith("/v1/communities")) return ["/v1/communities", "/v1/student/feed", "/v1/discovery", "/v1/notifications"];
  if (resource.startsWith("/v1/people")) return ["/v1/people", "/v1/student/feed", "/v1/discovery", "/v1/messages", "/v1/notifications", "/v1/communities"];
  if (resource.startsWith("/v1/account") || resource.startsWith("/v1/student/me")) return null;
  if (resource.startsWith("/v1/agents")) return ["/v1/agents", "/v1/student/store", "/v1/student/tutorials", "/v1/people", "/v1/discovery"];
  return null;
}
export function matchesRead(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "?") || path.startsWith(prefix + "/");
}

export type ReadCachePolicy = { freshMs: number; retainMs: number };
const freshOnly: ReadCachePolicy = { freshMs: 0, retainMs: 0 };
/** Allowlist only. New/unknown, metered, permission or transactional GETs are
 * coalesced in RAM but never retained. No private data enters a shared cache. */
export function readCachePolicy(path: string): ReadCachePolicy {
  const resource = (path.split("?")[0] ?? "").replace(/\/$/, "");
  if (resource === "/v1/config/public") return { freshMs: 15_000, retainMs: 30_000 };
  if (resource === "/v1/student/catalog") return { freshMs: 60_000, retainMs: 300_000 };
  if (/^\/v1\/maps\/campuses\/[^/]+\/(?:places|features)$/.test(resource) || resource === "/v1/student/campus/places")
    return { freshMs: 15_000, retainMs: 900_000 };
  if (["/v1/student/timetable", "/v1/student/gpa", "/v1/calendar", "/v1/calendar/exam-periods", "/v1/learning/alarms", "/v1/learning/courses"].includes(resource))
    return { freshMs: 30_000, retainMs: 300_000 };
  if (resource === "/v1/student/home") return { freshMs: 8_000, retainMs: 120_000 };
  if (resource === "/v1/student/me") return { freshMs: 10_000, retainMs: 10_000 };
  // Restriction/visibility-sensitive UI does not have a stale-display window.
  if (/^\/v1\/student\/feed(?:\/[^/]+(?:\/comments)?)?$/.test(resource))
    return { freshMs: 5_000, retainMs: 5_000 };
  if (/^\/v1\/people\/(?:by-username\/[^/]+|[^/]+(?:\/(?:followers|following))?)$/.test(resource) || resource === "/v1/discovery/search")
    return { freshMs: 3_000, retainMs: 3_000 };
  if (resource === "/v1/messages/inbox" || /^\/v1\/messages\/threads\/[^/]+$/.test(resource))
    return { freshMs: 1_500, retainMs: 1_500 };
  if (resource === "/v1/notifications/inbox") return { freshMs: 2_000, retainMs: 2_000 };
  return freshOnly;
}

export function cacheScopeForUser(user: { id: string; universityId: string | null; roles: string[]; operatorRoles: string[] }): string {
  return JSON.stringify([user.id, user.universityId, [...user.roles].sort(), [...user.operatorRoles].sort()]);
}
export function cacheExpiry(path: string, now: number, ttl: number): number {
  // Today must never reuse yesterday's snapshot across midnight WAT.
  const midnight = (Math.floor((now + 3_600_000) / 86_400_000) + 1) * 86_400_000 - 3_600_000;
  return path.split("?")[0] === "/v1/student/home" ? Math.min(now + ttl, midnight) : now + ttl;
}
