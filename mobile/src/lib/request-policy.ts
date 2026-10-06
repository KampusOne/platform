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

/** Background bookkeeping must never evict unrelated screen data. */
export function invalidationTargets(path: string): string[] | null {
  if (/^\/v1\/student\/feed\/[^/]+\/view$/.test(path)) return [];
  if (path === "/v1/student/events") return [];
  if (path === "/v1/analytics/events") return [];
  if (path === "/v1/notifications/alarm-events") return [];
  if (
    path === "/v1/notifications/devices" ||
    /^\/v1\/notifications\/devices\//.test(path)
  )
    return [];

  if (path === "/v1/account/streak") return ["/v1/student/home"];
  if (path.startsWith("/v1/student/feed"))
    return ["/v1/student/feed", "/v1/student/home"];
  if (path.startsWith("/v1/media"))
    return /^\/v1\/media\/message-uploads(?:\/|$)/.test(path) ? [] : ["/v1/student/me", "/v1/student/feed", "/v1/student/home"];
  if (path.startsWith("/v1/student/timetable"))
    return ["/v1/student/timetable", "/v1/student/home"];
  if (path.startsWith("/v1/student/gpa"))
    return ["/v1/student/gpa", "/v1/student/home"];
  if (path.startsWith("/v1/messages")) return ["/v1/messages"];
  if (path.startsWith("/v1/notifications")) return ["/v1/notifications"];
  if (path.startsWith("/v1/learning/alarms"))
    return ["/v1/learning/alarms", "/v1/student/timetable"];
  if (path.startsWith("/v1/calendar")) return ["/v1/calendar"];
  if (path.startsWith("/v1/communities")) return ["/v1/communities"];
  if (path.startsWith("/v1/applications")) return ["/v1/applications"];
  if (path.startsWith("/v1/agents")) return ["/v1/agents"];
  if (path.startsWith("/v1/people"))
    return ["/v1/people", "/v1/student/feed"];
  if (path.startsWith("/v1/account"))
    return ["/v1/account", "/v1/student/me", "/v1/student/home"];

  return null; // Unknown mutations and session transitions invalidate conservatively.
}
export function matchesRead(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "?") || path.startsWith(prefix + "/");
}
